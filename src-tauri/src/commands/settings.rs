use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::entity::{store_info, users};
use crate::utils::AppError;
use crate::utils::require_role;

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
    format!("OBF:{}", bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>())
}

fn deobfuscate(input: &str) -> String {
    if let Some(hex) = input.strip_prefix("OBF:") {
        let bytes: Vec<u8> = (0..hex.len())
            .step_by(2)
            .filter_map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
            .enumerate()
            .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
            .collect();
        String::from_utf8(bytes).unwrap_or_else(|_| input.to_string())
    } else {
        // Not obfuscated (legacy data) — return as-is
        input.to_string()
    }
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
    let data_dir = std::env::current_dir()
        .unwrap_or_default()
        .parent()
        .map(|p| p.join("data"))
        .unwrap_or_else(|| std::path::PathBuf::from("data"));
    data_dir.join("kasir.db")
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

    let store = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let mut info: serde_json::Value = store
        .additional_info
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));

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

    // Clear Mitra token so next request uses updated credentials
    {
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
pub async fn export_database(db: State<'_, DatabaseConnection>, caller_id: i64, export_path: String) -> Result<u64, AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let db_path = get_db_path();

    if !db_path.exists() {
        return Err(AppError::NotFound("File database tidak ditemukan".into()));
    }

    std::fs::copy(&db_path, &export_path)
        .map_err(|e| AppError::Internal(format!("Gagal mengekspor database: {}", e)))
}

#[tauri::command]
pub async fn import_database(db: State<'_, DatabaseConnection>, caller_id: i64, import_path: String) -> Result<String, AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let import = std::path::Path::new(&import_path);

    if !import.exists() {
        return Err(AppError::NotFound("File import tidak ditemukan".into()));
    }

    let db_path = get_db_path();

    std::fs::copy(import, &db_path)
        .map_err(|e| AppError::Internal(format!("Gagal mengimpor database: {}", e)))?;

    Ok("Database berhasil diimpor. Silakan restart aplikasi.".into())
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
