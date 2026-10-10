//! Sales: ringing one up, reading them back, and the two admin corrections.
//!
//! [`checkout`] owns the write path — cart resolution, the money arithmetic and
//! persistence. PPOB lines are fulfilled after the commit by
//! `ppob_fulfillment`, and `ppob_recovery` retries or settles the ones that did
//! not come back clean. [`queries`] is the read side and [`admin`] holds voiding
//! a sale and correcting its payment method. What they share lives here.

#[cfg(test)]
pub(crate) mod fixtures;
#[cfg(test)]
mod flow_tests;

pub mod admin;
pub mod checkout;
mod ppob_fulfillment;
mod ppob_reconcile;
mod ppob_recovery;
pub mod queries;

pub use admin::{update_payment_method, void};
pub use checkout::{checkout, sale_result, IdempotencyClaim};
pub use ppob_reconcile::{check_ppob_status, run_ppob_reconciler, PpobCheckResult};
pub use ppob_recovery::{
    mark_interrupted_ppob_uncertain, resolve_uncertain_ppob, retry_ppob_fulfillment,
};
pub use queries::{detail, list, next_receipt_number};

use std::collections::HashMap;

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use crate::domain::settings::parse_app_settings;
use crate::domain::transactions::PaymentSplit;
use crate::entity::store_info;
use crate::entity::{transaction_items, transaction_payments, transactions};
use crate::utils::AppError;

const VALID_PAYMENT_METHODS: &[&str] = &["cash", "qris", "debit", "ewallet", "transfer"];

/// The screen a sale was rung up on. `sales` is the cashier's cart; `ppob` is a
/// purchase completed on the PPOB page. See `migrations/025_transaction_channel.sql`.
pub(crate) const CHANNEL_SALES: &str = "sales";
pub(crate) const CHANNEL_PPOB: &str = "ppob";

const STATUS_COMPLETED: &str = "completed";
const MIXED_PAYMENT_METHOD: &str = "mixed";

/// Fulfilment states of a PPOB line. `pending` is set at checkout and owned by
/// the background task that follows it; `processing` is owned by a retry. Both
/// mean "a provider call is in flight", so neither may be retried.
const PPOB_STATUS_PENDING: &str = "pending";
const PPOB_STATUS_PROCESSING: &str = "processing";
pub(crate) const PPOB_STATUS_SUCCESS: &str = "success";
pub(crate) const PPOB_STATUS_FAILED: &str = "failed";
/// The provider call went out but its answer never arrived (timeout, dropped
/// connection, garbled body), Mitra answered `ADVICE` (the biller has the
/// payment, the result comes later — `ppob_advice` is set), or the app stopped
/// while it was in flight. The money may be spent, so the line is neither
/// retried nor refunded until `ppob_reconcile` finds it in the Mitra history or
/// a person marks it success or failed.
const PPOB_STATUS_UNCERTAIN: &str = "uncertain";

/// Whether a sold line can come back on a refund: goods always, and a PPOB
/// line only once its top-up `failed` — it was never delivered, so its money
/// goes back. A delivered line, or one still in flight or `uncertain`, cannot.
pub(crate) fn is_refundable_line(item: &transaction_items::Model) -> bool {
    item.product_id.is_some() || item.ppob_status.as_deref() == Some(PPOB_STATUS_FAILED)
}

/// A PPOB line whose top-up `failed`: never delivered, so its money is owed
/// back to the customer.
pub(crate) fn is_failed_ppob_line(item: &transaction_items::Model) -> bool {
    item.product_id.is_none() && item.ppob_status.as_deref() == Some(PPOB_STATUS_FAILED)
}

/// Units of a sold line a new refund may still take back, given the
/// already-refunded tally from `refunds::refunded_quantities`. Zero for a line
/// that cannot come back at all.
pub(crate) fn refundable_quantity(
    item: &transaction_items::Model,
    refunded: &HashMap<i64, i64>,
) -> i64 {
    if !is_refundable_line(item) {
        return 0;
    }
    (item.quantity - refunded.get(&item.id).copied().unwrap_or(0)).max(0)
}

/// The store's `allow_negative_stock` setting; permissive when the store row
/// is missing. Read by checkout and by the exchange half of a refund.
pub(crate) async fn load_allow_negative_stock<C: ConnectionTrait>(
    db: &C,
) -> Result<bool, AppError> {
    Ok(store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .map(|s| {
            parse_app_settings(&s.additional_info)
                .sales
                .allow_negative_stock
        })
        .unwrap_or(true))
}

/// Refuses anything but the five methods a sale may be paid with. `mixed` is
/// derived from a split payment, never chosen.
fn validate_payment_method(method: &str) -> Result<(), AppError> {
    if !VALID_PAYMENT_METHODS.contains(&method) {
        return Err(AppError::Validation(format!(
            "Metode pembayaran tidak valid: {}",
            method
        )));
    }

    Ok(())
}

async fn load_payment_breakdown<C: ConnectionTrait>(
    db: &C,
    transaction: &transactions::Model,
) -> Result<Vec<PaymentSplit>, AppError> {
    let splits = transaction_payments::Entity::find()
        .filter(transaction_payments::Column::TransactionId.eq(transaction.id))
        .all(db)
        .await?;

    Ok(payment_breakdown_from(splits, transaction))
}

/// A sale's recorded payment splits, or — for a sale written before splits
/// were recorded — a single split for the whole total in its one method.
fn payment_breakdown_from(
    splits: Vec<transaction_payments::Model>,
    transaction: &transactions::Model,
) -> Vec<PaymentSplit> {
    if splits.is_empty() {
        return vec![PaymentSplit {
            payment_method: transaction.payment_method.clone(),
            bank_name: None,
            amount: transaction.total_amount,
        }];
    }

    splits
        .into_iter()
        .map(|split| PaymentSplit {
            payment_method: split.payment_method,
            bank_name: split.bank_name,
            amount: split.amount,
        })
        .collect()
}
