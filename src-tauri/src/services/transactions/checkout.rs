//! Ringing up a sale: resolving the cart, splitting the money, writing the
//! rows, and chasing PPOB fulfilment afterwards.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, QueryFilter, Set, Statement, TransactionTrait,
};
#[cfg(test)]
use std::future::Future;
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg(test)]
use super::load_payment_breakdown;
use super::{
    generate_receipt_number, load_allow_negative_stock, now_timestamp, validate_cart_composition,
    MIXED_PAYMENT_METHOD, PPOB_STATUS_FAILED, PPOB_STATUS_PENDING, PPOB_STATUS_PROCESSING,
    PPOB_STATUS_SUCCESS, STATUS_COMPLETED, VALID_PAYMENT_METHODS,
};
use crate::domain::ppob::PaymentResult;
use crate::domain::transactions::{
    CheckoutTransactionInput, PaymentSplit, TransactionItemInput, TransactionResult,
};
use crate::domain::Actor;
use crate::entity::{products, transaction_items, transaction_payments, transactions};
use crate::services::ppob::executor::{execute_fulfillment_request, PpobFulfillmentRequest};
use crate::services::ppob::MitraClient;
use crate::utils::AppError;

#[derive(Default)]
struct ResolvedItem {
    product_id: Option<i64>,
    product_name: String,
    sell_price: f64,
    buy_price: Option<f64>,
    quantity: i64,
    subtotal: f64,
    item_discount: f64,
    service_type: Option<String>,
    service_ref: Option<String>,
    ppob_product_id: Option<i64>,
    ppob_product_code: Option<String>,
    ppob_inquiry_id: Option<String>,
    ppob_payment_code: Option<String>,
    ppob_flag_id: Option<String>,
}

async fn resolve_items<C: ConnectionTrait>(
    db: &C,
    items: &[TransactionItemInput],
    allow_negative_stock: bool,
) -> Result<Vec<ResolvedItem>, AppError> {
    let mut resolved_items = Vec::with_capacity(items.len());

    for item_input in items {
        if item_input.quantity <= 0 {
            return Err(AppError::Validation(
                "Jumlah item harus lebih dari 0".into(),
            ));
        }

        if let Some(service_type) = item_input.service_type.clone() {
            let product_name = item_input
                .product_name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| AppError::Validation("Nama produk PPOB harus diisi".into()))?;
            let product_price = item_input
                .product_price
                .filter(|value| *value > 0.0)
                .ok_or_else(|| AppError::Validation("Harga produk PPOB harus diisi".into()))?;
            let service_ref = item_input
                .service_ref
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::Validation("Referensi pelanggan PPOB harus diisi".into())
                })?;

            match service_type.as_str() {
                "pulsa" | "data" => {
                    if item_input.ppob_product_id.is_none()
                        || item_input
                            .ppob_product_code
                            .as_ref()
                            .is_none_or(|value| value.trim().is_empty())
                    {
                        return Err(AppError::Validation(
                            "Metadata produk PPOB belum lengkap untuk topup langsung".into(),
                        ));
                    }
                }
                "pln" | "pdam" | "bpjs" | "pp" | "transfer" | "emoney" => {
                    if item_input
                        .ppob_inquiry_id
                        .as_ref()
                        .is_none_or(|value| value.trim().is_empty())
                    {
                        return Err(AppError::Validation(
                            "Inquiry PPOB harus dilakukan sebelum checkout".into(),
                        ));
                    }
                }
                other => {
                    return Err(AppError::Validation(format!(
                        "Service type PPOB tidak didukung: {}",
                        other
                    )))
                }
            }

            resolved_items.push(ResolvedItem {
                product_id: None,
                product_name,
                sell_price: product_price,
                buy_price: item_input.buy_price,
                quantity: item_input.quantity,
                subtotal: product_price * item_input.quantity as f64,
                item_discount: item_input.item_discount.unwrap_or(0.0),
                service_type: Some(service_type),
                service_ref: Some(service_ref),
                ppob_product_id: item_input.ppob_product_id,
                ppob_product_code: item_input.ppob_product_code.clone(),
                ppob_inquiry_id: item_input.ppob_inquiry_id.clone(),
                ppob_payment_code: item_input.ppob_payment_code.clone(),
                ppob_flag_id: item_input.ppob_flag_id.clone(),
            });
            continue;
        }

        let product_id = item_input
            .product_id
            .ok_or_else(|| AppError::Validation("Produk fisik harus memiliki ID produk".into()))?;

        let product = products::Entity::find_by_id(product_id)
            .filter(products::Column::IsActive.eq(true))
            .one(db)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "Produk dengan ID {} tidak ditemukan atau tidak aktif",
                    product_id
                ))
            })?;

        if product.stock < item_input.quantity && !allow_negative_stock {
            return Err(AppError::Validation(format!(
                "Stok '{}' tidak cukup (tersedia: {}, diminta: {})",
                product.name, product.stock, item_input.quantity
            )));
        }

        resolved_items.push(ResolvedItem {
            product_id: Some(product.id),
            product_name: product.name,
            sell_price: product.sell_price,
            buy_price: Some(product.buy_price),
            quantity: item_input.quantity,
            subtotal: product.sell_price * item_input.quantity as f64,
            item_discount: item_input.item_discount.unwrap_or(0.0),
            service_type: None,
            service_ref: None,
            ppob_product_id: None,
            ppob_product_code: None,
            ppob_inquiry_id: None,
            ppob_payment_code: None,
            ppob_flag_id: None,
        });
    }

    Ok(resolved_items)
}

fn validate_payment_method(method: &str) -> Result<(), AppError> {
    if !VALID_PAYMENT_METHODS.contains(&method) {
        return Err(AppError::Validation(format!(
            "Metode pembayaran tidak valid: {}",
            method
        )));
    }

    Ok(())
}

