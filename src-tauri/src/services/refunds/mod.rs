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

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use crate::entity::{refund_items, refunds, transaction_items};
use crate::utils::AppError;

/// Units of each sold line (keyed by `transaction_items.id`) that earlier
/// refunds of `transaction_id` already took back. Lines never returned are
/// absent. This is the tally [`create`] checks a new refund against, and what
/// the transaction detail reports per line so the refund form can cap each
/// quantity at what is actually left.
pub async fn refunded_quantities<C: ConnectionTrait>(
    db: &C,
    transaction_id: i64,
) -> Result<HashMap<i64, i64>, AppError> {
    let refund_ids: Vec<i64> = refunds::Entity::find()
        .filter(refunds::Column::TransactionId.eq(transaction_id))
        .all(db)
        .await?
        .into_iter()
        .map(|refund| refund.id)
        .collect();

    let mut refunded = HashMap::new();
    if refund_ids.is_empty() {
        return Ok(refunded);
    }

    let returned_lines = refund_items::Entity::find()
        .filter(refund_items::Column::RefundId.is_in(refund_ids))
        .all(db)
        .await?;
    for line in returned_lines {
        *refunded.entry(line.transaction_item_id).or_insert(0) += line.quantity;
    }

    Ok(refunded)
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
