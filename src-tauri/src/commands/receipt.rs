use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::entity::{store_info, transaction_items, transactions, users};
use crate::printing::receipt::{
    format_receipt_text, format_test_page_text, ReceiptData,
    ReceiptItem, ReceiptTextLine,
};
use crate::utils::AppError;

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

#[derive(Debug, Serialize)]
pub struct PrinterInfoItem {
    pub id: String,
    pub name: String,
    pub printer_type: String, // "windows" or "usb"
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
pub struct PrinterSettings {
    pub printer_id: Option<String>,
    pub paper_width: Option<u8>,
    pub auto_print: Option<bool>,
    pub footer_text: Option<String>,
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

#[tauri::command]
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

#[tauri::command]
pub async fn print_receipt(
    db: State<'_, DatabaseConnection>,
    transaction_id: i64,
) -> Result<(), AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let settings = get_printer_settings(&store.additional_info);

    let printer_id = settings
        .printer_id
        .ok_or_else(|| AppError::Validation("Printer belum dikonfigurasi".into()))?;

    let paper_width = settings.paper_width.unwrap_or(58);

    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db.inner())
        .await?;

    let user = users::Entity::find_by_id(transaction.user_id)
        .one(db.inner())
        .await?;
    let cashier_name = user
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".to_string());

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

    eprintln!("[print_receipt] Transaction #{}, items count: {}", transaction_id, receipt_items.len());
    for (i, item) in receipt_items.iter().enumerate() {
        eprintln!("[print_receipt]   Item {}: {} x{} @{} = {}", i, item.name, item.quantity, item.price, item.subtotal);
    }

    let receipt_data = ReceiptData {
        store_name: store.name,
        store_address: store.address,
        store_phone: store.phone,
        receipt_number: transaction.receipt_number,
        date_time,
        cashier_name,
        items: receipt_items,
        total_amount: transaction.total_amount,
        payment_method: transaction.payment_method,
        payment_amount: transaction.payment_amount,
        change_amount: transaction.change_amount.unwrap_or(0.0),
        footer_text: settings.footer_text,
    };

    let text_lines = format_receipt_text(&receipt_data, paper_width);

    eprintln!(
        "[print_receipt] Generated {} text lines for GDI printer '{}'",
        text_lines.len(),
        printer_id
    );

    tokio::task::spawn_blocking(move || {
        send_to_printer_gdi(&printer_id, &text_lines)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Print task error: {}", e)))?
    .map_err(|e| AppError::Internal(e))?;

    Ok(())
}

#[tauri::command]
pub async fn test_print(db: State<'_, DatabaseConnection>) -> Result<(), AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let settings = get_printer_settings(&store.additional_info);

    let printer_id = settings
        .printer_id
        .ok_or_else(|| AppError::Validation("Printer belum dikonfigurasi".into()))?;

    let paper_width = settings.paper_width.unwrap_or(58);

    let text_lines = format_test_page_text(&store.name, paper_width);

    tokio::task::spawn_blocking(move || {
        send_to_printer_gdi(&printer_id, &text_lines)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Print task error: {}", e)))?
    .map_err(|e| AppError::Internal(e))?;

    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct UpdatePrinterSettingsInput {
    pub printer_id: Option<String>,
    pub paper_width: Option<u8>,
    pub auto_print: Option<bool>,
    pub footer_text: Option<String>,
}

#[tauri::command]
pub async fn update_printer_settings(
    db: State<'_, DatabaseConnection>,
    input: UpdatePrinterSettingsInput,
) -> Result<(), AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
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
    active.additional_info = Set(Some(serde_json::to_string(&info).map_err(|e| {
        AppError::Internal(format!("Gagal menyimpan pengaturan: {}", e))
    })?));
    active.updated_at = Set(Some(
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    ));
    active.update(db.inner()).await?;

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct PrinterSettingsResponse {
    pub printer_id: Option<String>,
    pub paper_width: Option<u8>,
    pub auto_print: Option<bool>,
    pub footer_text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReceiptDataResponse {
    pub store_name: String,
    pub store_address: Option<String>,
    pub store_phone: Option<String>,
    pub receipt_number: String,
    pub date_time: String,
    pub cashier_name: String,
    pub items: Vec<ReceiptItemResponse>,
    pub total_amount: f64,
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: f64,
    pub footer_text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReceiptItemResponse {
    pub name: String,
    pub quantity: i32,
    pub price: f64,
    pub subtotal: f64,
}

#[tauri::command]
pub async fn get_receipt_data(
    db: State<'_, DatabaseConnection>,
    transaction_id: i64,
) -> Result<ReceiptDataResponse, AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let settings = get_printer_settings(&store.additional_info);

    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db.inner())
        .await?;

    let user = users::Entity::find_by_id(transaction.user_id)
        .one(db.inner())
        .await?;
    let cashier_name = user
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".to_string());

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

    Ok(ReceiptDataResponse {
        store_name: store.name,
        store_address: store.address,
        store_phone: store.phone,
        receipt_number: transaction.receipt_number,
        date_time,
        cashier_name,
        items: receipt_items,
        total_amount: transaction.total_amount,
        payment_method: transaction.payment_method,
        payment_amount: transaction.payment_amount,
        change_amount: transaction.change_amount.unwrap_or(0.0),
        footer_text: settings.footer_text,
    })
}

#[tauri::command]
pub async fn get_printer_settings_cmd(
    db: State<'_, DatabaseConnection>,
) -> Result<PrinterSettingsResponse, AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?;

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
