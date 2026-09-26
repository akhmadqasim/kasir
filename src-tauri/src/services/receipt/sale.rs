//! The shop's own receipt for a sale: its data, its preview lines, and printing
//! it together with the struk of every PPOB line on it.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use super::ppob::load_ppob_receipts;
use super::ppob_data::{ppob_item_receipt_data, ProviderSlip};
use super::printer::{print_target, send_jobs, PrintTarget};
use super::settings::{receipt_render_settings, ReceiptRenderSettings};
use crate::domain::receipt::{
    ReceiptDataResponse, ReceiptItemResponse, ReceiptLineResponse, ReceiptPaymentSplitResponse,
};
use crate::entity::{store_info, transaction_items, transaction_payments, transactions, users};
use crate::printing::ppob_receipt::format_ppob_receipt;
use crate::printing::receipt::{
    format_receipt_text, ReceiptData, ReceiptItem, ReceiptPaymentSplit,
};
use crate::services::transactions::PPOB_STATUS_SUCCESS;
use crate::utils::time::TIMESTAMP_FORMAT;
use crate::utils::AppError;

fn effective_receipt_total(transaction: &transactions::Model) -> f64 {
    if transaction.status == "deleted" {
        (transaction.subtotal_amount - transaction.discount_amount).max(0.0)
    } else {
        transaction.total_amount
    }
}

