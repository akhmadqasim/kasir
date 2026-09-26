//! The product list: search, quick filters, sorting and barcode lookup.

use sea_orm::sea_query::{Expr, Order};
use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, JoinType, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, RelationTrait, Select,
};

use crate::domain::products::{PaginatedProducts, ProductSearchParams};
use crate::entity::{categories, products};
use crate::utils::AppError;

/// The one definition of "stok menipis", as a SQL predicate over an unaliased
/// `products` row.
///
/// There used to be four: this module's quick filter said
/// `stock <= 0 OR stock <= min_stock`, `dashboard::summary` and
/// `dashboard::low_stock_products` both said
/// `min_stock IS NOT NULL AND min_stock > 0 AND stock <= min_stock`, and
/// `reports::current_stock` said `stock <= min_stock AND min_stock > 0`. The
/// product screen therefore listed items the dashboard did not count, and the
/// stock report listed a third set.
///
/// The rule kept is "at or below the reorder point, and an unset reorder point
/// means zero": anything out of stock always needs restocking, whether or not
/// someone got round to setting a threshold for it, and a product with a
/// threshold is low as soon as it reaches it. Compared with the old dashboard
/// rule this adds the out-of-stock items that never had a `min_stock` — which is
/// the majority of a freshly imported catalogue, and exactly what the shop needs
/// to see.
///
/// Written without a table alias on purpose so it can be dropped into a query
/// that aliases `products` and one that does not; no other table joined
/// alongside it has a `stock` or `min_stock` column.
pub const LOW_STOCK_SQL: &str = "stock <= COALESCE(min_stock, 0)";

/// [`LOW_STOCK_SQL`] as a sea-orm condition, for the query builder paths.
fn low_stock_condition() -> Condition {
    Condition::all().add(Expr::cust(LOW_STOCK_SQL))
}

/// `true` when `trimmed` is a digit run that could be the *tail* of a barcode
/// the cashier is reading off a worn label — the gate on the suffix match in
/// [`build_search_condition`].
///
/// Under 3 digits matches so much of a 10k catalogue that the result list tells
/// the user nothing, and that short a query is far likelier to be the start of a
/// longer code still being typed. From 13 up is a whole code, which the prefix
/// match already resolves to exactly one product — widening it would only add
/// coincidental tails alongside the answer.
///
/// Digits only, which is also why the `LIKE` pattern built from it needs no
/// escaping: `%` and `_` cannot get past this check.
fn is_partial_barcode(trimmed: &str) -> bool {
    (3..=12).contains(&trimmed.len()) && trimmed.bytes().all(|b| b.is_ascii_digit())
}

fn build_search_condition(params: &ProductSearchParams) -> Condition {
    let mut condition = Condition::all().add(products::Column::IsActive.eq(true));

    if let Some(ref query) = params.query {
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            // Name stays a substring match (users search product names by fragment).
            // Barcode/SKU use prefix match (LIKE 'q%') so SQLite can seek the
            // idx_products_barcode index — scanning/typing a code is a prefix.
            let mut text_search = Condition::any()
                .add(products::Column::Name.contains(trimmed))
                .add(products::Column::Barcode.starts_with(trimmed))
                .add(products::Column::Sku.starts_with(trimmed));

            // A short digit run also matches the *end* of a barcode, so
            // `484807` finds `8992761484807`. Suffix and not substring on
            // purpose: every Indonesian EAN opens with `899`, so `LIKE '%899%'`
            // would tip the whole catalogue into the result list, and the prefix
            // match above already covers a code read from the front.
            if is_partial_barcode(trimmed) {
                text_search = text_search.add(products::Column::Barcode.ends_with(trimmed));
            }

            // Also match sell_price if query looks like a number
            if let Ok(price) = trimmed.parse::<f64>() {
                text_search = text_search.add(products::Column::SellPrice.eq(price));
            }

            condition = condition.add(text_search);
        }
    }

    if let Some(cat_id) = params.category_id {
        condition = condition.add(products::Column::CategoryId.eq(cat_id));
    }

    if let Some(ref quick_filter) = params.quick_filter {
        condition = match quick_filter.as_str() {
            "low_stock" => condition.add(low_stock_condition()),
            "negative_stock" => condition.add(products::Column::Stock.lt(0)),
            "no_barcode" => condition.add(
                Condition::any()
                    .add(products::Column::Barcode.is_null())
                    .add(products::Column::Barcode.eq("")),
            ),
            // "Perlu ditinjau" means the row has something WRONG with it.
            // `min_stock IS NULL OR min_stock <= 0` used to be in here, and it
            // is true for every product nobody has set a reorder point for —
            // which is almost the whole catalogue, so the filter matched
            // everything and told the user nothing. Not having a reorder point
            // is a normal state, not a defect; what is left is stock that has
            // gone negative, an uncategorised product, and a missing barcode.
            "needs_review" => condition.add(
                Condition::any()
                    .add(products::Column::Stock.lt(0))
                    .add(products::Column::CategoryId.is_null())
                    .add(products::Column::Barcode.is_null())
                    .add(products::Column::Barcode.eq("")),
            ),
            _ => condition,
        };
    }

    condition
}

