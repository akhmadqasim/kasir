//! Writing a resolved cart as a `completed` sale: the header, its lines, the
//! payment splits, and the stock that leaves the shelf.

use sea_orm::{ActiveModelTrait, ActiveValue::NotSet, ConnectionTrait, DbBackend, Set, Statement};

use super::cart::ResolvedItem;
use super::discounts::{prorated_line_nets, validate_discounts};
use super::payment::calculate_payment;
use crate::domain::transactions::{CheckoutTransactionInput, TransactionResult};
use crate::domain::Actor;
use crate::entity::{transaction_items, transaction_payments, transactions};
use crate::services::document_number::next_receipt_number;
use crate::services::shifts::open_shift_id;
use crate::services::transactions::{PPOB_STATUS_PENDING, STATUS_COMPLETED};
use crate::utils::time::now_ts;
use crate::utils::AppError;

/// Write the sale as `completed` with its lines, and take the physical stock off.
pub(super) async fn persist_transaction<C: ConnectionTrait>(
    db: &C,
    input: &CheckoutTransactionInput,
    actor: &Actor,
    resolved_items: &[ResolvedItem],
    channel: &str,
    allow_negative_stock: bool,
) -> Result<TransactionResult, AppError> {
    let subtotal_amount: f64 = resolved_items.iter().map(|item| item.subtotal).sum();
    let transaction_discount = input.transaction_discount.unwrap_or(0.0);
    // Reject tampered/over-range discounts BEFORE persisting anything.
    validate_discounts(resolved_items, transaction_discount)?;
    let item_discounts_total: f64 = resolved_items.iter().map(|item| item.item_discount).sum();
    let discount_amount = item_discounts_total + transaction_discount;
    let total_amount = (subtotal_amount - discount_amount).max(0.0);
    let payment = calculate_payment(input, total_amount)?;
    let receipt_number = next_receipt_number(db).await?;
    // The drawer the cash lands in is the cashier's own open shift, exactly as
    // for a refund — never a shift id from the request.
    let shift_id = open_shift_id(db, actor).await?;
    let now = now_ts();

    let transaction = transactions::ActiveModel {
        id: NotSet,
        receipt_number: Set(receipt_number),
        user_id: Set(actor.user_id),
        total_amount: Set(total_amount),
        subtotal_amount: Set(subtotal_amount),
        discount_amount: Set(discount_amount),
        payment_method: Set(payment.method),
        payment_amount: Set(payment.amount),
        change_amount: Set(Some(payment.change)),
        status: Set(STATUS_COMPLETED.to_string()),
        channel: Set(channel.to_string()),
        notes: Set(input.notes.clone()),
        shift_id: Set(shift_id),
        deleted_at: Set(None),
        deleted_by: Set(None),
        deleted_reason: Set(None),
        updated_at: Set(None),
        created_at: Set(Some(now.clone())),
    }
    .insert(db)
    .await?;

    let line_nets = prorated_line_nets(resolved_items, transaction_discount);
    let mut items = Vec::with_capacity(resolved_items.len());

    for (item, net_subtotal) in resolved_items.iter().zip(line_nets) {
        items.push(insert_line(db, transaction.id, item, net_subtotal, &now).await?);

        if let Some(product_id) = item.product_id {
            take_stock(db, item, product_id, allow_negative_stock, &now).await?;
        }
    }

    for split in &payment.splits {
        transaction_payments::ActiveModel {
            id: NotSet,
            transaction_id: Set(transaction.id),
            payment_method: Set(split.payment_method.clone()),
            bank_name: Set(split.bank_name.clone()),
            amount: Set(split.amount),
            created_at: Set(Some(now.clone())),
        }
        .insert(db)
        .await?;
    }

    Ok(TransactionResult {
        transaction,
        items,
        payment_breakdown: payment.splits,
    })
}

/// One sold line, with name and price snapshotted. A PPOB line starts out
/// `pending`: its fulfilment runs after the commit.
async fn insert_line<C: ConnectionTrait>(
    db: &C,
    transaction_id: i64,
    item: &ResolvedItem,
    net_subtotal: f64,
    now: &str,
) -> Result<transaction_items::Model, AppError> {
    let is_ppob = item.service_type.is_some();

    Ok(transaction_items::ActiveModel {
        id: NotSet,
        transaction_id: Set(transaction_id),
        product_id: Set(item.product_id),
        product_name: Set(item.product_name.clone()),
        product_price: Set(item.sell_price),
        buy_price: Set(item.buy_price),
        quantity: Set(item.quantity),
        subtotal: Set(item.subtotal),
        item_discount: Set(item.item_discount),
        net_subtotal: Set(net_subtotal),
        service_type: Set(item.service_type.clone()),
        service_ref: Set(item.service_ref.clone()),
        ppob_product_id: Set(item.ppob_product_id),
        ppob_product_code: Set(item.ppob_product_code.clone()),
        ppob_inquiry_id: Set(item.ppob_inquiry_id.clone()),
        ppob_payment_code: Set(item.ppob_payment_code.clone()),
        ppob_flag_id: Set(item.ppob_flag_id.clone()),
        ppob_status: Set(is_ppob.then(|| PPOB_STATUS_PENDING.to_string())),
        ppob_message: Set(None),
        ppob_serial_number: Set(None),
        created_at: Set(Some(now.to_string())),
    }
    .insert(db)
    .await?)
}

/// Atomic, guarded decrement inside the same DB transaction so we cannot
/// oversell: the stock is re-read and checked by the UPDATE itself. When
/// `allow_negative_stock` is false, the row only matches while
/// `stock >= quantity`; otherwise ($4 = 1) the guard is bypassed and negative
/// stock is permitted. PPOB items have a NULL `product_id` and never get here.
async fn take_stock<C: ConnectionTrait>(
    db: &C,
    item: &ResolvedItem,
    product_id: i64,
    allow_negative_stock: bool,
    now: &str,
) -> Result<(), AppError> {
    let allow_negative_flag: i64 = if allow_negative_stock { 1 } else { 0 };
    let update_result = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE products SET stock = stock - $1, updated_at = $2 WHERE id = $3 AND (stock >= $1 OR $4 = 1)",
            vec![
                item.quantity.into(),
                now.into(),
                product_id.into(),
                allow_negative_flag.into(),
            ],
        ))
        .await?;

    if update_result.rows_affected() == 0 {
        // No row matched the guard => insufficient stock (and not allowed to
        // go negative). Returning here aborts before commit, rolling back the
        // whole transaction.
        return Err(AppError::Validation(format!(
            "Stok '{}' tidak cukup",
            item.product_name
        )));
    }

    Ok(())
}