fn calculate_payment_amount(
    payment_method: &str,
    requested_payment_amount: f64,
    total_amount: f64,
) -> Result<(f64, f64, Vec<PaymentSplit>), AppError> {
    if payment_method == "cash" && requested_payment_amount < total_amount {
        return Err(AppError::Validation(format!(
            "Pembayaran kurang. Total: {}, Dibayar: {}",
            total_amount, requested_payment_amount
        )));
    }

    let payment_amount = if payment_method == "cash" {
        requested_payment_amount
    } else {
        total_amount
    };
    let change_amount = if payment_method == "cash" {
        requested_payment_amount - total_amount
    } else {
        0.0
    };

    Ok((
        payment_amount,
        change_amount,
        vec![PaymentSplit {
            payment_method: payment_method.to_string(),
            bank_name: None,
            amount: total_amount,
        }],
    ))
}

fn calculate_payment_amount_with_breakdown(
    input: &CheckoutTransactionInput,
    total_amount: f64,
) -> Result<(String, f64, f64, Vec<PaymentSplit>), AppError> {
    if let Some(payment_breakdown) = &input.payment_breakdown {
        let splits: Vec<PaymentSplit> = payment_breakdown
            .iter()
            .filter(|split| split.amount > 0.0)
            .map(|split| PaymentSplit {
                payment_method: split.payment_method.clone(),
                bank_name: split.bank_name.clone().and_then(|name| {
                    let trimmed = name.trim().to_string();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
                    }
                }),
                amount: split.amount,
            })
            .collect();

        if !splits.is_empty() {
            for split in &splits {
                validate_payment_method(&split.payment_method)?;
                if split.payment_method == "transfer"
                    && split
                        .bank_name
                        .as_ref()
                        .is_none_or(|name| name.trim().is_empty())
                {
                    return Err(AppError::Validation(
                        "Nama bank wajib diisi untuk pembayaran transfer bank".into(),
                    ));
                }
            }

            let mut seen = std::collections::HashSet::new();
            if splits
                .iter()
                .any(|split| !seen.insert(split.payment_method.clone()))
            {
                return Err(AppError::Validation(
                    "Metode pembayaran tidak boleh duplikat".into(),
                ));
            }

            let cash_index = splits
                .iter()
                .position(|split| split.payment_method == "cash");
            let total_paid: f64 = splits.iter().map(|split| split.amount).sum();

            if let Some(cash_index) = cash_index {
                let non_cash_total: f64 = splits
                    .iter()
                    .enumerate()
                    .filter(|(index, _)| *index != cash_index)
                    .map(|(_, split)| split.amount)
                    .sum();

                if non_cash_total - total_amount > 0.01 {
                    return Err(AppError::Validation(
                        "Nominal non-tunai tidak boleh melebihi total transaksi".into(),
                    ));
                }

                let remaining_due = (total_amount - non_cash_total).max(0.0);
                if splits[cash_index].amount + 0.01 < remaining_due {
                    return Err(AppError::Validation(
                        "Nominal tunai belum cukup untuk menutup sisa pembayaran".into(),
                    ));
                }

                let change_amount = (splits[cash_index].amount - remaining_due).max(0.0);
                let mut effective_splits = splits.clone();
                effective_splits[cash_index].amount = remaining_due;

                // Drop splits that contribute nothing. When the non-cash legs
                // already cover the total the cash leg lands on 0, and keeping
                // it recorded the sale as `mixed`, inserted a Rp 0 payment row,
                // made the sale match a "cash" filter and put a spurious empty
                // bucket in the payment-method stats.
                effective_splits.retain(|split| split.amount > 0.0);

                let payment_method = match effective_splits.len() {
                    // A zero-total sale paid in cash: nothing is left to record,
                    // so fall back to the method the cashier actually chose.
                    0 => splits[cash_index].payment_method.clone(),
                    1 => effective_splits[0].payment_method.clone(),
                    _ => MIXED_PAYMENT_METHOD.to_string(),
                };

                return Ok((payment_method, total_paid, change_amount, effective_splits));
            }

            if (total_paid - total_amount).abs() > 0.01 {
                return Err(AppError::Validation(
                    "Total pembayaran gabungan harus sama dengan total transaksi".into(),
                ));
            }

            let payment_method = if splits.len() == 1 {
                splits[0].payment_method.clone()
            } else {
                MIXED_PAYMENT_METHOD.to_string()
            };

            return Ok((payment_method, total_paid, 0.0, splits));
        }
    }

    let (payment_amount, change_amount, splits) =
        calculate_payment_amount(&input.payment_method, input.payment_amount, total_amount)?;

    if input.payment_method == "transfer" {
        return Err(AppError::Validation(
            "Nama bank wajib diisi untuk pembayaran transfer bank".into(),
        ));
    }

    Ok((
        input.payment_method.clone(),
        payment_amount,
        change_amount,
        splits,
    ))
}

/// Validates client-supplied discounts against server-computed subtotals.
///
/// Each `item_discount` must sit in `[0, line_subtotal]` where `line_subtotal`
/// is the server price multiplied by the quantity (`ResolvedItem::subtotal`,
/// derived from re-fetched prices in `resolve_items`). The
/// `transaction_discount` must sit in `[0, subtotal_after_item_discounts]`.
/// Out-of-range discounts are rejected (never silently clamped) to protect
/// money integrity.
fn validate_discounts(
    resolved_items: &[ResolvedItem],
    transaction_discount: f64,
) -> Result<(), AppError> {
    // Small tolerance for floating-point noise on REAL money values.
    const EPSILON: f64 = 0.01;

    let mut subtotal_after_item_discounts = 0.0_f64;

    for item in resolved_items {
        let line_subtotal = item.subtotal;
        if !item.item_discount.is_finite()
            || item.item_discount < -EPSILON
            || item.item_discount > line_subtotal + EPSILON
        {
            return Err(AppError::Validation(format!(
                "Diskon item '{}' tidak valid",
                item.product_name
            )));
        }
        subtotal_after_item_discounts += line_subtotal - item.item_discount;
    }

    if !transaction_discount.is_finite()
        || transaction_discount < -EPSILON
        || transaction_discount > subtotal_after_item_discounts + EPSILON
    {
        return Err(AppError::Validation("Diskon tidak valid".into()));
    }

    Ok(())
}

