use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, Condition, DatabaseConnection, DbBackend,
    EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::entity::{product_shortcuts, products};
use crate::utils::AppError;
use crate::utils::require_role;

#[derive(Debug, Deserialize)]
pub struct ProductSearchParams {
    pub query: Option<String>,
    pub category_id: Option<i64>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PaginatedProducts {
    pub data: Vec<products::Model>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateProductInput {
    pub barcode: Option<String>,
    pub sku: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub buy_price: f64,
    pub sell_price: f64,
    pub margin: Option<f64>,
    pub stock: i64,
    pub unit: String,
    pub min_stock: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProductInput {
    pub id: i64,
    pub barcode: Option<String>,
    pub sku: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub buy_price: f64,
    pub sell_price: f64,
    pub margin: Option<f64>,
    pub stock: i64,
    pub unit: String,
    pub min_stock: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct BulkProductInput {
    pub barcode: Option<String>,
    pub name: String,
    pub category_name: Option<String>,
    pub buy_price: f64,
    pub sell_price: f64,
    pub margin: Option<f64>,
    pub stock: i64,
    pub unit: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BulkImportResult {
    pub imported: i64,
    pub updated: i64,
    pub skipped: i64,
    pub errors: Vec<String>,
}

fn build_search_condition(params: &ProductSearchParams) -> Condition {
    let mut condition = Condition::all().add(products::Column::IsActive.eq(true));

    if let Some(ref query) = params.query {
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            let mut text_search = Condition::any()
                .add(products::Column::Name.contains(trimmed))
                .add(products::Column::Barcode.contains(trimmed))
                .add(products::Column::Sku.contains(trimmed));

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

    condition
}

#[tauri::command]
pub async fn search_products(
    db: State<'_, DatabaseConnection>,
    params: ProductSearchParams,
) -> Result<PaginatedProducts, AppError> {
    let page = params.page.unwrap_or(1).max(1);
    let per_page = params.per_page.unwrap_or(50).max(1);
    let offset = (page - 1) * per_page;

    let total = products::Entity::find()
        .filter(build_search_condition(&params))
        .count(db.inner())
        .await? as i64;

    let total_pages = if total == 0 {
        1
    } else {
        (total + per_page - 1) / per_page
    };

    let sort_col = match params.sort_by.as_deref() {
        Some("sell_price") => products::Column::SellPrice,
        Some("stock") => products::Column::Stock,
        _ => products::Column::Name,
    };

    let query = products::Entity::find().filter(build_search_condition(&params));

    let query = if params.sort_order.as_deref() == Some("desc") {
        query.order_by_desc(sort_col)
    } else {
        query.order_by_asc(sort_col)
    };

    let data = query
        .offset(Some(offset as u64))
        .limit(Some(per_page as u64))
        .all(db.inner())
        .await?;

    Ok(PaginatedProducts {
        data,
        total,
        page,
        per_page,
        total_pages,
    })
}

#[tauri::command]
pub async fn get_product_by_barcode(
    db: State<'_, DatabaseConnection>,
    barcode: String,
) -> Result<Option<products::Model>, AppError> {
    let product = products::Entity::find()
        .filter(products::Column::Barcode.eq(&barcode))
        .filter(products::Column::IsActive.eq(true))
        .one(db.inner())
        .await?;
    Ok(product)
}

#[tauri::command]
pub async fn create_product(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    input: CreateProductInput,
) -> Result<products::Model, AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "Nama produk tidak boleh kosong".to_string(),
        ));
    }
    if input.sell_price <= 0.0 {
        return Err(AppError::Validation(
            "Harga jual harus lebih dari 0".to_string(),
        ));
    }
    if input.buy_price < 0.0 {
        return Err(AppError::Validation(
            "Harga beli tidak boleh negatif".to_string(),
        ));
    }
    if input.stock < 0 {
        return Err(AppError::Validation(
            "Stok tidak boleh negatif".to_string(),
        ));
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

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

    let product = new_product.insert(db.inner()).await?;
    Ok(product)
}

#[tauri::command]
pub async fn update_product(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    input: UpdateProductInput,
) -> Result<products::Model, AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "Nama produk tidak boleh kosong".to_string(),
        ));
    }
    if input.sell_price <= 0.0 {
        return Err(AppError::Validation(
            "Harga jual harus lebih dari 0".to_string(),
        ));
    }
    if input.buy_price < 0.0 {
        return Err(AppError::Validation(
            "Harga beli tidak boleh negatif".to_string(),
        ));
    }
    if input.stock < 0 {
        return Err(AppError::Validation(
            "Stok tidak boleh negatif".to_string(),
        ));
    }

    let existing = products::Entity::find_by_id(input.id)
        .filter(products::Column::IsActive.eq(true))
        .one(db.inner())
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
    active.updated_at = Set(Some(
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    ));

    let product = active.update(db.inner()).await?;
    Ok(product)
}

