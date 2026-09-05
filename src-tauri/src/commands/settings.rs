use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::entity::{store_info, users};
use crate::utils::require_role;
use crate::utils::AppError;

use super::ppob::auth::clear_tokens;
use super::ppob::client::MitraClient;

// Simple obfuscation for sensitive fields stored in DB
// Prevents plaintext credential exposure in database files
const OBFUSCATION_KEY: &[u8] = b"kasir-pos-2025-secure";

fn obfuscate(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }
    let bytes: Vec<u8> = input
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect();
    format!(
        "OBF:{}",
        bytes
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>()
    )
}

/// Decode an even-length ASCII hex string, or `None` if it is not one.
///
/// The caller used to index `&hex[i..i + 2]` for every `i` in
/// `(0..hex.len()).step_by(2)`, which panics on the last pair of an odd-length
/// payload and on any non-ASCII byte that a 2-byte window splits. Checking the
/// shape up front makes both impossible.
fn hex_to_bytes(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) || !hex.is_ascii() {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

/// Reverse [`obfuscate`]. Values without the marker are legacy plaintext and are
/// returned unchanged.
///
/// A corrupt `OBF:` payload yields an empty string rather than a panic.
/// `parse_app_settings` is on the path of `get_app_settings`,
/// `update_app_settings`, `ppob/executor.rs` and `ppob/inquiry.rs`, so a single
/// truncated character in `store_info.additional_info` used to take out PPOB and
/// the entire Settings page. Empty (rather than the raw ciphertext) is returned
/// so the admin sees a blank field to re-enter instead of garbage they might
/// save back and obfuscate a second time.
fn deobfuscate(input: &str) -> String {
    let Some(hex) = input.strip_prefix("OBF:") else {
        // Not obfuscated (legacy data) — return as-is
        return input.to_string();
    };

    let Some(bytes) = hex_to_bytes(hex) else {
        return String::new();
    };

    let plain: Vec<u8> = bytes
        .into_iter()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect();

    String::from_utf8(plain).unwrap_or_default()
}

// --- App Settings structs ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SalesSettings {
    pub allow_negative_stock: bool,
    pub default_payment_method: String,
}

