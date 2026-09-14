//! Building a receipt from a transaction and getting it onto paper.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::TimeZone;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use tokio::sync::Mutex;

use crate::domain::ppob::HistoryPaymentItem;
use crate::domain::receipt::{
    PrinterInfoItem, PrinterSettings, PrinterSettingsResponse, ReceiptDataResponse,
    ReceiptItemResponse, ReceiptLineResponse, ReceiptPaymentSplitResponse,
    UpdatePrinterSettingsInput,
};
use crate::entity::{
    ppob_receipts, store_info, transaction_items, transaction_payments, transactions, users,
};
use crate::printing::ppob_receipt::{format_ppob_receipt, PpobReceiptData};
use crate::printing::receipt::{
    columns, format_receipt_text, format_test_page_text, PrintMode, ReceiptData, ReceiptItem,
    ReceiptTextLine,
};
use crate::services;
use crate::services::ppob::client::MitraClient;
use crate::services::ppob::parsers::{get_num_field, parse_string, response_objects};
use crate::services::transactions::PPOB_STATUS_SUCCESS;
use crate::utils::AppError;

fn effective_receipt_total(transaction: &transactions::Model) -> f64 {
    if transaction.status == "deleted" {
        (transaction.subtotal_amount - transaction.discount_amount).max(0.0)
    } else {
        transaction.total_amount
    }
}

