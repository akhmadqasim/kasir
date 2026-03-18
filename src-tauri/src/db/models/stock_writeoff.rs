use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct StockWriteoff {
    pub id: i64,
    pub writeoff_number: String,
    pub product_id: i64,
    pub user_id: i64,
    pub quantity: i64,
    pub reason: String,
    pub loss_value: f64,
    pub notes: Option<String>,
    pub approved_by: Option<i64>,
    pub status: String,
    pub refund_id: Option<i64>,
    pub created_at: String,
}
