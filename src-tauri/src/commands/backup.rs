use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use sea_orm::DatabaseConnection;

use crate::commands::resolve_actor;
use crate::domain::backup::{BackupInfo, BackupStatus};
use crate::services;
use crate::services::backup::BackupScheduler;
use crate::utils::AppError;

/// Spawn the background backup schedule. Called once from `run()`; the schedule
/// itself lives in the service, this only chooses the runtime it runs on.
pub fn start_backup_scheduler(scheduler: Arc<Mutex<BackupScheduler>>) {
    tauri::async_runtime::spawn(services::backup::run_scheduler(scheduler));
}

#[tauri::command]
pub async fn create_backup(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    scheduler: State<'_, Arc<Mutex<BackupScheduler>>>,
) -> Result<BackupInfo, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::backup::create(&actor, scheduler.inner()).await
}

#[tauri::command]
pub async fn get_backup_status(
    scheduler: State<'_, Arc<Mutex<BackupScheduler>>>,
) -> Result<BackupStatus, AppError> {
    services::backup::status(scheduler.inner()).await
}

#[tauri::command]
pub async fn list_backups() -> Result<Vec<BackupInfo>, AppError> {
    services::backup::list()
}

#[tauri::command]
pub async fn restore_backup(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    filename: String,
) -> Result<String, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::backup::restore(&actor, &filename)
}

#[tauri::command]
pub async fn delete_backup(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    filename: String,
) -> Result<(), AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::backup::delete(&actor, &filename)
}
