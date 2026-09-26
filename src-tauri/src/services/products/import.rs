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
/// matched by barcode are updated instead of inserted.
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
        if let Err(e) =
            validate_product_fields(&name, input.sell_price, input.buy_price, input.stock)
        {
            skipped += 1;
            errors.push(format!("Baris {}: {}", row_num, e));
            continue;
        }

        let unit = input
            .unit
            .as_deref()
            .map(|u| u.trim())
            .filter(|u| !u.is_empty())
            .unwrap_or("pcs")
            .to_string();

        let category_name = input
            .category_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty());
        let category_id = match category_name {
            Some(name) => Some(resolve_category(&txn, &mut category_ids, name).await?),
            None => None,
        };

        let barcode = normalize_code(input.barcode.clone());

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

        let margin = input.margin.unwrap_or(0.0);
        let now = now_ts();

        if let Some(existing) = existing_product {
            let mut active: products::ActiveModel = existing.into();
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
                    errors.push(row_write_failed(row_num, &e));
                }
            }
        } else {
            let new_product = products::ActiveModel {
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
                    errors.push(row_write_failed(row_num, &e));
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
    use crate::services::products::test_fixtures::{admin, make_valid_input};
    use crate::services::products::{create, delete};
    use crate::test_support::setup_test_db;

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
}
