//! Product search, CRUD, quick-access shortcuts and bulk import.

use sea_orm::sea_query::{Expr, Order};
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, Condition, ConnectionTrait,
    DatabaseConnection, DbBackend, EntityTrait, JoinType, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, RelationTrait, Select, Set, Statement, TransactionTrait,
};

use crate::domain::products::{
    BulkImportResult, BulkProductInput, CreateProductInput, PaginatedProducts, ProductSearchParams,
    ShortcutProduct, UpdateProductInput,
};
use crate::domain::Actor;
use crate::entity::{categories, product_shortcuts, products};
use crate::services::guard;
use crate::utils::AppError;

fn now_ts() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

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
pub fn low_stock_condition() -> Condition {
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
pub enum ProductSort {
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
    pub const DEFAULT: ProductSort = ProductSort::Name;

    pub fn from_param(value: Option<&str>) -> ProductSort {
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
    let offset = (page - 1) * per_page;

    let total = products::Entity::find()
        .filter(build_search_condition(&params))
        .count(db)
        .await? as i64;

    let total_pages = if total == 0 {
        1
    } else {
        (total + per_page - 1) / per_page
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

/// Price and stock rules shared by create and update.
fn validate_product_fields(
    name: &str,
    sell_price: f64,
    buy_price: f64,
    stock: i64,
) -> Result<String, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "Nama produk tidak boleh kosong".to_string(),
        ));
    }
    if sell_price <= 0.0 {
        return Err(AppError::Validation(
            "Harga jual harus lebih dari 0".to_string(),
        ));
    }
    if buy_price < 0.0 {
        return Err(AppError::Validation(
            "Harga beli tidak boleh negatif".to_string(),
        ));
    }
    if stock < 0 {
        return Err(AppError::Validation("Stok tidak boleh negatif".to_string()));
    }
    Ok(name)
}

