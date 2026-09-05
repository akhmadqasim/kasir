use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::domain::ppob::*;
use crate::services;
use crate::services::ppob::client::MitraClient;
use crate::utils::AppError;

#[tauri::command]
pub async fn ppob_login(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<PpobSaldoResponse, AppError> {
    services::ppob::menu::saldo(db.inner(), mitra.inner()).await
}

#[tauri::command]
pub async fn ppob_get_saldo(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<PpobSaldoResponse, AppError> {
    services::ppob::menu::saldo(db.inner(), mitra.inner()).await
}

#[tauri::command]
pub async fn ppob_get_menu(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<PpobMenuGroup>, AppError> {
    services::ppob::menu::menu(db.inner(), mitra.inner()).await
}

#[tauri::command]
pub async fn ppob_get_providers(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<PulsaProvider>, AppError> {
    services::ppob::menu::providers(db.inner(), mitra.inner()).await
}

#[tauri::command]
pub async fn ppob_get_pulsa_details(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    phone_number: String,
) -> Result<PulsaDetailsResponse, AppError> {
    services::ppob::menu::pulsa_details(db.inner(), mitra.inner(), phone_number).await
}

#[tauri::command]
pub async fn ppob_get_pulsa_price_list(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    provider_uid: String,
) -> Result<Vec<PulsaProduct>, AppError> {
    services::ppob::menu::pulsa_price_list(db.inner(), mitra.inner(), provider_uid).await
}

#[tauri::command]
pub async fn ppob_get_data_price_list(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    provider_uid: String,
) -> Result<Vec<PulsaProduct>, AppError> {
    services::ppob::menu::data_price_list(db.inner(), mitra.inner(), provider_uid).await
}

#[tauri::command]
pub async fn ppob_get_pln_denom(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<PlnDenom>, AppError> {
    services::ppob::menu::pln_denom(db.inner(), mitra.inner()).await
}

#[tauri::command]
pub async fn ppob_get_pdam_products(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<PdamProduct>, AppError> {
    services::ppob::menu::pdam_products(db.inner(), mitra.inner()).await
}

#[tauri::command]
pub async fn ppob_get_emoney_denom(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    product_id: i64,
) -> Result<Vec<EmoneyDenom>, AppError> {
    services::ppob::menu::emoney_denom(db.inner(), mitra.inner(), product_id).await
}

#[tauri::command]
pub async fn ppob_get_pp_sub_menu(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    pp_id: i64,
) -> Result<Vec<PpSubMenuItem>, AppError> {
    services::ppob::menu::pp_sub_menu(db.inner(), mitra.inner(), pp_id).await
}

#[tauri::command]
pub async fn ppob_get_transfer_channels(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<TransferChannelGroup>, AppError> {
    services::ppob::menu::transfer_channels(db.inner(), mitra.inner()).await
}

#[tauri::command]
pub async fn ppob_get_voucher_groups(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<VoucherGroup>, AppError> {
    services::ppob::menu::voucher_groups(db.inner(), mitra.inner()).await
}
