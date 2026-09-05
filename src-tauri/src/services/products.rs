//! Product search, CRUD, quick-access shortcuts and bulk import.

use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, Condition, DatabaseConnection, DbBackend,
    EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement,
    TransactionTrait,
};

use crate::domain::products::{
    BulkImportResult, BulkProductInput, CreateProductInput, PaginatedProducts, ProductSearchParams,
    SaveTemplateFileInput, ShortcutProduct, UpdateProductInput,
};
use crate::domain::Actor;
use crate::entity::{product_shortcuts, products};
use crate::services::guard;
use crate::utils::AppError;

fn now_ts() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
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
            "low_stock" => condition.add(Condition::any().add(products::Column::Stock.lte(0)).add(
                Expr::col(products::Column::Stock).lte(Expr::col(products::Column::MinStock)),
            )),
            "negative_stock" => condition.add(products::Column::Stock.lt(0)),
            "no_barcode" => condition.add(
                Condition::any()
                    .add(products::Column::Barcode.is_null())
                    .add(products::Column::Barcode.eq("")),
            ),
            "needs_review" => condition.add(
                Condition::any()
                    .add(products::Column::Stock.lt(0))
                    .add(products::Column::CategoryId.is_null())
                    .add(products::Column::MinStock.is_null())
                    .add(products::Column::MinStock.lte(0))
                    .add(products::Column::Barcode.is_null())
                    .add(products::Column::Barcode.eq("")),
            ),
            _ => condition,
        };
    }

    condition
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

    let sort_col = match params.sort_by.as_deref() {
        Some("created_at") => products::Column::CreatedAt,
        Some("updated_at") => products::Column::UpdatedAt,
        Some("name") => products::Column::Name,
        Some("sell_price") => products::Column::SellPrice,
        Some("stock") => products::Column::Stock,
        _ => products::Column::Name,
    };

    let query = products::Entity::find().filter(build_search_condition(&params));

    let is_desc = params.sort_order.as_deref() == Some("desc");
    let query = if is_desc {
        query.order_by_desc(sort_col)
    } else {
        query.order_by_asc(sort_col)
    };
    let query = if matches!(
        params.sort_by.as_deref(),
        Some("created_at") | Some("updated_at")
    ) {
        if is_desc {
            query.order_by_desc(products::Column::Id)
        } else {
            query.order_by_asc(products::Column::Id)
        }
    } else {
        query
    };

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

pub async fn create(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateProductInput,
) -> Result<products::Model, AppError> {
    guard::require_admin(actor)?;

    let name =
        validate_product_fields(&input.name, input.sell_price, input.buy_price, input.stock)?;

    let now = now_ts();

    let new_product = products::ActiveModel {
        id: NotSet,
        barcode: Set(input.barcode),
        sku: Set(input.sku),
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

    let product = new_product.insert(db).await?;
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

    let existing = products::Entity::find_by_id(input.id)
        .filter(products::Column::IsActive.eq(true))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan".to_string()))?;

    let mut active: products::ActiveModel = existing.into();
    active.barcode = Set(input.barcode);
    active.sku = Set(input.sku);
    active.name = Set(name);
    active.category_id = Set(input.category_id);
    active.buy_price = Set(input.buy_price);
    active.sell_price = Set(input.sell_price);
    active.margin = Set(input.margin.unwrap_or(0.0));
    active.stock = Set(input.stock);
    active.unit = Set(input.unit);
    active.min_stock = Set(Some(input.min_stock.unwrap_or(0)));
    active.updated_at = Set(Some(now_ts()));

    let product = active.update(db).await?;
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
    let limit = limit.unwrap_or(20).max(1).min(200);

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
                is_pinned: shortcut.map_or(false, |s| s.is_pinned),
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

        if input.sell_price <= 0.0 {
            skipped += 1;
            errors.push(format!("Baris {}: Harga jual harus lebih dari 0", row_num));
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

        // Check existing product by barcode
        let existing_product = match &barcode {
            Some(bc) => {
                prod_ent::Entity::find()
                    .filter(prod_ent::Column::Barcode.eq(bc.as_str()))
                    .one(&txn)
                    .await?
            }
            None => None,
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
            active.is_active = Set(true);
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

/// The import template, generated server-side.
///
/// The Tauri path has the webview build this CSV and post it back to
/// [`save_template_file`], which means the column contract — the thing
/// [`bulk_create`] parses — is defined in the frontend and merely written by the
/// backend. Over HTTP the template is a download, so the columns are declared
/// here next to the importer that has to understand them.
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

/// Write an import template onto the user's Desktop.
pub fn save_template_file(input: SaveTemplateFileInput) -> Result<(), AppError> {
    let SaveTemplateFileInput { content, filename } = input;

    // Reject anything that could escape the Desktop directory: path separators,
    // parent-dir components, or absolute paths.
    let invalid = filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || std::path::Path::new(&filename).is_absolute();
    let has_known_ext = {
        let lower = filename.to_lowercase();
        lower.ends_with(".csv") || lower.ends_with(".xlsx") || lower.ends_with(".xls")
    };
    if invalid || !has_known_ext {
        return Err(AppError::Validation("Nama file tidak valid".into()));
    }

    let desktop = dirs::desktop_dir()
        .ok_or_else(|| AppError::Internal("Tidak dapat menemukan folder Desktop".into()))?;
    let path = desktop.join(&filename);
    std::fs::write(&path, content)
        .map_err(|e| AppError::Internal(format!("Gagal menyimpan file: {}", e)))?;
    Ok(())
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
