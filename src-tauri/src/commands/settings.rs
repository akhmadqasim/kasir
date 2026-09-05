use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::commands::resolve_actor;
use crate::domain::settings::{AppSettings, ChangePinInput, DatabaseInfo, UpdateStoreInfoInput};
use crate::domain::Actor;
use crate::entity::store_info;
use crate::services;
use crate::services::ppob::client::MitraClient;
use crate::utils::AppError;

#[tauri::command]
pub async fn get_store_info(
    db: State<'_, DatabaseConnection>,
) -> Result<Option<store_info::Model>, AppError> {
    services::settings::get_store_info(db.inner()).await
}

#[tauri::command]
pub async fn update_store_info(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    name: String,
    address: Option<String>,
    phone: Option<String>,
    email: Option<String>,
) -> Result<store_info::Model, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::settings::update_store_info(
        db.inner(),
        &actor,
        UpdateStoreInfoInput {
            name,
            address,
            phone,
            email,
        },
    )
    .await
}

#[tauri::command]
pub async fn get_app_settings(db: State<'_, DatabaseConnection>) -> Result<AppSettings, AppError> {
    services::settings::get_app_settings(db.inner()).await
}

#[tauri::command]
pub async fn update_app_settings(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    settings: AppSettings,
) -> Result<(), AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::settings::update_app_settings(db.inner(), &actor, mitra.inner(), settings).await
}

#[tauri::command]
pub async fn change_user_pin(
    db: State<'_, DatabaseConnection>,
    user_id: i64,
    current_pin: String,
    new_pin: String,
) -> Result<(), AppError> {
    // The current PIN is what proves the identity here, so the id is passed
    // through unverified exactly as it was before.
    let actor = Actor::unverified(user_id);
    services::settings::change_pin(
        db.inner(),
        &actor,
        ChangePinInput {
            current_pin,
            new_pin,
        },
    )
    .await
}

#[tauri::command]
pub async fn export_database(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    export_path: String,
) -> Result<u64, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::settings::export_database(&actor, &export_path)
}

#[tauri::command]
pub async fn import_database(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    import_path: String,
) -> Result<String, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::settings::import_database(&actor, &import_path)
}

#[tauri::command]
pub async fn get_database_info() -> Result<DatabaseInfo, AppError> {
    services::settings::database_info()
}