/// The columns the product list may be ordered by — the allowlist behind the
/// `sort_by` query parameter.
///
/// The parameter is a string from the URL, so it cannot be spliced into the
/// `ORDER BY` as it is; it is mapped onto a known column here, and a name that
/// is not on the list falls back to the default rather than failing the
/// request. Silent fallback rather than a 400 on purpose: a stale client
/// asking for a column this build no longer knows should still get its list,
/// just in the default order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProductSort {
    Name,
    Barcode,
    Category,
    SellPrice,
    Stock,
    CreatedAt,
    UpdatedAt,
}

impl ProductSort {
    /// The order the list comes in when no sort is asked for.
    const DEFAULT: ProductSort = ProductSort::Name;

    fn from_param(value: Option<&str>) -> ProductSort {
        match value {
            Some("name") => ProductSort::Name,
            Some("barcode") => ProductSort::Barcode,
            Some("category") => ProductSort::Category,
            Some("sell_price") => ProductSort::SellPrice,
            Some("stock") => ProductSort::Stock,
            Some("created_at") => ProductSort::CreatedAt,
            Some("updated_at") => ProductSort::UpdatedAt,
            _ => ProductSort::DEFAULT,
        }
    }

    /// Adds this ordering to a product query.
    ///
    /// The category lives in another table, so that one sort joins it; the
    /// join is only paid for when the screen actually sorts by category. An
    /// uncategorised product has no name to sort on, so SQLite puts it first
    /// ascending, the same as a product with a blank barcode.
    fn order(self, query: Select<products::Entity>, order: Order) -> Select<products::Entity> {
        let column = match self {
            ProductSort::Name => products::Column::Name,
            ProductSort::Barcode => products::Column::Barcode,
            ProductSort::SellPrice => products::Column::SellPrice,
            ProductSort::Stock => products::Column::Stock,
            ProductSort::CreatedAt => products::Column::CreatedAt,
            ProductSort::UpdatedAt => products::Column::UpdatedAt,
            ProductSort::Category => {
                return query
                    .join(JoinType::LeftJoin, products::Relation::Category.def())
                    .order_by(categories::Column::Name, order);
            }
        };
        query.order_by(column, order)
    }
}

pub async fn search(
    db: &DatabaseConnection,
    params: ProductSearchParams,
) -> Result<PaginatedProducts, AppError> {
    let page = params.page.unwrap_or(1).max(1);
    let per_page = params.per_page.unwrap_or(50).max(1);
    // Saturating: both come straight from the query string, and a page number
    // big enough to overflow is just a page past the end.
    let offset = (page - 1).saturating_mul(per_page);

    let total = products::Entity::find()
        .filter(build_search_condition(&params))
        .count(db)
        .await? as i64;

    let total_pages = if total == 0 {
        1
    } else {
        (total - 1) / per_page + 1
    };

    let sort = ProductSort::from_param(params.sort_by.as_deref());
    let order = if params.sort_order.as_deref() == Some("desc") {
        Order::Desc
    } else {
        Order::Asc
    };

    let query = sort.order(
        products::Entity::find().filter(build_search_condition(&params)),
        order.clone(),
    );

    // Every sort needs a tiebreaker, not just the timestamps. `ORDER BY stock`
    // over a catalogue where hundreds of rows sit at `stock = 0` — precisely
    // what the low-stock quick filter selects — leaves SQLite free to return
    // those ties in any order it likes, and it does not have to pick the same
    // order twice. `LIMIT/OFFSET` pagination on top of that repeats some rows on
    // page two and skips others entirely. `id` is unique, so appending it makes
    // the order total and the paging stable.
    let query = query.order_by(products::Column::Id, order);

    let data = query
        .offset(Some(offset as u64))
        .limit(Some(per_page as u64))
        .all(db)
        .await?;

    Ok(PaginatedProducts {
        data,
        total,
        page,
        per_page,
        total_pages,
    })
}

