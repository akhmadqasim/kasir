//! Store details, app settings, the admin's own PIN, and moving the database
//! file in and out.

use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::domain::settings::{
    clamp_ui_zoom, obfuscate, parse_app_settings, parse_ui_zoom, AppSettings, ChangePinInput,
    DatabaseInfo, PpobMarkup, PpobSettings, PublicAppSettings, UpdateAppSettingsInput,
    UpdatePpobCredentialsInput, UpdateStoreInfoInput, UI_ZOOM_DEFAULT,
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

pub(crate) fn now_ts() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub async fn get_store_info(
    db: &DatabaseConnection,
) -> Result<Option<store_info::Model>, AppError> {
    let info = store_info::Entity::find_by_id(1_i64).one(db).await?;
    Ok(info)
}

/// The singleton store row, or `NotFound` before onboarding has created it.
/// Every write to store details starts here.
pub(crate) async fn require_store_info(
    db: &DatabaseConnection,
) -> Result<store_info::Model, AppError> {
    get_store_info(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))
}

pub async fn update_store_info(
    db: &DatabaseConnection,
    actor: &Actor,
    input: UpdateStoreInfoInput,
) -> Result<store_info::Model, AppError> {
    guard::require_admin(actor)?;

    let store = require_store_info(db).await?;

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

/// Just the PPOB markup table, open to any logged-in session.
///
/// `GET /api/settings` is admin-only because it is the one place the PPOB
/// password and PIN used to leak; the markup that turns a vendor's cost into a
/// counter price is not a secret, and `PpobQuickAccess` is a cashier screen
/// that needs it to price a sale. Reusing [`get_app_settings`] and returning
/// only `ppob.markup` keeps this endpoint from ever being able to grow a
/// credential field by accident.
pub async fn ppob_markup(db: &DatabaseConnection) -> Result<PpobMarkup, AppError> {
    Ok(get_app_settings(db).await?.ppob.markup)
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

    // Obfuscate sensitive PPOB credentials before storing
    let mut ppob_to_store = settings.ppob.clone();
    ppob_to_store.password = obfuscate(&ppob_to_store.password);
    ppob_to_store.pin = obfuscate(&ppob_to_store.pin);

    let should_reset_ppob_session = merge_additional_info(db, |info| {
        let current_settings = parse_app_settings(&Some(info.to_string()));
        let should_reset = !settings.ppob.enabled
            || current_settings.ppob.enabled != settings.ppob.enabled
            || current_settings.ppob.phone_number != settings.ppob.phone_number
            || current_settings.ppob.password != settings.ppob.password
            || current_settings.ppob.device_id != settings.ppob.device_id
            || current_settings.ppob.pin != settings.ppob.pin;

        // Merge the four sections, preserving the printer and `ui` keys.
        info["sales"] = to_json(&settings.sales)?;
        info["security"] = to_json(&settings.security)?;
        info["ppob"] = to_json(&ppob_to_store)?;
        info["backup"] = to_json(&settings.backup)?;
        Ok(should_reset)
    })
    .await?;

    if should_reset_ppob_session {
        clear_tokens(db).await?;
        let mut client = mitra.lock().await;
        client.clear_auth();
    }

    Ok(())
}

/// The webview zoom the till window should open at. The default when the shop
/// has not been set up yet or nothing was ever saved.
pub async fn ui_zoom(db: &DatabaseConnection) -> Result<f64, AppError> {
    let store = store_info::Entity::find_by_id(1_i64).one(db).await?;
    Ok(store
        .map(|s| parse_ui_zoom(&s.additional_info))
        .unwrap_or(UI_ZOOM_DEFAULT))
}

/// Remember the webview zoom under `additional_info.ui.zoom`, next to the
/// printer keys and the settings sections, so a restart opens the window the
/// way it was left. Returns the factor as stored — clamped and rounded — so the
/// caller applies exactly what a restart will.
pub async fn save_ui_zoom(db: &DatabaseConnection, factor: f64) -> Result<f64, AppError> {
    let factor = clamp_ui_zoom(factor)
        .ok_or_else(|| AppError::Validation("Faktor zoom tidak valid.".into()))?;

    merge_additional_info(db, |info| {
        // `info["ui"]["zoom"] = …` builds the object when `ui` is absent but
        // panics when it holds a non-object, so anything that is not a section
        // is replaced.
        if !info["ui"].is_object() {
            info["ui"] = serde_json::json!({});
        }
        info["ui"]["zoom"] = serde_json::json!(factor);
        Ok(())
    })
    .await?;

    Ok(factor)
}

/// Read-modify-write on `store_info.additional_info`, the one JSON blob every
/// settings section shares: the four `AppSettings` sections, the printer keys
/// and `ui.zoom`. Each writer merges its own keys into `info` and leaves the
/// rest alone, so this is the only place that knows how the blob is loaded,
/// serialised and stamped.
///
/// `mutate` runs on the parsed blob (an empty object when the column is null
/// or unreadable) and its return value is handed back.
pub(crate) async fn merge_additional_info<T>(
    db: &DatabaseConnection,
    mutate: impl FnOnce(&mut serde_json::Value) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    // Valid JSON that is not an object (`[]`, `5`) would make `info["key"] = …`
    // panic, so it is treated like unreadable JSON: replaced by an empty one.
    let mut info: serde_json::Value = store
        .additional_info
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or(serde_json::json!({}));
    let out = mutate(&mut info)?;

    let mut active: store_info::ActiveModel = store.into();
    active.additional_info =
        Set(Some(serde_json::to_string(&info).map_err(|e| {
            AppError::Internal(format!("Gagal menyimpan pengaturan: {}", e))
        })?));
    active.updated_at = Set(Some(now_ts()));
    active.update(db).await?;

    Ok(out)
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<serde_json::Value, AppError> {
    serde_json::to_value(value)
        .map_err(|e| AppError::Internal(format!("Gagal serialisasi pengaturan: {}", e)))
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

/// The live database, ready to be sent to a browser.
pub struct DatabaseExport {
    /// Where to read the bytes from. Always the server's own database path —
    /// nothing a client sends contributes to it.
    pub path: std::path::PathBuf,
    /// What to put in `Content-Disposition`. Generated here, from the clock.
    pub filename: String,
}

/// Prepare a download of the live database.
///
/// [`export_database`] takes a destination path from its caller and copies the
/// file there. That is fine for a Tauri file dialog, whose path the user chose
/// through the OS, and it is a path-traversal hole the moment the caller is a
/// request body — an admin session could write a copy of the database anywhere
/// the process can reach, under any name.
///
/// There is no destination here at all. The server opens its own file and
/// streams it; the only thing the client influences is whether it saves what
/// arrives. The filename in the header is generated from the clock, so it is not
/// a path either.
pub fn prepare_export(actor: &Actor) -> Result<DatabaseExport, AppError> {
    guard::require_admin(actor)?;

    let db_path = get_db_path();
    if !db_path.exists() {
        return Err(AppError::NotFound("File database tidak ditemukan".into()));
    }

    // WAL is on, so everything committed since the last checkpoint lives in
    // `kasir.db-wal`. Sending `kasir.db` without checkpointing first silently
    // drops the day's sales from the export.
    backup::checkpoint_database_wal(&db_path);

    Ok(DatabaseExport {
        filename: format!(
            "kasir-export-{}.db",
            chrono::Local::now().format("%Y-%m-%d_%H%M%S")
        ),
        path: db_path,
    })
}

/// Install an uploaded database image, from bytes rather than from a path.
///
/// The counterpart to [`prepare_export`]: [`import_database`] is handed a path
/// and reads whatever is there, which over HTTP would let a request name any
/// file on the till as the new database. Here the bytes *are* the request. They
/// are checked for the SQLite header and staged next to the live file, to be
/// swapped in at the next launch — the same staging `restore` uses, and for the
/// same reason: the connection pool holds `kasir.db` open, so it cannot be
/// replaced while the app is running.
pub fn import_database_bytes(actor: &Actor, data: &[u8]) -> Result<String, AppError> {
    guard::require_admin(actor)?;

    backup::stage_restore_bytes(&get_db_path(), data)?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{insert_store_info, setup_test_db};

    #[tokio::test]
    async fn ui_zoom_defaults_before_the_shop_is_set_up_and_before_a_save() {
        let db = setup_test_db().await;
        assert_eq!(ui_zoom(&db).await.expect("read"), UI_ZOOM_DEFAULT);

        insert_store_info(&db, false).await;
        assert_eq!(ui_zoom(&db).await.expect("read"), UI_ZOOM_DEFAULT);
    }

    #[tokio::test]
    async fn ui_zoom_round_trips_through_the_settings_blob_without_touching_its_neighbours() {
        let db = setup_test_db().await;
        insert_store_info(&db, true).await;

        let stored = save_ui_zoom(&db, 1.5).await.expect("save");
        assert_eq!(stored, 1.5);
        assert_eq!(ui_zoom(&db).await.expect("read"), 1.5);

        // The sales section the fixture seeded is still there.
        let settings = get_app_settings(&db).await.expect("settings");
        assert!(settings.sales.allow_negative_stock);
    }

    #[tokio::test]
    async fn ui_zoom_is_stored_clamped() {
        let db = setup_test_db().await;
        insert_store_info(&db, false).await;

        assert_eq!(save_ui_zoom(&db, 5.0).await.expect("save"), 2.0);
        assert_eq!(ui_zoom(&db).await.expect("read"), 2.0);

        assert_eq!(save_ui_zoom(&db, 0.0).await.expect("save"), 0.5);
        assert_eq!(ui_zoom(&db).await.expect("read"), 0.5);
    }

    #[tokio::test]
    async fn a_zoom_that_is_not_a_number_is_refused() {
        let db = setup_test_db().await;
        insert_store_info(&db, false).await;

        let err = save_ui_zoom(&db, f64::NAN).await.expect_err("refused");
        assert!(matches!(err, AppError::Validation(_)));
        assert_eq!(ui_zoom(&db).await.expect("read"), UI_ZOOM_DEFAULT);
    }

    /// `additional_info` that parses but is not an object must not panic the
    /// merge; it is replaced the way unreadable JSON is.
    #[tokio::test]
    async fn a_non_object_settings_blob_is_replaced_rather_than_indexed() {
        let db = setup_test_db().await;
        let store = insert_store_info(&db, false).await;
        let mut active: store_info::ActiveModel = store.into();
        active.additional_info = Set(Some("[1,2]".into()));
        active.update(&db).await.expect("seed");

        assert_eq!(save_ui_zoom(&db, 1.3).await.expect("save"), 1.3);
        assert_eq!(ui_zoom(&db).await.expect("read"), 1.3);
    }

    #[tokio::test]
    async fn saving_zoom_before_onboarding_is_a_not_found() {
        let db = setup_test_db().await;
        let err = save_ui_zoom(&db, 1.2).await.expect_err("no store row");
        assert!(matches!(err, AppError::NotFound(_)));
    }
}