/// Trims a barcode or SKU and treats a blank one as absent.
///
/// `barcode` and `sku` are UNIQUE columns, and SQLite counts `''` as a value
/// like any other while it lets NULLs repeat freely. Storing the empty string
/// therefore meant the SECOND product saved without a barcode collided with the
/// first.
fn normalize_code(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Makes `barcode` and `sku` available to the product being written, or explains
/// who has them.
///
/// A live product holding the code is a genuine clash and the caller gets a
/// `Validation` error naming it, instead of the bare
/// `UNIQUE constraint failed: products.barcode` the UI had no way to interpret.
///
/// A SOFT-DELETED product holding it is not a clash at all — the row only still
/// exists so old receipts keep resolving — but it kept the code hostage
/// forever: delete a product and it became impossible to create it again, from
/// any screen, with no way out. The rule is that a deleted product never blocks
/// a live one, so the code is released from it (set to NULL) and the caller
/// proceeds. The deleted row keeps everything history depends on; its name and
/// price are snapshotted onto `transaction_items` anyway, and nothing looks a
/// deleted product up by barcode.
///
/// `exclude_id` is the product being updated, which is allowed to keep its own
/// codes.
async fn claim_codes<C: ConnectionTrait>(
    db: &C,
    barcode: Option<&str>,
    sku: Option<&str>,
    exclude_id: Option<i64>,
) -> Result<(), AppError> {
    for (label, is_barcode, value) in [("Barcode", true, barcode), ("SKU", false, sku)] {
        let Some(value) = value else { continue };

        let column = if is_barcode {
            products::Column::Barcode
        } else {
            products::Column::Sku
        };

        let mut query = products::Entity::find().filter(column.eq(value));
        if let Some(id) = exclude_id {
            query = query.filter(products::Column::Id.ne(id));
        }
        let Some(holder) = query.one(db).await? else {
            continue;
        };

        if holder.is_active {
            return Err(AppError::Validation(format!(
                "{} '{}' sudah dipakai produk '{}'",
                label, value, holder.name
            )));
        }

        let mut released: products::ActiveModel = holder.into();
        if is_barcode {
            released.barcode = Set(None);
        } else {
            released.sku = Set(None);
        }
        released.updated_at = Set(Some(now_ts()));
        released.update(db).await?;
    }

    Ok(())
}

pub async fn create(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateProductInput,
) -> Result<products::Model, AppError> {
    guard::require_admin(actor)?;

    let name =
        validate_product_fields(&input.name, input.sell_price, input.buy_price, input.stock)?;
    let barcode = normalize_code(input.barcode);
    let sku = normalize_code(input.sku);

    let now = now_ts();

    // Releasing a dead product's code and taking it must be one unit of work,
    // or a failure in between would leave the catalogue with the code freed and
    // nothing holding it.
    let txn = db.begin().await?;
    claim_codes(&txn, barcode.as_deref(), sku.as_deref(), None).await?;

    let new_product = products::ActiveModel {
        id: NotSet,
        barcode: Set(barcode),
        sku: Set(sku),
        name: Set(name),
        category_id: Set(input.category_id),
        buy_price: Set(input.buy_price),
        sell_price: Set(input.sell_price),
        margin: Set(input.margin.unwrap_or(0.0)),
        stock: Set(input.stock),
        unit: Set(input.unit),
        min_stock: Set(Some(input.min_stock.unwrap_or(0))),
        is_active: Set(true),
        created_at: Set(Some(now.clone())),
        updated_at: Set(Some(now)),
    };

    let product = new_product.insert(&txn).await?;
    txn.commit().await?;
    Ok(product)
}

pub async fn update(
    db: &DatabaseConnection,
    actor: &Actor,
    input: UpdateProductInput,
) -> Result<products::Model, AppError> {
    guard::require_admin(actor)?;

    let name =
        validate_product_fields(&input.name, input.sell_price, input.buy_price, input.stock)?;
    let barcode = normalize_code(input.barcode);
    let sku = normalize_code(input.sku);

    let txn = db.begin().await?;

    let existing = products::Entity::find_by_id(input.id)
        .filter(products::Column::IsActive.eq(true))
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan".to_string()))?;

    claim_codes(&txn, barcode.as_deref(), sku.as_deref(), Some(existing.id)).await?;

    let mut active: products::ActiveModel = existing.into();
    active.barcode = Set(barcode);
    active.sku = Set(sku);
    active.name = Set(name);
    active.category_id = Set(input.category_id);
    active.buy_price = Set(input.buy_price);
    active.sell_price = Set(input.sell_price);
    active.margin = Set(input.margin.unwrap_or(0.0));
    active.stock = Set(input.stock);
    active.unit = Set(input.unit);
    active.min_stock = Set(Some(input.min_stock.unwrap_or(0)));
    active.updated_at = Set(Some(now_ts()));

    let product = active.update(&txn).await?;
    txn.commit().await?;
    Ok(product)
}

/// Soft delete: the row stays for transaction history, `is_active` goes false.
pub async fn delete(db: &DatabaseConnection, actor: &Actor, id: i64) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    let existing = products::Entity::find_by_id(id)
        .filter(products::Column::IsActive.eq(true))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan".to_string()))?;

    let mut active: products::ActiveModel = existing.into();
    active.is_active = Set(false);
    active.updated_at = Set(Some(now_ts()));
    active.update(db).await?;

    Ok(())
}

