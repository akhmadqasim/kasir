//! Building a receipt from a transaction and getting it onto paper.

use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

use crate::domain::receipt::{
    PrinterInfoItem, PrinterSettings, PrinterSettingsResponse, ReceiptDataResponse,
    ReceiptItemResponse, ReceiptPaymentSplitResponse, UpdatePrinterSettingsInput,
};
use crate::entity::{store_info, transaction_items, transaction_payments, transactions, users};
use crate::printing::ppob_receipt::{format_ppob_receipt, PpobReceiptData};
use crate::printing::receipt::{
    format_receipt_text, format_test_page_text, ReceiptData, ReceiptItem, ReceiptTextLine,
};
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

/// Get printer settings from store_info.additional_info JSON
fn get_printer_settings(additional_info: &Option<String>) -> PrinterSettings {
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
        })
        .unwrap_or(PrinterSettings {
            printer_id: None,
            paper_width: None,
            auto_print: None,
            footer_text: None,
        })
}

/// Encode text lines as ESC/POS and send them to the print queue as RAW data,
/// so the printer renders them with its own built-in font instead of the driver
/// rasterising a bitmap (which printed thin and stuttered).
fn send_to_printer(printer_id: &str, lines: &[ReceiptTextLine]) -> Result<(), String> {
    #[cfg(windows)]
    {
        let bytes = crate::printing::escpos::encode_lines(lines);
        crate::printing::windows_printer::send_raw_data(printer_id, &bytes)
    }
    #[cfg(not(windows))]
    {
        let _ = (printer_id, lines);
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
}

async fn print_target(db: &DatabaseConnection) -> Result<PrintTarget, AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let settings = get_printer_settings(&store.additional_info);
    let printer_id = settings
        .printer_id
        .ok_or_else(|| AppError::Validation("Printer belum dikonfigurasi".into()))?;

    Ok(PrintTarget {
        store,
        printer_id,
        paper_width: settings.paper_width.unwrap_or(58),
        footer_text: settings.footer_text,
    })
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
async fn send_jobs(printer_id: String, jobs: Vec<Vec<ReceiptTextLine>>) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let mut first_error = None;
        for job in &jobs {
            if let Err(error) = send_to_printer(&printer_id, job) {
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
    } = print_target(db).await?;

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
            "Struk PPOB hanya bisa dicetak setelah fulfillment berhasil".into(),
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

    let receipt_items: Vec<ReceiptItem> = items
        .iter()
        .map(|item| ReceiptItem {
            name: item.product_name.clone(),
            quantity: item.quantity as i32,
            price: item.product_price,
            subtotal: item.subtotal,
        })
        .collect();
    let payment_breakdown = load_payment_breakdown(db, &transaction).await?;
    let is_deleted = transaction.status == "deleted";
    let original_total_amount = effective_receipt_total(&transaction);
    let deleted_reason = transaction.deleted_reason.clone();

    eprintln!(
        "[print_receipt] Transaction #{}, items count: {}",
        transaction_id,
        receipt_items.len()
    );
    for (i, item) in receipt_items.iter().enumerate() {
        eprintln!(
            "[print_receipt]   Item {}: {} x{} @{} = {}",
            i, item.name, item.quantity, item.price, item.subtotal
        );
    }

    let receipt_data = ReceiptData {
        store_name: store.name.clone(),
        store_address: store.address.clone(),
        store_phone: store.phone.clone(),
        receipt_number: transaction.receipt_number.clone(),
        date_time: date_time.clone(),
        cashier_name: cashier_name.clone(),
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
        is_deleted,
        deleted_reason,
        deleted_by_name,
        original_total_amount,
    };

    let text_lines = format_receipt_text(&receipt_data, paper_width);

    eprintln!(
        "[print_receipt] Generated {} text lines for printer '{}'",
        text_lines.len(),
        printer_id
    );

    // The sale first, then one struk per PPOB line that has come back fulfilled
    // by the time the paper is cut.
    //
    // Auto-print usually finds none of them ready: the cashier screen calls this
    // the moment the sale commits, while fulfilment is still in flight in a
    // background task, so the lines are `pending` and are skipped. That is the
    // right behaviour — a struk with no token on it is worse than no struk — and
    // it is why the detail dialog has a button of its own. A reprint from there,
    // or any later print of the sale, picks them up.
    let mut jobs = vec![text_lines];
    jobs.extend(
        items
            .iter()
            .filter(|item| item.ppob_status.as_deref() == Some(PPOB_STATUS_SUCCESS))
            .map(|item| {
                let data =
                    build_ppob_receipt_data(&store, &transaction, &cashier_name, &date_time, item);
                format_ppob_receipt(&data, paper_width)
            }),
    );

    send_jobs(printer_id, jobs).await
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
        ..
    } = print_target(db).await?;

    let transaction = transactions::Entity::find_by_id(item.transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let cashier_name = users::Entity::find_by_id(transaction.user_id)
        .one(db)
        .await?
        .map(|user| user.full_name)
        .unwrap_or_else(|| "Unknown".to_string());

    let date_time = transaction
        .created_at
        .as_deref()
        .map(utc_to_local_formatted)
        .unwrap_or_else(|| "N/A".to_string());

    let data = build_ppob_receipt_data(&store, &transaction, &cashier_name, &date_time, &item);
    let lines = format_ppob_receipt(&data, paper_width);

    send_jobs(printer_id, vec![lines]).await
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
fn provider_field(raw: &serde_json::Value, keys: &[&str]) -> Option<String> {
    response_objects(raw).find_map(|object| {
        keys.iter().find_map(|key| {
            parse_string(object.get(*key))
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
    })
}

fn provider_number(raw: &serde_json::Value, keys: &[&str]) -> Option<f64> {
    response_objects(raw).find_map(|object| get_num_field(object, keys))
}

/// One of our own columns, treating a blank string as the absence it means.
fn stored(column: &Option<String>) -> Option<String> {
    column
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Assemble a PPOB struk from the sold line and the provider blob stored with
/// it. Tolerant throughout: an item saved before migration 023, or one whose
/// provider answered with fields we have never seen, still yields a struk built
/// from the columns we control.
fn build_ppob_receipt_data(
    store: &store_info::Model,
    transaction: &transactions::Model,
    cashier_name: &str,
    date_time: &str,
    item: &transaction_items::Model,
) -> PpobReceiptData {
    let raw: serde_json::Value = item
        .ppob_receipt_data
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or(serde_json::Value::Null);

    let admin_fee =
        provider_number(&raw, &["admin_fee", "admin", "amount_fee", "fee"]).unwrap_or(0.0);

    // What the provider charged us, admin fee included.
    //
    // `amount` is that figure, not the bill: a real PLN response reads
    // `amount: 23500, base_price: 20000, admin_fee: 3500`, and the PDF invoice
    // Mitra issues for the same transaction calls 23.500 the total. Adding the
    // fee on top of `amount` would bill it twice. `total` is tried first only
    // because a response that sends both means the other one to be the bill.
    let provider_total =
        provider_number(&raw, &["total", "total_payment", "total_amount", "amount"])
            .filter(|total| *total > 0.0)
            .unwrap_or(item.net_subtotal);

    // The bill on its own, for the fallback block. Derived when absent, because
    // `amount` is already spoken for above.
    let bill_amount = provider_number(&raw, &["base_price", "nominal", "denom"])
        .filter(|amount| *amount > 0.0)
        .unwrap_or((provider_total - admin_fee).max(0.0));

    PpobReceiptData {
        store_name: store.name.clone(),
        store_address: store.address.clone(),
        store_phone: store.phone.clone(),
        receipt_number: transaction.receipt_number.clone(),
        date_time: date_time.to_string(),
        cashier_name: cashier_name.to_string(),
        service_type: item.service_type.clone().unwrap_or_default(),
        flag_id: item.ppob_flag_id.clone(),
        product_name: Some(item.product_name.clone()),
        // Our own columns first: they are what the cashier typed and what the
        // fulfilment actually used, whatever the provider echoed back. A column
        // holding `""` counts as absent — `execute_confirm_payment` copies the
        // provider's empty string into it rather than leaving it NULL, and an
        // empty column that shadowed the blob would cost the struk its token.
        customer_id: stored(&item.service_ref).or_else(|| {
            provider_field(
                &raw,
                &["customer_no", "customer_id", "idpel", "no_meter", "target"],
            )
        }),
        customer_name: provider_field(
            &raw,
            &["customer_name", "nama_pelanggan", "subscriber_name", "nama"],
        ),
        // The token is worth more than the serial: PLN prepaid answers with the
        // token in `token_number` and an empty `serial_number`, and the column
        // was filled from the latter.
        serial_number: provider_field(&raw, &["token_number"])
            .or_else(|| stored(&item.ppob_serial_number))
            .or_else(|| provider_field(&raw, &["serial_number", "token", "sn"])),
        reference_number: provider_field(&raw, &["no_ref", "ref", "reference", "trx_id", "trxid"]),
        payment_code: stored(&item.ppob_payment_code)
            .or_else(|| provider_field(&raw, &["payment_code", "raw_paymentcode"])),
        service_description: provider_field(&raw, &["description", "plu_desc"]),
        provider_description: provider_field(&raw, &["igr_desc"]),
        provider_receipt_text: provider_field(&raw, &["receipt_text", "invoice_string"]),
        amount: bill_amount,
        admin_fee,
        total: provider_total,
        // What the customer actually handed over for this line, discounts and
        // our markup already in it.
        grand_total: item.net_subtotal,
        footer_text: provider_field(&raw, &["footer", "footer_text"]),
    }
}

pub async fn test_print(db: &DatabaseConnection) -> Result<(), AppError> {
    let PrintTarget {
        store,
        printer_id,
        paper_width,
        ..
    } = print_target(db).await?;

    let text_lines = format_test_page_text(&store.name, paper_width);

    send_jobs(printer_id, vec![text_lines]).await
}

pub async fn update_printer_settings(
    db: &DatabaseConnection,
    input: UpdatePrinterSettingsInput,
) -> Result<(), AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let mut info: serde_json::Value = store
        .additional_info
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));

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

    let mut active: store_info::ActiveModel = store.into();
    active.additional_info =
        Set(Some(serde_json::to_string(&info).map_err(|e| {
            AppError::Internal(format!("Gagal menyimpan pengaturan: {}", e))
        })?));
    active.updated_at = Set(Some(
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    ));
    active.update(db).await?;

    Ok(())
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
        });

    Ok(PrinterSettingsResponse {
        printer_id: settings.printer_id,
        paper_width: settings.paper_width,
        auto_print: settings.auto_print,
        footer_text: settings.footer_text,
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
}
