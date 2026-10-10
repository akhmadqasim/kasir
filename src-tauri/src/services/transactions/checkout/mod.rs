//! Ringing up a sale.
//!
//! [`cart`] turns the request into trusted lines, [`discounts`] and [`payment`]
//! do the money arithmetic, and [`persist`] writes it all in one DB
//! transaction. PPOB lines are then handed to `ppob_fulfillment`, after the
//! commit.

mod cart;
mod discounts;
mod payment;
mod persist;

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait};
#[cfg(test)]
use std::future::Future;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::load_allow_negative_stock;
use super::ppob_fulfillment::{build_ppob_request, spawn_fulfillment};
use super::validate_payment_method;
use crate::domain::transactions::{CheckoutTransactionInput, TransactionResult};
use crate::domain::Actor;
use crate::services::ppob::executor::validate_pin;
use crate::services::ppob::MitraClient;
use crate::utils::text::ensure_printable_len;
use crate::utils::AppError;
use cart::{resolve_channel, resolve_items, validate_cart_composition};
use persist::persist_transaction;

#[cfg(test)]
use super::ppob_fulfillment::{update_ppob_item_status, PpobOutcome};
#[cfg(test)]
use crate::domain::ppob::PaymentResult;
#[cfg(test)]
use crate::services::ppob::executor::PpobFulfillmentRequest;

/// One claim on an `idempotency_keys` row: its id and the random `claim_nonce`
/// it was claimed with. Every attempt with a key shares the row id, so the
/// nonce is what tells this claim from a retry's re-claim, even within one
/// second; every write a claim makes afterwards (the sale link, complete,
/// release) is conditional on both.
#[derive(Debug, Clone)]
pub struct IdempotencyClaim {
    pub key_id: String,
    pub nonce: String,
}

/// Everything a checkout does before PPOB fulfilment: validate the cart, write
/// the sale as `completed` and take the physical stock off. Returns the sale,
/// whether it has PPOB lines, and the (validated) PPOB PIN.
async fn ring_up(
    db: &DatabaseConnection,
    actor: &Actor,
    input: &CheckoutTransactionInput,
    idempotency_key: Option<&IdempotencyClaim>,
) -> Result<(TransactionResult, bool, String), AppError> {
    validate_payment_method(&input.payment_method)?;
    // Notes are printed on every receipt of this sale.
    ensure_printable_len(input.notes.as_deref(), "Catatan")?;

    let has_ppob = validate_cart_composition(&input.items)?;
    // Resolved before anything is written: a cart the PPOB page may not sell
    // must not take stock off the shelf on its way to being refused.
    let channel = resolve_channel(input.channel.as_deref(), &input.items)?;
    // Checked before anything is written: a cart with a PPOB line and no PIN
    // (or a malformed one) must not create a transaction at all.
    let ppob_pin = validate_pin(input.ppob_pin.clone(), has_ppob)?;
    let allow_negative_stock = load_allow_negative_stock(db).await?;
    let resolved_items = resolve_items(db, &input.items, allow_negative_stock).await?;

    let txn = db.begin().await?;
    let result = persist_transaction(
        &txn,
        input,
        actor,
        &resolved_items,
        channel,
        allow_negative_stock,
    )
    .await?;
    if let Some(claim) = idempotency_key {
        link_idempotency_key(&txn, claim, result.transaction.id).await?;
    }
    txn.commit().await?;

    Ok((result, has_ppob, ppob_pin))
}

/// Ring up a sale.
///
/// The sale is always written as `completed` and the physical stock comes off
/// straight away; any PPOB lines are then chased in the background, because the
/// provider can take seconds and the customer is standing at the counter.
///
/// `idempotency_key` is the claim on the `idempotency_keys` row guarding this
/// request, if any; the sale's id is written to it in the same DB transaction.
pub async fn checkout(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    actor: &Actor,
    input: CheckoutTransactionInput,
    idempotency_key: Option<&IdempotencyClaim>,
) -> Result<TransactionResult, AppError> {
    let (result, has_ppob, ppob_pin) = ring_up(db, actor, &input, idempotency_key).await?;

    if has_ppob {
        // Process each PPOB item in its own background task
        for ppob_item in result
            .items
            .iter()
            .filter(|item| item.service_type.is_some())
        {
            let request = build_ppob_request(ppob_item, ppob_pin.clone())?;
            spawn_fulfillment(db.clone(), mitra.clone(), ppob_item.id, request);
        }
    }

    Ok(result)
}

/// Test seam for [`checkout`]: the same flow with the PPOB provider call
/// injected and awaited in line, so a test can drive fulfilment without a
/// network and read the outcome straight off the returned sale.
#[cfg(test)]
pub(crate) async fn checkout_with_executor<F, Fut>(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CheckoutTransactionInput,
    fulfill_ppob: F,
) -> Result<TransactionResult, AppError>
where
    F: Fn(PpobFulfillmentRequest) -> Fut,
    Fut: Future<Output = Result<PaymentResult, AppError>>,
{
    let (result, has_ppob, ppob_pin) = ring_up(db, actor, &input, None).await?;

    if !has_ppob {
        return Ok(result);
    }

    for ppob_item in result
        .items
        .iter()
        .filter(|item| item.service_type.is_some())
    {
        let request = build_ppob_request(ppob_item, ppob_pin.clone())?;
        let outcome = PpobOutcome::from_result(fulfill_ppob(request).await);
        update_ppob_item_status(db, ppob_item.id, outcome).await?;
    }

    sale_result(db, result.transaction.id).await
}

/// Record, inside the sale's own DB transaction, which sale the idempotency
/// key produced, so a key a crash strands `in_progress` shows whether its sale
/// committed. The link lands only on this attempt's own unlinked claim; if a
/// retry re-claimed the row, the error rolls this sale back and the retry sells.
async fn link_idempotency_key<C: ConnectionTrait>(
    db: &C,
    claim: &IdempotencyClaim,
    transaction_id: i64,
) -> Result<(), AppError> {
    let linked = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE idempotency_keys SET transaction_id = $1
             WHERE id = $2 AND claim_nonce = $3
               AND status = 'in_progress' AND transaction_id IS NULL",
            vec![
                transaction_id.into(),
                claim.key_id.clone().into(),
                claim.nonce.clone().into(),
            ],
        ))
        .await?;

    if linked.rows_affected() != 1 {
        return Err(AppError::Validation(
            "Transaksi ini sudah diproses ulang oleh percobaan lain dan dibatalkan. Periksa riwayat transaksi."
                .into(),
        ));
    }
    Ok(())
}

/// A committed sale in the shape [`checkout`] answers with: header, lines and
/// payment splits. Used to answer for a sale whose original response was lost.
pub async fn sale_result(
    db: &DatabaseConnection,
    transaction_id: i64,
) -> Result<TransactionResult, AppError> {
    use crate::entity::{transaction_items, transactions};
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db)
        .await?;

    let payment_breakdown = super::load_payment_breakdown(db, &transaction).await?;

    Ok(TransactionResult {
        transaction,
        items,
        payment_breakdown,
    })
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod edge_tests;
