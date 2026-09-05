//! Refunds and exchanges.
//!
//! [`create`] is the whole write path — the seven-day window, the
//! already-refunded tally, stock restoration and the automatic write-off for
//! goods that came back damaged. [`queries`] is the read side. The shared
//! helpers below are what both agree on.

pub mod create;
pub mod queries;

pub use create::create;
pub use queries::{detail, list};

use sea_orm::{ConnectionTrait, DbBackend, Statement};

use crate::domain::refunds::RefundItemInput;
use crate::entity::transaction_items;
use crate::utils::AppError;

const REFUND_MAX_DAYS: i64 = 7;
const VALID_CONDITIONS: &[&str] = &["good", "damaged", "expired"];

async fn generate_refund_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let prefix = format!("RFD-{}-", today);

    let result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT MAX(CAST(SUBSTR(refund_number, LENGTH($1) + 1) AS INTEGER)) as max_num FROM refunds WHERE refund_number LIKE $2",
            vec![prefix.clone().into(), format!("{}%", prefix).into()],
        ))
        .await?;

    let max_num: i64 = result
        .map(|r| r.try_get::<i64>("", "max_num").unwrap_or(0))
        .unwrap_or(0);

    Ok(format!("{}{:04}", prefix, max_num + 1))
}

async fn generate_writeoff_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let prefix = format!("WO-{}-", today);

    let result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT MAX(CAST(SUBSTR(writeoff_number, LENGTH($1) + 1) AS INTEGER)) as max_num FROM stock_writeoffs WHERE writeoff_number LIKE $2",
            vec![prefix.clone().into(), format!("{}%", prefix).into()],
        ))
        .await?;

    let max_num: i64 = result
        .map(|r| r.try_get::<i64>("", "max_num").unwrap_or(0))
        .unwrap_or(0);

    Ok(format!("{}{:04}", prefix, max_num + 1))
}

/// Resolves the sold line a refund input points at, together with the product
/// whose stock it moves. Both come from the transaction itself, never from the
/// client: `transaction_item_id` is the only thing a caller gets to choose, and
/// it is checked against the lines of the transaction being refunded.
///
/// PPOB lines carry no `product_id` — there is no physical stock to give back —
/// so they are rejected here rather than failing later on a NOT NULL column.
fn resolve_refund_line<'a>(
    txn_items: &'a [transaction_items::Model],
    item_input: &RefundItemInput,
) -> Result<(&'a transaction_items::Model, i64), AppError> {
    let txn_item = txn_items
        .iter()
        .find(|ti| ti.id == item_input.transaction_item_id)
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Item transaksi ID {} tidak ditemukan dalam transaksi ini",
                item_input.transaction_item_id
            ))
        })?;

    let product_id = txn_item.product_id.ok_or_else(|| {
        AppError::Validation(format!(
            "'{}' bukan produk fisik dan tidak bisa di-refund",
            txn_item.product_name
        ))
    })?;

    Ok((txn_item, product_id))
}

/// Rupiah to hand back for `quantity` units of a sold line.
///
/// This is the money that actually changed hands, not the list price:
/// `transaction_items.net_subtotal` already has the line's own discount and its
/// share of the transaction-level discount taken off (see migration 018), so a
/// single unit is worth `net_subtotal / quantity`. Refunding at
/// `product_price * quantity` instead handed the customer back every discount
/// they were given, at the shop's expense, on every single return.
fn refund_amount_for(txn_item: &transaction_items::Model, quantity: i64) -> f64 {
    if txn_item.quantity <= 0 {
        return 0.0;
    }

    txn_item.net_subtotal / txn_item.quantity as f64 * quantity as f64
}

/// Page size to actually use, clamped to `1..=100`.
///
/// Zero would make `total_pages` meaningless, and an uncapped upper end let a
/// single request pull the whole refund history into memory.
fn clamp_per_page(requested: Option<i64>) -> i64 {
    requested.unwrap_or(50).clamp(1, 100)
}
