//! Product search, CRUD and bulk-import types.

use sea_orm::FromQueryResult;
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
    /// Absent: the update leaves stock alone. Sales, refunds and write-offs
    /// keep moving it while an edit form is open, so a form that only changed
    /// the price must not write back the number it loaded.
    #[serde(default)]
    pub stock: Option<i64>,
    /// The stock the form loaded. With it, `stock` is applied as the delta
    /// `stock - expected_stock` on top of the current value, so sales made in
    /// the meantime survive. Without it (older clients), `stock` is written
    /// as is.
    #[serde(default)]
    pub expected_stock: Option<i64>,
    pub unit: String,
    pub min_stock: Option<i64>,
}

/// One import row. Every field but `name` and `sell_price` is optional, and
/// absent means "the file does not say": a matched product keeps its current
/// value, a new one gets the default (0, `pcs`, no category).
#[derive(Debug, Clone, Deserialize)]
pub struct BulkProductInput {
    pub barcode: Option<String>,
    pub name: String,
    pub category_name: Option<String>,
    pub buy_price: Option<f64>,
    pub sell_price: f64,
    pub margin: Option<f64>,
    /// A stock-take: replaces the matched product's stock outright.
    pub stock: Option<i64>,
    pub unit: Option<String>,
    /// The row's 1-based data-row number in the file, as the import preview
    /// shows it. The client drops nameless rows before sending, so the array
    /// index no longer matches the file; absent means "use the index".
    #[serde(default)]
    pub row_number: Option<usize>,
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

/// What the cart reprices a line from: the catalogue's price, stock and unit
/// of the moment. See `GET /api/products/lookup`.
#[derive(Debug, Serialize, FromQueryResult)]
pub struct ProductLookup {
    pub id: i64,
    pub sell_price: f64,
    pub stock: i64,
    pub unit: String,
    pub is_active: bool,
}
