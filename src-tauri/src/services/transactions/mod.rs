//! Sales: ringing one up, reading them back, and the two admin corrections.
//!
//! [`checkout`] owns the write path — cart resolution, the money arithmetic and
//! persistence. PPOB lines are fulfilled after the commit by
//! `ppob_fulfillment`, and `ppob_recovery` retries or settles the ones that did
//! not come back clean. [`queries`] is the read side and [`admin`] holds voiding
//! a sale and correcting its payment method. What they share lives here.

#[cfg(test)]
pub(crate) mod fixtures;

pub mod admin;
pub mod checkout;
mod ppob_fulfillment;
mod ppob_recovery;
pub mod queries;

pub use admin::{update_payment_method, void};
pub use checkout::checkout;
pub use ppob_recovery::{
    mark_interrupted_ppob_uncertain, resolve_uncertain_ppob, retry_ppob_fulfillment,
};
pub use queries::{detail, list, next_receipt_number};

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
const PPOB_STATUS_FAILED: &str = "failed";
/// The provider call went out but its answer never arrived (timeout, dropped
/// connection, garbled body), or the app stopped while it was in flight. The
/// money may be spent, so the line is neither retried nor refunded until a
/// person checks the Mitra history and marks it success or failed.
const PPOB_STATUS_UNCERTAIN: &str = "uncertain";

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

fn summarize_ppob_items(
    items: &[transaction_items::Model],
) -> (bool, Option<String>, Option<String>, Option<String>) {
    let ppob_item = items.iter().find(|item| item.service_type.is_some());

    match ppob_item {
        Some(item) => (
            true,
            item.ppob_status.clone(),
            item.ppob_message.clone(),
            item.ppob_serial_number.clone(),
        ),
        None => (false, None, None, None),
    }
}
