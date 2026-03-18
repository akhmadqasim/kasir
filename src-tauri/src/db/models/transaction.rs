use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Transaction {
    pub id: i64,
    pub receipt_number: String,
    pub user_id: i64,
    pub total_amount: f64,
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: f64,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionItem {
    pub id: i64,
    pub transaction_id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub product_price: f64,
    pub quantity: i64,
    pub subtotal: f64,
    pub created_at: String,
}
