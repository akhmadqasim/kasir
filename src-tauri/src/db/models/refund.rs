use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Refund {
    pub id: i64,
    pub refund_number: String,
    pub transaction_id: i64,
    pub user_id: i64,
    pub r#type: String,
    pub total_refund_amount: f64,
    pub total_exchange_amount: f64,
    pub difference_amount: f64,
    pub payment_method: Option<String>,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefundItem {
    pub id: i64,
    pub refund_id: i64,
    pub transaction_item_id: i64,
    pub product_id: i64,
    pub quantity: i64,
    pub subtotal: f64,
    pub condition: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExchangeItem {
    pub id: i64,
    pub refund_id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub product_price: f64,
    pub quantity: i64,
    pub subtotal: f64,
    pub created_at: String,
}