/// The rupiah actually paid for each line, in the order the lines were given.
///
/// A line starts at `subtotal - item_discount`, then gives up its share of the
/// transaction-level discount, weighted by that post-item-discount amount. The
/// result sums to `subtotal_amount - discount_amount`, i.e. the transaction
/// total, so refunds, reports and receipts can all read one stored number
/// instead of each re-deriving money from prices and two discount columns.
///
/// A fully discounted cart (`net_total == 0`) has nothing to spread, so every
/// line is zero.
fn prorated_line_nets(resolved_items: &[ResolvedItem], transaction_discount: f64) -> Vec<f64> {
    let line_nets: Vec<f64> = resolved_items
        .iter()
        .map(|item| item.subtotal - item.item_discount)
        .collect();
    let net_total: f64 = line_nets.iter().sum();

    if net_total <= 0.0 {
        return vec![0.0; line_nets.len()];
    }

    let kept_ratio = (1.0 - transaction_discount / net_total).max(0.0);
    line_nets.into_iter().map(|net| net * kept_ratio).collect()
}

/// Write the sale and its lines, and move the stock.
async fn persist_transaction<C: ConnectionTrait>(
    db: &C,
    input: &CheckoutTransactionInput,
    actor: &Actor,
    resolved_items: &[ResolvedItem],
    status: &str,
    deduct_physical_stock: bool,
    allow_negative_stock: bool,
) -> Result<TransactionResult, AppError> {
    let subtotal_amount: f64 = resolved_items.iter().map(|item| item.subtotal).sum();
    let transaction_discount = input.transaction_discount.unwrap_or(0.0);
    // Reject tampered/over-range discounts BEFORE persisting anything.
    validate_discounts(resolved_items, transaction_discount)?;
    let item_discounts_total: f64 = resolved_items.iter().map(|item| item.item_discount).sum();
    let discount_amount = item_discounts_total + transaction_discount;
    let total_amount = (subtotal_amount - discount_amount).max(0.0);
    let (payment_method, payment_amount, change_amount, payment_breakdown) =
        calculate_payment_amount_with_breakdown(input, total_amount)?;
    let receipt_number = generate_receipt_number(db).await?;
    let now = now_timestamp();

    let new_transaction = transactions::ActiveModel {
        id: NotSet,
        receipt_number: Set(receipt_number),
        user_id: Set(actor.user_id),
        total_amount: Set(total_amount),
        subtotal_amount: Set(subtotal_amount),
        discount_amount: Set(discount_amount),
        payment_method: Set(payment_method),
        payment_amount: Set(payment_amount),
        change_amount: Set(Some(change_amount)),
        status: Set(status.to_string()),
        notes: Set(input.notes.clone()),
        shift_id: Set(input.shift_id),
        deleted_at: Set(None),
        deleted_by: Set(None),
        deleted_reason: Set(None),
        updated_at: Set(None),
        created_at: Set(Some(now.clone())),
    };

    let transaction = new_transaction.insert(db).await?;
    let mut items = Vec::with_capacity(resolved_items.len());
    let line_nets = prorated_line_nets(resolved_items, transaction_discount);

    for (index, item) in resolved_items.iter().enumerate() {
        let is_ppob = item.service_type.is_some();
        let new_item = transaction_items::ActiveModel {
            id: NotSet,
            transaction_id: Set(transaction.id),
            product_id: Set(item.product_id),
            product_name: Set(item.product_name.clone()),
            product_price: Set(item.sell_price),
            buy_price: Set(item.buy_price),
            quantity: Set(item.quantity),
            subtotal: Set(item.subtotal),
            item_discount: Set(item.item_discount),
            net_subtotal: Set(line_nets[index]),
            service_type: Set(item.service_type.clone()),
            service_ref: Set(item.service_ref.clone()),
            ppob_product_id: Set(item.ppob_product_id),
            ppob_product_code: Set(item.ppob_product_code.clone()),
            ppob_inquiry_id: Set(item.ppob_inquiry_id.clone()),
            ppob_payment_code: Set(item.ppob_payment_code.clone()),
            ppob_flag_id: Set(item.ppob_flag_id.clone()),
            ppob_status: Set(if is_ppob {
                Some(PPOB_STATUS_PENDING.to_string())
            } else {
                None
            }),
            ppob_message: Set(None),
            ppob_serial_number: Set(None),
            created_at: Set(Some(now.clone())),
        };

        let created_item = new_item.insert(db).await?;
        items.push(created_item);

        if deduct_physical_stock {
            if let Some(product_id) = item.product_id {
                // Atomic, guarded decrement inside the same DB transaction so we
                // cannot oversell: the stock is re-read and checked by the UPDATE
                // itself. When `allow_negative_stock` is false, the row only
                // matches while `stock >= quantity`; otherwise ($4 = 1) the guard
                // is bypassed and negative stock is permitted. PPOB items have a
                // NULL `product_id` and never reach this branch.
                let allow_negative_flag: i64 = if allow_negative_stock { 1 } else { 0 };
                let update_result = db
                    .execute(Statement::from_sql_and_values(
                        DbBackend::Sqlite,
                        "UPDATE products SET stock = stock - $1, updated_at = $2 WHERE id = $3 AND (stock >= $1 OR $4 = 1)",
                        vec![
                            item.quantity.into(),
                            now.clone().into(),
                            product_id.into(),
                            allow_negative_flag.into(),
                        ],
                    ))
                    .await?;

                if update_result.rows_affected() == 0 {
                    // No row matched the guard => insufficient stock (and not
                    // allowed to go negative). Returning here aborts before
                    // commit, rolling back the whole transaction.
                    return Err(AppError::Validation(format!(
                        "Stok '{}' tidak cukup",
                        item.product_name
                    )));
                }
            }
        }
    }

    for split in &payment_breakdown {
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
        payment_breakdown,
    })
}

