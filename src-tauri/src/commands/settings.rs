use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::domain::settings::{obfuscate, parse_app_settings, AppSettings, DatabaseInfo};
use crate::entity::{store_info, users};
use crate::utils::require_role;
use crate::utils::AppError;

use crate::services::ppob::auth::clear_tokens;
use crate::services::ppob::client::MitraClient;

fn get_db_path() -> std::path::PathBuf {
    crate::utils::paths::get_db_path()
}

#[tauri::command]
pub async fn get_store_info(
    db: State<'_, DatabaseConnection>,
) -> Result<Option<store_info::Model>, AppError> {
    let info = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?;
    Ok(info)
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
    require_role(db.inner(), caller_id, "admin").await?;

    let store = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let mut active: store_info::ActiveModel = store.into();
    active.name = Set(name);
    active.address = Set(address);
    active.phone = Set(phone);
    active.email = Set(email);
    active.updated_at = Set(Some(
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    ));

    let updated = active.update(db.inner()).await?;
    Ok(updated)
}

#[tauri::command]
pub async fn get_app_settings(db: State<'_, DatabaseConnection>) -> Result<AppSettings, AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?;

    let settings = store
        .map(|s| parse_app_settings(&s.additional_info))
        .unwrap_or_default();

    Ok(settings)
}

#[tauri::command]
pub async fn update_app_settings(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    settings: AppSettings,
) -> Result<(), AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    // Write boundary for the backup scheduler's inputs. An interval of zero
    // panics `tokio::time::interval` inside the scheduler's spawned task, and a
    // negative retention makes cleanup delete the backup that was just written —
    // both fail silently, so they are refused here rather than discovered later.
    settings.backup.validate()?;

    let store = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let mut info: serde_json::Value = store
        .additional_info
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));
    let current_settings = parse_app_settings(&store.additional_info);
    let should_reset_ppob_session = !settings.ppob.enabled
        || current_settings.ppob.enabled != settings.ppob.enabled
        || current_settings.ppob.phone_number != settings.ppob.phone_number
        || current_settings.ppob.password != settings.ppob.password
        || current_settings.ppob.device_id != settings.ppob.device_id
        || current_settings.ppob.pin != settings.ppob.pin;

    // Obfuscate sensitive PPOB credentials before storing
    let mut ppob_to_store = settings.ppob.clone();
    ppob_to_store.password = obfuscate(&ppob_to_store.password);
    ppob_to_store.pin = obfuscate(&ppob_to_store.pin);

    // Merge sales and security keys, preserving existing printer keys
    info["sales"] = serde_json::to_value(&settings.sales)
        .map_err(|e| AppError::Internal(format!("Gagal serialisasi pengaturan: {}", e)))?;
    info["security"] = serde_json::to_value(&settings.security)
        .map_err(|e| AppError::Internal(format!("Gagal serialisasi pengaturan: {}", e)))?;
    info["ppob"] = serde_json::to_value(&ppob_to_store)
        .map_err(|e| AppError::Internal(format!("Gagal serialisasi pengaturan: {}", e)))?;
    info["backup"] = serde_json::to_value(&settings.backup)
        .map_err(|e| AppError::Internal(format!("Gagal serialisasi pengaturan: {}", e)))?;

    let mut active: store_info::ActiveModel = store.into();
    active.additional_info =
        Set(Some(serde_json::to_string(&info).map_err(|e| {
            AppError::Internal(format!("Gagal menyimpan pengaturan: {}", e))
        })?));
    active.updated_at = Set(Some(
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    ));
    active.update(db.inner()).await?;

    if should_reset_ppob_session {
        clear_tokens(db.inner()).await?;
        let mut client = mitra.lock().await;
        client.clear_auth();
    }

    Ok(())
}

#[tauri::command]
pub async fn change_user_pin(
    db: State<'_, DatabaseConnection>,
    user_id: i64,
    current_pin: String,
    new_pin: String,
) -> Result<(), AppError> {
    let user = users::Entity::find_by_id(user_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    // Verify current PIN
    let pin_valid = bcrypt::verify(&current_pin, &user.pin_hash)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !pin_valid {
        return Err(AppError::Auth("PIN saat ini tidak sesuai".into()));
    }

    // Validate new PIN: 4-6 digits
    if new_pin.len() < 4 || new_pin.len() > 6 || !new_pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation(
            "PIN baru harus terdiri dari 4-6 digit angka".into(),
        ));
    }

    // Hash and save
    let new_hash = bcrypt::hash(&new_pin, bcrypt::DEFAULT_COST)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut active: users::ActiveModel = user.into();
    active.pin_hash = Set(new_hash);
    active.updated_at = Set(Some(
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    ));
    active.update(db.inner()).await?;

    Ok(())
}

#[tauri::command]
pub async fn export_database(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    export_path: String,
) -> Result<u64, AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let db_path = get_db_path();

    if !db_path.exists() {
        return Err(AppError::NotFound("File database tidak ditemukan".into()));
    }

    // B18: WAL is on, so everything committed since the last checkpoint lives in
    // `kasir.db-wal` and a bare copy of `kasir.db` leaves it behind — silently
    // losing the day's sales in the very flow the UI banner recommends for
    // moving between versions. `create_backup_file` already did this correctly.
    crate::services::backup::checkpoint_database_wal(&db_path);

    std::fs::copy(&db_path, &export_path)
        .map_err(|e| AppError::Internal(format!("Gagal mengekspor database: {}", e)))
}

#[tauri::command]
pub async fn import_database(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    import_path: String,
) -> Result<String, AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let import = std::path::Path::new(&import_path);

    if !import.exists() {
        return Err(AppError::NotFound("File import tidak ditemukan".into()));
    }

    let db_path = get_db_path();

    // B19: this used to `fs::copy` straight over the live `kasir.db`. The
    // sea-orm pool still holds that file open, and the old `-wal`/`-shm`
    // survived, so the previous WAL was replayed over the import on the next
    // start. Staging the file makes the swap happen in `run()` before the pool
    // exists, with the sidecars removed; the header is checked first so a file
    // that is not a database is refused instead of bricking the app.
    crate::services::backup::stage_restore_from_file(&db_path, import)?;

    Ok("Database berhasil diimpor. Tutup dan buka kembali aplikasi untuk menerapkannya.".into())
}

#[tauri::command]
pub async fn get_database_info() -> Result<DatabaseInfo, AppError> {
    let db_path = get_db_path();

    if !db_path.exists() {
        return Err(AppError::NotFound("File database tidak ditemukan".into()));
    }

    let metadata = std::fs::metadata(&db_path)
        .map_err(|e| AppError::Internal(format!("Gagal membaca info database: {}", e)))?;

    Ok(DatabaseInfo {
        size_bytes: metadata.len(),
        path: db_path.to_string_lossy().to_string(),
    })
}
