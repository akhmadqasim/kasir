use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::domain::ppob::{HistoryDetailItem, HistoryPaymentItem, MutasiItem};
use crate::services;
use crate::services::ppob::client::MitraClient;
use crate::utils::AppError;

#[tauri::command]
pub async fn ppob_get_history(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    start_date: String,
    end_date: String,
) -> Result<Vec<HistoryPaymentItem>, AppError> {
    services::ppob::history::list(db.inner(), mitra.inner(), start_date, end_date).await
}

#[tauri::command]
pub async fn ppob_get_history_detail(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    trx_id: String,
) -> Result<HistoryDetailItem, AppError> {
    services::ppob::history::detail(db.inner(), mitra.inner(), trx_id).await
}

#[tauri::command]
pub async fn ppob_get_mutasi(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    start_date: String,
    end_date: String,
) -> Result<Vec<MutasiItem>, AppError> {
    services::ppob::history::mutasi(db.inner(), mitra.inner(), start_date, end_date).await
}