pub async fn get_by_barcode(
    db: &DatabaseConnection,
    barcode: &str,
) -> Result<Option<products::Model>, AppError> {
    let product = products::Entity::find()
        .filter(products::Column::Barcode.eq(barcode))
        .filter(products::Column::IsActive.eq(true))
        .one(db)
        .await?;
    Ok(product)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::products::create;
    use crate::services::products::test_fixtures::{admin, make_valid_input};
    use crate::test_support::setup_test_db;

    // --- Search, sorting and filters ---

    async fn seed(conn: &DatabaseConnection, name: &str, stock: i64, min_stock: Option<i64>) {
        let mut input = make_valid_input();
        input.name = name.to_string();
        input.barcode = None;
        input.sku = None;
        input.stock = stock;
        input.min_stock = min_stock;
        create(conn, &admin(), input).await.expect("product");
    }

    fn search_params(sort_by: &str, page: i64, per_page: i64) -> ProductSearchParams {
        ProductSearchParams {
            query: None,
            category_id: None,
            quick_filter: None,
            page: Some(page),
            per_page: Some(per_page),
            sort_by: Some(sort_by.to_string()),
            sort_order: Some("asc".to_string()),
        }
    }

    /// Sorting by a column full of ties — `stock = 0` is the normal state for
    /// hundreds of rows — left SQLite free to order them differently on each
    /// query, so paging repeated some products and skipped others. `id` breaks
    /// every tie now.
    #[tokio::test]
    async fn paging_a_column_full_of_ties_visits_every_row_once() {
        let conn = setup_test_db().await;
        for i in 0..9 {
            seed(&conn, &format!("Produk {}", i), 0, None).await;
        }

        let mut seen: Vec<i64> = Vec::new();
        for page in 1..=3 {
            let result = search(&conn, search_params("stock", page, 3))
                .await
                .expect("search");
            assert_eq!(result.data.len(), 3);
            seen.extend(result.data.iter().map(|p| p.id));
        }

        let unique: std::collections::HashSet<i64> = seen.iter().copied().collect();
        assert_eq!(
            unique.len(),
            9,
            "every product appears exactly once: {:?}",
            seen
        );
    }

    /// The quick filter has to mean the same thing as the dashboard card and the
    /// stock report — `LOW_STOCK_SQL`.
    #[tokio::test]
    async fn the_low_stock_filter_uses_the_shared_definition() {
        let conn = setup_test_db().await;
        seed(&conn, "Habis tanpa ambang", 0, None).await;
        seed(&conn, "Di bawah ambang", 3, Some(5)).await;
        seed(&conn, "Aman", 50, Some(5)).await;

        let mut params = search_params("name", 1, 50);
        params.quick_filter = Some("low_stock".to_string());
        let result = search(&conn, params).await.expect("search");

        let mut names: Vec<&str> = result.data.iter().map(|p| p.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, vec!["Di bawah ambang", "Habis tanpa ambang"]);
    }

    /// `min_stock IS NULL OR min_stock <= 0` is true for practically every
    /// product, so it used to drag the whole catalogue into "perlu ditinjau".
    #[tokio::test]
    async fn needs_review_ignores_an_unset_reorder_point() {
        let conn = setup_test_db().await;

        let mut complete = make_valid_input();
        complete.name = "Lengkap".to_string();
        complete.min_stock = None;
        let category = crate::services::categories::create(
            &conn,
            &admin(),
            crate::domain::categories::CreateCategoryInput {
                name: "Sembako".to_string(),
                description: None,
            },
        )
        .await
        .expect("category");
        complete.category_id = Some(category.id);
        create(&conn, &admin(), complete).await.expect("product");

        seed(&conn, "Tanpa barcode dan kategori", 10, Some(2)).await;

        let mut params = search_params("name", 1, 50);
        params.quick_filter = Some("needs_review".to_string());
        let result = search(&conn, params).await.expect("search");

        assert_eq!(result.data.len(), 1);
        assert_eq!(result.data[0].name, "Tanpa barcode dan kategori");
    }

    // --- Sort allowlist ---

    async fn seed_category(conn: &DatabaseConnection, name: &str) -> i64 {
        crate::services::categories::create(
            conn,
            &admin(),
            crate::domain::categories::CreateCategoryInput {
                name: name.to_string(),
                description: None,
            },
        )
        .await
        .expect("category")
        .id
    }

    async fn seed_in_category(conn: &DatabaseConnection, name: &str, category_id: Option<i64>) {
        let mut input = make_valid_input();
        input.name = name.to_string();
        input.barcode = None;
        input.sku = None;
        input.category_id = category_id;
        create(conn, &admin(), input).await.expect("product");
    }

    async fn names_sorted_by(conn: &DatabaseConnection, sort_by: &str, order: &str) -> Vec<String> {
        let mut params = search_params(sort_by, 1, 50);
        params.sort_order = Some(order.to_string());
        search(conn, params)
            .await
            .expect("search")
            .data
            .into_iter()
            .map(|p| p.name)
            .collect()
    }

    #[test]
    fn every_sortable_column_is_on_the_allowlist_and_nothing_else_is() {
        for (param, expected) in [
            ("name", ProductSort::Name),
            ("barcode", ProductSort::Barcode),
            ("category", ProductSort::Category),
            ("sell_price", ProductSort::SellPrice),
            ("stock", ProductSort::Stock),
            ("created_at", ProductSort::CreatedAt),
            ("updated_at", ProductSort::UpdatedAt),
        ] {
            assert_eq!(ProductSort::from_param(Some(param)), expected, "{param}");
        }
        assert_eq!(ProductSort::from_param(None), ProductSort::DEFAULT);
        // Not a column, a column that is not sortable, and an injection
        // attempt all land on the default rather than in the SQL.
        for junk in ["", "buy_price", "id; DROP TABLE products", "NAME"] {
            assert_eq!(
                ProductSort::from_param(Some(junk)),
                ProductSort::DEFAULT,
                "{junk:?}"
            );
        }
    }

    /// The category is in another table, so this is the one sort that joins.
    /// Uncategorised products sort as an empty name: first ascending, last
    /// descending.
    #[tokio::test]
    async fn sorting_by_category_orders_by_the_category_name() {
        let conn = setup_test_db().await;
        let sembako = seed_category(&conn, "Sembako").await;
        let minuman = seed_category(&conn, "Minuman").await;
        seed_in_category(&conn, "Beras", Some(sembako)).await;
        seed_in_category(&conn, "Teh Botol", Some(minuman)).await;
        seed_in_category(&conn, "Tanpa kategori", None).await;

        assert_eq!(
            names_sorted_by(&conn, "category", "asc").await,
            vec!["Tanpa kategori", "Teh Botol", "Beras"]
        );
        assert_eq!(
            names_sorted_by(&conn, "category", "desc").await,
            vec!["Beras", "Teh Botol", "Tanpa kategori"]
        );
    }

    #[tokio::test]
    async fn an_unknown_sort_column_falls_back_to_the_default_order() {
        let conn = setup_test_db().await;
        seed(&conn, "Zebra", 1, None).await;
        seed(&conn, "Apel", 2, None).await;

        assert_eq!(
            names_sorted_by(&conn, "tidak_ada", "asc").await,
            names_sorted_by(&conn, "name", "asc").await
        );
        assert_eq!(
            names_sorted_by(&conn, "name", "asc").await,
            vec!["Apel", "Zebra"]
        );
    }

    /// Anything but `desc` — including a typo — means ascending.
    #[tokio::test]
    async fn only_desc_reverses_the_order() {
        let conn = setup_test_db().await;
        seed(&conn, "Sedikit", 1, None).await;
        seed(&conn, "Banyak", 9, None).await;

        assert_eq!(
            names_sorted_by(&conn, "stock", "desc").await,
            vec!["Banyak", "Sedikit"]
        );
        assert_eq!(
            names_sorted_by(&conn, "stock", "DESC").await,
            vec!["Sedikit", "Banyak"]
        );
        assert_eq!(
            names_sorted_by(&conn, "stock", "turun").await,
            vec!["Sedikit", "Banyak"]
        );
    }

    // --- Barcode suffix search ---

    /// Seeds the two catalogue rows every case below searches over.
    async fn seed_barcode_catalogue() -> DatabaseConnection {
        let conn = setup_test_db().await;
        for (name, barcode) in [
            ("Indomie Goreng", "8992761484807"),
            ("Sarimi Ayam Bawang", "8991234534567"),
        ] {
            let mut input = make_valid_input();
            input.name = name.to_string();
            input.barcode = Some(barcode.to_string());
            input.sku = None;
            create(&conn, &admin(), input).await.expect("product");
        }
        conn
    }

    async fn search_names(conn: &DatabaseConnection, query: &str) -> Vec<String> {
        let mut params = search_params("name", 1, 50);
        params.query = Some(query.to_string());
        search(conn, params)
            .await
            .expect("search")
            .data
            .into_iter()
            .map(|p| p.name)
            .collect()
    }

    /// The point of the feature: the cashier can only read the last digits off a
    /// worn label and types those.
    #[tokio::test]
    async fn a_digit_run_matches_the_end_of_a_barcode() {
        let conn = seed_barcode_catalogue().await;

        assert_eq!(search_names(&conn, "484807").await, vec!["Indomie Goreng"]);
        assert_eq!(
            search_names(&conn, "34567").await,
            vec!["Sarimi Ayam Bawang"]
        );
    }

    /// The suffix match is additive — a prefix still finds everything it did.
    #[tokio::test]
    async fn a_prefix_still_matches_every_barcode_starting_with_it() {
        let conn = seed_barcode_catalogue().await;

        let mut names = search_names(&conn, "899").await;
        names.sort_unstable();
        assert_eq!(names, vec!["Indomie Goreng", "Sarimi Ayam Bawang"]);
    }

    /// A whole EAN-13 is left to the indexed prefix match, and still resolves to
    /// exactly its own product.
    #[tokio::test]
    async fn a_full_barcode_still_matches_only_its_own_product() {
        let conn = seed_barcode_catalogue().await;

        assert_eq!(
            search_names(&conn, "8992761484807").await,
            vec!["Indomie Goreng"]
        );
    }

    /// Text queries are untouched: no digits, no suffix clause.
    #[tokio::test]
    async fn a_name_fragment_still_searches_names() {
        let conn = seed_barcode_catalogue().await;

        assert_eq!(search_names(&conn, "Indo").await, vec!["Indomie Goreng"]);
    }

    /// A digit run that appears mid-barcode but not at the end must not match —
    /// this is the substring behaviour we deliberately did not implement.
    #[tokio::test]
    async fn a_mid_barcode_digit_run_does_not_match() {
        let conn = seed_barcode_catalogue().await;

        assert!(search_names(&conn, "2761").await.is_empty());
    }

    #[test]
    fn only_short_digit_runs_count_as_a_partial_barcode() {
        assert!(is_partial_barcode("484807"));
        assert!(is_partial_barcode("899"));
        assert!(!is_partial_barcode("89"), "too short to be useful");
        assert!(
            !is_partial_barcode("8992761484807"),
            "a whole EAN-13 belongs to the indexed prefix match"
        );
        assert!(!is_partial_barcode("48a807"), "not all digits");
        assert!(!is_partial_barcode("%4807"), "wildcards cannot reach LIKE");
    }
}
