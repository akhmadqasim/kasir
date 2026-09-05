//! Store details, app settings, the admin's own PIN, and moving the database
//! file in and out.

use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::domain::settings::{
    obfuscate, parse_app_settings, AppSettings, ChangePinInput, DatabaseInfo, PpobSettings,
    PublicAppSettings, UpdateAppSettingsInput, UpdatePpobCredentialsInput, UpdateStoreInfoInput,
};
use crate::domain::Actor;
use crate::entity::{store_info, users};
use crate::services::backup;
use crate::services::guard;
use crate::services::ppob::auth::clear_tokens;
use crate::services::ppob::client::MitraClient;
use crate::utils::AppError;

fn get_db_path() -> std::path::PathBuf {
    crate::utils::paths::get_db_path()
}

fn now_ts() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub async fn get_store_info(
    db: &DatabaseConnection,
) -> Result<Option<store_info::Model>, AppError> {
    let info = store_info::Entity::find_by_id(1_i64).one(db).await?;
    Ok(info)
}

pub async fn update_store_info(
    db: &DatabaseConnection,
    actor: &Actor,
    input: UpdateStoreInfoInput,
) -> Result<store_info::Model, AppError> {
    guard::require_admin(actor)?;

    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let mut active: store_info::ActiveModel = store.into();
    active.name = Set(input.name);
    active.address = Set(input.address);
    active.phone = Set(input.phone);
    active.email = Set(input.email);
    active.updated_at = Set(Some(now_ts()));

    let updated = active.update(db).await?;
    Ok(updated)
}

pub async fn get_app_settings(db: &DatabaseConnection) -> Result<AppSettings, AppError> {
    let store = store_info::Entity::find_by_id(1_i64).one(db).await?;

    let settings = store
        .map(|s| parse_app_settings(&s.additional_info))
        .unwrap_or_default();

    Ok(settings)
}

/// The settings with the PPOB credentials removed, for a caller that is not the
/// PPOB executor.
///
/// [`get_app_settings`] hands back `ppob.password` and `ppob.pin` in the clear
/// and checks no role at all, which was survivable while the only caller was a
/// local webview. It is not survivable on a LAN. Every transport-facing read
/// goes through this instead.
pub async fn public_app_settings(
    db: &DatabaseConnection,
    actor: &Actor,
) -> Result<PublicAppSettings, AppError> {
    guard::require_admin(actor)?;
    Ok(PublicAppSettings::from(get_app_settings(db).await?))
}

/// Save the settings a client is allowed to send, keeping the stored PPOB
/// credentials.
///
/// The client never sees the password and PIN, so it cannot send them back —
/// which means a settings save that did not carry them would otherwise wipe
/// them. They are read from the database and put back unchanged.
pub async fn update_public_app_settings(
    db: &DatabaseConnection,
    actor: &Actor,
    mitra: &Arc<Mutex<MitraClient>>,
    input: UpdateAppSettingsInput,
) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    let stored = get_app_settings(db).await?;
    let settings = AppSettings {
        sales: input.sales,
        security: input.security,
        ppob: PpobSettings {
            enabled: input.ppob.enabled,
            phone_number: input.ppob.phone_number,
            device_id: input.ppob.device_id,
            password: stored.ppob.password,
            pin: stored.ppob.pin,
            markup: input.ppob.markup,
        },
        backup: input.backup,
    };

    update_app_settings(db, actor, mitra, settings).await
}

/// Set the PPOB credentials. The only write that can change them.
pub async fn update_ppob_credentials(
    db: &DatabaseConnection,
    actor: &Actor,
    mitra: &Arc<Mutex<MitraClient>>,
    input: UpdatePpobCredentialsInput,
) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    let mut settings = get_app_settings(db).await?;
    settings.ppob.password = input.password;
    settings.ppob.pin = input.pin;

    update_app_settings(db, actor, mitra, settings).await
}

/// Save the settings blob, then drop the cached Mitra session if anything the
/// session depends on changed.
pub async fn update_app_settings(
    db: &DatabaseConnection,
    actor: &Actor,
    mitra: &Arc<Mutex<MitraClient>>,
    settings: AppSettings,
) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    // Write boundary for the backup scheduler's inputs. An interval of zero
    // panics `tokio::time::interval` inside the scheduler's spawned task, and a
    // negative retention makes cleanup delete the backup that was just written —
    // both fail silently, so they are refused here rather than discovered later.
    settings.backup.validate()?;

    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
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
    active.updated_at = Set(Some(now_ts()));
    active.update(db).await?;

    if should_reset_ppob_session {
        clear_tokens(db).await?;
        let mut client = mitra.lock().await;
        client.clear_auth();
    }

    Ok(())
}

/// Change the actor's own PIN. The current PIN is the proof of identity here, so
/// this is the one privileged action that does not need a role.
pub async fn change_pin(
    db: &DatabaseConnection,
    actor: &Actor,
    input: ChangePinInput,
) -> Result<(), AppError> {
    let user = users::Entity::find_by_id(actor.user_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    // Verify current PIN
    let pin_valid = bcrypt::verify(&input.current_pin, &user.pin_hash)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !pin_valid {
        return Err(AppError::Auth("PIN saat ini tidak sesuai".into()));
    }

    // Validate new PIN: 4-6 digits
    if input.new_pin.len() < 4
        || input.new_pin.len() > 6
        || !input.new_pin.chars().all(|c| c.is_ascii_digit())
    {
        return Err(AppError::Validation(
            "PIN baru harus terdiri dari 4-6 digit angka".into(),
        ));
    }

    // Hash and save
    let new_hash = bcrypt::hash(&input.new_pin, bcrypt::DEFAULT_COST)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut active: users::ActiveModel = user.into();
    active.pin_hash = Set(new_hash);
    active.updated_at = Set(Some(now_ts()));
    active.update(db).await?;

    Ok(())
}

/// Copy the live database to `export_path`, returning the bytes written.
pub fn export_database(actor: &Actor, export_path: &str) -> Result<u64, AppError> {
    guard::require_admin(actor)?;

    let db_path = get_db_path();

    if !db_path.exists() {
        return Err(AppError::NotFound("File database tidak ditemukan".into()));
    }

    // B18: WAL is on, so everything committed since the last checkpoint lives in
    // `kasir.db-wal` and a bare copy of `kasir.db` leaves it behind — silently
    // losing the day's sales in the very flow the UI banner recommends for
    // moving between versions. `create_backup_file` already did this correctly.
    backup::checkpoint_database_wal(&db_path);

    std::fs::copy(&db_path, export_path)
        .map_err(|e| AppError::Internal(format!("Gagal mengekspor database: {}", e)))
}

pub fn import_database(actor: &Actor, import_path: &str) -> Result<String, AppError> {
    guard::require_admin(actor)?;

    let import = std::path::Path::new(import_path);

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
    backup::stage_restore_from_file(&db_path, import)?;

    Ok("Database berhasil diimpor. Tutup dan buka kembali aplikasi untuk menerapkannya.".into())
}

pub fn database_info() -> Result<DatabaseInfo, AppError> {
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