pub async fn popular(
    db: &DatabaseConnection,
    limit: Option<i64>,
) -> Result<Vec<ShortcutProduct>, AppError> {
    let limit = limit.unwrap_or(20).clamp(1, 200);

    // Get shortcuts with product data: pinned first, then by select_count
    let rows = products::Entity::find()
        .from_raw_sql(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            r#"SELECT p.id, p.barcode, p.sku, p.name, p.category_id, p.buy_price,
                      p.sell_price, p.margin, p.stock, p.unit, p.min_stock, p.is_active,
                      p.created_at, p.updated_at
               FROM products p
               INNER JOIN product_shortcuts s ON p.id = s.product_id
               WHERE p.is_active = 1
                 AND (s.is_pinned = 1 OR s.select_count > 0)
               ORDER BY s.is_pinned DESC, s.select_count DESC
               LIMIT $1"#,
            vec![limit.into()],
        ))
        .all(db)
        .await?;

    // Get shortcut metadata for each product
    let product_ids: Vec<i64> = rows.iter().map(|p| p.id).collect();
    let shortcuts = product_shortcuts::Entity::find()
        .filter(product_shortcuts::Column::ProductId.is_in(product_ids))
        .all(db)
        .await?;

    let result: Vec<ShortcutProduct> = rows
        .into_iter()
        .map(|p| {
            let shortcut = shortcuts.iter().find(|s| s.product_id == p.id);
            ShortcutProduct {
                product: p,
                is_pinned: shortcut.is_some_and(|s| s.is_pinned),
                select_count: shortcut.map_or(0, |s| s.select_count),
            }
        })
        .collect();

    Ok(result)
}

pub async fn track_selection(db: &DatabaseConnection, product_id: i64) -> Result<(), AppError> {
    let now = now_ts();

    let existing = product_shortcuts::Entity::find()
        .filter(product_shortcuts::Column::ProductId.eq(product_id))
        .one(db)
        .await?;

    if let Some(shortcut) = existing {
        let mut active: product_shortcuts::ActiveModel = shortcut.into();
        active.select_count = Set(active.select_count.unwrap() + 1);
        active.last_selected_at = Set(Some(now));
        active.update(db).await?;
    } else {
        let new_shortcut = product_shortcuts::ActiveModel {
            id: NotSet,
            product_id: Set(product_id),
            select_count: Set(1),
            is_pinned: Set(false),
            last_selected_at: Set(Some(now.clone())),
            created_at: Set(Some(now)),
        };
        new_shortcut.insert(db).await?;
    }

    Ok(())
}

/// Flip the pin on a product's quick-access shortcut, creating it if needed.
/// Returns the new pinned state.
pub async fn toggle_pin(db: &DatabaseConnection, product_id: i64) -> Result<bool, AppError> {
    let now = now_ts();

    let existing = product_shortcuts::Entity::find()
        .filter(product_shortcuts::Column::ProductId.eq(product_id))
        .one(db)
        .await?;

    if let Some(shortcut) = existing {
        let new_pinned = !shortcut.is_pinned;
        let mut active: product_shortcuts::ActiveModel = shortcut.into();
        active.is_pinned = Set(new_pinned);
        active.update(db).await?;
        Ok(new_pinned)
    } else {
        let new_shortcut = product_shortcuts::ActiveModel {
            id: NotSet,
            product_id: Set(product_id),
            select_count: Set(0),
            is_pinned: Set(true),
            last_selected_at: Set(Some(now.clone())),
            created_at: Set(Some(now)),
        };
        new_shortcut.insert(db).await?;
        Ok(true)
    }
}