impl Default for SalesSettings {
    fn default() -> Self {
        Self {
            allow_negative_stock: true,
            default_payment_method: "cash".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SecuritySettings {
    pub session_timeout_minutes: i32,
}

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            session_timeout_minutes: 30,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PpobMarkupConfig {
    #[serde(rename = "type")]
    pub markup_type: String, // "fixed" or "percentage"
    pub value: f64,
}

impl Default for PpobMarkupConfig {
    fn default() -> Self {
        Self {
            markup_type: "fixed".to_string(),
            value: 0.0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PpobMarkup {
    #[serde(default)]
    pub pulsa: PpobMarkupConfig,
    #[serde(default)]
    pub data: PpobMarkupConfig,
    #[serde(default)]
    pub pln: PpobMarkupConfig,
    #[serde(default)]
    pub pdam: PpobMarkupConfig,
    #[serde(default)]
    pub bpjs: PpobMarkupConfig,
    #[serde(default)]
    pub emoney: PpobMarkupConfig,
    #[serde(default)]
    pub custom_prices: std::collections::HashMap<String, f64>,
}

impl Default for PpobMarkup {
    fn default() -> Self {
        Self {
            pulsa: PpobMarkupConfig::default(),
            data: PpobMarkupConfig::default(),
            pln: PpobMarkupConfig::default(),
            pdam: PpobMarkupConfig::default(),
            bpjs: PpobMarkupConfig::default(),
            emoney: PpobMarkupConfig::default(),
            custom_prices: std::collections::HashMap::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PpobSettings {
    pub enabled: bool,
    pub phone_number: String,
    pub password: String,
    pub device_id: String,
    pub pin: String,
    #[serde(default)]
    pub markup: PpobMarkup,
}

impl Default for PpobSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            phone_number: String::new(),
            password: String::new(),
            device_id: String::new(),
            pin: String::new(),
            markup: PpobMarkup::default(),
        }
    }
}

use super::backup::BackupSettings;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub sales: SalesSettings,
    pub security: SecuritySettings,
    pub ppob: PpobSettings,
    pub backup: BackupSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            sales: SalesSettings::default(),
            security: SecuritySettings::default(),
            ppob: PpobSettings::default(),
            backup: BackupSettings::default(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct DatabaseInfo {
    pub size_bytes: u64,
    pub path: String,
}

// --- Helper: get database path ---

fn get_db_path() -> std::path::PathBuf {
    crate::utils::paths::get_db_path()
}

// --- Helper: parse AppSettings from additional_info JSON ---

pub fn parse_app_settings(additional_info: &Option<String>) -> AppSettings {
    let json: serde_json::Value = additional_info
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));

    let sales = json
        .get("sales")
        .and_then(|v| serde_json::from_value::<SalesSettings>(v.clone()).ok())
        .unwrap_or_default();

    let security = json
        .get("security")
        .and_then(|v| serde_json::from_value::<SecuritySettings>(v.clone()).ok())
        .unwrap_or_default();

    let ppob = json
        .get("ppob")
        .and_then(|v| serde_json::from_value::<PpobSettings>(v.clone()).ok())
        .map(|mut p| {
            // Deobfuscate sensitive fields when reading from DB
            p.password = deobfuscate(&p.password);
            p.pin = deobfuscate(&p.pin);
            p
        })
        .unwrap_or_default();

    let backup = json
        .get("backup")
        .and_then(|v| serde_json::from_value::<BackupSettings>(v.clone()).ok())
        .unwrap_or_default();

    AppSettings {
        sales,
        security,
        ppob,
        backup,
    }
}

// --- Commands ---

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
    super::backup::checkpoint_database_wal(&db_path);

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
    super::backup::stage_restore_from_file(&db_path, import)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obfuscation_round_trips() {
        for value in [
            "",
            "0812345678",
            "rahasia123",
            "p@ssw0rd!",
            "081-\u{e9}\u{2014}",
        ] {
            assert_eq!(deobfuscate(&obfuscate(value)), value);
        }
    }

    /// An odd number of hex characters made `&hex[i..i + 2]` run past the end of
    /// the string. `parse_app_settings` is called from `get_app_settings`,
    /// `update_app_settings`, `ppob/executor.rs` and `ppob/inquiry.rs`, so this
    /// panic disabled PPOB and the whole Settings page at once.
    #[test]
    fn deobfuscate_survives_an_odd_length_payload() {
        assert_eq!(deobfuscate("OBF:1b2c3"), "");
        assert_eq!(deobfuscate("OBF:a"), "");
    }

    #[test]
    fn deobfuscate_survives_junk_payloads() {
        assert_eq!(deobfuscate("OBF:zzzz"), "");
        assert_eq!(deobfuscate("OBF:\u{e9}\u{e9}"), "");
        assert_eq!(deobfuscate("OBF:"), "");
    }

    /// Values stored before obfuscation existed have no marker and must come
    /// back untouched.
    #[test]
    fn deobfuscate_passes_legacy_plaintext_through() {
        assert_eq!(deobfuscate("rahasia123"), "rahasia123");
        assert_eq!(deobfuscate(""), "");
    }

    /// A corrupt PPOB block must not take the rest of the settings with it.
    #[test]
    fn parse_app_settings_survives_a_corrupt_credential() {
        let json = serde_json::json!({
            "sales": { "allow_negative_stock": false, "default_payment_method": "qris" },
            "ppob": {
                "enabled": true,
                "phone_number": "0812",
                "password": "OBF:1b2c3",
                "device_id": "dev",
                "pin": "OBF:zzz"
            },
            "backup": { "interval_hours": 6, "retention_days": 30 }
        })
        .to_string();

        let settings = parse_app_settings(&Some(json));
        assert_eq!(settings.sales.default_payment_method, "qris");
        assert!(!settings.sales.allow_negative_stock);
        assert_eq!(settings.backup.interval_hours, 6);
        assert_eq!(settings.ppob.phone_number, "0812");
        assert_eq!(settings.ppob.password, "");
        assert_eq!(settings.ppob.pin, "");
    }

    #[test]
    fn hex_to_bytes_only_accepts_even_length_ascii_hex() {
        assert_eq!(hex_to_bytes("0a1b"), Some(vec![0x0a, 0x1b]));
        assert_eq!(hex_to_bytes(""), Some(vec![]));
        assert_eq!(hex_to_bytes("0a1"), None);
        assert_eq!(hex_to_bytes("0g"), None);
        assert_eq!(hex_to_bytes("\u{e9}\u{e9}"), None);
    }
}