#[cfg(test)]
async fn fetch_transaction_result(
    db: &DatabaseConnection,
    transaction_id: i64,
) -> Result<TransactionResult, AppError> {
    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db)
        .await?;

    let payment_breakdown = load_payment_breakdown(db, transaction_id, &transaction).await?;

    Ok(TransactionResult {
        transaction,
        items,
        payment_breakdown,
    })
}
fn build_ppob_request(item: &transaction_items::Model) -> Result<PpobFulfillmentRequest, AppError> {
    let service_type = item
        .service_type
        .clone()
        .ok_or_else(|| AppError::Validation("Item PPOB tidak memiliki service type".into()))?;

    Ok(PpobFulfillmentRequest {
        service_type,
        customer_id: item.service_ref.clone(),
        inquiry_id: item.ppob_inquiry_id.clone(),
        product_id: item.ppob_product_id,
        product_code: item.ppob_product_code.clone(),
        payment_code: item.ppob_payment_code.clone(),
        flag_id: if item.service_type.as_deref() == Some("pln") {
            item.ppob_flag_id.clone()
        } else {
            None
        },
        phone_number: if item.service_type.as_deref() == Some("bpjs") {
            item.ppob_flag_id.clone()
        } else {
            None
        },
        amount: if item.service_type.as_deref() == Some("bpjs") {
            item.buy_price
        } else {
            None
        },
    })
}

fn build_ppob_success_message(payment_result: &PaymentResult) -> String {
    if let Some(serial_number) = &payment_result.serial_number {
        return format!("Fulfillment PPOB berhasil. SN: {}", serial_number);
    }

    if let Some(product_name) = &payment_result.product_name {
        return format!("Fulfillment PPOB berhasil untuk {}", product_name);
    }

    "Fulfillment PPOB berhasil".to_string()
}

async fn update_ppob_item_status(
    db: &DatabaseConnection,
    item_id: i64,
    ppob_status: &str,
    ppob_message: Option<String>,
    ppob_serial_number: Option<String>,
) -> Result<(), AppError> {
    let item = transaction_items::Entity::find_by_id(item_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Item transaksi PPOB tidak ditemukan".into()))?;

    let mut active_item: transaction_items::ActiveModel = item.into();
    active_item.ppob_status = Set(Some(ppob_status.to_string()));
    active_item.ppob_message = Set(ppob_message);
    active_item.ppob_serial_number = Set(ppob_serial_number);
    active_item.update(db).await?;

    Ok(())
}

/// Test seam for [`checkout_transaction`]: the same flow with the PPOB provider
/// call injected, so a test can drive fulfilment without a network.
///
/// It used to back a `create_transaction` IPC command whose injected executor
/// always failed, so a checkout routed through it took the money, deducted the
/// stock, marked the sale completed and marked every PPOB line failed. Nothing
/// called it, and it is no longer registered.
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
    validate_payment_method(&input.payment_method)?;

    let has_ppob = validate_cart_composition(&input.items)?;
    let allow_negative_stock = load_allow_negative_stock(db).await?;
    let resolved_items = resolve_items(db, &input.items, allow_negative_stock).await?;

    // Always create transaction as completed and deduct physical stock
    let txn = db.begin().await?;
    let result = persist_transaction(
        &txn,
        &input,
        actor,
        &resolved_items,
        STATUS_COMPLETED,
        true,
        allow_negative_stock,
    )
    .await?;
    txn.commit().await?;

    if !has_ppob {
        return Ok(result);
    }

    // Process all PPOB items
    for ppob_item in result
        .items
        .iter()
        .filter(|item| item.service_type.is_some())
    {
        let request = build_ppob_request(ppob_item)?;
        let ppob_item_id = ppob_item.id;

        match fulfill_ppob(request).await {
            Ok(payment_result) => {
                update_ppob_item_status(
                    db,
                    ppob_item_id,
                    PPOB_STATUS_SUCCESS,
                    Some(build_ppob_success_message(&payment_result)),
                    payment_result.serial_number.clone(),
                )
                .await?;
            }
            Err(error) => {
                update_ppob_item_status(
                    db,
                    ppob_item_id,
                    PPOB_STATUS_FAILED,
                    Some(error.to_string()),
                    None,
                )
                .await?;
            }
        }
    }

    fetch_transaction_result(db, result.transaction.id).await
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
    let conn = db.clone();
    let mitra = mitra.clone();

    validate_payment_method(&input.payment_method)?;

    let has_ppob = validate_cart_composition(&input.items)?;
    let allow_negative_stock = load_allow_negative_stock(&conn).await?;
    let resolved_items = resolve_items(&conn, &input.items, allow_negative_stock).await?;

    // Always create as completed and deduct physical stock immediately
    let txn = conn.begin().await?;
    let result = persist_transaction(
        &txn,
        &input,
        actor,
        &resolved_items,
        STATUS_COMPLETED,
        true,
        allow_negative_stock,
    )
    .await?;
    txn.commit().await?;

    if has_ppob {
        // Process each PPOB item in its own background task
        for ppob_item in result
            .items
            .iter()
            .filter(|item| item.service_type.is_some())
        {
            let request = build_ppob_request(ppob_item)?;
            let ppob_item_id = ppob_item.id;
            let bg_conn = conn.clone();
            let bg_mitra = mitra.clone();

            tokio::spawn(async move {
                match execute_fulfillment_request(&bg_conn, &bg_mitra, &request).await {
                    Ok(payment_result) => {
                        let _ = update_ppob_item_status(
                            &bg_conn,
                            ppob_item_id,
                            PPOB_STATUS_SUCCESS,
                            Some(build_ppob_success_message(&payment_result)),
                            payment_result.serial_number.clone(),
                        )
                        .await;
                    }
                    Err(error) => {
                        let _ = update_ppob_item_status(
                            &bg_conn,
                            ppob_item_id,
                            PPOB_STATUS_FAILED,
                            Some(error.to_string()),
                            None,
                        )
                        .await;
                    }
                }
            });
        }
    }

    Ok(result)
}

