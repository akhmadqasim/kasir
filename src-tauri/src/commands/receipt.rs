use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::entity::{store_info, transaction_items, transactions, users};
use crate::printing::receipt::{format_receipt, format_test_page, ReceiptData, ReceiptItem};
use crate::utils::AppError;

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

/// Send data to printer based on printer_id format
/// USB printers: "USB:XXXX:XXXX" (vendor:product hex)
/// Windows printers: anything else (printer name)
fn send_to_printer(printer_id: &str, data: &[u8]) -> Result<(), String> {
    if let Some(usb_ids) = printer_id.strip_prefix("USB:") {
        let parts: Vec<&str> = usb_ids.split(':').collect();
        if parts.len() != 2 {
            return Err("Format USB printer ID tidak valid".to_string());
        }
        let vendor_id =
            u16::from_str_radix(parts[0], 16).map_err(|_| "Vendor ID tidak valid".to_string())?;
        let product_id = u16::from_str_radix(parts[1], 16)
            .map_err(|_| "Product ID tidak valid".to_string())?;

        crate::printing::usb_printer::send_raw_data(vendor_id, product_id, data)
    } else {
        #[cfg(windows)]
        {
            crate::printing::windows_printer::send_raw_data(printer_id, data)
        }
        #[cfg(not(windows))]
        {
            Err("Windows printer tidak tersedia di platform ini".to_string())
        }
    }
}

#[tauri::command]
pub async fn list_printers() -> Result<Vec<PrinterInfoItem>, AppError> {
    let mut all_printers = Vec::new();

    // List Windows printers only (USB Direct not supported on Windows)
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

    Ok(all_printers)
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
        .and_then(|dt| {
            chrono::NaiveDateTime::parse_from_str(dt, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|ndt| ndt.format("%d/%m/%Y %H:%M").to_string())
        })
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

    let bytes = format_receipt(&receipt_data, paper_width);

    send_to_printer(&printer_id, &bytes).map_err(|e| AppError::Internal(e))?;

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

    let bytes = format_test_page(&store.name, paper_width);

    send_to_printer(&printer_id, &bytes).map_err(|e| AppError::Internal(e))?;

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
