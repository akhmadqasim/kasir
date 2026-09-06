//! Product search, CRUD and bulk-import types.

use serde::{Deserialize, Serialize};

use crate::entity::products;

#[derive(Debug, Clone, Deserialize)]
pub struct ProductSearchParams {
    pub query: Option<String>,
    pub category_id: Option<i64>,
    pub quick_filter: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateProductInput {
    /// Optional in the payload because over HTTP the id lives in the path
    /// (`PUT /api/products/{id}`) and the route overwrites whatever the body
    /// says. The Tauri command still sends it in the body.
    #[serde(default)]
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

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Serialize)]
pub struct ShortcutProduct {
    #[serde(flatten)]
    pub product: products::Model,
    pub is_pinned: bool,
    pub select_count: i64,
}
