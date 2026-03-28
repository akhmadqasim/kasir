use chrono::Local;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::utils::AppError;

const DEFAULT_INTERVAL_HOURS: u64 = 3;
const DEFAULT_RETENTION_DAYS: i64 = 90;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupSettings {
    pub interval_hours: u64,
    pub retention_days: i64,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            interval_hours: DEFAULT_INTERVAL_HOURS,
            retention_days: DEFAULT_RETENTION_DAYS,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct BackupInfo {
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct BackupStatus {
    pub last_backup: Option<BackupInfo>,
    pub total_backups: usize,
    pub total_size_bytes: u64,
    pub backup_dir: String,
    pub settings: BackupSettings,
}

/// Get the database file path
fn get_db_path() -> PathBuf {
    let data_dir = std::env::current_dir()
        .unwrap_or_default()
        .parent()
        .map(|p| p.join("data"))
        .unwrap_or_else(|| PathBuf::from("data"));
    data_dir.join("kasir.db")
}

/// Get the backup directory (data/backups/)
fn get_backup_dir() -> PathBuf {
    let data_dir = std::env::current_dir()
        .unwrap_or_default()
        .parent()
        .map(|p| p.join("data"))
        .unwrap_or_else(|| PathBuf::from("data"));
    data_dir.join("backups")
}

/// Create a compressed backup of the database
fn create_backup_file(db_path: &Path, backup_dir: &Path) -> Result<BackupInfo, AppError> {
    fs::create_dir_all(backup_dir)
        .map_err(|e| AppError::Internal(format!("Gagal membuat folder backup: {}", e)))?;

    let now = Local::now();
    let filename = format!("kasir_{}.db.gz", now.format("%Y-%m-%d"));
    let backup_path = backup_dir.join(&filename);

    // Read the database file
    let mut db_file = fs::File::open(db_path)
        .map_err(|e| AppError::Internal(format!("Gagal membaca database: {}", e)))?;
    let mut db_data = Vec::new();
    db_file
        .read_to_end(&mut db_data)
        .map_err(|e| AppError::Internal(format!("Gagal membaca database: {}", e)))?;

    // Compress with gzip
    let backup_file = fs::File::create(&backup_path)
        .map_err(|e| AppError::Internal(format!("Gagal membuat file backup: {}", e)))?;
    let mut encoder = GzEncoder::new(backup_file, Compression::default());
    encoder
        .write_all(&db_data)
        .map_err(|e| AppError::Internal(format!("Gagal mengompres backup: {}", e)))?;
    encoder
        .finish()
        .map_err(|e| AppError::Internal(format!("Gagal menyelesaikan backup: {}", e)))?;

    let metadata = fs::metadata(&backup_path)
        .map_err(|e| AppError::Internal(format!("Gagal membaca info backup: {}", e)))?;

    Ok(BackupInfo {
        filename,
        size_bytes: metadata.len(),
        created_at: now.format("%Y-%m-%d %H:%M:%S").to_string(),
    })
}

/// Delete backups older than retention period
fn cleanup_old_backups(backup_dir: &Path, retention_days: i64) -> Result<usize, AppError> {
    let cutoff = Local::now() - chrono::Duration::days(retention_days);
    let cutoff_str = cutoff.format("%Y-%m-%d").to_string();
    let mut deleted = 0;

    if !backup_dir.exists() {
        return Ok(0);
    }

    let entries = fs::read_dir(backup_dir)
        .map_err(|e| AppError::Internal(format!("Gagal membaca folder backup: {}", e)))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Pattern: kasir_YYYY-MM-DD.db.gz
        if name.starts_with("kasir_") && name.ends_with(".db.gz") {
            let date_part = &name[6..16]; // Extract YYYY-MM-DD
            if date_part < cutoff_str.as_str() {
                if fs::remove_file(entry.path()).is_ok() {
                    deleted += 1;
                }
            }
        }
    }

    Ok(deleted)
}

/// Run backup and cleanup — used by both manual trigger and scheduler
pub fn run_backup(retention_days: i64) -> Result<BackupInfo, AppError> {
    let db_path = get_db_path();
    if !db_path.exists() {
        return Err(AppError::NotFound("Database tidak ditemukan".into()));
    }

    let backup_dir = get_backup_dir();
    let info = create_backup_file(&db_path, &backup_dir)?;
    let _ = cleanup_old_backups(&backup_dir, retention_days);
    Ok(info)
}

/// Check if today's backup already exists
fn has_todays_backup(backup_dir: &Path) -> bool {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let filename = format!("kasir_{}.db.gz", today);
    backup_dir.join(filename).exists()
}

// --- Background scheduler ---

/// Shared state for the backup scheduler
pub struct BackupScheduler {
    pub last_backup: Option<BackupInfo>,
    pub settings: BackupSettings,
}

impl BackupScheduler {
    pub fn new() -> Self {
        Self {
            last_backup: None,
            settings: BackupSettings::default(),
        }
    }
}

/// Read backup settings from the database
fn read_backup_settings_from_db() -> BackupSettings {
    let db_path = get_db_path();
    if !db_path.exists() {
        return BackupSettings::default();
    }

    let conn = match rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(c) => c,
        Err(_) => return BackupSettings::default(),
    };

    let json_str: String = match conn.query_row(
        "SELECT additional_info FROM store_info WHERE id = 1",
        [],
        |row| row.get(0),
    ) {
        Ok(s) => s,
        Err(_) => return BackupSettings::default(),
    };

    let json: serde_json::Value = match serde_json::from_str(&json_str) {
        Ok(v) => v,
        Err(_) => return BackupSettings::default(),
    };

    json.get("backup")
        .and_then(|v| serde_json::from_value::<BackupSettings>(v.clone()).ok())
        .unwrap_or_default()
}

