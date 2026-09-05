use sea_orm::DatabaseConnection;
use tauri::State;

use crate::domain::receipt::{
    PrinterInfoItem, PrinterSettingsResponse, ReceiptDataResponse, UpdatePrinterSettingsInput,
};
use crate::services;
use crate::utils::AppError;

#[tauri::command]
pub async fn list_printers() -> Result<Vec<PrinterInfoItem>, AppError> {
    services::receipt::list_printers().await
}

#[tauri::command]
pub async fn print_receipt(
    db: State<'_, DatabaseConnection>,
    transaction_id: i64,
) -> Result<(), AppError> {
    services::receipt::print(db.inner(), transaction_id).await
}

#[tauri::command]
pub async fn test_print(db: State<'_, DatabaseConnection>) -> Result<(), AppError> {
    services::receipt::test_print(db.inner()).await
}

#[tauri::command]
pub async fn update_printer_settings(
    db: State<'_, DatabaseConnection>,
    input: UpdatePrinterSettingsInput,
) -> Result<(), AppError> {
    services::receipt::update_printer_settings(db.inner(), input).await
}

#[tauri::command]
pub async fn get_printer_settings_cmd(
    db: State<'_, DatabaseConnection>,
) -> Result<PrinterSettingsResponse, AppError> {
    services::receipt::printer_settings(db.inner()).await
}

#[tauri::command]
pub async fn get_receipt_data(
    db: State<'_, DatabaseConnection>,
    transaction_id: i64,
) -> Result<ReceiptDataResponse, AppError> {
    services::receipt::receipt_data(db.inner(), transaction_id).await
}