/// Claims a failed PPOB line for exactly one more fulfilment attempt.
///
/// The claim is a single conditional UPDATE, so of two callers racing on the
/// same line only one can move it out of `failed` and only that one goes on to
/// call the provider. The old code read the status, `await`ed, then wrote
/// `"pending"`: two clicks — or one click while the checkout's own background
/// task was still in flight — both passed the check and paid the provider twice
/// for a single sale.
///
/// `pending` means the checkout task has not reported back yet and `processing`
/// means another retry is in flight; neither is retryable. The request is built
/// before the claim so a malformed line fails without leaving the row stuck in
/// `processing`.
async fn claim_ppob_retry(
    db: &DatabaseConnection,
    item_id: i64,
) -> Result<PpobFulfillmentRequest, AppError> {
    let item = transaction_items::Entity::find_by_id(item_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Item transaksi tidak ditemukan".into()))?;

    match item.ppob_status.as_deref().unwrap_or("") {
        PPOB_STATUS_FAILED => {}
        PPOB_STATUS_PENDING | PPOB_STATUS_PROCESSING => {
            return Err(AppError::Validation(
                "Fulfillment PPOB masih diproses. Tunggu hasilnya sebelum retry.".into(),
            ))
        }
        _ => {
            return Err(AppError::Validation(
                "Hanya item PPOB yang gagal yang bisa di-retry".into(),
            ))
        }
    }

    let request = build_ppob_request(&item)?;

    let claimed = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items
             SET ppob_status = $1, ppob_message = $2
             WHERE id = $3 AND ppob_status = $4",
            vec![
                PPOB_STATUS_PROCESSING.into(),
                "Sedang di-retry...".to_string().into(),
                item_id.into(),
                PPOB_STATUS_FAILED.into(),
            ],
        ))
        .await?;

    if claimed.rows_affected() != 1 {
        return Err(AppError::Validation(
            "Fulfillment PPOB sedang diproses oleh permintaan lain".into(),
        ));
    }

    Ok(request)
}

