use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::domain::ppob::NotificationListResult;
use crate::services;
use crate::services::ppob::client::MitraClient;
use crate::utils::AppError;

#[tauri::command]
pub async fn ppob_get_notifications(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    page: Option<i64>,
    per_page: Option<i64>,
    force_refresh: Option<bool>,
) -> Result<NotificationListResult, AppError> {
    services::ppob::notifications::list(db.inner(), mitra.inner(), page, per_page, force_refresh)
        .await
}

#[tauri::command]
pub async fn ppob_mark_all_read(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<(), AppError> {
    services::ppob::notifications::mark_all_read(db.inner(), mitra.inner()).await
}

#[tauri::command]
pub async fn ppob_mark_notification_read(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    inbox_id: String,
) -> Result<(), AppError> {
    services::ppob::notifications::mark_read(db.inner(), mitra.inner(), inbox_id).await
}
