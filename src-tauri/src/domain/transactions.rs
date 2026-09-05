//! Checkout, listing and transaction-management types.
//!
//! `CheckoutTransactionInput`, `DeleteTransactionInput` and
//! `UpdatePaymentMethodInput` no longer carry a `user_id`: who rang up a sale,
//! who voided one and who corrected its payment method all come from the
//! [`crate::domain::Actor`].

use serde::{Deserialize, Serialize};

use crate::entity::{transaction_items, transactions};

#[derive(Debug, Deserialize, Clone)]
pub struct TransactionItemInput {
    pub product_id: Option<i64>,
    pub quantity: i64,
    pub product_name: Option<String>,
    pub product_price: Option<f64>,
    pub buy_price: Option<f64>,
    pub item_discount: Option<f64>,
    pub service_type: Option<String>,
    pub service_ref: Option<String>,
    pub ppob_product_id: Option<i64>,
    pub ppob_product_code: Option<String>,
    pub ppob_inquiry_id: Option<String>,
    pub ppob_payment_code: Option<String>,
    pub ppob_flag_id: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CheckoutTransactionInput {
    pub items: Vec<TransactionItemInput>,
    pub payment_method: String,
    pub payment_amount: f64,
    pub payment_breakdown: Option<Vec<PaymentSplitInput>>,
    pub notes: Option<String>,
    pub transaction_discount: Option<f64>,
    pub shift_id: Option<i64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PaymentSplitInput {
    pub payment_method: String,
    pub bank_name: Option<String>,
    pub amount: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct PaymentSplit {
    pub payment_method: String,
    pub bank_name: Option<String>,
    pub amount: f64,
}

#[derive(Debug, Serialize)]
pub struct TransactionResult {
    pub transaction: transactions::Model,
    pub items: Vec<transaction_items::Model>,
    pub payment_breakdown: Vec<PaymentSplit>,
}
#[derive(Debug, Deserialize)]
pub struct ListTransactionsInput {
    pub page: Option<u64>,
    pub per_page: Option<u64>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub payment_method: Option<String>,
    pub status: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TransactionListItem {
    pub id: i64,
    pub receipt_number: String,
    /// The cashier who rang the sale up, read back from the stored row.
    pub user_id: i64,
    pub cashier_name: String,
    pub total_amount: f64,
    pub subtotal_amount: f64,
    pub discount_amount: f64,
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: f64,
    pub status: String,
    pub item_count: i64,
    pub notes: Option<String>,
    pub created_at: Option<String>,
    pub has_ppob: bool,
    pub ppob_status: Option<String>,
    pub ppob_message: Option<String>,
    pub ppob_serial_number: Option<String>,
    pub deleted_at: Option<String>,
    pub deleted_reason: Option<String>,
    pub payment_breakdown: Vec<PaymentSplit>,
}

#[derive(Debug, Serialize)]
pub struct PaginatedTransactions {
    pub data: Vec<TransactionListItem>,
    pub total: u64,
    pub page: u64,
    pub per_page: u64,
    pub total_pages: u64,
}

/// Page size to actually use, clamped to `1..=100`.
///
/// `per_page = 0` slipped past the old `.min(100)` and then divided the row
/// count by zero, so `total_pages` came back as `u64::MAX` and the pager
#[derive(Debug, Serialize)]
pub struct TransactionDetail {
    pub transaction: transactions::Model,
    pub items: Vec<transaction_items::Model>,
    pub cashier_name: String,
    pub has_ppob: bool,
    pub ppob_status: Option<String>,
    pub ppob_message: Option<String>,
    pub ppob_serial_number: Option<String>,
    pub payment_breakdown: Vec<PaymentSplit>,
}

/// Voiding a completed sale.
#[derive(Debug, Clone, Deserialize)]
pub struct DeleteTransactionInput {
    pub transaction_id: i64,
    pub reason: String,
}

/// Correcting the payment method recorded against a sale.
#[derive(Debug, Clone, Deserialize)]
pub struct UpdatePaymentMethodInput {
    pub transaction_id: i64,
    pub payment_method: String,
    pub reason: String,
}
