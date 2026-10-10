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
    /// The cashier's Mitra transaction PIN, typed at the moment of sale.
    /// Required only when `items` has a PPOB line — see
    /// `crate::services::ppob::executor::validate_pin` — and never persisted:
    /// it is read out of this struct once, on the way into a
    /// `PpobFulfillmentRequest`, and does not outlive the checkout call.
    pub ppob_pin: Option<String>,
    /// Which screen rang the sale up: `sales` (the cashier's cart) or `ppob`
    /// (a purchase completed on the PPOB page). Absent means `sales`, so an
    /// older client keeps ringing up cart sales.
    #[serde(default)]
    pub channel: Option<String>,
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
    /// Restricts the page to one channel. `None` (or empty) means every
    /// channel, which is what the admin views want.
    pub channel: Option<String>,
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
    /// `sales` or `ppob` — which screen rang the sale up. The history page
    /// offers a refund only for `sales`.
    pub channel: String,
    pub item_count: i64,
    pub notes: Option<String>,
    pub created_at: Option<String>,
    /// Whether any line still has units a refund may take back. A mixed cart
    /// whose goods all came back stays `partial_refund`, so the status cannot
    /// say it.
    pub has_refundable_goods: bool,
    /// A failed PPOB line still has money to give back. That refund has no
    /// seven-day window (see `refunds::create::eligibility`), so the history
    /// keeps offering it after goods stopped being returnable.
    pub has_refundable_failed_ppob: bool,
    pub has_ppob: bool,
    /// The PPOB line that most needs a person — `uncertain` first, then
    /// `failed`, then one still in flight — so a cart with several lines shows
    /// the one to act on, not merely the first.
    pub ppob_status: Option<String>,
    pub ppob_message: Option<String>,
    pub ppob_serial_number: Option<String>,
    /// That same line's `service_type` and `ppob_advice`, so the badge can say
    /// "Menunggu Konfirmasi PLN" for an ADVICE line instead of "Perlu Dicek".
    pub ppob_service_type: Option<String>,
    pub ppob_advice: Option<String>,
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

/// A sold line as the detail view returns it: the row itself, flattened, plus
/// its refund state. `refundable` says whether the line can come back at all
/// (goods, or a failed PPOB top-up); `refundable_quantity` is what is left of
/// it, the same cap `create_refund` enforces.
#[derive(Debug, Serialize)]
pub struct TransactionDetailItem {
    #[serde(flatten)]
    pub item: transaction_items::Model,
    pub refunded_quantity: i64,
    pub refundable: bool,
    pub refundable_quantity: i64,
    /// UTC `YYYY-MM-DD HH:MM:SS` from which an admin may mark this `uncertain`
    /// ADVICE line failed by hand (`ppob_recovery::advice_fail_opens_at`).
    /// `None` when no wait applies: not ADVICE, or not `uncertain`.
    pub ppob_manual_fail_opens_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TransactionDetail {
    pub transaction: transactions::Model,
    pub items: Vec<TransactionDetailItem>,
    pub cashier_name: String,
    /// Same as `TransactionListItem::has_refundable_goods`.
    pub has_refundable_goods: bool,
    /// Same as `TransactionListItem::has_refundable_failed_ppob`.
    pub has_refundable_failed_ppob: bool,
    pub has_ppob: bool,
    /// The most urgent PPOB line, picked as `TransactionListItem::ppob_status`.
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