#[tauri::command]
pub async fn delete_product(db: State<'_, DatabaseConnection>, caller_id: i64, id: i64) -> Result<(), AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let existing = products::Entity::find_by_id(id)
        .filter(products::Column::IsActive.eq(true))
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan".to_string()))?;

    let mut active: products::ActiveModel = existing.into();
    active.is_active = Set(false);
    active.updated_at = Set(Some(
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    ));
    active.update(db.inner()).await?;

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ShortcutProduct {
    #[serde(flatten)]
    pub product: products::Model,
    pub is_pinned: bool,
    pub select_count: i64,
}

#[tauri::command]
pub async fn get_popular_products(
    db: State<'_, DatabaseConnection>,
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
        .all(db.inner())
        .await?;

    // Get shortcut metadata for each product
    let product_ids: Vec<i64> = rows.iter().map(|p| p.id).collect();
    let shortcuts = product_shortcuts::Entity::find()
        .filter(product_shortcuts::Column::ProductId.is_in(product_ids))
        .all(db.inner())
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

#[tauri::command]
pub async fn track_product_selection(
    db: State<'_, DatabaseConnection>,
    product_id: i64,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let existing = product_shortcuts::Entity::find()
        .filter(product_shortcuts::Column::ProductId.eq(product_id))
        .one(db.inner())
        .await?;

    if let Some(shortcut) = existing {
        let mut active: product_shortcuts::ActiveModel = shortcut.into();
        active.select_count = Set(active.select_count.unwrap() + 1);
        active.last_selected_at = Set(Some(now));
        active.update(db.inner()).await?;
    } else {
        let new_shortcut = product_shortcuts::ActiveModel {
            id: NotSet,
            product_id: Set(product_id),
            select_count: Set(1),
            is_pinned: Set(false),
            last_selected_at: Set(Some(now.clone())),
            created_at: Set(Some(now)),
        };
        new_shortcut.insert(db.inner()).await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_product_pin(
    db: State<'_, DatabaseConnection>,
    product_id: i64,
) -> Result<bool, AppError> {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let existing = product_shortcuts::Entity::find()
        .filter(product_shortcuts::Column::ProductId.eq(product_id))
        .one(db.inner())
        .await?;

    if let Some(shortcut) = existing {
        let new_pinned = !shortcut.is_pinned;
        let mut active: product_shortcuts::ActiveModel = shortcut.into();
        active.is_pinned = Set(new_pinned);
        active.update(db.inner()).await?;
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
        new_shortcut.insert(db.inner()).await?;
        Ok(true)
    }
}

#[tauri::command]
pub async fn bulk_create_products(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    products: Vec<BulkProductInput>,
) -> Result<BulkImportResult, AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    use crate::entity::categories as cat_ent;
    use crate::entity::products as prod_ent;

    let txn = db.begin().await?;

    let mut imported: i64 = 0;
    let mut updated: i64 = 0;
    let mut skipped: i64 = 0;
    let mut errors: Vec<String> = Vec::new();

    for (idx, input) in products.iter().enumerate() {
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
                            created_at: Set(Some(
                                chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                            )),
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
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

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

#[tauri::command]
pub fn save_template_file(content: String, filename: String) -> Result<(), AppError> {
    let desktop = dirs::desktop_dir()
        .ok_or_else(|| AppError::Internal("Tidak dapat menemukan folder Desktop".into()))?;
    let path = desktop.join(&filename);
    std::fs::write(&path, content)
        .map_err(|e| AppError::Internal(format!("Gagal menyimpan file: {}", e)))?;
    Ok(())
}
