//! Sales: ringing one up, reading them back, and the two admin corrections.
//!
//! [`checkout`] owns the write path — cart resolution, the money arithmetic,
//! persistence and PPOB fulfilment. [`queries`] is the read side and [`admin`]
//! holds voiding a sale and correcting its payment method. What all three share
//! lives here.

#[cfg(test)]
pub(crate) mod fixtures;

pub mod admin;
pub mod checkout;
pub mod queries;

pub use admin::{update_payment_method, void};
pub use checkout::{checkout, retry_ppob_fulfillment};
pub use queries::{detail, list, next_receipt_number};

use sea_orm::{ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, QueryFilter, Statement};

use crate::domain::settings::parse_app_settings;
use crate::domain::transactions::{PaymentSplit, TransactionItemInput};
use crate::entity::store_info;
use crate::entity::{transaction_items, transaction_payments, transactions};
use crate::utils::AppError;

const VALID_PAYMENT_METHODS: &[&str] = &["cash", "qris", "debit", "ewallet", "transfer"];
const STATUS_COMPLETED: &str = "completed";
const MIXED_PAYMENT_METHOD: &str = "mixed";

/// Fulfilment states of a PPOB line. `pending` is set at checkout and owned by
/// the background task that follows it; `processing` is owned by a retry. Both
/// mean "a provider call is in flight", so neither may be retried.
const PPOB_STATUS_PENDING: &str = "pending";
const PPOB_STATUS_PROCESSING: &str = "processing";
pub(crate) const PPOB_STATUS_SUCCESS: &str = "success";
const PPOB_STATUS_FAILED: &str = "failed";

fn now_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

async fn generate_receipt_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    // Use the same UTC basis as `created_at` (stored via `now_timestamp()` /
    // `Utc::now()`), so a late-night local sale's receipt date matches the date
    // recorded in `created_at` and the per-day sequence resets on the same day.
    let today = chrono::Utc::now().format("%Y%m%d").to_string();
    let prefix = format!("TRX-{}-", today);

    let result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT MAX(CAST(SUBSTR(receipt_number, LENGTH($1) + 1) AS INTEGER)) as max_num FROM transactions WHERE receipt_number LIKE $2",
            vec![prefix.clone().into(), format!("{}%", prefix).into()],
        ))
        .await?;

    let max_num: i64 = result
        .map(|r| r.try_get::<i64>("", "max_num").unwrap_or(0))
        .unwrap_or(0);

    Ok(format!("{}{:04}", prefix, max_num + 1))
}

async fn load_allow_negative_stock<C: ConnectionTrait>(db: &C) -> Result<bool, AppError> {
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

fn validate_cart_composition(items: &[TransactionItemInput]) -> Result<bool, AppError> {
    if items.is_empty() {
        return Err(AppError::Validation(
            "Item transaksi tidak boleh kosong".into(),
        ));
    }

    let has_ppob = items.iter().any(|item| item.service_type.is_some());

    Ok(has_ppob)
}
async fn load_payment_breakdown<C: ConnectionTrait>(
    db: &C,
    transaction_id: i64,
    transaction: &transactions::Model,
) -> Result<Vec<PaymentSplit>, AppError> {
    let splits = transaction_payments::Entity::find()
        .filter(transaction_payments::Column::TransactionId.eq(transaction_id))
        .all(db)
        .await?;

    if !splits.is_empty() {
        return Ok(splits
            .into_iter()
            .map(|split| PaymentSplit {
                payment_method: split.payment_method,
                bank_name: split.bank_name,
                amount: split.amount,
            })
            .collect());
    }

    Ok(vec![PaymentSplit {
        payment_method: transaction.payment_method.clone(),
        bank_name: None,
        amount: transaction.total_amount,
    }])
}
fn clamp_per_page(requested: Option<u64>) -> u64 {
    requested.unwrap_or(50).clamp(1, 100)
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
