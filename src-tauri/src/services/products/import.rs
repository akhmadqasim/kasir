//! Bulk import from a spreadsheet, and the template it reads.

use std::collections::HashMap;

use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, DatabaseTransaction,
    EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};

use super::crud::{normalize_code, validate_product_fields};
use crate::domain::products::{BulkImportResult, BulkProductInput};
use crate::domain::Actor;
use crate::entity::{categories as category_entity, products};
use crate::services::{categories, guard};
use crate::utils::time::now_ts;
use crate::utils::AppError;

/// The per-row message for a write the database refused. The `DbErr` itself goes
/// to the error log only: `http::error` keeps database errors away from the
/// client, and the import result is a client response like any other.
fn row_write_failed(row_num: usize, err: &sea_orm::DbErr) -> String {
    crate::utils::logging::log_error(&format!("Import produk baris {}: {}", row_num, err));
    format!("Baris {}: gagal disimpan ke database", row_num)
}

/// The id of the category called `name`, created if the catalogue has none.
///
/// The name is matched case-insensitively after trimming
/// ([`categories::find_by_name`]): a price list typed by hand says "minuman"
/// on one row and "Minuman" on the next, and every spelling but the exact one
/// used to miss the existing category and create a second "Minuman" beside it
/// (`categories.name` is UNIQUE only case-sensitively). A newly created
/// category keeps the spelling of the first row that named it.
///
/// A price list names the same few categories on hundreds of rows, so each
/// name is looked up (or created) once per import and remembered in `cache`,
/// keyed by [`categories::name_key`].
async fn resolve_category(
    txn: &DatabaseTransaction,
    cache: &mut HashMap<String, i64>,
    name: &str,
) -> Result<i64, AppError> {
    let name = name.trim();
    let key = categories::name_key(name);
    if let Some(&id) = cache.get(&key) {
        return Ok(id);
    }

    let id = match categories::find_by_name(txn, name).await? {
        Some(category) => category.id,
        None => {
            category_entity::ActiveModel {
                id: NotSet,
                name: Set(name.to_string()),
                description: Set(None),
                created_at: Set(Some(now_ts())),
            }
            .insert(txn)
            .await?
            .id
        }
    };

    cache.insert(key, id);
    Ok(id)
}

