use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Product {
    pub id: i64,
    pub barcode: Option<String>,
    pub sku: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub buy_price: f64,
    pub sell_price: f64,
    pub stock: i64,
    pub unit: String,
    pub min_stock: i64,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}