/// Import a spreadsheet's worth of rows in one transaction. Rows that fail
/// validation are counted and reported rather than aborting the batch; rows
/// matched by barcode are updated instead of inserted.
pub async fn bulk_create(
    db: &DatabaseConnection,
    actor: &Actor,
    rows: Vec<BulkProductInput>,
) -> Result<BulkImportResult, AppError> {
    guard::require_admin(actor)?;

    use crate::entity::categories as cat_ent;
    use crate::entity::products as prod_ent;

    let txn = db.begin().await?;

    let mut imported: i64 = 0;
    let mut updated: i64 = 0;
    let mut skipped: i64 = 0;
    let mut errors: Vec<String> = Vec::new();

    for (idx, input) in rows.iter().enumerate() {
        let row_num = idx + 1;
        let name = input.name.trim().to_string();

        if name.is_empty() {
            skipped += 1;
            continue;
        }

        // The same price and stock rules `create` enforces. The importer used to
        // check only the sell price, so a spreadsheet could put negative buy
        // prices and negative stock into the catalogue through the one door that
        // touches hundreds of rows at a time.
        if input.sell_price <= 0.0 {
            skipped += 1;
            errors.push(format!("Baris {}: Harga jual harus lebih dari 0", row_num));
            continue;
        }

        if input.buy_price < 0.0 {
            skipped += 1;
            errors.push(format!("Baris {}: Harga beli tidak boleh negatif", row_num));
            continue;
        }

        if input.stock < 0 {
            skipped += 1;
            errors.push(format!("Baris {}: Stok tidak boleh negatif", row_num));
            continue;
        }

        let unit = input
            .unit
            .as_deref()
            .map(|u| u.trim())
            .filter(|u| !u.is_empty())
            .unwrap_or("pcs")
            .to_string();

        // Resolve category
        let category_id: Option<i64> = match &input.category_name {
            Some(cat_name) if !cat_name.trim().is_empty() => {
                let cat_trimmed = cat_name.trim();
                let existing = cat_ent::Entity::find()
                    .filter(cat_ent::Column::Name.eq(cat_trimmed))
                    .one(&txn)
                    .await?;

                match existing {
                    Some(cat) => Some(cat.id),
                    None => {
                        let new_cat = cat_ent::ActiveModel {
                            id: NotSet,
                            name: Set(cat_trimmed.to_string()),
                            description: Set(None),
                            created_at: Set(Some(now_ts())),
                        };
                        let cat = new_cat.insert(&txn).await?;
                        Some(cat.id)
                    }
                }
            }
            _ => None,
        };

        // Resolve barcode
        let barcode = input
            .barcode
            .as_deref()
            .map(|b| b.trim())
            .filter(|b| !b.is_empty())
            .map(|b| b.to_string());

        // Find the product this row is about.
        //
        // A barcode is the authoritative identity, so it is tried first. Rows
        // WITHOUT one used to match nothing at all and always insert, which is
        // why importing the same 500-line price list twice doubled the
        // catalogue: unbarcoded goods (loose rice, sugar by the kilo) have
        // nothing else to be recognised by. They now match on the product name,
        // compared case-insensitively after trimming, and the lowest id wins if
        // the catalogue somehow holds two products under one name.
        //
        // Either way only LIVE products are matched. The old code matched
        // deleted ones too and set `is_active = 1` on them, so an import could
        // resurrect products an admin had removed on purpose, with no mention of
        // it anywhere. A barcode belonging to a deleted product now stops that
        // row and says so; freeing the code is a decision for the product screen,
        // where a human is looking at it.
        let existing_product = match &barcode {
            Some(bc) => {
                let holder = prod_ent::Entity::find()
                    .filter(prod_ent::Column::Barcode.eq(bc.as_str()))
                    .one(&txn)
                    .await?;

                match holder {
                    Some(dead) if !dead.is_active => {
                        skipped += 1;
                        errors.push(format!(
                            "Baris {}: Barcode '{}' masih dipakai produk '{}' yang sudah dihapus",
                            row_num, bc, dead.name
                        ));
                        continue;
                    }
                    other => other,
                }
            }
            None => {
                prod_ent::Entity::find()
                    .filter(prod_ent::Column::IsActive.eq(true))
                    .filter(Expr::cust_with_values(
                        "LOWER(name) = LOWER(?)",
                        [name.as_str()],
                    ))
                    .order_by_asc(prod_ent::Column::Id)
                    .one(&txn)
                    .await?
            }
        };

        let margin = input.margin.unwrap_or(0.0);
        let now = now_ts();

        if let Some(existing) = existing_product {
            let mut active: prod_ent::ActiveModel = existing.into();
            active.name = Set(name);
            active.category_id = Set(category_id);
            active.buy_price = Set(input.buy_price);
            active.sell_price = Set(input.sell_price);
            active.margin = Set(margin);
            active.stock = Set(input.stock);
            active.unit = Set(unit);
            // `is_active` is deliberately left alone: only live products are
            // matched above, so there is nothing to reactivate.
            active.updated_at = Set(Some(now));

            match active.update(&txn).await {
                Ok(_) => updated += 1,
                Err(e) => {
                    skipped += 1;
                    errors.push(format!("Baris {}: {}", row_num, e));
                }
            }
        } else {
            let new_product = prod_ent::ActiveModel {
                id: NotSet,
                barcode: Set(barcode),
                sku: Set(None),
                name: Set(name),
                category_id: Set(category_id),
                buy_price: Set(input.buy_price),
                sell_price: Set(input.sell_price),
                margin: Set(margin),
                stock: Set(input.stock),
                unit: Set(unit),
                min_stock: Set(Some(0)),
                is_active: Set(true),
                created_at: Set(Some(now.clone())),
                updated_at: Set(Some(now)),
            };

            match new_product.insert(&txn).await {
                Ok(_) => imported += 1,
                Err(e) => {
                    skipped += 1;
                    errors.push(format!("Baris {}: {}", row_num, e));
                }
            }
        }
    }

    txn.commit().await?;

    Ok(BulkImportResult {
        imported,
        updated,
        skipped,
        errors,
    })
}