fn utc_to_local_formatted(utc_str: &str) -> String {
    chrono::NaiveDateTime::parse_from_str(utc_str, TIMESTAMP_FORMAT)
        .ok()
        .map(|ndt| {
            let utc = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(ndt, chrono::Utc);
            utc.with_timezone(&chrono::Local)
                .format("%d/%m/%Y %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| "N/A".to_string())
}

/// Whether a sale with PPOB lines is still held back from printing.
///
/// Only the legacy statuses of a sale whose PPOB never went through qualify.
/// A mixed cart's goods can be refunded after the top-up landed, and that
/// `partial_refund`/`refunded` sale still has a perfectly good struk.
fn ppob_receipt_withheld(status: &str) -> bool {
    matches!(status, "pending_ppob" | "ppob_failed")
}

/// Everything about a sale both receipt shapes — the thermal lines and the
/// HTML fallback's JSON — are built from.
struct SaleRecord {
    transaction: transactions::Model,
    items: Vec<transaction_items::Model>,
    cashier_name: String,
    deleted_by_name: Option<String>,
    date_time: String,
    payment_breakdown: Vec<ReceiptPaymentSplitResponse>,
}

async fn load_sale(db: &DatabaseConnection, transaction_id: i64) -> Result<SaleRecord, AppError> {
    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db)
        .await?;

    let has_ppob = items.iter().any(|item| item.service_type.is_some());
    if has_ppob && ppob_receipt_withheld(&transaction.status) {
        return Err(AppError::Validation(
            "Struk hanya tersedia setelah fulfillment PPOB berhasil".into(),
        ));
    }

    let user = users::Entity::find_by_id(transaction.user_id)
        .one(db)
        .await?;
    let cashier_name = user
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".to_string());
    let deleted_by_name = if let Some(deleted_by) = transaction.deleted_by {
        users::Entity::find_by_id(deleted_by)
            .one(db)
            .await?
            .map(|u| u.full_name)
    } else {
        None
    };

    let date_time = transaction
        .created_at
        .as_ref()
        .map(|dt| utc_to_local_formatted(dt))
        .unwrap_or_else(|| "N/A".to_string());

    let payment_breakdown = load_payment_breakdown(db, &transaction).await?;

    Ok(SaleRecord {
        transaction,
        items,
        cashier_name,
        deleted_by_name,
        date_time,
        payment_breakdown,
    })
}

/// Assemble the sale receipt's [`ReceiptData`] — everything
/// [`crate::printing::receipt::format_receipt_text`] needs — from a
/// transaction. Shared by [`print`] and by the receipt-lines endpoint the
/// frontend's preview reads, so the preview never drifts from what actually
/// prints.
async fn build_sale_receipt_data(
    db: &DatabaseConnection,
    store: &store_info::Model,
    footer_text: Option<String>,
    transaction_id: i64,
) -> Result<(ReceiptData, Vec<transaction_items::Model>), AppError> {
    let SaleRecord {
        transaction,
        items,
        cashier_name,
        deleted_by_name,
        date_time,
        payment_breakdown,
    } = load_sale(db, transaction_id).await?;

    // PPOB lines print their payment code and the provider's reference under
    // the item — the customer's proof if a top-up never lands. The code is on
    // our own row; the reference only lives in the stored provider blob.
    let blobs = load_ppob_receipts(
        db,
        items
            .iter()
            .filter(|item| item.service_type.is_some())
            .map(|item| item.id),
    )
    .await?;
    let receipt_items: Vec<ReceiptItem> = items
        .iter()
        .map(|item| {
            let slip = item
                .service_type
                .as_ref()
                .map(|_| ProviderSlip::from_response(blobs.get(&item.id).map(String::as_str)));
            ReceiptItem {
                name: item.product_name.clone(),
                quantity: item.quantity as i32,
                price: item.product_price,
                subtotal: item.subtotal,
                payment_code: item
                    .ppob_payment_code
                    .clone()
                    .or_else(|| slip.as_ref().and_then(|slip| slip.payment_code.clone())),
                reference_number: slip.and_then(|slip| slip.reference_number),
            }
        })
        .collect();
    let is_deleted = transaction.status == "deleted";
    let original_total_amount = effective_receipt_total(&transaction);
    let deleted_reason = transaction.deleted_reason.clone();

    let receipt_data = ReceiptData {
        store_name: store.name.clone(),
        store_address: store.address.clone(),
        store_phone: store.phone.clone(),
        receipt_number: transaction.receipt_number.clone(),
        date_time,
        cashier_name,
        items: receipt_items,
        subtotal_amount: transaction.subtotal_amount,
        discount_amount: transaction.discount_amount,
        payment_method: transaction.payment_method.clone(),
        payment_amount: transaction.payment_amount,
        change_amount: transaction.change_amount.unwrap_or(0.0),
        payment_breakdown: payment_breakdown
            .iter()
            .map(|split| ReceiptPaymentSplit {
                payment_method: split.payment_method.clone(),
                bank_name: split.bank_name.clone(),
                amount: split.amount,
            })
            .collect(),
        footer_text,
        notes: transaction.notes.clone(),
        is_deleted,
        deleted_reason,
        deleted_by_name,
        original_total_amount,
    };

    Ok((receipt_data, items))
}

pub async fn print(db: &DatabaseConnection, transaction_id: i64) -> Result<(), AppError> {
    let PrintTarget {
        store,
        printer_id,
        paper_width,
        footer_text,
        mode,
    } = print_target(db).await?;

    let (receipt_data, items) =
        build_sale_receipt_data(db, &store, footer_text, transaction_id).await?;
    let text_lines = format_receipt_text(&receipt_data, paper_width);

    // The sale first, then one struk per PPOB line that has come back fulfilled
    // by the time the paper is cut.
    //
    // Auto-print usually finds none of them ready: the cashier screen calls this
    // the moment the sale commits, while fulfilment is still in flight in a
    // background task, so the lines are `pending` and are skipped. That is the
    // right behaviour — a struk with no token on it is worse than no struk — and
    // it is why the detail dialog has a button of its own. A reprint from there,
    // or any later print of the sale, picks them up.
    let fulfilled: Vec<&transaction_items::Model> = items
        .iter()
        .filter(|item| item.ppob_status.as_deref() == Some(PPOB_STATUS_SUCCESS))
        .collect();
    let blobs = load_ppob_receipts(db, fulfilled.iter().map(|item| item.id)).await?;

    let mut jobs = vec![text_lines];
    jobs.extend(fulfilled.into_iter().map(|item| {
        let data = ppob_item_receipt_data(
            &store,
            item,
            blobs.get(&item.id).map(String::as_str),
            &receipt_data.receipt_number,
        );
        format_ppob_receipt(&data, paper_width)
    }));

    send_jobs(printer_id, jobs, paper_width, mode).await
}

async fn load_payment_breakdown(
    db: &DatabaseConnection,
    transaction: &transactions::Model,
) -> Result<Vec<ReceiptPaymentSplitResponse>, AppError> {
    let splits = transaction_payments::Entity::find()
        .filter(transaction_payments::Column::TransactionId.eq(transaction.id))
        .all(db)
        .await?;

    if !splits.is_empty() {
        return Ok(splits
            .into_iter()
            .map(|split| ReceiptPaymentSplitResponse {
                payment_method: split.payment_method,
                bank_name: split.bank_name,
                amount: split.amount,
            })
            .collect());
    }

    Ok(vec![ReceiptPaymentSplitResponse {
        payment_method: transaction.payment_method.clone(),
        bank_name: None,
        amount: transaction.total_amount,
    }])
}

/// The lines the printer would be handed for this sale, for the success
/// dialog to show a struk preview before anything is printed.
///
/// Built from [`build_sale_receipt_data`] and
/// [`crate::printing::receipt::format_receipt_text`] — the same two calls
/// [`print`] makes — so the preview cannot drift from what actually comes out
/// of the printer. `paper_width` overrides the configured paper size (58 or
/// 80mm) for a preview at a width other than what is set up; without it, the
/// same width `print` would use.
pub async fn sale_receipt_lines(
    db: &DatabaseConnection,
    transaction_id: i64,
    paper_width: Option<u8>,
) -> Result<Vec<ReceiptLineResponse>, AppError> {
    let ReceiptRenderSettings {
        store,
        paper_width: default_paper_width,
        footer_text,
    } = receipt_render_settings(db).await?;

    let (receipt_data, _items) =
        build_sale_receipt_data(db, &store, footer_text, transaction_id).await?;

    Ok(
        format_receipt_text(&receipt_data, paper_width.unwrap_or(default_paper_width))
            .into_iter()
            .map(ReceiptLineResponse::from)
            .collect(),
    )
}

pub async fn receipt_data(
    db: &DatabaseConnection,
    transaction_id: i64,
) -> Result<ReceiptDataResponse, AppError> {
    let ReceiptRenderSettings {
        store, footer_text, ..
    } = receipt_render_settings(db).await?;

    let SaleRecord {
        transaction,
        items,
        cashier_name,
        deleted_by_name,
        date_time,
        payment_breakdown,
    } = load_sale(db, transaction_id).await?;

    let receipt_items: Vec<ReceiptItemResponse> = items
        .iter()
        .map(|item| ReceiptItemResponse {
            name: item.product_name.clone(),
            quantity: item.quantity as i32,
            price: item.product_price,
            subtotal: item.subtotal,
        })
        .collect();
    let is_deleted = transaction.status == "deleted";
    let original_total_amount = effective_receipt_total(&transaction);
    let notes = transaction.notes.clone();
    let deleted_reason = transaction.deleted_reason.clone();

    Ok(ReceiptDataResponse {
        store_name: store.name,
        store_address: store.address,
        store_phone: store.phone,
        receipt_number: transaction.receipt_number,
        date_time,
        cashier_name,
        items: receipt_items,
        subtotal_amount: transaction.subtotal_amount,
        discount_amount: transaction.discount_amount,
        total_amount: transaction.total_amount,
        payment_method: transaction.payment_method,
        payment_amount: transaction.payment_amount,
        change_amount: transaction.change_amount.unwrap_or(0.0),
        payment_breakdown,
        footer_text,
        notes,
        is_deleted,
        deleted_reason,
        deleted_by_name,
        original_total_amount,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A mixed cart whose goods were refunded after the top-up went through
    /// still prints; only a sale whose PPOB never landed is held back.
    #[test]
    fn only_an_undelivered_ppob_sale_withholds_its_struk() {
        for status in ["completed", "partial_refund", "refunded", "deleted"] {
            assert!(!ppob_receipt_withheld(status), "{status}");
        }
        assert!(ppob_receipt_withheld("pending_ppob"));
        assert!(ppob_receipt_withheld("ppob_failed"));
    }
}