/// Import a spreadsheet's worth of rows in one transaction. Rows that fail
/// validation are counted and reported rather than aborting the batch; rows
/// matched by barcode are updated instead of inserted, writing only the fields
/// the row carries (see [`BulkProductInput`]). The same product twice in one
/// file is reported and skipped from the second row on.
pub async fn bulk_create(
    db: &DatabaseConnection,
    actor: &Actor,
    rows: Vec<BulkProductInput>,
) -> Result<BulkImportResult, AppError> {
    guard::require_admin(actor)?;

    let txn = db.begin().await?;

    let mut imported: i64 = 0;
    let mut updated: i64 = 0;
    let mut skipped: i64 = 0;
    let mut errors: Vec<String> = Vec::new();
    let mut category_ids: HashMap<String, i64> = HashMap::new();
    // Product identity (barcode, or name key on unbarcoded rows) → the row
    // that already wrote it.
    let mut written_rows: HashMap<String, usize> = HashMap::new();
    // Product id → the row that already wrote it. The identity above keys a
    // row by barcode or by name, so "Beras 5kg" with a barcode and "beras 5kg"
    // without one pass it as two products while both land on the same row.
    let mut written_products: HashMap<i64, usize> = HashMap::new();
    // Name key → the first unbarcoded row that wrote a product under that
    // name, and that product's barcode. Lets a barcoded row that misses by
    // barcode still recognise the unbarcoded row above it that wrote the same
    // product (the reverse order is caught by the name lookup below, through
    // `written_products`).
    let mut written_names: HashMap<String, (usize, Option<String>)> = HashMap::new();

    for (idx, input) in rows.iter().enumerate() {
        let row_num = input.row_number.unwrap_or(idx + 1);
        let name = input.name.trim().to_string();

        if name.is_empty() {
            skipped += 1;
            continue;
        }

        // The same price and stock rules `create` enforces. The importer used to
        // check only the sell price, so a spreadsheet could put negative buy
        // prices and negative stock into the catalogue through the one door that
        // touches hundreds of rows at a time. An absent field has nothing to
        // check, so the (valid) zero stands in for it.
        if let Err(e) = validate_product_fields(
            &name,
            input.sell_price,
            input.buy_price.unwrap_or(0.0),
            input.stock.unwrap_or(0),
        ) {
            skipped += 1;
            errors.push(format!("Baris {}: {}", row_num, e));
            continue;
        }

        let barcode = normalize_code(input.barcode.clone());
        let name_key = categories::name_key(&name);
        let barcode_missing = barcode.is_none();

        let (identity, label) = match &barcode {
            Some(bc) => (format!("barcode:{bc}"), format!("Barcode '{bc}'")),
            None => (format!("name:{name_key}"), format!("Produk '{name}'")),
        };
        if let Some(&first_row) = written_rows.get(&identity) {
            skipped += 1;
            errors.push(format!(
                "Baris {row_num}: {label} sudah ada di baris {first_row}, baris ini dilewati"
            ));
            continue;
        }

        let unit = input
            .unit
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .map(str::to_string);

        let category_name = input
            .category_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty());
        let category_id = match category_name {
            Some(name) => Some(resolve_category(&txn, &mut category_ids, name).await?),
            None => None,
        };

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
                let holder = products::Entity::find()
                    .filter(products::Column::Barcode.eq(bc.as_str()))
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
                products::Entity::find()
                    .filter(products::Column::IsActive.eq(true))
                    .filter(Expr::cust_with_values(
                        "LOWER(name) = LOWER(?)",
                        [name.as_str()],
                    ))
                    .order_by_asc(products::Column::Id)
                    .one(&txn)
                    .await?
            }
        };

        // A barcoded row that matched nothing by barcode may still be a
        // product an earlier unbarcoded row of this file created ("beras 5kg"
        // on row 1, "Beras 5kg" with a barcode on row 2): a repeat, skipped
        // like the reverse order is, not a second product. Only when the
        // product written there has no barcode, or this one: an unbarcoded row
        // that updated a product with another barcode says nothing about this
        // barcode, and two barcodes under one name are two products.
        let repeat_by_name = match (&barcode, &existing_product) {
            (Some(bc), None) => written_names
                .get(&name_key)
                .filter(|(_, written_barcode)| {
                    written_barcode.as_ref().is_none_or(|written| written == bc)
                })
                .map(|(first_row, _)| first_row),
            _ => None,
        };
        if let Some(first_row) = repeat_by_name.or_else(|| {
            existing_product
                .as_ref()
                .and_then(|existing| written_products.get(&existing.id))
        }) {
            skipped += 1;
            errors.push(format!(
                "Baris {row_num}: Produk '{name}' sudah ada di baris {first_row}, baris ini dilewati"
            ));
            continue;
        }

        let now = now_ts();
        // The barcode of the product this row writes.
        let written_barcode = match &existing_product {
            Some(existing) => existing.barcode.clone(),
            None => barcode.clone(),
        };

        let written = if let Some(existing) = existing_product {
            let product_id = existing.id;
            let prices_change = existing.sell_price != input.sell_price
                || input.buy_price.is_some_and(|buy| buy != existing.buy_price);
            let had_margin = existing.margin != 0.0;

            // Only what the row says is `Set`; everything else stays
            // `Unchanged` and out of the UPDATE.
            let mut active: products::ActiveModel = existing.into();
            active.name = Set(name);
            active.sell_price = Set(input.sell_price);
            if let Some(id) = category_id {
                active.category_id = Set(Some(id));
            }
            if let Some(buy_price) = input.buy_price {
                active.buy_price = Set(buy_price);
            }
            match input.margin {
                Some(margin) => active.margin = Set(margin),
                // The stored margin is the markup the product form last saved;
                // after a price change it no longer matches the prices. Zero
                // makes the form work it out from the prices again.
                None if prices_change && had_margin => active.margin = Set(0.0),
                None => {}
            }
            if let Some(stock) = input.stock {
                active.stock = Set(stock);
            }
            if let Some(unit) = unit {
                active.unit = Set(unit);
            }
            // `is_active` is deliberately left alone: only live products are
            // matched above, so there is nothing to reactivate.
            active.updated_at = Set(Some(now));

            match active.update(&txn).await {
                Ok(_) => {
                    updated += 1;
                    Some(product_id)
                }
                Err(e) => {
                    skipped += 1;
                    errors.push(row_write_failed(row_num, &e));
                    None
                }
            }
        } else {
            let new_product = products::ActiveModel {
                id: NotSet,
                barcode: Set(barcode),
                sku: Set(None),
                name: Set(name),
                category_id: Set(category_id),
                buy_price: Set(input.buy_price.unwrap_or(0.0)),
                sell_price: Set(input.sell_price),
                margin: Set(input.margin.unwrap_or(0.0)),
                stock: Set(input.stock.unwrap_or(0)),
                unit: Set(unit.unwrap_or_else(|| "pcs".to_string())),
                min_stock: Set(Some(0)),
                is_active: Set(true),
                created_at: Set(Some(now.clone())),
                updated_at: Set(Some(now)),
            };

            match new_product.insert(&txn).await {
                Ok(product) => {
                    imported += 1;
                    Some(product.id)
                }
                Err(e) => {
                    skipped += 1;
                    errors.push(row_write_failed(row_num, &e));
                    None
                }
            }
        };

        if let Some(product_id) = written {
            written_rows.insert(identity, row_num);
            written_products.insert(product_id, row_num);
            // Only unbarcoded rows: two rows with different barcodes under one
            // name are two products, as they would be in the catalogue.
            if barcode_missing {
                written_names
                    .entry(name_key)
                    .or_insert((row_num, written_barcode));
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
    use crate::services::products::test_fixtures::{admin, make_valid_input};
    use crate::services::products::{create, delete};
    use crate::test_support::setup_test_db;

    // --- Bulk import ---

    fn import_row(name: &str, barcode: Option<&str>) -> BulkProductInput {
        BulkProductInput {
            barcode: barcode.map(str::to_string),
            name: name.to_string(),
            category_name: None,
            buy_price: Some(10_000.0),
            sell_price: 12_000.0,
            margin: None,
            stock: Some(5),
            unit: None,
            row_number: None,
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

    /// A hand-typed price list spells the same category three ways. All of
    /// them land in the category the catalogue already has, instead of new
    /// near-duplicates next to it.
    #[tokio::test]
    async fn import_matches_category_names_case_insensitively() {
        let conn = setup_test_db().await;
        let existing = crate::services::categories::create(
            &conn,
            &admin(),
            crate::domain::categories::CreateCategoryInput {
                name: "Minuman".to_string(),
                description: None,
            },
        )
        .await
        .expect("category");

        let mut rows = vec![
            import_row("Teh Botol", None),
            import_row("Air Mineral", None),
            import_row("Kopi Sachet", None),
        ];
        rows[0].category_name = Some("minuman".to_string());
        rows[1].category_name = Some("  MINUMAN ".to_string());
        rows[2].category_name = Some("Minuman".to_string());

        let result = bulk_create(&conn, &admin(), rows).await.expect("import");
        assert_eq!(result.imported, 3);

        let all_categories = category_entity::Entity::find()
            .all(&conn)
            .await
            .expect("query");
        assert_eq!(all_categories.len(), 1, "no near-duplicate was created");
        let imported = products::Entity::find().all(&conn).await.expect("query");
        assert!(imported.iter().all(|p| p.category_id == Some(existing.id)));
    }

    /// A category the catalogue does not have yet is created once, spelled as
    /// the first row spelled it, and reused by the rows that spell it
    /// differently.
    #[tokio::test]
    async fn import_creates_a_new_category_once_whatever_its_case() {
        let conn = setup_test_db().await;
        let mut rows = vec![import_row("Sabun", None), import_row("Sampo", None)];
        rows[0].category_name = Some("Perawatan Diri".to_string());
        rows[1].category_name = Some("perawatan diri".to_string());

        bulk_create(&conn, &admin(), rows).await.expect("import");

        let all_categories = category_entity::Entity::find()
            .all(&conn)
            .await
            .expect("query");
        assert_eq!(all_categories.len(), 1);
        assert_eq!(all_categories[0].name, "Perawatan Diri");
    }

    /// The importer used to check the sell price only, so a spreadsheet could
    /// push negative buy prices and negative stock into hundreds of rows at once.
    #[tokio::test]
    async fn import_applies_the_same_price_and_stock_rules_as_create() {
        let conn = setup_test_db().await;

        let mut negative_buy = import_row("Harga beli minus", None);
        negative_buy.buy_price = Some(-1.0);
        let mut negative_stock = import_row("Stok minus", None);
        negative_stock.stock = Some(-5);
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

    /// A row carrying only name, barcode and price.
    fn price_only_row(name: &str, barcode: Option<&str>, sell_price: f64) -> BulkProductInput {
        BulkProductInput {
            barcode: barcode.map(str::to_string),
            name: name.to_string(),
            category_name: None,
            buy_price: None,
            sell_price,
            margin: None,
            stock: None,
            unit: None,
            row_number: None,
        }
    }

    /// A price-only file used to reach the backend with zeros for every
    /// unmapped column, and reset the stock, cost, margin, unit and category of
    /// every product it matched.
    #[tokio::test]
    async fn a_price_only_import_changes_only_the_price() {
        let conn = setup_test_db().await;
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
        let mut input = make_valid_input();
        input.category_id = Some(category.id);
        input.unit = "karung".to_string();
        input.margin = Some(30.0);
        let product = create(&conn, &admin(), input).await.expect("product");

        let result = bulk_create(
            &conn,
            &admin(),
            vec![price_only_row("Beras 5kg", Some("1234567890123"), 70_000.0)],
        )
        .await
        .expect("import");
        assert_eq!(result.updated, 1);

        let after = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("row");
        assert_eq!(after.sell_price, 70_000.0);
        assert_eq!(after.stock, 100);
        assert_eq!(after.buy_price, 50_000.0);
        assert_eq!(after.unit, "karung");
        assert_eq!(after.category_id, Some(category.id));
        // The stored 30% no longer fits the new price, so it is cleared for
        // the product form to recompute from the prices.
        assert_eq!(after.margin, 0.0);
    }

    /// An unchanged price leaves a stored margin alone.
    #[tokio::test]
    async fn an_import_without_margin_keeps_it_when_the_prices_do_not_move() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.margin = Some(30.0);
        let product = create(&conn, &admin(), input).await.expect("product");

        bulk_create(
            &conn,
            &admin(),
            vec![price_only_row("Beras 5kg", Some("1234567890123"), 65_000.0)],
        )
        .await
        .expect("import");

        let after = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("row");
        assert_eq!(after.margin, 30.0);
    }

    /// A new product from a sparse row takes the same defaults as before.
    #[tokio::test]
    async fn a_sparse_row_inserts_with_the_defaults() {
        let conn = setup_test_db().await;

        let result = bulk_create(
            &conn,
            &admin(),
            vec![price_only_row("Kopi Sachet", None, 1_500.0)],
        )
        .await
        .expect("import");
        assert_eq!(result.imported, 1);

        let row = products::Entity::find().one(&conn).await.unwrap().unwrap();
        assert_eq!(row.buy_price, 0.0);
        assert_eq!(row.margin, 0.0);
        assert_eq!(row.stock, 0);
        assert_eq!(row.unit, "pcs");
        assert_eq!(row.category_id, None);
    }

    /// A stock column is a stock-take: it replaces the count outright.
    #[tokio::test]
    async fn a_stock_column_sets_the_stock_absolutely() {
        let conn = setup_test_db().await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");

        let mut row = price_only_row("Beras 5kg", Some("1234567890123"), 65_000.0);
        row.stock = Some(7);
        bulk_create(&conn, &admin(), vec![row])
            .await
            .expect("import");

        let after = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("row");
        assert_eq!(after.stock, 7);
    }

    /// The second row with a barcode already imported from the same file used
    /// to count as "updated" and overwrite the first.
    #[tokio::test]
    async fn a_barcode_repeated_in_one_file_is_skipped_and_reported() {
        let conn = setup_test_db().await;
        let first = import_row("Indomie Goreng", Some("8996001010013"));
        let mut second = import_row("Indomie Goreng Jumbo", Some("8996001010013"));
        second.sell_price = 99_000.0;

        let result = bulk_create(&conn, &admin(), vec![first, second])
            .await
            .expect("import");

        assert_eq!(result.imported, 1);
        assert_eq!(result.updated, 0);
        assert_eq!(result.skipped, 1);
        assert!(
            result.errors[0].contains("Baris 2") && result.errors[0].contains("baris 1"),
            "names both rows: {}",
            result.errors[0]
        );

        let all = products::Entity::find().all(&conn).await.expect("query");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Indomie Goreng");
        assert_eq!(all[0].sell_price, 12_000.0);
    }

    /// The client drops nameless rows before sending, so it passes each row's
    /// own file row number. Errors name that row, not the array position.
    #[tokio::test]
    async fn errors_name_the_file_row_number_the_client_sent() {
        let conn = setup_test_db().await;
        let mut kopi = import_row("Kopi", None);
        kopi.row_number = Some(1);
        // File row 2 had no name and never reached the backend.
        let mut teh = import_row("Teh", None);
        teh.sell_price = 0.0;
        teh.row_number = Some(3);

        let result = bulk_create(&conn, &admin(), vec![kopi, teh])
            .await
            .expect("import");

        assert_eq!(result.imported, 1);
        assert_eq!(result.errors.len(), 1);
        assert!(
            result.errors[0].starts_with("Baris 3:"),
            "file row, not index: {}",
            result.errors[0]
        );
    }

    /// Same for unbarcoded rows, which are matched by name.
    #[tokio::test]
    async fn an_unbarcoded_name_repeated_in_one_file_is_skipped() {
        let conn = setup_test_db().await;
        let result = bulk_create(
            &conn,
            &admin(),
            vec![
                import_row("Beras Curah", None),
                import_row("beras curah ", None),
            ],
        )
        .await
        .expect("import");

        assert_eq!(result.imported, 1);
        assert_eq!(result.updated, 0);
        assert_eq!(result.skipped, 1);
    }

    /// A barcoded row and an unbarcoded row of the same name are keyed apart
    /// (barcode vs name), but the second finds the product the first wrote by
    /// its name. It used to overwrite it; it is now skipped like any repeat.
    #[tokio::test]
    async fn a_barcoded_row_and_an_unbarcoded_row_of_one_product_write_it_once() {
        let conn = setup_test_db().await;
        let first = import_row("Beras 5kg", Some("8996001010099"));
        let mut second = import_row("beras 5kg", None);
        second.sell_price = 99_000.0;

        let result = bulk_create(&conn, &admin(), vec![first, second])
            .await
            .expect("import");

        assert_eq!(result.imported, 1);
        assert_eq!(result.updated, 0);
        assert_eq!(result.skipped, 1);
        assert!(
            result.errors[0].contains("Baris 2") && result.errors[0].contains("baris 1"),
            "names both rows: {}",
            result.errors[0]
        );
        let all = products::Entity::find().all(&conn).await.expect("query");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].sell_price, 12_000.0);
    }

    /// The reverse order on an empty catalogue: the unbarcoded row creates the
    /// product, and the barcoded row after it misses by barcode. It must find
    /// the product by name among this import's writes, not insert a second one.
    #[tokio::test]
    async fn an_unbarcoded_row_and_then_a_barcoded_row_of_one_product_write_it_once() {
        let conn = setup_test_db().await;
        let first = import_row("beras 5kg", None);
        let mut second = import_row("Beras 5kg", Some("8996001010099"));
        second.sell_price = 99_000.0;

        let result = bulk_create(&conn, &admin(), vec![first, second])
            .await
            .expect("import");

        assert_eq!(result.imported, 1);
        assert_eq!(result.skipped, 1);
        assert!(
            result.errors[0].contains("Baris 2") && result.errors[0].contains("baris 1"),
            "names both rows: {}",
            result.errors[0]
        );
        let all = products::Entity::find().all(&conn).await.expect("query");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].sell_price, 12_000.0);
    }

    /// Two barcodes under one name are two products, as in the catalogue.
    #[tokio::test]
    async fn two_barcoded_rows_sharing_a_name_are_two_products() {
        let conn = setup_test_db().await;
        let result = bulk_create(
            &conn,
            &admin(),
            vec![
                import_row("Indomie Goreng", Some("8998866200301")),
                import_row("Indomie Goreng", Some("8998866200318")),
            ],
        )
        .await
        .expect("import");

        assert_eq!(result.imported, 2);
        assert_eq!(result.skipped, 0);
    }

    /// The same the other way round, against a product already in the
    /// catalogue: the unbarcoded row updates it by name, and the row with its
    /// barcode later in the file must not write it a second time.
    #[tokio::test]
    async fn an_existing_product_named_and_then_scanned_in_one_file_is_written_once() {
        let conn = setup_test_db().await;
        bulk_create(
            &conn,
            &admin(),
            vec![import_row("Gula 1kg", Some("8991002101036"))],
        )
        .await
        .expect("seed");
        let mut by_name = import_row("GULA 1KG", None);
        by_name.sell_price = 15_000.0;
        let mut by_barcode = import_row("Gula 1kg", Some("8991002101036"));
        by_barcode.sell_price = 99_000.0;

        let result = bulk_create(&conn, &admin(), vec![by_name, by_barcode])
            .await
            .expect("import");

        assert_eq!(result.updated, 1);
        assert_eq!(result.skipped, 1);
        let all = products::Entity::find().all(&conn).await.expect("query");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].sell_price, 15_000.0);
    }

    /// The unbarcoded row updates an existing product that has another
    /// barcode; a later row with a new barcode under that name is a second
    /// product, not a repeat of the first row.
    #[tokio::test]
    async fn a_new_barcode_after_a_name_update_of_another_barcode_is_a_new_product() {
        let conn = setup_test_db().await;
        bulk_create(
            &conn,
            &admin(),
            vec![import_row("Kopi Kapal Api", Some("8991002101036"))],
        )
        .await
        .expect("seed");

        let result = bulk_create(
            &conn,
            &admin(),
            vec![
                import_row("kopi kapal api", None),
                import_row("Kopi Kapal Api", Some("8991002105003")),
            ],
        )
        .await
        .expect("import");

        assert_eq!(result.updated, 1);
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        assert_eq!(result.skipped, 0);
        let barcodes: Vec<Option<String>> = products::Entity::find()
            .order_by_asc(products::Column::Id)
            .all(&conn)
            .await
            .expect("query")
            .into_iter()
            .map(|product| product.barcode)
            .collect();
        assert_eq!(
            barcodes,
            vec![
                Some("8991002101036".to_string()),
                Some("8991002105003".to_string())
            ]
        );
    }

    /// A row that failed is not "already imported": a later valid row with the
    /// same barcode still goes in.
    #[tokio::test]
    async fn a_repeat_of_a_rejected_row_is_not_a_duplicate() {
        let conn = setup_test_db().await;
        let mut bad = import_row("Teh", Some("8991002101036"));
        bad.sell_price = 0.0;
        let good = import_row("Teh", Some("8991002101036"));

        let result = bulk_create(&conn, &admin(), vec![bad, good])
            .await
            .expect("import");

        assert_eq!(result.imported, 1);
        assert_eq!(result.skipped, 1);
    }
}