/// Filename offered for the import template download.
pub const IMPORT_TEMPLATE_FILENAME: &str = "template-import-produk.csv";

/// The import template, generated server-side, next to the importer
/// ([`bulk_create`]) that has to understand its columns.
pub fn import_template_csv() -> String {
    const HEADERS: [&str; 7] = [
        "Nama Produk",
        "Barcode",
        "Kategori",
        "Harga Beli",
        "Harga Jual",
        "Stok",
        "Satuan",
    ];
    const SAMPLE_ROWS: [[&str; 7]; 3] = [
        [
            "Indomie Goreng",
            "8996001010013",
            "Mie Instan",
            "2500",
            "3000",
            "100",
            "pcs",
        ],
        [
            "Gula Pasir 1kg",
            "8991002101036",
            "Bahan Pokok",
            "14000",
            "16000",
            "50",
            "pcs",
        ],
        [
            "Minyak Goreng 1L",
            "",
            "Minyak",
            "18000",
            "20000",
            "30",
            "pcs",
        ],
    ];

    std::iter::once(HEADERS.join(","))
        .chain(SAMPLE_ROWS.iter().map(|row| row.join(",")))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::setup_test_db;

    fn admin() -> Actor {
        Actor::new(1, "admin")
    }

    fn make_valid_input() -> CreateProductInput {
        CreateProductInput {
            barcode: Some("1234567890123".to_string()),
            sku: Some("SKU-001".to_string()),
            name: "Beras 5kg".to_string(),
            category_id: None,
            buy_price: 50_000.0,
            sell_price: 65_000.0,
            margin: None,
            stock: 100,
            unit: "pcs".to_string(),
            min_stock: Some(10),
        }
    }

    #[tokio::test]
    async fn test_create_product_success() {
        let conn = setup_test_db().await;
        let input = make_valid_input();

        let product = create(&conn, &admin(), input)
            .await
            .expect("create should succeed");

        assert_eq!(product.name, "Beras 5kg");
        assert_eq!(product.sell_price, 65_000.0);
        assert_eq!(product.buy_price, 50_000.0);
        assert_eq!(product.stock, 100);
        assert!(product.is_active);
        assert_eq!(product.barcode, Some("1234567890123".to_string()));
        assert_eq!(product.sku, Some("SKU-001".to_string()));
        assert_eq!(product.unit, "pcs");
        assert_eq!(product.min_stock, Some(10));
    }

    #[tokio::test]
    async fn test_create_product_empty_name_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.name = "   ".to_string();

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("kosong")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_zero_sell_price_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.sell_price = 0.0;

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Harga jual")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_negative_sell_price_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.sell_price = -100.0;

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Harga jual")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_negative_buy_price_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.buy_price = -1.0;

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("negatif")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_negative_stock_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.stock = -5;

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Stok")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_trims_name() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.name = "  Gula Pasir 1kg  ".to_string();
        input.barcode = None;
        input.sku = None;

        let product = create(&conn, &admin(), input)
            .await
            .expect("create should succeed");

        assert_eq!(product.name, "Gula Pasir 1kg");
    }

    #[tokio::test]
    async fn test_create_product_kasir_rejected() {
        let conn = setup_test_db().await;

        let input = make_valid_input();
        let result = create(&conn, &Actor::new(2, "kasir"), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Forbidden(_) => {} // expected — kasir cannot create products
            other => panic!("Expected Forbidden error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_delete_product_soft_deletes() {
        let conn = setup_test_db().await;
        let input = make_valid_input();

        let product = create(&conn, &admin(), input)
            .await
            .expect("create should succeed");
        assert!(product.is_active);

        delete(&conn, &admin(), product.id)
            .await
            .expect("delete should succeed");

        // Product still exists in DB but is_active = false
        let deleted = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("product should still exist in DB");

        assert!(!deleted.is_active);
    }

    #[tokio::test]
    async fn test_delete_nonexistent_product_fails() {
        let conn = setup_test_db().await;

        let result = delete(&conn, &admin(), 999).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(_) => {} // expected
            other => panic!("Expected NotFound error, got: {:?}", other),
        }
    }

    // --- Barcode and SKU uniqueness ---

    /// A live product holding the code is a real clash, and the message has to
    /// name it. The UI used to be handed
    /// `UNIQUE constraint failed: products.barcode` with nothing to do about it.
    #[tokio::test]
    async fn a_barcode_a_live_product_holds_is_a_validation_error() {
        let conn = setup_test_db().await;
        create(&conn, &admin(), make_valid_input())
            .await
            .expect("first product");

        let mut second = make_valid_input();
        second.name = "Beras 10kg".to_string();
        second.sku = Some("SKU-002".to_string());

        match create(&conn, &admin(), second).await.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("1234567890123"), "names the code: {}", msg);
                assert!(msg.contains("Beras 5kg"), "names the holder: {}", msg);
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn a_sku_a_live_product_holds_is_a_validation_error() {
        let conn = setup_test_db().await;
        create(&conn, &admin(), make_valid_input())
            .await
            .expect("first product");

        let mut second = make_valid_input();
        second.name = "Beras 10kg".to_string();
        second.barcode = Some("9999999999999".to_string());

        match create(&conn, &admin(), second).await.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("SKU-001"), "{}", msg),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    /// Deleting a product used to take its barcode to the grave: recreating it
    /// was impossible from any screen. A soft-deleted row never blocks a live
    /// one — the code is released and the new product takes it.
    #[tokio::test]
    async fn a_deleted_products_barcode_can_be_used_again() {
        let conn = setup_test_db().await;
        let first = create(&conn, &admin(), make_valid_input())
            .await
            .expect("first product");
        delete(&conn, &admin(), first.id)
            .await
            .expect("soft delete");

        let recreated = create(&conn, &admin(), make_valid_input())
            .await
            .expect("the barcode is free again");

        assert_eq!(recreated.barcode, Some("1234567890123".to_string()));
        assert_eq!(recreated.sku, Some("SKU-001".to_string()));

        let released = products::Entity::find_by_id(first.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("the deleted row is still there for history");
        assert!(!released.is_active);
        assert_eq!(released.barcode, None);
        assert_eq!(released.sku, None);
    }

    #[tokio::test]
    async fn update_cannot_steal_a_live_products_barcode_but_can_take_a_dead_ones() {
        let conn = setup_test_db().await;
        let first = create(&conn, &admin(), make_valid_input())
            .await
            .expect("first product");

        let mut second_input = make_valid_input();
        second_input.name = "Gula 1kg".to_string();
        second_input.barcode = Some("2222222222222".to_string());
        second_input.sku = Some("SKU-002".to_string());
        let second = create(&conn, &admin(), second_input)
            .await
            .expect("second product");

        let take_it = |barcode: &str| UpdateProductInput {
            id: second.id,
            barcode: Some(barcode.to_string()),
            sku: Some("SKU-002".to_string()),
            name: "Gula 1kg".to_string(),
            category_id: None,
            buy_price: 10_000.0,
            sell_price: 12_000.0,
            margin: None,
            stock: 5,
            unit: "pcs".to_string(),
            min_stock: None,
        };

        match update(&conn, &admin(), take_it("1234567890123"))
            .await
            .unwrap_err()
        {
            AppError::Validation(msg) => assert!(msg.contains("Beras 5kg"), "{}", msg),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        delete(&conn, &admin(), first.id)
            .await
            .expect("soft delete");

        let updated = update(&conn, &admin(), take_it("1234567890123"))
            .await
            .expect("a deleted product does not hold a barcode hostage");
        assert_eq!(updated.barcode, Some("1234567890123".to_string()));
    }

    /// A product may keep the codes it already has.
    #[tokio::test]
    async fn update_leaves_a_product_its_own_codes() {
        let conn = setup_test_db().await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");

        let updated = update(
            &conn,
            &admin(),
            UpdateProductInput {
                id: product.id,
                barcode: product.barcode.clone(),
                sku: product.sku.clone(),
                name: "Beras 5kg Premium".to_string(),
                category_id: None,
                buy_price: 50_000.0,
                sell_price: 70_000.0,
                margin: None,
                stock: 100,
                unit: "pcs".to_string(),
                min_stock: Some(10),
            },
        )
        .await
        .expect("update");

        assert_eq!(updated.name, "Beras 5kg Premium");
        assert_eq!(updated.barcode, product.barcode);
    }

    /// `''` is a value as far as a UNIQUE index is concerned, so a blank code
    /// has to become NULL or the second product saved without one collides with
    /// the first.
    #[tokio::test]
    async fn a_blank_barcode_is_stored_as_null() {
        let conn = setup_test_db().await;

        for name in ["Beras Curah", "Gula Curah"] {
            let mut input = make_valid_input();
            input.name = name.to_string();
            input.barcode = Some("   ".to_string());
            input.sku = Some(String::new());
            let product = create(&conn, &admin(), input)
                .await
                .unwrap_or_else(|e| panic!("'{}' saves without a code: {:?}", name, e));
            assert_eq!(product.barcode, None);
            assert_eq!(product.sku, None);
        }
    }

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
            &conn,
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
            assert_eq!(ProductSort::from_param(Some(junk)), ProductSort::DEFAULT, "{junk:?}");
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
        assert_eq!(names_sorted_by(&conn, "name", "asc").await, vec!["Apel", "Zebra"]);
    }

    /// Anything but `desc` — including a typo — means ascending.
    #[tokio::test]
    async fn only_desc_reverses_the_order() {
        let conn = setup_test_db().await;
        seed(&conn, "Sedikit", 1, None).await;
        seed(&conn, "Banyak", 9, None).await;

        assert_eq!(names_sorted_by(&conn, "stock", "desc").await, vec!["Banyak", "Sedikit"]);
        assert_eq!(names_sorted_by(&conn, "stock", "DESC").await, vec!["Sedikit", "Banyak"]);
        assert_eq!(names_sorted_by(&conn, "stock", "turun").await, vec!["Sedikit", "Banyak"]);
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

    // --- Bulk import ---

    fn import_row(name: &str, barcode: Option<&str>) -> BulkProductInput {
        BulkProductInput {
            barcode: barcode.map(str::to_string),
            name: name.to_string(),
            category_name: None,
            buy_price: 10_000.0,
            sell_price: 12_000.0,
            margin: None,
            stock: 5,
            unit: None,
        }
    }

    /// Loose goods have no barcode, so nothing matched them and every import
    /// inserted a fresh row. Running the same price list twice doubled the
    /// catalogue.
    #[tokio::test]
    async fn importing_the_same_unbarcoded_list_twice_updates_instead_of_duplicating() {
        let conn = setup_test_db().await;
        let rows = vec![
            import_row("Beras Curah", None),
            import_row("Gula Curah", None),
        ];

        let first = bulk_create(&conn, &admin(), rows).await.expect("import");
        assert_eq!(first.imported, 2);
        assert_eq!(first.updated, 0);

        let mut second_rows = vec![
            import_row("beras curah", None),
            import_row("Gula Curah", None),
        ];
        second_rows[0].sell_price = 15_000.0;
        let second = bulk_create(&conn, &admin(), second_rows)
            .await
            .expect("import");
        assert_eq!(second.imported, 0, "nothing new to insert");
        assert_eq!(second.updated, 2, "matched by name, case-insensitively");

        let total = products::Entity::find().all(&conn).await.expect("query");
        assert_eq!(total.len(), 2);
        let beras = total
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case("beras curah"))
            .expect("beras");
        assert_eq!(beras.sell_price, 15_000.0);
    }

    /// The importer used to check the sell price only, so a spreadsheet could
    /// push negative buy prices and negative stock into hundreds of rows at once.
    #[tokio::test]
    async fn import_applies_the_same_price_and_stock_rules_as_create() {
        let conn = setup_test_db().await;

        let mut negative_buy = import_row("Harga beli minus", None);
        negative_buy.buy_price = -1.0;
        let mut negative_stock = import_row("Stok minus", None);
        negative_stock.stock = -5;
        let mut free = import_row("Gratis", None);
        free.sell_price = 0.0;

        let result = bulk_create(&conn, &admin(), vec![negative_buy, negative_stock, free])
            .await
            .expect("import");

        assert_eq!(result.imported, 0);
        assert_eq!(result.skipped, 3);
        assert_eq!(result.errors.len(), 3);
        assert_eq!(products::Entity::find().all(&conn).await.unwrap().len(), 0);
    }

    /// An unattended bulk path must not bring back products an admin removed on
    /// purpose. It stops the row and says whose barcode it is.
    #[tokio::test]
    async fn import_does_not_resurrect_a_deleted_product() {
        let conn = setup_test_db().await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");
        delete(&conn, &admin(), product.id)
            .await
            .expect("soft delete");

        let result = bulk_create(
            &conn,
            &admin(),
            vec![import_row("Beras 5kg", Some("1234567890123"))],
        )
        .await
        .expect("import");

        assert_eq!(result.imported, 0);
        assert_eq!(result.updated, 0);
        assert_eq!(result.skipped, 1);
        assert!(
            result.errors[0].contains("sudah dihapus"),
            "explains itself: {}",
            result.errors[0]
        );

        let still_deleted = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("row");
        assert!(!still_deleted.is_active);
    }

    #[tokio::test]
    async fn test_delete_already_deleted_product_fails() {
        let conn = setup_test_db().await;
        let input = make_valid_input();

        let product = create(&conn, &admin(), input)
            .await
            .expect("create should succeed");

        delete(&conn, &admin(), product.id)
            .await
            .expect("first delete should succeed");

        // Second delete should fail — product is already inactive
        let result = delete(&conn, &admin(), product.id).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(_) => {} // expected — already soft-deleted
            other => panic!("Expected NotFound error, got: {:?}", other),
        }
    }
}
