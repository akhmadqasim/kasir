//! Building a receipt from a transaction and getting it onto paper.

use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

use crate::domain::receipt::{
    PrinterInfoItem, PrinterSettings, PrinterSettingsResponse, ReceiptDataResponse,
    ReceiptItemResponse, ReceiptPaymentSplitResponse, UpdatePrinterSettingsInput,
};
use crate::entity::{store_info, transaction_items, transaction_payments, transactions, users};
use crate::printing::receipt::{
    format_receipt_text, format_test_page_text, ReceiptData, ReceiptItem, ReceiptTextLine,
};
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

/// Send text lines to printer via GDI pipeline (reliable for USB thermal printers)
fn send_to_printer_gdi(printer_id: &str, lines: &[ReceiptTextLine]) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::printing::windows_printer::send_gdi_text(printer_id, lines)
    }
    #[cfg(not(windows))]
    {
        let _ = (printer_id, lines);
        Err("Printing hanya tersedia di Windows".to_string())
    }
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
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let settings = get_printer_settings(&store.additional_info);

    let printer_id = settings
        .printer_id
        .ok_or_else(|| AppError::Validation("Printer belum dikonfigurasi".into()))?;

    let paper_width = settings.paper_width.unwrap_or(58);

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
        store_name: store.name,
        store_address: store.address,
        store_phone: store.phone,
        receipt_number: transaction.receipt_number,
        date_time,
        cashier_name,
        items: receipt_items,
        subtotal_amount: transaction.subtotal_amount,
        discount_amount: transaction.discount_amount,
        payment_method: transaction.payment_method,
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
        footer_text: settings.footer_text,
        is_deleted,
        deleted_reason,
        deleted_by_name,
        original_total_amount,
    };

    let text_lines = format_receipt_text(&receipt_data, paper_width);

    eprintln!(
        "[print_receipt] Generated {} text lines for GDI printer '{}'",
        text_lines.len(),
        printer_id
    );

    tokio::task::spawn_blocking(move || send_to_printer_gdi(&printer_id, &text_lines))
        .await
        .map_err(|e| AppError::Internal(format!("Print task error: {}", e)))?
        .map_err(|e| AppError::Internal(e))?;

    Ok(())
}

pub async fn test_print(db: &DatabaseConnection) -> Result<(), AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let settings = get_printer_settings(&store.additional_info);

    let printer_id = settings
        .printer_id
        .ok_or_else(|| AppError::Validation("Printer belum dikonfigurasi".into()))?;

    let paper_width = settings.paper_width.unwrap_or(58);

    let text_lines = format_test_page_text(&store.name, paper_width);

    tokio::task::spawn_blocking(move || send_to_printer_gdi(&printer_id, &text_lines))
        .await
        .map_err(|e| AppError::Internal(format!("Print task error: {}", e)))?
        .map_err(|e| AppError::Internal(e))?;

    Ok(())
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
