//! Stock write-off inputs and responses.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWriteoffInput {
    pub product_id: i64,
    pub quantity: i64,
    pub reason: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWriteoffsInput {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub status: Option<String>,
    pub reason: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockWriteoffResponse {
    pub id: i64,
    pub writeoff_number: String,
    pub product_id: i64,
    pub product_name: String,
    pub user_id: i64,
    pub cashier_name: String,
    pub quantity: i64,
    pub reason: String,
    pub loss_value: f64,
    pub notes: Option<String>,
    pub approved_by: Option<i64>,
    pub approver_name: Option<String>,
    pub status: String,
    pub refund_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWriteoffsResult {
    pub items: Vec<StockWriteoffResponse>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}
