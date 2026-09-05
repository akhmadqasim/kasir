//! Refund and exchange inputs and responses.
//!
//! `CreateRefundInput` no longer carries a `userId`: who performs a refund
//! comes from the [`crate::domain::Actor`], never from the request body.

use serde::{Deserialize, Serialize};

use crate::entity::{exchange_items, refund_items, refunds};

/// One returned line. The product is deliberately NOT part of this payload:
/// it is derived from `transaction_item_id`, which is checked to belong to the
/// transaction being refunded. A client-chosen product id let a refund restore
/// stock for — and book a write-off loss against — an item that was never sold.
/// Clients may still send `product_id`; it is ignored.
#[derive(Debug, Deserialize)]
pub struct RefundItemInput {
    pub transaction_item_id: i64,
    pub quantity: i64,
    pub condition: String,
}

#[derive(Debug, Deserialize)]
pub struct ExchangeItemInput {
    pub product_id: i64,
    pub quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateRefundInput {
    pub transaction_id: i64,
    pub reason: Option<String>,
    pub items: Vec<RefundItemInput>,
    pub exchange_items: Option<Vec<ExchangeItemInput>>,
}

#[derive(Debug, Deserialize)]
pub struct ListRefundsInput {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub refund_type: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RefundResult {
    pub refund: refunds::Model,
    pub items: Vec<refund_items::Model>,
    pub exchange_items: Vec<exchange_items::Model>,
}

#[derive(Debug, Serialize)]
pub struct RefundDetailItem {
    pub id: i64,
    pub product_name: String,
    pub product_price: f64,
    pub quantity: i64,
    pub subtotal: f64,
    pub condition: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExchangeDetailItem {
    pub id: i64,
    pub product_name: String,
    pub product_price: f64,
    pub quantity: i64,
    pub subtotal: f64,
}

#[derive(Debug, Serialize)]
pub struct RefundDetailResult {
    pub refund: refunds::Model,
    pub items: Vec<RefundDetailItem>,
    pub exchange_items: Vec<ExchangeDetailItem>,
    pub transaction_receipt: String,
    pub cashier_name: String,
}

#[derive(Debug, Serialize)]
pub struct RefundListItem {
    pub id: i64,
    pub refund_number: String,
    pub refund_type: String,
    pub transaction_receipt: String,
    pub cashier_name: String,
    pub total_refund_amount: f64,
    pub total_exchange_amount: f64,
    pub difference_amount: f64,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListRefundsResult {
    pub items: Vec<RefundListItem>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}
