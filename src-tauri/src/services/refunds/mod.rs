//! Refunds and exchanges.
//!
//! [`create`] is the whole write path — the seven-day window, the
//! already-refunded tally, stock restoration, the automatic write-off for
//! goods that came back damaged, and the replacement goods of an exchange.
//! [`queries`] is the read side. The shared helpers below are what both agree
//! on.

#[cfg(test)]
pub(crate) mod fixtures;

pub mod create;
pub mod queries;

pub use create::create;
pub use queries::{detail, list};

use std::collections::HashMap;

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect};

use crate::entity::{refund_items, refunds, transaction_items};
use crate::utils::AppError;

/// Units of each sold line (keyed by `transaction_items.id`) that earlier
/// refunds of `transaction_id` already took back. Lines never returned are
/// absent. A new refund is checked against this tally.
pub async fn refunded_quantities<C: ConnectionTrait>(
    db: &C,
    transaction_id: i64,
) -> Result<HashMap<i64, i64>, AppError> {
    refunded_quantities_for(db, &[transaction_id]).await
}

/// [`refunded_quantities`] for several sales in one query.
pub async fn refunded_quantities_for<C: ConnectionTrait>(
    db: &C,
    transaction_ids: &[i64],
) -> Result<HashMap<i64, i64>, AppError> {
    if transaction_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows: Vec<(i64, i64)> = refund_items::Entity::find()
        .select_only()
        .column(refund_items::Column::TransactionItemId)
        .column_as(refund_items::Column::Quantity.sum(), "quantity")
        .inner_join(refunds::Entity)
        .filter(refunds::Column::TransactionId.is_in(transaction_ids.iter().copied()))
        .group_by(refund_items::Column::TransactionItemId)
        .into_tuple()
        .all(db)
        .await?;

    Ok(rows.into_iter().collect())
}

/// Rupiah to hand back for `quantity` units of a sold line: the money that
/// changed hands, `net_subtotal / quantity` per unit, so every discount given
/// on the line stays given.
fn refund_amount_for(txn_item: &transaction_items::Model, quantity: i64) -> f64 {
    if txn_item.quantity <= 0 {
        return 0.0;
    }

    txn_item.net_subtotal / txn_item.quantity as f64 * quantity as f64
}
