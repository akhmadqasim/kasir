//! Printing and previewing the struk for a PPOB line — one sold here, or one
//! from Mitra's own history.

use std::collections::HashMap;
use std::sync::Arc;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use tokio::sync::Mutex;

use super::ppob_data::{build_ppob_receipt_data, ppob_item_receipt_data, PpobLine, ProviderSlip};
use super::printer::{print_target, send_jobs, PrintTarget};
use super::settings::{receipt_render_settings, ReceiptRenderSettings};
use crate::domain::receipt::ReceiptLineResponse;
use crate::entity::{ppob_receipts, transaction_items, transactions};
use crate::printing::ppob_receipt::{format_ppob_receipt, PpobReceiptData};
use crate::services;
use crate::services::ppob::client::MitraClient;
use crate::services::transactions::PPOB_STATUS_SUCCESS;
use crate::utils::AppError;

/// The stored provider responses for the given lines, keyed by line.
///
/// Its own table, so the sale history and the refund screens never carry these
/// kilobytes around. See migration 023.
pub(super) async fn load_ppob_receipts(
    db: &DatabaseConnection,
    item_ids: impl IntoIterator<Item = i64>,
) -> Result<HashMap<i64, String>, AppError> {
    let ids: Vec<i64> = item_ids.into_iter().collect();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    Ok(ppob_receipts::Entity::find()
        .filter(ppob_receipts::Column::TransactionItemId.is_in(ids))
        .all(db)
        .await?
        .into_iter()
        .map(|row| (row.transaction_item_id, row.data))
        .collect())
}

/// Print the struk for one fulfilled PPOB line, on its own.
///
/// Separate from the sale's receipt because it is reprinted on its own: the
/// customer loses the slip with the token on it, or the thermal paper fades,
/// and neither is a reason to reprint the groceries.
pub async fn print_ppob_item(
    db: &DatabaseConnection,
    transaction_item_id: i64,
) -> Result<(), AppError> {
    let item = transaction_items::Entity::find_by_id(transaction_item_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Item transaksi tidak ditemukan".into()))?;

    if item.service_type.is_none() {
        return Err(AppError::Validation("Item ini bukan transaksi PPOB".into()));
    }
    if item.ppob_status.as_deref() != Some(PPOB_STATUS_SUCCESS) {
        return Err(AppError::Validation(
            "Struk PPOB hanya bisa dicetak setelah fulfillment berhasil".into(),
        ));
    }

    let PrintTarget {
        store,
        printer_id,
        paper_width,
        mode,
        ..
    } = print_target(db).await?;

    // The struk carries nothing about the sale itself — no receipt number, no
    // cashier — so the transaction row is never read for its own sake here.
    // See `printing::ppob_receipt` for why: it is the provider's document.
    // Pulsa/data is the one exception: its invoice line falls back to our own
    // receipt number when Mitra sent no id of its own, which is why the
    // transaction is still looked up, just for that one field.
    let blob = ppob_receipts::Entity::find_by_id(item.id)
        .one(db)
        .await?
        .map(|row| row.data);
    let receipt_number = transactions::Entity::find_by_id(item.transaction_id)
        .one(db)
        .await?
        .map(|t| t.receipt_number)
        .unwrap_or_default();

    let data = ppob_item_receipt_data(&store, &item, blob.as_deref(), &receipt_number);
    let lines = format_ppob_receipt(&data, paper_width);

    send_jobs(printer_id, vec![lines], paper_width, mode).await
}

/// The struk for a transaction in Mitra's history, at a sell price chosen now.
///
/// This is the Mitra app's "Ringkasan Transaksi" flow: after a payment, or
/// from its Riwayat, the outlet sees what it paid, sets a "Harga Jual", and
/// prints. The sell price is the struk's `Grand Total`; the difference from
/// the provider's total prints as `Biaya Layanan`.
///
/// `sell_price` is taken as given: the route already refused a negative or
/// non-finite one as a malformed request, and a struk sold at a loss is the
/// outlet's call to make.
async fn ppob_history_receipt_data(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    store_name: &str,
    trx_id: String,
    sell_price: f64,
) -> Result<PpobReceiptData, AppError> {
    let item = services::ppob::history::detail(db, mitra, trx_id).await?;
    if !services::ppob::history::is_success(&item) {
        return Err(AppError::Validation(
            "Struk hanya bisa dicetak untuk transaksi yang sukses".into(),
        ));
    }

    Ok(build_ppob_receipt_data(
        store_name,
        PpobLine::from_history(&item, sell_price),
        ProviderSlip::from_history(&item),
    ))
}

/// The lines a history struk would print, for the screen to show before the
/// paper is spent. Needs the store but not a printer: the preview is useful on
/// a till whose printer is not set up yet, if only to show what would be lost.
pub async fn ppob_history_receipt(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    trx_id: String,
    sell_price: f64,
) -> Result<Vec<ReceiptLineResponse>, AppError> {
    let ReceiptRenderSettings {
        store, paper_width, ..
    } = receipt_render_settings(db).await?;

    let data = ppob_history_receipt_data(db, mitra, &store.name, trx_id, sell_price).await?;

    Ok(format_ppob_receipt(&data, paper_width)
        .into_iter()
        .map(ReceiptLineResponse::from)
        .collect())
}

/// Print the struk for a transaction in Mitra's history. The same lines the
/// preview showed: both go through [`ppob_history_receipt_data`] and the same
/// formatter, so what was on the screen is what lands on the paper.
pub async fn print_ppob_history(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    trx_id: String,
    sell_price: f64,
) -> Result<(), AppError> {
    let PrintTarget {
        store,
        printer_id,
        paper_width,
        mode,
        ..
    } = print_target(db).await?;

    let data = ppob_history_receipt_data(db, mitra, &store.name, trx_id, sell_price).await?;
    let lines = format_ppob_receipt(&data, paper_width);

    send_jobs(printer_id, vec![lines], paper_width, mode).await
}