/// Ask the provider once more for a line that came back failed.
pub async fn retry_ppob_fulfillment(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    item_id: i64,
) -> Result<String, AppError> {
    let conn = db.clone();
    let mitra = mitra.clone();

    let request = claim_ppob_retry(&conn, item_id).await?;

    let bg_conn = conn.clone();
    tokio::spawn(async move {
        match execute_fulfillment_request(&bg_conn, &mitra, &request).await {
            Ok(payment_result) => {
                let _ = update_ppob_item_status(
                    &bg_conn,
                    item_id,
                    PPOB_STATUS_SUCCESS,
                    Some(build_ppob_success_message(&payment_result)),
                    payment_result.serial_number.clone(),
                )
                .await;
            }
            Err(error) => {
                let _ = update_ppob_item_status(
                    &bg_conn,
                    item_id,
                    PPOB_STATUS_FAILED,
                    Some(error.to_string()),
                    None,
                )
                .await;
            }
        }
    });

    Ok("PPOB fulfillment sedang diproses ulang".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::transactions::PaymentSplitInput;
    use crate::entity::products;
    use crate::services::transactions::fixtures::{insert_product, setup_test_db};

    /// The seeded admin (id 1).
    fn actor() -> Actor {
        Actor::new(1, "admin")
    }

    #[tokio::test]
    async fn standard_checkout_completes_and_deducts_stock() {
        let conn = setup_test_db().await;
        let product = insert_product(&conn, "Beras", 15_000.0, 10).await;

        let result = checkout_with_executor(
            &conn,
            &actor(),
            CheckoutTransactionInput {
                items: vec![TransactionItemInput {
                    product_id: Some(product.id),
                    quantity: 2,
                    product_name: None,
                    product_price: None,
                    buy_price: None,
                    service_type: None,
                    service_ref: None,
                    ppob_product_id: None,
                    ppob_product_code: None,
                    ppob_inquiry_id: None,
                    ppob_payment_code: None,
                    ppob_flag_id: None,
                    item_discount: None,
                }],
                payment_method: "cash".to_string(),
                payment_amount: 30_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
                payment_breakdown: None,
            },
            |_request| async { Err(AppError::Internal("should not execute".into())) },
        )
        .await
        .expect("checkout success");

        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        assert!(result.items[0].ppob_status.is_none());

        let updated_product = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("product query")
            .expect("product exists");
        assert_eq!(updated_product.stock, 8);
    }

    #[tokio::test]
    async fn ppob_checkout_success_updates_item_and_transaction() {
        let conn = setup_test_db().await;

        let result = checkout_with_executor(
            &conn,
            &actor(),
            CheckoutTransactionInput {
                items: vec![TransactionItemInput {
                    product_id: None,
                    quantity: 1,
                    product_name: Some("Pulsa Telkomsel 10K".to_string()),
                    product_price: Some(12_000.0),
                    buy_price: Some(10_000.0),
                    service_type: Some("pulsa".to_string()),
                    service_ref: Some("08123456789".to_string()),
                    ppob_product_id: Some(101),
                    ppob_product_code: Some("TS10".to_string()),
                    ppob_inquiry_id: None,
                    ppob_payment_code: None,
                    ppob_flag_id: None,
                    item_discount: None,
                }],
                payment_method: "cash".to_string(),
                payment_amount: 12_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
                payment_breakdown: None,
            },
            |request| async move {
                assert_eq!(request.service_type, "pulsa");
                Ok(PaymentResult {
                    success: true,
                    receipt_data: serde_json::json!({}),
                    service_type: "pulsa".to_string(),
                    customer_id: request.customer_id.unwrap_or_default(),
                    amount: 10_000.0,
                    admin_fee: 0.0,
                    total: 10_000.0,
                    product_name: Some("Pulsa Telkomsel 10K".to_string()),
                    customer_name: None,
                    serial_number: Some("SN-123".to_string()),
                })
            },
        )
        .await
        .expect("ppob checkout success");

        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        assert_eq!(result.items[0].ppob_status.as_deref(), Some("success"));
        assert_eq!(
            result.items[0].ppob_serial_number.as_deref(),
            Some("SN-123")
        );
    }

    #[tokio::test]
    async fn ppob_checkout_failure_keeps_transaction_completed_marks_item_failed() {
        let conn = setup_test_db().await;

        let result = checkout_with_executor(
            &conn,
            &actor(),
            CheckoutTransactionInput {
                items: vec![TransactionItemInput {
                    product_id: None,
                    quantity: 1,
                    product_name: Some("Token PLN 20K".to_string()),
                    product_price: Some(21_000.0),
                    buy_price: Some(20_000.0),
                    service_type: Some("pln".to_string()),
                    service_ref: Some("1234567890".to_string()),
                    ppob_product_id: None,
                    ppob_product_code: None,
                    ppob_inquiry_id: Some("INQ-1".to_string()),
                    ppob_payment_code: Some("20000".to_string()),
                    ppob_flag_id: Some("0".to_string()),
                    item_discount: None,
                }],
                payment_method: "cash".to_string(),
                payment_amount: 21_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
                payment_breakdown: None,
            },
            |_request| async { Err(AppError::Internal("Provider timeout".into())) },
        )
        .await
        .expect("ppob checkout should return transaction result even on PPOB failure");

        // Transaction stays completed (payment received)
        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        // But item is marked as failed
        assert_eq!(result.items[0].ppob_status.as_deref(), Some("failed"));
        assert!(result.items[0]
            .ppob_message
            .as_deref()
            .is_some_and(|message| message.contains("Provider timeout")));
    }

    #[tokio::test]
    async fn mixed_cart_succeeds_with_stock_deduction_and_ppob_fulfillment() {
        let conn = setup_test_db().await;
        let product = insert_product(&conn, "Gula", 18_000.0, 5).await;

        let result = checkout_with_executor(
            &conn,
            &actor(),
            CheckoutTransactionInput {
                items: vec![
                    TransactionItemInput {
                        product_id: Some(product.id),
                        quantity: 1,
                        product_name: None,
                        product_price: None,
                        buy_price: None,
                        service_type: None,
                        service_ref: None,
                        ppob_product_id: None,
                        ppob_product_code: None,
                        ppob_inquiry_id: None,
                        ppob_payment_code: None,
                        ppob_flag_id: None,
                        item_discount: None,
                    },
                    TransactionItemInput {
                        product_id: None,
                        quantity: 1,
                        product_name: Some("Pulsa".to_string()),
                        product_price: Some(10_000.0),
                        buy_price: Some(9_000.0),
                        service_type: Some("pulsa".to_string()),
                        service_ref: Some("08123".to_string()),
                        ppob_product_id: Some(1),
                        ppob_product_code: Some("P1".to_string()),
                        ppob_inquiry_id: None,
                        ppob_payment_code: None,
                        ppob_flag_id: None,
                        item_discount: None,
                    },
                ],
                payment_method: "cash".to_string(),
                payment_amount: 28_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
                payment_breakdown: None,
            },
            |request| async move {
                assert_eq!(request.service_type, "pulsa");
                Ok(PaymentResult {
                    success: true,
                    receipt_data: serde_json::json!({}),
                    service_type: "pulsa".to_string(),
                    customer_id: request.customer_id.unwrap_or_default(),
                    amount: 10_000.0,
                    admin_fee: 0.0,
                    total: 10_000.0,
                    product_name: Some("Pulsa".to_string()),
                    customer_name: None,
                    serial_number: Some("SN-MIX-1".to_string()),
                })
            },
        )
        .await
        .expect("mixed cart checkout success");

        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        assert_eq!(result.items.len(), 2);

        // Physical item: no ppob_status, stock deducted
        let physical_item = result
            .items
            .iter()
            .find(|i| i.service_type.is_none())
            .unwrap();
        assert!(physical_item.ppob_status.is_none());
        let updated_product = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("exists");
        assert_eq!(updated_product.stock, 4);

        // PPOB item: ppob_status = success
        let ppob_item = result
            .items
            .iter()
            .find(|i| i.service_type.is_some())
            .unwrap();
        assert_eq!(ppob_item.ppob_status.as_deref(), Some("success"));
        assert_eq!(ppob_item.ppob_serial_number.as_deref(), Some("SN-MIX-1"));
    }

    #[tokio::test]
    async fn multi_ppob_cart_succeeds_with_all_items_fulfilled() {
        let conn = setup_test_db().await;

        let result = checkout_with_executor(
            &conn,
            &actor(),
            CheckoutTransactionInput {
                items: vec![
                    TransactionItemInput {
                        product_id: None,
                        quantity: 1,
                        product_name: Some("Pulsa 10K".to_string()),
                        product_price: Some(12_000.0),
                        buy_price: Some(10_000.0),
                        service_type: Some("pulsa".to_string()),
                        service_ref: Some("08123".to_string()),
                        ppob_product_id: Some(1),
                        ppob_product_code: Some("P1".to_string()),
                        ppob_inquiry_id: None,
                        ppob_payment_code: None,
                        ppob_flag_id: None,
                        item_discount: None,
                    },
                    TransactionItemInput {
                        product_id: None,
                        quantity: 1,
                        product_name: Some("Token PLN".to_string()),
                        product_price: Some(21_000.0),
                        buy_price: Some(20_000.0),
                        service_type: Some("pln".to_string()),
                        service_ref: Some("123456".to_string()),
                        ppob_product_id: None,
                        ppob_product_code: None,
                        ppob_inquiry_id: Some("INQ-2".to_string()),
                        ppob_payment_code: Some("20000".to_string()),
                        ppob_flag_id: Some("0".to_string()),
                        item_discount: None,
                    },
                ],
                payment_method: "cash".to_string(),
                payment_amount: 33_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
                payment_breakdown: None,
            },
            |request| async move {
                let sn = if request.service_type == "pulsa" {
                    "SN-PULSA"
                } else {
                    "SN-PLN"
                };
                Ok(PaymentResult {
                    success: true,
                    receipt_data: serde_json::json!({}),
                    service_type: request.service_type.clone(),
                    customer_id: request.customer_id.unwrap_or_default(),
                    amount: 10_000.0,
                    admin_fee: 0.0,
                    total: 10_000.0,
                    product_name: None,
                    customer_name: None,
                    serial_number: Some(sn.to_string()),
                })
            },
        )
        .await
        .expect("multi PPOB checkout should succeed");

        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        assert_eq!(result.items.len(), 2);

        let pulsa_item = result
            .items
            .iter()
            .find(|i| i.service_type.as_deref() == Some("pulsa"))
            .unwrap();
        assert_eq!(pulsa_item.ppob_status.as_deref(), Some("success"));
        assert_eq!(pulsa_item.ppob_serial_number.as_deref(), Some("SN-PULSA"));

        let pln_item = result
            .items
            .iter()
            .find(|i| i.service_type.as_deref() == Some("pln"))
            .unwrap();
        assert_eq!(pln_item.ppob_status.as_deref(), Some("success"));
        assert_eq!(pln_item.ppob_serial_number.as_deref(), Some("SN-PLN"));
    }

    fn resolved_item(subtotal: f64, item_discount: f64) -> ResolvedItem {
        ResolvedItem {
            product_name: "Item".to_string(),
            subtotal,
            item_discount,
            ..Default::default()
        }
    }

    #[test]
    fn validate_discounts_accepts_in_range_values() {
        // subtotal_after_item_discounts = (20_000 - 2_000) + (10_000 - 0) = 28_000
        let items = vec![
            resolved_item(20_000.0, 2_000.0),
            resolved_item(10_000.0, 0.0),
        ];

        assert!(validate_discounts(&items, 0.0).is_ok());
        assert!(validate_discounts(&items, 5_000.0).is_ok());
        // Transaction discount may consume the full post-item-discount subtotal.
        assert!(validate_discounts(&items, 28_000.0).is_ok());
    }

    #[test]
    fn validate_discounts_rejects_item_discount_above_line_subtotal() {
        let items = vec![resolved_item(20_000.0, 21_000.0)];
        assert!(validate_discounts(&items, 0.0).is_err());
    }

    #[test]
    fn validate_discounts_rejects_negative_item_discount() {
        let items = vec![resolved_item(20_000.0, -1.0)];
        assert!(validate_discounts(&items, 0.0).is_err());
    }

    #[test]
    fn validate_discounts_rejects_transaction_discount_above_subtotal() {
        // subtotal_after_item_discounts = 20_000; a 25_000 transaction discount
        // would push the total negative, so it must be rejected (not clamped).
        let items = vec![resolved_item(20_000.0, 0.0)];
        assert!(validate_discounts(&items, 25_000.0).is_err());
    }

    #[test]
    fn validate_discounts_rejects_negative_transaction_discount() {
        let items = vec![resolved_item(20_000.0, 0.0)];
        assert!(validate_discounts(&items, -1.0).is_err());
    }

    /// A completed sale with one PPOB line, left in `ppob_status`.
    async fn seed_ppob_sale(
        conn: &DatabaseConnection,
        ppob_status: &str,
    ) -> transaction_items::Model {
        let result = checkout_with_executor(
            conn,
            &actor(),
            CheckoutTransactionInput {
                items: vec![TransactionItemInput {
                    product_id: None,
                    quantity: 1,
                    product_name: Some("Pulsa Telkomsel 10K".to_string()),
                    product_price: Some(12_000.0),
                    buy_price: Some(10_000.0),
                    service_type: Some("pulsa".to_string()),
                    service_ref: Some("08123456789".to_string()),
                    ppob_product_id: Some(101),
                    ppob_product_code: Some("TS10".to_string()),
                    ppob_inquiry_id: None,
                    ppob_payment_code: None,
                    ppob_flag_id: None,
                    item_discount: None,
                }],
                payment_method: "cash".to_string(),
                payment_amount: 12_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
                payment_breakdown: None,
            },
            |_request| async { Err(AppError::Internal("Provider timeout".into())) },
        )
        .await
        .expect("ppob checkout success");

        let item = result
            .items
            .into_iter()
            .find(|item| item.service_type.is_some())
            .expect("ppob line");

        update_ppob_item_status(conn, item.id, ppob_status, None, None)
            .await
            .expect("set ppob status");

        transaction_items::Entity::find_by_id(item.id)
            .one(conn)
            .await
            .expect("query")
            .expect("item exists")
    }

    async fn ppob_status_of(conn: &DatabaseConnection, item_id: i64) -> Option<String> {
        transaction_items::Entity::find_by_id(item_id)
            .one(conn)
            .await
            .expect("query")
            .expect("item exists")
            .ppob_status
    }

    #[tokio::test]
    async fn ppob_retry_claims_a_failed_line_once() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;

        claim_ppob_retry(&conn, item.id)
            .await
            .expect("first retry claims the line");
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_PROCESSING)
        );

        // A second click, while the first attempt is still in flight, must not
        // reach the provider again.
        match claim_ppob_retry(&conn, item.id).await {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("diproses"),
                "Error should say a call is in flight, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn ppob_retry_refuses_a_pending_line() {
        let conn = setup_test_db().await;
        // Checkout leaves the line `pending` while its background task runs.
        let item = seed_ppob_sale(&conn, PPOB_STATUS_PENDING).await;

        match claim_ppob_retry(&conn, item.id).await {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("diproses"),
                "Error should say a call is in flight, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_PENDING)
        );
    }

    #[tokio::test]
    async fn ppob_retry_refuses_an_already_fulfilled_line() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_SUCCESS).await;

        match claim_ppob_retry(&conn, item.id).await {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("gagal"),
                "Error should say only failed lines retry, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_SUCCESS)
        );
    }

    /// A completed one-line cash sale, ready to be voided or amended.
    fn breakdown_input(splits: Vec<(&str, f64)>) -> CheckoutTransactionInput {
        CheckoutTransactionInput {
            items: vec![],
            payment_method: "cash".to_string(),
            payment_amount: 0.0,
            payment_breakdown: Some(
                splits
                    .into_iter()
                    .map(|(method, amount)| PaymentSplitInput {
                        payment_method: method.to_string(),
                        bank_name: None,
                        amount,
                    })
                    .collect(),
            ),
            notes: None,
            transaction_discount: None,
            shift_id: None,
        }
    }

    #[test]
    fn fully_non_cash_payment_drops_the_zero_cash_split() {
        // QRIS already covers the 50.000 total; the 20.000 cash the customer put
        // on the counter is all change.
        let input = breakdown_input(vec![("qris", 50_000.0), ("cash", 20_000.0)]);

        let (payment_method, payment_amount, change_amount, splits) =
            calculate_payment_amount_with_breakdown(&input, 50_000.0).expect("breakdown accepted");

        assert_eq!(payment_method, "qris");
        assert_eq!(payment_amount, 70_000.0);
        assert_eq!(change_amount, 20_000.0);
        assert_eq!(splits.len(), 1);
        assert_eq!(splits[0].payment_method, "qris");
        assert_eq!(splits[0].amount, 50_000.0);
    }

    #[test]
    fn partially_cash_payment_stays_mixed() {
        let input = breakdown_input(vec![("qris", 30_000.0), ("cash", 25_000.0)]);

        let (payment_method, _, change_amount, splits) =
            calculate_payment_amount_with_breakdown(&input, 50_000.0).expect("breakdown accepted");

        assert_eq!(payment_method, MIXED_PAYMENT_METHOD);
        assert_eq!(change_amount, 5_000.0);
        assert_eq!(splits.len(), 2);
        assert_eq!(splits[1].amount, 20_000.0);
    }

    #[test]
    fn prorated_line_nets_split_the_transaction_discount_by_weight() {
        // Lines net 18_000 and 6_000 after item discounts; a 6_000 transaction
        // discount is 25% of the 24_000 that is left, so each line gives up 25%.
        let items = vec![
            resolved_item(20_000.0, 2_000.0),
            resolved_item(6_000.0, 0.0),
        ];

        let nets = prorated_line_nets(&items, 6_000.0);

        assert_eq!(nets, vec![13_500.0, 4_500.0]);
        assert_eq!(nets.iter().sum::<f64>(), 18_000.0);
    }

    #[test]
    fn prorated_line_nets_are_zero_for_a_fully_discounted_cart() {
        let items = vec![resolved_item(20_000.0, 20_000.0)];
        assert_eq!(prorated_line_nets(&items, 0.0), vec![0.0]);
    }

    #[tokio::test]
    async fn checkout_persists_the_net_amount_paid_per_line() {
        let conn = setup_test_db().await;
        let soap = insert_product(&conn, "Sabun", 5_000.0, 10).await;
        let rice = insert_product(&conn, "Beras", 50_000.0, 10).await;

        // Soap 2 x 5.000 = 10.000, rice 1 x 50.000 with a 10.000 line discount
        // => line nets 10.000 + 40.000 = 50.000, minus a 5.000 transaction
        // discount split 20%/80% => 9.000 and 36.000, total 45.000.
        let result = checkout_with_executor(
            &conn,
            &actor(),
            CheckoutTransactionInput {
                items: vec![
                    TransactionItemInput {
                        product_id: Some(soap.id),
                        quantity: 2,
                        product_name: None,
                        product_price: None,
                        buy_price: None,
                        service_type: None,
                        service_ref: None,
                        ppob_product_id: None,
                        ppob_product_code: None,
                        ppob_inquiry_id: None,
                        ppob_payment_code: None,
                        ppob_flag_id: None,
                        item_discount: None,
                    },
                    TransactionItemInput {
                        product_id: Some(rice.id),
                        quantity: 1,
                        product_name: None,
                        product_price: None,
                        buy_price: None,
                        service_type: None,
                        service_ref: None,
                        ppob_product_id: None,
                        ppob_product_code: None,
                        ppob_inquiry_id: None,
                        ppob_payment_code: None,
                        ppob_flag_id: None,
                        item_discount: Some(10_000.0),
                    },
                ],
                payment_method: "cash".to_string(),
                payment_amount: 45_000.0,
                notes: None,
                transaction_discount: Some(5_000.0),
                shift_id: None,
                payment_breakdown: None,
            },
            |_request| async { Err(AppError::Internal("should not execute".into())) },
        )
        .await
        .expect("checkout success");

        assert_eq!(result.transaction.total_amount, 45_000.0);

        let soap_line = result
            .items
            .iter()
            .find(|item| item.product_id == Some(soap.id))
            .expect("soap line");
        let rice_line = result
            .items
            .iter()
            .find(|item| item.product_id == Some(rice.id))
            .expect("rice line");

        assert_eq!(soap_line.net_subtotal, 9_000.0);
        assert_eq!(rice_line.net_subtotal, 36_000.0);
        assert_eq!(
            soap_line.net_subtotal + rice_line.net_subtotal,
            result.transaction.total_amount
        );
    }
}
