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

use sea_orm::{DatabaseConnection, TransactionTrait};
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
use crate::utils::AppError;
use cart::{resolve_channel, resolve_items, validate_cart_composition};
use persist::persist_transaction;

#[cfg(test)]
use super::ppob_fulfillment::{update_ppob_item_status, PpobOutcome};
#[cfg(test)]
use crate::domain::ppob::PaymentResult;
#[cfg(test)]
use crate::services::ppob::executor::PpobFulfillmentRequest;

/// Everything a checkout does before PPOB fulfilment: validate the cart, write
/// the sale as `completed` and take the physical stock off. Returns the sale,
/// whether it has PPOB lines, and the (validated) PPOB PIN.
async fn ring_up(
    db: &DatabaseConnection,
    actor: &Actor,
    input: &CheckoutTransactionInput,
) -> Result<(TransactionResult, bool, String), AppError> {
    validate_payment_method(&input.payment_method)?;

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
    txn.commit().await?;

    Ok((result, has_ppob, ppob_pin))
}

/// Ring up a sale.
///
/// The sale is always written as `completed` and the physical stock comes off
/// straight away; any PPOB lines are then chased in the background, because the
/// provider can take seconds and the customer is standing at the counter.
pub async fn checkout(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    actor: &Actor,
    input: CheckoutTransactionInput,
) -> Result<TransactionResult, AppError> {
    let (result, has_ppob, ppob_pin) = ring_up(db, actor, &input).await?;

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
    let (result, has_ppob, ppob_pin) = ring_up(db, actor, &input).await?;

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

    fetch_transaction_result(db, result.transaction.id).await
}

#[cfg(test)]
async fn fetch_transaction_result(
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
