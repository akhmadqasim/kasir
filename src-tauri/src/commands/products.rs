use crate::db::Database;
use crate::db::models::product::Product;
use crate::utils::AppError;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct ProductSearchParams {
    pub query: Option<String>,
    pub category_id: Option<i64>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct PaginatedProducts {
    pub data: Vec<Product>,
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
    pub stock: i64,
    pub unit: String,
    pub min_stock: Option<i64>,
}

fn row_to_product(row: &rusqlite::Row) -> rusqlite::Result<Product> {
    Ok(Product {
        id: row.get(0)?,
        barcode: row.get(1)?,
        sku: row.get(2)?,
        name: row.get(3)?,
        category_id: row.get(4)?,
        buy_price: row.get(5)?,
        sell_price: row.get(6)?,
        stock: row.get(7)?,
        unit: row.get(8)?,
        min_stock: row.get(9)?,
        is_active: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

const PRODUCT_COLUMNS: &str =
    "id, barcode, sku, name, category_id, buy_price, sell_price, stock, unit, min_stock, is_active, created_at, updated_at";

#[tauri::command]
pub fn search_products(
    db: State<'_, Database>,
    params: ProductSearchParams,
) -> Result<PaginatedProducts, AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let page = params.page.unwrap_or(1).max(1);
    let per_page = params.per_page.unwrap_or(50).max(1);
    let offset = (page - 1) * per_page;

    let mut where_clauses: Vec<String> = vec!["is_active = 1".to_string()];
    let mut sql_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref query) = params.query {
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            where_clauses.push(format!(
                "(name LIKE ?{} OR barcode = ?{})",
                param_idx,
                param_idx + 1
            ));
            sql_params.push(Box::new(format!("%{}%", trimmed)));
            sql_params.push(Box::new(trimmed.to_string()));
            param_idx += 2;
        }
    }

    if let Some(cat_id) = params.category_id {
        where_clauses.push(format!("category_id = ?{}", param_idx));
        sql_params.push(Box::new(cat_id));
        param_idx += 1;
    }

    let where_sql = where_clauses.join(" AND ");

    // Count total
    let count_sql = format!("SELECT COUNT(*) FROM products WHERE {}", where_sql);
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = sql_params.iter().map(|p| p.as_ref()).collect();
    let total: i64 = conn.query_row(&count_sql, param_refs.as_slice(), |row| row.get(0))?;

    let total_pages = if total == 0 { 1 } else { (total + per_page - 1) / per_page };

    // Fetch page
    let select_sql = format!(
        "SELECT {} FROM products WHERE {} ORDER BY name LIMIT ?{} OFFSET ?{}",
        PRODUCT_COLUMNS, where_sql, param_idx, param_idx + 1
    );
    let mut select_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref query) = params.query {
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            select_params.push(Box::new(format!("%{}%", trimmed)));
            select_params.push(Box::new(trimmed.to_string()));
        }
    }
    if let Some(cat_id) = params.category_id {
        select_params.push(Box::new(cat_id));
    }
    select_params.push(Box::new(per_page));
    select_params.push(Box::new(offset));

    let select_refs: Vec<&dyn rusqlite::types::ToSql> =
        select_params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&select_sql)?;
    let products = stmt
        .query_map(select_refs.as_slice(), row_to_product)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(PaginatedProducts {
        data: products,
        total,
        page,
        per_page,
        total_pages,
    })
}

#[tauri::command]
pub fn get_product_by_barcode(
    db: State<'_, Database>,
    barcode: String,
) -> Result<Option<Product>, AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let sql = format!(
        "SELECT {} FROM products WHERE barcode = ?1 AND is_active = 1",
        PRODUCT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let product = stmt
        .query_row([&barcode], row_to_product)
        .optional()
        .map_err(AppError::Database)?;

    Ok(product)
}

#[tauri::command]
pub fn create_product(
    db: State<'_, Database>,
    input: CreateProductInput,
) -> Result<Product, AppError> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Nama produk tidak boleh kosong".to_string()));
    }
    if input.sell_price <= 0.0 {
        return Err(AppError::Validation("Harga jual harus lebih dari 0".to_string()));
    }

    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let min_stock = input.min_stock.unwrap_or(0);

    conn.execute(
        "INSERT INTO products (barcode, sku, name, category_id, buy_price, sell_price, stock, unit, min_stock)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            input.barcode,
            input.sku,
            name,
            input.category_id,
            input.buy_price,
            input.sell_price,
            input.stock,
            input.unit,
            min_stock,
        ],
    )?;

    let id = conn.last_insert_rowid();
    let sql = format!("SELECT {} FROM products WHERE id = ?1", PRODUCT_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let product = stmt.query_row([id], row_to_product)?;

    Ok(product)
}

#[tauri::command]
pub fn update_product(
    db: State<'_, Database>,
    input: UpdateProductInput,
) -> Result<Product, AppError> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Nama produk tidak boleh kosong".to_string()));
    }
    if input.sell_price <= 0.0 {
        return Err(AppError::Validation("Harga jual harus lebih dari 0".to_string()));
    }

    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let min_stock = input.min_stock.unwrap_or(0);

    let rows = conn.execute(
        "UPDATE products SET barcode = ?1, sku = ?2, name = ?3, category_id = ?4,
         buy_price = ?5, sell_price = ?6, stock = ?7, unit = ?8, min_stock = ?9,
         updated_at = CURRENT_TIMESTAMP
         WHERE id = ?10 AND is_active = 1",
        rusqlite::params![
            input.barcode,
            input.sku,
            name,
            input.category_id,
            input.buy_price,
            input.sell_price,
            input.stock,
            input.unit,
            min_stock,
            input.id,
        ],
    )?;

    if rows == 0 {
        return Err(AppError::NotFound("Produk tidak ditemukan".to_string()));
    }

    let sql = format!("SELECT {} FROM products WHERE id = ?1", PRODUCT_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let product = stmt.query_row([input.id], row_to_product)?;

    Ok(product)
}

#[tauri::command]
pub fn delete_product(db: State<'_, Database>, id: i64) -> Result<(), AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let rows = conn.execute(
        "UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND is_active = 1",
        [id],
    )?;

    if rows == 0 {
        return Err(AppError::NotFound("Produk tidak ditemukan".to_string()));
    }

    Ok(())
}