fn utc_to_local_formatted(utc_str: &str) -> String {
    chrono::NaiveDateTime::parse_from_str(utc_str, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|ndt| {
            let utc = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(ndt, chrono::Utc);
            utc.with_timezone(&chrono::Local)
                .format("%d/%m/%Y %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| "N/A".to_string())
}

/// Mitra's own `"DD-MM-YYYY HH:MM:SS"` timestamp, already WIB — its history
/// and its payment responses are never anything else, see
/// `services::ppob::history` and `services::ppob::notifications` — split into
/// the pulsa/data struk's date and time fields.
fn split_provider_wib_timestamp(value: &str) -> Option<(String, String)> {
    let (date, time) = value.trim().split_once(' ')?;
    let hm = time.get(0..5)?;
    Some((date.to_string(), format!("{hm} WIB")))
}

/// `transaction_items.created_at`, stored in UTC, converted to WIB —
/// Asia/Jakarta, a fixed UTC+7 with no daylight saving — for the pulsa/data
/// struk's date and time fields.
///
/// Deliberately not `chrono::Local`: the shop's own machine is not
/// necessarily in WIB (`services::ppob::history::detail`'s "the vendor
/// reports WIB and the shop runs an hour ahead of it" is exactly this), and a
/// struk that prints a WITA hour under the label "WIB" is wrong regardless of
/// which zone the till happens to be set to.
fn utc_to_wib_timestamp(utc_str: &str) -> Option<(String, String)> {
    let naive = chrono::NaiveDateTime::parse_from_str(utc_str, "%Y-%m-%d %H:%M:%S").ok()?;
    let wib_offset = chrono::FixedOffset::east_opt(7 * 3600).unwrap();
    let wib = wib_offset.from_utc_datetime(&naive);
    Some((
        wib.format("%d-%m-%Y").to_string(),
        format!("{} WIB", wib.format("%H:%M")),
    ))
}

/// The pulsa/data struk's date and time: the provider's own timestamp when it
/// sent one, our own row's `created_at` converted from UTC otherwise.
fn pulsa_date_time(
    provider_wib_timestamp: Option<&str>,
    item_created_at_utc: Option<&str>,
) -> (Option<String>, Option<String>) {
    let resolved = provider_wib_timestamp
        .and_then(split_provider_wib_timestamp)
        .or_else(|| item_created_at_utc.and_then(utc_to_wib_timestamp));

    match resolved {
        Some((date, time)) => (Some(date), Some(time)),
        None => (None, None),
    }
}

/// Get printer settings from store_info.additional_info JSON
pub(crate) fn get_printer_settings(additional_info: &Option<String>) -> PrinterSettings {
    additional_info
        .as_ref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .map(|v| PrinterSettings {
            printer_id: v
                .get("printer_id")
                .and_then(|v| v.as_str())
                .map(String::from),
            paper_width: v
                .get("paper_width")
                .and_then(|v| v.as_u64())
                .map(|v| v as u8),
            auto_print: v.get("auto_print").and_then(|v| v.as_bool()),
            footer_text: v
                .get("footer_text")
                .and_then(|v| v.as_str())
                .map(String::from),
            print_mode: v
                .get("print_mode")
                .and_then(|v| v.as_str())
                .map(String::from),
        })
        .unwrap_or(PrinterSettings {
            printer_id: None,
            paper_width: None,
            auto_print: None,
            footer_text: None,
            print_mode: None,
        })
}

/// Encode the lines and send them to the print queue as RAW data.
///
/// In raster mode the text is drawn with GDI and the picture is sent, which is
/// how the Mitra Indogrosir app prints and what the shop asked us to match; in
/// text mode the characters go to the printer.s own font engine, which is
/// faster and much smaller but looks like three fonts on one slip.
fn send_to_printer(
    printer_id: &str,
    lines: &[ReceiptTextLine],
    paper_width: u8,
    mode: PrintMode,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use crate::printing::raster::{render_lines, DOTS_58MM, DOTS_80MM};

        let bytes = match mode {
            PrintMode::Raster => {
                let dots = if paper_width >= 80 {
                    DOTS_80MM
                } else {
                    DOTS_58MM
                };
                let bitmap = render_lines(lines, columns(paper_width), dots)?;
                crate::printing::escpos::encode_raster(&bitmap)
            }
            PrintMode::Text => crate::printing::escpos::encode_lines(lines),
        };
        crate::printing::windows_printer::send_raw_data(printer_id, &bytes)
    }
    #[cfg(not(windows))]
    {
        let _ = (printer_id, lines, paper_width, mode);
        Err("Printing hanya tersedia di Windows".to_string())
    }
}

/// Where a print job goes and how the paper is set up. Every print path needs
/// the same four things and all of them come from the single `store_info` row,
/// so they are fetched once, here.
struct PrintTarget {
    store: store_info::Model,
    printer_id: String,
    paper_width: u8,
    footer_text: Option<String>,
    mode: PrintMode,
}

async fn print_target(db: &DatabaseConnection) -> Result<PrintTarget, AppError> {
    let ReceiptRenderSettings {
        store,
        paper_width,
        footer_text,
    } = receipt_render_settings(db).await?;

    let settings = get_printer_settings(&store.additional_info);
    let printer_id = settings
        .printer_id
        .ok_or_else(|| AppError::Validation("Printer belum dikonfigurasi".into()))?;

    Ok(PrintTarget {
        store,
        printer_id,
        paper_width,
        footer_text,
        mode: PrintMode::from_setting(settings.print_mode.as_deref()),
    })
}

/// The struk's own layout settings — paper width, footer text — without
/// requiring a printer to be configured at all.
///
/// [`print_target`] builds on this and adds the one thing only printing
/// needs: somewhere to send the bytes.
pub(crate) struct ReceiptRenderSettings {
    pub store: store_info::Model,
    pub paper_width: u8,
    pub footer_text: Option<String>,
}

pub(crate) async fn receipt_render_settings(
    db: &DatabaseConnection,
) -> Result<ReceiptRenderSettings, AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let settings = get_printer_settings(&store.additional_info);

    Ok(ReceiptRenderSettings {
        paper_width: settings.paper_width.unwrap_or(58),
        footer_text: settings.footer_text,
        store,
    })
}

/// Assemble the sale receipt's [`ReceiptData`] — everything
/// [`crate::printing::receipt::format_receipt_text`] needs — from a
/// transaction. Shared by [`print`] and by the receipt-lines endpoint the
/// frontend's preview reads, so the preview never drifts from what actually
/// prints.
pub(crate) async fn build_sale_receipt_data(
    db: &DatabaseConnection,
    store: &store_info::Model,
    footer_text: Option<String>,
    transaction_id: i64,
) -> Result<(ReceiptData, Vec<transaction_items::Model>), AppError> {
    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db)
        .await?;

    let has_ppob = items.iter().any(|item| item.service_type.is_some());
    if has_ppob && transaction.status != "completed" && transaction.status != "deleted" {
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
    let payment_breakdown = load_payment_breakdown(db, &transaction).await?;
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
            .map(|split| crate::printing::receipt::ReceiptPaymentSplit {
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

/// Send already-formatted jobs to the printer, in order, off the async runtime.
///
/// One job per piece of paper. A PPOB struk is cut away from the sale receipt
/// it belongs to precisely so the customer can take it to PLN without carrying
/// the shop's own receipt with it.
///
/// A job that fails does not cancel the ones behind it. The jobs are separate
/// pieces of paper for separate purposes, and stopping after the first failure
/// would mean one unlucky struk also costs the customer the second one.
async fn send_jobs(
    printer_id: String,
    jobs: Vec<Vec<ReceiptTextLine>>,
    paper_width: u8,
    mode: PrintMode,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let mut first_error = None;
        for job in &jobs {
            if let Err(error) = send_to_printer(&printer_id, job, paper_width, mode) {
                first_error.get_or_insert(error);
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("Print task error: {}", e)))?
    .map_err(AppError::Internal)
}

pub async fn list_printers() -> Result<Vec<PrinterInfoItem>, AppError> {
    tokio::task::spawn_blocking(|| {
        let mut all_printers = Vec::new();

        #[cfg(windows)]
        {
            if let Ok(win_printers) = crate::printing::windows_printer::list_printers() {
                for p in win_printers {
                    all_printers.push(PrinterInfoItem {
                        id: p.name.clone(),
                        name: if p.is_default {
                            format!("{} (Default)", p.name)
                        } else {
                            p.name
                        },
                        printer_type: "windows".to_string(),
                        is_default: p.is_default,
                    });
                }
            }
        }

        all_printers
    })
    .await
    .map_err(|e| AppError::Internal(format!("List printers error: {}", e)))
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

/// The stored provider responses for the given lines, keyed by line.
///
/// Its own table, so the sale history and the refund screens never carry these
/// kilobytes around. See migration 023.
async fn load_ppob_receipts(
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

/// First non-empty string the provider offers under any of `keys`, looked for
/// in the response itself and in every wrapper `response_objects` knows about —
/// a payment response keeps its status at the top and the struk details one
/// level down, and which level that is depends on the endpoint.
///
/// The emptiness test sits *inside* the search, not after it. Mitra fills a
/// field it has no value for with `""` as readily as it omits the key, so a
/// `"receipt_text": ""` at the root would otherwise end the search and hide the
/// real block one level down.
/// Keys outrank nesting: `admin_fee` anywhere beats `fee` at the root. They are
/// listed most-specific first for exactly that reason, and a wrapper holding the
/// real `admin_fee` should not lose to a root that happens to carry a vaguer
/// synonym.
fn provider_field(raw: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        response_objects(raw).find_map(|object| {
            parse_string(object.get(*key))
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
    })
}

fn provider_number(raw: &serde_json::Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| response_objects(raw).find_map(|object| get_num_field(object, &[*key])))
}

/// One of our own columns, treating a blank string as the absence it means.
fn stored(column: &Option<String>) -> Option<String> {
    column
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// What the provider said about a line, whichever endpoint said it: the
/// payment response stored with a line sold here, or a row of Mitra's own
/// history. Both end up as the same struk, so both are read into this first.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct ProviderSlip {
    pub customer_id: Option<String>,
    pub customer_name: Option<String>,
    /// PLN prepaid's twenty digits, when the provider sent them under that
    /// name. Kept apart from `serial_number` because it outranks even our own
    /// stored column — see [`build_ppob_receipt_data`].
    pub token_number: Option<String>,
    pub serial_number: Option<String>,
    pub reference_number: Option<String>,
    pub payment_code: Option<String>,
    /// The provider's `igr_desc`, e.g. `Pre paid dengan nomor meter`.
    pub description: Option<String>,
    pub receipt_text: Option<String>,
    /// The bill on its own, before the admin fee.
    pub bill_amount: Option<f64>,
    pub admin_fee: Option<f64>,
    /// What the provider charged, admin fee included.
    pub total: Option<f64>,
    /// Mitra's own transaction id — `trx_id` in a history row, the same
    /// field under the same name in a stored payment response if it carried
    /// one. Pulsa/data's `Nomor Invoice #…`; every other service ignores it.
    pub invoice_number: Option<String>,
    /// Mitra's own `"DD-MM-YYYY HH:MM:SS"`, WIB, unconverted. Pulsa/data's
    /// date/time line; every other service ignores it.
    pub formatted_date: Option<String>,
}

impl ProviderSlip {
    /// Read from the raw payment response stored with a sold line. Tolerant
    /// throughout: an item saved before migration 023 has no blob at all, and
    /// one whose provider answered with fields we have never seen still yields
    /// the slip's shape with the gaps left open.
    fn from_response(provider_response: Option<&str>) -> Self {
        let raw: serde_json::Value = provider_response
            .and_then(|json| serde_json::from_str(json).ok())
            .unwrap_or(serde_json::Value::Null);

        Self {
            customer_id: provider_field(
                &raw,
                &["customer_no", "customer_id", "idpel", "no_meter", "target"],
            ),
            customer_name: provider_field(
                &raw,
                &["customer_name", "nama_pelanggan", "subscriber_name", "nama"],
            ),
            token_number: provider_field(&raw, &["token_number"]),
            serial_number: provider_field(&raw, &["serial_number", "token", "sn"]),
            reference_number: provider_field(
                &raw,
                &["no_ref", "ref", "reference", "trx_id", "trxid"],
            ),
            payment_code: provider_field(&raw, &["payment_code", "raw_paymentcode"]),
            description: provider_field(&raw, &["igr_desc"]),
            receipt_text: provider_field(&raw, &["receipt_text", "invoice_string"]),
            // Deliberately not read from `amount`: the payment endpoints mean
            // the bill by it and the history endpoint means the total, and
            // from a stored blob there is no telling which shape arrived.
            // Guessing wrong prints the admin fee twice or not at all, so the
            // figure is only taken from a field that means one thing.
            bill_amount: provider_number(&raw, &["base_price", "nominal", "denom"]),
            admin_fee: provider_number(&raw, &["admin_fee", "admin", "amount_fee", "fee"]),
            total: provider_number(&raw, &["total", "total_payment", "total_amount"]),
            // Kept apart from `reference_number`'s own fallback list even
            // though both would otherwise read `trx_id`: they are different
            // Mitra ids (the struk prints both, under "Nomor Invoice #" and
            // "No. Ref:"), and `reference_number`'s existing fallback order
            // is left as it was for every other service.
            invoice_number: provider_field(&raw, &["trx_id", "trxid"]),
            formatted_date: provider_field(&raw, &["formatted_date", "created_at"]),
        }
    }

    /// Read from a row of `history-payment`, already parsed once by
    /// `services::ppob::history`. There `amount` is the total the outlet paid,
    /// admin fee included — `base_price` 20.000 + `admin_fee` 3.500 = `amount`
    /// 23.500, the figure Mitra's own invoice calls the total.
    pub(crate) fn from_history(item: &HistoryPaymentItem) -> Self {
        Self {
            customer_id: stored(&item.customer_no),
            customer_name: None,
            token_number: stored(&item.token_number),
            serial_number: stored(&item.serial_number),
            reference_number: stored(&item.no_ref),
            payment_code: stored(&item.payment_code),
            description: stored(&item.igr_desc),
            receipt_text: stored(&item.receipt_text),
            bill_amount: item.base_price,
            admin_fee: item.admin_fee,
            total: item.amount.or(item.total),
            invoice_number: stored(&item.trx_id),
            formatted_date: stored(&item.created_at),
        }
    }
}

/// What we know about the line from our own side: what the cashier chose,
/// what fulfilment actually used, and what the customer paid for it.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct PpobLine {
    /// `pln`, `pulsa`, `data`, `pdam`, `bpjs`, `pp`, `transfer`, `emoney`.
    pub service_type: String,
    /// PLN only: `"0"` prepaid, `"1"` postpaid. Set at checkout; a history row
    /// never carries it and the formatter falls back to the provider's slip.
    pub flag_id: Option<String>,
    pub product_name: Option<String>,
    pub customer_id: Option<String>,
    pub serial_number: Option<String>,
    pub payment_code: Option<String>,
    /// What the customer hands over for this line, our markup in it.
    pub grand_total: f64,
    /// `transaction_items.created_at`, UTC. Pulsa/data's date/time fallback
    /// when the provider sent no timestamp of its own; every other service
    /// ignores it.
    pub created_at_utc: Option<String>,
    /// The sale's own receipt number, `TRX-YYYYMMDD-XXXX`. Pulsa/data's
    /// invoice-line fallback when Mitra sent no id of its own; every other
    /// service ignores it.
    pub our_receipt_number: Option<String>,
}

impl PpobLine {
    fn from_item(item: &transaction_items::Model, our_receipt_number: &str) -> Self {
        Self {
            service_type: item.service_type.clone().unwrap_or_default(),
            flag_id: item.ppob_flag_id.clone(),
            product_name: Some(item.product_name.clone()),
            // A column holding `""` counts as absent — `execute_confirm_payment`
            // copies the provider's empty string into it rather than leaving it
            // NULL, and an empty column that shadowed the blob would cost the
            // struk its token.
            customer_id: stored(&item.service_ref),
            serial_number: stored(&item.ppob_serial_number),
            payment_code: stored(&item.ppob_payment_code),
            grand_total: item.net_subtotal,
            created_at_utc: item.created_at.clone(),
            our_receipt_number: Some(our_receipt_number.to_string()),
        }
    }

    /// A history row printed at a sell price chosen now, the way the Mitra
    /// app's "Ringkasan Transaksi" screen does it. Nothing here was typed by
    /// our cashier, so every identifying field is left to the provider's slip.
    pub(crate) fn from_history(item: &HistoryPaymentItem, sell_price: f64) -> Self {
        Self {
            service_type: history_service_type(item),
            flag_id: None,
            // Mitra fills `product_name` with `-` on most history rows and
            // says what was bought in `description` instead.
            product_name: stored(&item.product_name)
                .filter(|name| name != "-")
                .or_else(|| stored(&item.description)),
            customer_id: None,
            serial_number: None,
            payment_code: None,
            grand_total: sell_price,
            // There is no sale of ours behind a history struk to read either
            // of these from.
            created_at_utc: None,
            our_receipt_number: None,
        }
    }
}

/// Mitra's history names the service in capitals with spaces — `PLN`,
/// `PAYMENT POINT` — where our lines use the keys the flows were written
/// with. The struk only turns on `pln`, but the rest are mapped so the data
/// reads the same whichever side it came from.
fn history_service_type(item: &HistoryPaymentItem) -> String {
    let raw = item
        .service_type
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    match raw.as_str() {
        "" => String::new(),
        "payment point" | "payment_point" | "pp" => "pp".to_string(),
        "e-money" | "emoney" | "e money" => "emoney".to_string(),
        "paket data" | "data" => "data".to_string(),
        other => other.to_string(),
    }
}

/// Assemble a PPOB struk from what we know of the line and what the provider
/// said about it. Our own columns outrank the provider's echo of them — they
/// are what the cashier typed and what the fulfilment actually used — with one
/// exception: the token is worth more than the serial, and PLN prepaid answers
/// with the token in `token_number` and an empty `serial_number`, from which
/// our column was filled.
fn build_ppob_receipt_data(
    store_name: &str,
    line: PpobLine,
    slip: ProviderSlip,
) -> PpobReceiptData {
    let admin_fee = slip.admin_fee.unwrap_or(0.0);
    let bill_amount = slip
        .bill_amount
        .filter(|amount| *amount > 0.0)
        .unwrap_or(0.0);

    // What the provider charged us, admin fee included, which is the figure
    // their own struk and their PDF invoice both call the total. Their total if
    // they sent one, its two parts added up otherwise, and failing both the
    // rupiah the customer paid — which at worst shows a service fee of zero
    // rather than a wrong figure.
    let provider_total = slip
        .total
        .filter(|total| *total > 0.0)
        .or_else(|| (bill_amount > 0.0).then_some(bill_amount + admin_fee))
        .unwrap_or(line.grand_total);

    // Pulsa/data only — see `PpobReceiptData` and `printing::ppob_receipt`.
    // Every other service carries these four fields around unused.
    let (date, time) = pulsa_date_time(
        slip.formatted_date.as_deref(),
        line.created_at_utc.as_deref(),
    );

    PpobReceiptData {
        store_name: store_name.to_string(),
        service_type: line.service_type,
        flag_id: line.flag_id,
        product_name: line.product_name,
        customer_id: line.customer_id.or(slip.customer_id),
        customer_name: slip.customer_name,
        serial_number: slip
            .token_number
            .or(line.serial_number)
            .or(slip.serial_number),
        reference_number: slip.reference_number,
        payment_code: line.payment_code.or(slip.payment_code),
        provider_description: slip.description,
        provider_receipt_text: slip.receipt_text,
        amount: if bill_amount > 0.0 {
            bill_amount
        } else {
            (provider_total - admin_fee).max(0.0)
        },
        admin_fee,
        total: provider_total,
        grand_total: line.grand_total,
        date,
        time,
        mitra_invoice_number: slip.invoice_number,
        our_receipt_number: line.our_receipt_number,
    }
}

/// The struk for a line sold here, from its row and the provider blob stored
/// with it. `our_receipt_number` is the sale's own `TRX-…` number — the
/// pulsa/data invoice line's fallback when Mitra's response carried no id of
/// its own.
fn ppob_item_receipt_data(
    store: &store_info::Model,
    item: &transaction_items::Model,
    provider_response: Option<&str>,
    our_receipt_number: &str,
) -> PpobReceiptData {
    build_ppob_receipt_data(
        &store.name,
        PpobLine::from_item(item, our_receipt_number),
        ProviderSlip::from_response(provider_response),
    )
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
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;
    let paper_width = get_printer_settings(&store.additional_info)
        .paper_width
        .unwrap_or(58);

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

pub async fn test_print(db: &DatabaseConnection) -> Result<(), AppError> {
    let PrintTarget {
        store,
        printer_id,
        paper_width,
        mode,
        ..
    } = print_target(db).await?;

    let text_lines = format_test_page_text(&store.name, paper_width);

    send_jobs(printer_id, vec![text_lines], paper_width, mode).await
}

pub async fn update_printer_settings(
    db: &DatabaseConnection,
    input: UpdatePrinterSettingsInput,
) -> Result<(), AppError> {
    services::settings::merge_additional_info(db, |info| {
        if let Some(id) = &input.printer_id {
            info["printer_id"] = serde_json::json!(id);
        }
        if let Some(width) = &input.paper_width {
            info["paper_width"] = serde_json::json!(width);
        }
        if let Some(auto) = &input.auto_print {
            info["auto_print"] = serde_json::json!(auto);
        }
        if let Some(footer) = &input.footer_text {
            info["footer_text"] = serde_json::json!(footer);
        }
        if let Some(mode) = &input.print_mode {
            // Normalised on the way in, so an unknown value cannot sit in the
            // settings looking like it means something.
            info["print_mode"] =
                serde_json::json!(PrintMode::from_setting(Some(mode)).as_setting());
        }
        Ok(())
    })
    .await
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
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let settings = get_printer_settings(&store.additional_info);

    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db)
        .await?;

    let has_ppob = items.iter().any(|item| item.service_type.is_some());
    if has_ppob && transaction.status != "completed" && transaction.status != "deleted" {
        return Err(AppError::Validation(
            "Struk PPOB hanya tersedia setelah fulfillment berhasil".into(),
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

    let receipt_items: Vec<ReceiptItemResponse> = items
        .iter()
        .map(|item| ReceiptItemResponse {
            name: item.product_name.clone(),
            quantity: item.quantity as i32,
            price: item.product_price,
            subtotal: item.subtotal,
        })
        .collect();
    let payment_breakdown = load_payment_breakdown(db, &transaction).await?;
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
        footer_text: settings.footer_text,
        notes,
        is_deleted,
        deleted_reason,
        deleted_by_name,
        original_total_amount,
    })
}

pub async fn printer_settings(
    db: &DatabaseConnection,
) -> Result<PrinterSettingsResponse, AppError> {
    let store = store_info::Entity::find_by_id(1_i64).one(db).await?;

    let settings = store
        .map(|s| get_printer_settings(&s.additional_info))
        .unwrap_or(PrinterSettings {
            printer_id: None,
            paper_width: None,
            auto_print: None,
            footer_text: None,
            print_mode: None,
        });

    Ok(PrinterSettingsResponse {
        printer_id: settings.printer_id,
        paper_width: settings.paper_width,
        auto_print: settings.auto_print,
        footer_text: settings.footer_text,
        // Absent means the default, and the screen should show which that is.
        print_mode: Some(
            PrintMode::from_setting(settings.print_mode.as_deref())
                .as_setting()
                .to_string(),
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// `pulsa/v2/topup` answers with everything one level down, under
    /// `history_payment`; the `*/payment` endpoints answer flat. Both have to
    /// work without the caller knowing which service it is looking at.
    #[test]
    fn provider_fields_are_found_in_the_root_and_in_every_known_wrapper() {
        let flat = json!({ "serial_number": "SN-1", "total": 54500 });
        assert_eq!(
            provider_field(&flat, &["token_number", "serial_number"]),
            Some("SN-1".to_string())
        );
        assert_eq!(provider_number(&flat, &["total"]), Some(54500.0));

        let nested = json!({ "message": "OK", "history_payment": { "no_ref": "REF-9" } });
        assert_eq!(
            provider_field(&nested, &["no_ref"]),
            Some("REF-9".to_string())
        );
    }

    /// Mitra sends money as a number on one service and a quoted string on the
    /// next, and pads strings it did not fill in.
    #[test]
    fn provider_values_survive_the_providers_own_inconsistency() {
        let raw = json!({ "amount": "5283.00", "customer_name": "  EDA RUSDIANI  ", "note": "" });
        assert_eq!(provider_number(&raw, &["amount"]), Some(5283.0));
        assert_eq!(
            provider_field(&raw, &["customer_name"]),
            Some("EDA RUSDIANI".to_string())
        );
        // An empty string is not an answer; the struk leaves the line out.
        assert_eq!(provider_field(&raw, &["note"]), None);
        assert_eq!(provider_field(&raw, &["nothing_like_this"]), None);
    }

    /// Mitra fills a field it has no value for with `""` as readily as it drops
    /// the key. An empty one at the root must not end the search and hide the
    /// real block one level down -- that is the difference between a struk with
    /// the provider's own text on it and a struk with our reconstruction.
    #[test]
    fn an_empty_value_does_not_shadow_a_real_one_deeper_down() {
        let raw = json!({
            "receipt_text": "",
            "serial_number": "   ",
            "history_payment": {
                "receipt_text": "NO METER : 45094614059",
                "token_number": "69915243803067642910"
            }
        });

        assert_eq!(
            provider_field(&raw, &["receipt_text", "invoice_string"]),
            Some("NO METER : 45094614059".to_string())
        );
        assert_eq!(
            provider_field(&raw, &["token_number", "serial_number"]),
            Some("69915243803067642910".to_string())
        );
    }

    /// A column holding `""` means the same as a column holding NULL.
    #[test]
    fn a_blank_column_counts_as_absent() {
        assert_eq!(stored(&Some("  ".to_string())), None);
        assert_eq!(stored(&None), None);
        assert_eq!(
            stored(&Some(" SN-1 ".to_string())),
            Some("SN-1".to_string())
        );
    }

    /// An item stored before migration 023 has no blob at all.
    #[test]
    fn a_missing_provider_blob_yields_nothing_rather_than_panicking() {
        let raw = serde_json::Value::Null;
        assert_eq!(provider_field(&raw, &["receipt_text"]), None);
        assert_eq!(provider_number(&raw, &["total"]), None);
    }

    // -----------------------------------------------------------------------
    // The history path: a row of Mitra's `history-payment`, printed at a sell
    // price chosen now.
    // -----------------------------------------------------------------------

    /// An anonymised copy of a real PLN postpaid row as `services::ppob::history`
    /// parses it: `total` null, `amount` the figure the outlet paid with the
    /// admin fee already in it, the provider's slip in `receipt_text`.
    fn pln_postpaid_row() -> HistoryPaymentItem {
        HistoryPaymentItem {
            trx_id: Some("111100000001".to_string()),
            product_name: Some("-".to_string()),
            description: Some("PLN - 231000000002".to_string()),
            serial_number: Some(String::new()),
            total: None,
            amount: Some(73229.0),
            admin_fee: Some(3500.0),
            status: Some("SUKSES".to_string()),
            created_at: Some("2026-09-11 10:11:50".to_string()),
            base_price: Some(69729.0),
            plu: Some("321700758".to_string()),
            service_type: Some("PLN".to_string()),
            customer_no: Some("231000000002".to_string()),
            token_number: Some(String::new()),
            payment_code: Some("L231000000002-2-260911101150".to_string()),
            receipt_text: Some(
                "\r\n\r\nSTRUK PEMBAYARAN TAGIHAN LISTRIK\r\n\r\nIDPEL          : 231000000002\r\nNAMA           : PT.CONTOH SEJA H\r\n                  TERA\r\nTOTAL BAYAR    : Rp 73.229,00\r\n"
                    .to_string(),
            ),
            igr_desc: Some("Post paid".to_string()),
            no_ref: Some("13516345".to_string()),
            ..HistoryPaymentItem::default()
        }
    }

    /// The row and the sell price become the same [`PpobReceiptData`] a line
    /// sold here would: the provider's figures as the provider's, the sell
    /// price as the grand total, and the slip printed verbatim.
    #[test]
    fn a_history_row_is_mapped_like_a_line_sold_here() {
        let row = pln_postpaid_row();
        let data = build_ppob_receipt_data(
            "Toko Contoh",
            PpobLine::from_history(&row, 75000.0),
            ProviderSlip::from_history(&row),
        );

        assert_eq!(data.store_name, "Toko Contoh");
        assert_eq!(data.service_type, "pln");
        assert_eq!(data.flag_id, None);
        // `-` is not a product name; the description says what was bought.
        assert_eq!(data.product_name.as_deref(), Some("PLN - 231000000002"));
        assert_eq!(data.customer_id.as_deref(), Some("231000000002"));
        // Both the token and the serial were sent empty: no token block.
        assert_eq!(data.serial_number, None);
        assert_eq!(data.reference_number.as_deref(), Some("13516345"));
        assert_eq!(
            data.payment_code.as_deref(),
            Some("L231000000002-2-260911101150")
        );
        assert_eq!(data.provider_description.as_deref(), Some("Post paid"));
        assert!(data
            .provider_receipt_text
            .as_deref()
            .is_some_and(|text| text.contains("STRUK PEMBAYARAN TAGIHAN LISTRIK")));
        assert_eq!(data.amount, 69729.0);
        assert_eq!(data.admin_fee, 3500.0);
        assert_eq!(data.total, 73229.0);
        assert_eq!(data.grand_total, 75000.0);
    }

    /// The struk itself ends in the Mitra app's three lines, with the sell
    /// price as `Grand Total` and the markup as `Biaya Layanan`.
    #[test]
    fn a_history_struk_prints_the_sell_price_as_the_grand_total() {
        let row = pln_postpaid_row();
        let data = build_ppob_receipt_data(
            "Toko Contoh",
            PpobLine::from_history(&row, 75000.0),
            ProviderSlip::from_history(&row),
        );
        let lines: Vec<String> = format_ppob_receipt(&data, 58)
            .into_iter()
            .map(|line| line.text)
            .collect();

        assert!(lines.contains(&"Total             Rp 73.229".to_string()));
        assert!(lines.contains(&"Biaya Layanan     Rp 1.771".to_string()));
        assert!(lines.contains(&"Grand Total       Rp 75.000".to_string()));
    }

    /// A row that never said its total is summed from the two parts it did
    /// send, exactly as a stored payment blob is.
    #[test]
    fn a_history_row_without_a_total_adds_the_bill_and_the_admin_fee() {
        let row = HistoryPaymentItem {
            amount: None,
            total: None,
            base_price: Some(20000.0),
            admin_fee: Some(3500.0),
            ..pln_postpaid_row()
        };
        let data = build_ppob_receipt_data(
            "Toko Contoh",
            PpobLine::from_history(&row, 25000.0),
            ProviderSlip::from_history(&row),
        );

        assert_eq!(data.total, 23500.0);
        assert_eq!(data.amount, 20000.0);
    }

    /// Mitra's capitals-and-spaces service names become the keys our lines use.
    #[test]
    fn history_service_names_are_mapped_to_our_keys() {
        let named = |name: &str| HistoryPaymentItem {
            service_type: Some(name.to_string()),
            ..HistoryPaymentItem::default()
        };
        assert_eq!(history_service_type(&named("PLN")), "pln");
        assert_eq!(history_service_type(&named("PAYMENT POINT")), "pp");
        assert_eq!(history_service_type(&named("E-Money")), "emoney");
        assert_eq!(history_service_type(&named("BPJS")), "bpjs");
        assert_eq!(history_service_type(&named("")), "");
    }

    /// Our own columns outrank the provider's echo of them, with the one
    /// exception the PLN prepaid response forces: its token arrives under
    /// `token_number` while our serial column was filled from an empty
    /// `serial_number`, so the provider's token beats the stored serial.
    #[test]
    fn the_line_outranks_the_slip_except_for_the_token() {
        let line = PpobLine {
            service_type: "pln".to_string(),
            customer_id: Some("typed-by-cashier".to_string()),
            serial_number: Some("stored-serial".to_string()),
            payment_code: Some("stored-code".to_string()),
            grand_total: 25000.0,
            ..PpobLine::default()
        };
        let slip = ProviderSlip {
            customer_id: Some("echoed".to_string()),
            token_number: Some("1111 2222 3333 4444 5555".to_string()),
            serial_number: Some("provider-serial".to_string()),
            payment_code: Some("echoed-code".to_string()),
            bill_amount: Some(20000.0),
            admin_fee: Some(3500.0),
            total: None,
            ..ProviderSlip::default()
        };

        let data = build_ppob_receipt_data("Toko", line, slip);

        assert_eq!(data.customer_id.as_deref(), Some("typed-by-cashier"));
        assert_eq!(data.payment_code.as_deref(), Some("stored-code"));
        assert_eq!(
            data.serial_number.as_deref(),
            Some("1111 2222 3333 4444 5555")
        );
        assert_eq!(data.total, 23500.0);
        assert_eq!(data.grand_total, 25000.0);
    }

    /// With nothing from the provider at all, the struk still has a total: the
    /// rupiah the customer paid, which at worst shows a service fee of zero.
    #[test]
    fn a_line_with_no_provider_figures_falls_back_to_what_was_paid() {
        let line = PpobLine {
            grand_total: 12000.0,
            ..PpobLine::default()
        };
        let data = build_ppob_receipt_data("Toko", line, ProviderSlip::default());

        assert_eq!(data.total, 12000.0);
        assert_eq!(data.amount, 12000.0);
        assert_eq!(data.admin_fee, 0.0);
    }

    // -----------------------------------------------------------------------
    // Pulsa/data: date, invoice number, and the sale's own receipt number as
    // its fallback. See `printing::ppob_receipt::format_pulsa_receipt` for
    // where these four fields end up on the paper.
    // -----------------------------------------------------------------------

    /// A real row's numbers: `ppob_serial_number` holding a copy of the
    /// reference number rather than an actual token, and `created_at` in
    /// UTC, an hour and change before midnight.
    fn pulsa_item_row() -> transaction_items::Model {
        transaction_items::Model {
            id: 1,
            transaction_id: 1,
            product_id: None,
            product_name: "Pulsa TELKOMSEL - TELKOMSEL 20.000,- Masa Aktif 30 Hari".to_string(),
            product_price: 20070.0,
            buy_price: Some(20000.0),
            quantity: 1,
            subtotal: 20070.0,
            item_discount: 0.0,
            net_subtotal: 20070.0,
            service_type: Some("pulsa".to_string()),
            service_ref: Some("081348172197".to_string()),
            ppob_product_id: None,
            ppob_product_code: None,
            ppob_inquiry_id: None,
            ppob_payment_code: Some("P081348172197-861-260327091340".to_string()),
            ppob_flag_id: None,
            ppob_status: Some(PPOB_STATUS_SUCCESS.to_string()),
            ppob_message: None,
            ppob_serial_number: Some("04273700000625739077".to_string()),
            created_at: Some("2026-09-12 23:44:34".to_string()),
        }
    }

    /// `utc_to_wib_timestamp` is a fixed +7h, not the machine's own zone: 23:44
    /// UTC is 06:44 the *next* day in WIB, and the date has to move with it.
    #[test]
    fn transaction_items_created_at_is_converted_from_utc_to_a_fixed_wib_offset() {
        assert_eq!(
            utc_to_wib_timestamp("2026-09-12 23:44:34"),
            Some(("13-09-2026".to_string(), "06:44 WIB".to_string()))
        );
    }

    /// The provider's own timestamp is already WIB and is only ever split,
    /// never re-zoned.
    #[test]
    fn a_providers_own_timestamp_is_split_not_reinterpreted() {
        assert_eq!(
            split_provider_wib_timestamp("27-03-2026 09:13:00"),
            Some(("27-03-2026".to_string(), "09:13 WIB".to_string()))
        );
    }

    /// No provider response at all: the invoice line and the clock both fall
    /// back to our own side — the sale's receipt number and the row's own
    /// `created_at`, converted from UTC.
    #[test]
    fn a_sold_here_pulsa_line_with_no_provider_response_falls_back_to_our_own_side() {
        let line = PpobLine::from_item(&pulsa_item_row(), "TRX-20260912-0007");
        assert_eq!(line.created_at_utc.as_deref(), Some("2026-09-12 23:44:34"));
        assert_eq!(
            line.our_receipt_number.as_deref(),
            Some("TRX-20260912-0007")
        );

        let data = build_ppob_receipt_data("Toko Contoh", line, ProviderSlip::default());

        assert_eq!(data.mitra_invoice_number, None);
        assert_eq!(
            data.our_receipt_number.as_deref(),
            Some("TRX-20260912-0007")
        );
        assert_eq!(data.date.as_deref(), Some("13-09-2026"));
        assert_eq!(data.time.as_deref(), Some("06:44 WIB"));
    }

    /// A provider response that does carry its own id and timestamp outranks
    /// our own side — same precedence every other field on the slip already
    /// has.
    #[test]
    fn a_sold_here_pulsa_line_prefers_the_providers_own_invoice_and_timestamp() {
        let blob = json!({
            "trx_id": "50151852",
            "formatted_date": "27-03-2026 09:13:00",
        })
        .to_string();
        let line = PpobLine::from_item(&pulsa_item_row(), "TRX-20260912-0007");
        let slip = ProviderSlip::from_response(Some(&blob));

        let data = build_ppob_receipt_data("Toko Contoh", line, slip);

        assert_eq!(data.mitra_invoice_number.as_deref(), Some("50151852"));
        // Still carried, even though the provider's id wins the invoice line.
        assert_eq!(
            data.our_receipt_number.as_deref(),
            Some("TRX-20260912-0007")
        );
        assert_eq!(data.date.as_deref(), Some("27-03-2026"));
        assert_eq!(data.time.as_deref(), Some("09:13 WIB"));
    }

    /// A row of Mitra's own history: `trx_id` is the invoice number, its
    /// `created_at` (Mitra's `formatted_date`, WIB) the timestamp, and there
    /// is no sale of ours behind it for either to fall back to.
    fn pulsa_history_row() -> HistoryPaymentItem {
        HistoryPaymentItem {
            trx_id: Some("50151852".to_string()),
            service_type: Some("PULSA".to_string()),
            product_name: Some("-".to_string()),
            customer_no: Some("081348172197".to_string()),
            created_at: Some("27-03-2026 09:13:00".to_string()),
            no_ref: Some("04103400001446365784".to_string()),
            payment_code: Some("P081348172197-861-260327091340".to_string()),
            token_number: Some("-".to_string()),
            amount: Some(20070.0),
            admin_fee: Some(0.0),
            base_price: Some(20000.0),
            ..HistoryPaymentItem::default()
        }
    }

    #[test]
    fn a_pulsa_history_row_carries_mitras_own_invoice_number_and_timestamp() {
        let row = pulsa_history_row();
        let data = build_ppob_receipt_data(
            "Toko Contoh",
            PpobLine::from_history(&row, 20070.0),
            ProviderSlip::from_history(&row),
        );

        assert_eq!(data.service_type, "pulsa");
        assert_eq!(data.mitra_invoice_number.as_deref(), Some("50151852"));
        // No sale of ours behind a history struk.
        assert_eq!(data.our_receipt_number, None);
        assert_eq!(data.date.as_deref(), Some("27-03-2026"));
        assert_eq!(data.time.as_deref(), Some("09:13 WIB"));
    }

    /// The stored payment blob is read the way it always was: a wrapped
    /// response yields the slip with the provider's own spellings resolved.
    #[test]
    fn a_stored_payment_response_is_read_into_the_slip() {
        let blob = json!({
            "message": "OK",
            "history_payment": {
                "token_number": "1111 2222 3333 4444 5555",
                "serial_number": "",
                "no_ref": "REF-9",
                "base_price": "20000.00",
                "admin_fee": 3500,
                "receipt_text": "NO METER : 14300000001"
            }
        })
        .to_string();

        let slip = ProviderSlip::from_response(Some(&blob));

        assert_eq!(
            slip.token_number.as_deref(),
            Some("1111 2222 3333 4444 5555")
        );
        assert_eq!(slip.serial_number, None);
        assert_eq!(slip.reference_number.as_deref(), Some("REF-9"));
        assert_eq!(slip.bill_amount, Some(20000.0));
        assert_eq!(slip.admin_fee, Some(3500.0));
        assert_eq!(slip.total, None);
        assert_eq!(slip.receipt_text.as_deref(), Some("NO METER : 14300000001"));
        assert_eq!(ProviderSlip::from_response(None), ProviderSlip::default());
    }

    /// A stored pulsa response carries its own invoice id and timestamp
    /// the same way any other field is read off it: found under a nested
    /// wrapper as readily as at the root.
    #[test]
    fn a_stored_pulsa_response_carries_the_invoice_id_and_timestamp() {
        let blob = json!({
            "message": "OK",
            "history_payment": {
                "trx_id": "50151852",
                "formatted_date": "27-03-2026 09:13:00",
            }
        })
        .to_string();

        let slip = ProviderSlip::from_response(Some(&blob));

        assert_eq!(slip.invoice_number.as_deref(), Some("50151852"));
        assert_eq!(slip.formatted_date.as_deref(), Some("27-03-2026 09:13:00"));
    }
}