/// Start the background backup scheduler
pub fn start_backup_scheduler(scheduler: Arc<Mutex<BackupScheduler>>) {
    tauri::async_runtime::spawn(async move {
        // Read settings from DB
        let settings = read_backup_settings_from_db();
        let retention_days = settings.retention_days;
        let interval_secs = settings.interval_hours * 3600;

        {
            let mut s = scheduler.lock().await;
            s.settings = settings;
        }

        // Initial backup on startup
        match run_backup(retention_days) {
            Ok(info) => {
                let mut s = scheduler.lock().await;
                s.last_backup = Some(info);
            }
            Err(_) => {}
        }

        // Run at configured interval
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
        interval.tick().await; // Skip first tick (already ran above)

        loop {
            interval.tick().await;
            // Re-read settings each cycle in case they changed
            let current_settings = read_backup_settings_from_db();
            match run_backup(current_settings.retention_days) {
                Ok(info) => {
                    let mut s = scheduler.lock().await;
                    s.last_backup = Some(info);
                    s.settings = current_settings;
                }
                Err(_) => {}
            }
        }
    });
}

// --- Tauri commands ---

#[tauri::command]
pub async fn create_backup(
    scheduler: State<'_, Arc<Mutex<BackupScheduler>>>,
) -> Result<BackupInfo, AppError> {
    let info = run_backup(read_backup_settings_from_db().retention_days)?;
    let mut s = scheduler.lock().await;
    s.last_backup = Some(info.clone());
    Ok(info)
}

#[tauri::command]
pub async fn get_backup_status(
    scheduler: State<'_, Arc<Mutex<BackupScheduler>>>,
) -> Result<BackupStatus, AppError> {
    let backup_dir = get_backup_dir();
    let mut backups: Vec<BackupInfo> = Vec::new();
    let mut total_size: u64 = 0;

    if backup_dir.exists() {
        if let Ok(entries) = fs::read_dir(&backup_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("kasir_") && name.ends_with(".db.gz") {
                    if let Ok(meta) = entry.metadata() {
                        let date_part = name[6..16].to_string();
                        total_size += meta.len();
                        backups.push(BackupInfo {
                            filename: name,
                            size_bytes: meta.len(),
                            created_at: format!("{} 00:00:00", date_part),
                        });
                    }
                }
            }
        }
    }

    // Sort by date descending
    backups.sort_by(|a, b| b.filename.cmp(&a.filename));

    let s = scheduler.lock().await;

    Ok(BackupStatus {
        last_backup: s.last_backup.clone().or_else(|| backups.first().cloned()),
        total_backups: backups.len(),
        total_size_bytes: total_size,
        backup_dir: backup_dir.to_string_lossy().to_string(),
        settings: s.settings.clone(),
    })
}

#[tauri::command]
pub async fn list_backups() -> Result<Vec<BackupInfo>, AppError> {
    let backup_dir = get_backup_dir();
    let mut backups: Vec<BackupInfo> = Vec::new();

    if !backup_dir.exists() {
        return Ok(backups);
    }

    let entries = fs::read_dir(&backup_dir)
        .map_err(|e| AppError::Internal(format!("Gagal membaca folder backup: {}", e)))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("kasir_") && name.ends_with(".db.gz") {
            if let Ok(meta) = entry.metadata() {
                let date_part = name[6..16].to_string();
                backups.push(BackupInfo {
                    filename: name,
                    size_bytes: meta.len(),
                    created_at: format!("{} 00:00:00", date_part),
                });
            }
        }
    }

    backups.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(backups)
}

#[tauri::command]
pub async fn restore_backup(filename: String) -> Result<String, AppError> {
    let backup_dir = get_backup_dir();
    let backup_path = backup_dir.join(&filename);

    if !backup_path.exists() {
        return Err(AppError::NotFound("File backup tidak ditemukan".into()));
    }

    let db_path = get_db_path();

    // Decompress gzip
    let backup_file = fs::File::open(&backup_path)
        .map_err(|e| AppError::Internal(format!("Gagal membuka backup: {}", e)))?;
    let mut decoder = flate2::read::GzDecoder::new(backup_file);
    let mut db_data = Vec::new();
    decoder
        .read_to_end(&mut db_data)
        .map_err(|e| AppError::Internal(format!("Gagal dekompresi backup: {}", e)))?;

    // Write to database file
    fs::write(&db_path, &db_data)
        .map_err(|e| AppError::Internal(format!("Gagal menulis database: {}", e)))?;

    Ok("Database berhasil dipulihkan dari backup. Silakan restart aplikasi.".into())
}

#[tauri::command]
pub async fn delete_backup(filename: String) -> Result<(), AppError> {
    let backup_dir = get_backup_dir();
    let backup_path = backup_dir.join(&filename);

    if !backup_path.exists() {
        return Err(AppError::NotFound("File backup tidak ditemukan".into()));
    }

    fs::remove_file(&backup_path)
        .map_err(|e| AppError::Internal(format!("Gagal menghapus backup: {}", e)))?;

    Ok(())
}
