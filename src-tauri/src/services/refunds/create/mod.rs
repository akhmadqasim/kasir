//! Recording a refund or exchange.
//!
//! [`eligibility`] decides whether the sale may be refunded at all, [`returns`]
//! handles the goods coming back and [`exchange`] the replacements going out.
//! [`create`] runs them in order inside one write-locked DB transaction.

mod eligibility;
mod exchange;
mod returns;

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, QueryFilter, Set, Statement, TransactionTrait,
};

use crate::domain::refunds::{CreateRefundInput, RefundResult};
use crate::domain::Actor;
use crate::entity::{refunds, transaction_items, transactions};
use crate::services::document_number::next_refund_number;
use crate::services::shifts::open_shift_id;
use crate::utils::time::now_ts;
use crate::utils::AppError;
use eligibility::{load_refundable_transaction, validate_input};
use exchange::record_exchange;
use returns::{record_returned_lines, RefundTally};

/// Record a return, and the replacement goods when it is an exchange.
///
/// The actor is recorded on the refund and on any write-off it raises; nothing
/// in the request body decides who did it.
pub async fn create(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateRefundInput,
) -> Result<RefundResult, AppError> {
    validate_input(&input)?;

    let txn = db.begin().await?;
    lock_for_refund(&txn, input.transaction_id).await?;

    let transaction = load_refundable_transaction(&txn, input.transaction_id).await?;

    let txn_items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(input.transaction_id))
        .all(&txn)
        .await?;
    let mut tally = RefundTally::load(&txn, input.transaction_id).await?;

    let now = now_ts();
    let refund_number = next_refund_number(&txn).await?;

    let returned_lines = tally.claim(&txn_items, &input.items)?;
    let total_refund_amount: f64 = returned_lines.iter().map(|line| line.amount).sum();

    let exchange_inputs = input.exchange_items.as_deref().unwrap_or_default();
    let has_exchange = !exchange_inputs.is_empty();

    // The drawer the money comes out of is the one open NOW, not the one that
    // rang up the sale. It is resolved from the actor's own open shift rather
    // than taken from the payload: a cashier cannot book a payout against
    // somebody else's till by editing a request. `None` when no shift is open —
    // shifts are optional here, exactly as they are for a sale.
    let shift_id = open_shift_id(&txn, actor).await?;

    let refund = refunds::ActiveModel {
        id: NotSet,
        refund_number: Set(refund_number),
        transaction_id: Set(input.transaction_id),
        user_id: Set(actor.user_id),
        refund_type: Set(if has_exchange { "exchange" } else { "refund" }.to_string()),
        total_refund_amount: Set(total_refund_amount),
        total_exchange_amount: Set(Some(0.0)),
        difference_amount: Set(Some(0.0)),
        payment_method: Set(Some(transaction.payment_method.clone())),
        reason: Set(input.reason.clone()),
        shift_id: Set(shift_id),
        created_at: Set(Some(now.clone())),
    }
    .insert(&txn)
    .await?;

    let items = record_returned_lines(&txn, actor, &refund, &returned_lines, &now).await?;
    let (exchange_items, total_exchange_amount) =
        record_exchange(&txn, refund.id, exchange_inputs, &now).await?;

    // Keep the updated model: the previous code updated a clone and dropped the
    // result, so every exchange reported total_exchange_amount 0 and
    // difference_amount 0 back to the caller even though the row was correct.
    let refund = if has_exchange {
        let mut active_refund: refunds::ActiveModel = refund.into();
        active_refund.total_exchange_amount = Set(Some(total_exchange_amount));
        active_refund.difference_amount = Set(Some(total_refund_amount - total_exchange_amount));
        active_refund.update(&txn).await?
    } else {
        refund
    };

    let mut active_txn: transactions::ActiveModel = transaction.into();
    active_txn.status = Set(tally.settled_status(&txn_items).to_string());
    active_txn.update(&txn).await?;

    txn.commit().await?;

    Ok(RefundResult {
        refund,
        items,
        exchange_items,
    })
}

/// Acquire the SQLite write lock up front (emulate BEGIN IMMEDIATE) so the
/// already-refunded tally and exchange stock reads are consistent and no
/// concurrent refund of the same transaction can interleave between our reads
/// and our writes. sea-orm's begin()/begin_with_config() only issue a DEFERRED
/// `BEGIN` for SQLite (access mode is ignored), which would let two
/// interleaving refunds each read a stale tally and both pass. Forcing an early
/// (no-op) write escalates to the reserved write lock; a second refund then
/// serializes on it (busy_timeout) and re-reads the fresh totals.
async fn lock_for_refund<C: ConnectionTrait>(db: &C, transaction_id: i64) -> Result<(), AppError> {
    db.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE transactions SET status = status WHERE id = $1",
        vec![transaction_id.into()],
    ))
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::refunds::fixtures::{actor, aged_sale, refund_one, setup};

    /// B23: the money comes out of the drawer that is open now. The shift is
    /// read from the actor's own open shift, so a payload cannot book a payout
    /// against another cashier's till, and a return taken with no shift open is
    /// simply unattributed rather than being forced onto one.
    #[tokio::test]
    async fn a_refund_is_stamped_with_the_cashiers_own_open_shift() {
        use crate::domain::shifts::OpenShiftInput;

        let conn = setup().await;
        let (txn, item) = aged_sale(&conn, chrono::Duration::hours(1)).await;

        let without_shift = create(&conn, &actor(), refund_one(txn.id, item.id))
            .await
            .expect("a refund with no shift open still works");
        assert_eq!(without_shift.refund.shift_id, None);

        let shift = crate::services::shifts::open(
            &conn,
            &actor(),
            OpenShiftInput {
                opening_cash: Some(0.0),
            },
        )
        .await
        .expect("shift opens");

        let (txn2, item2) = aged_sale(&conn, chrono::Duration::hours(1)).await;
        let with_shift = create(&conn, &actor(), refund_one(txn2.id, item2.id))
            .await
            .expect("refund");
        assert_eq!(with_shift.refund.shift_id, Some(shift.id));

        // Another cashier's return goes to their own drawer, not this one.
        let other =
            crate::test_support::insert_user(&conn, "kasir9", "Kasir Sembilan", "kasir").await;
        let (txn3, item3) = aged_sale(&conn, chrono::Duration::hours(1)).await;
        let theirs = create(&conn, &Actor::from(&other), refund_one(txn3.id, item3.id))
            .await
            .expect("refund");
        assert_eq!(theirs.refund.shift_id, None);
    }
}
