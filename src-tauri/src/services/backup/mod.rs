//! Compressed database snapshots: taking them, listing them, restoring them,
//! and the background schedule that keeps them coming.
//!
//! [`naming`] owns the filename shape, [`folder`] what is in the backup folder
//! and what retention drops from it, [`snapshot`] the consistent copies of the
//! live database, [`restore`] swapping one in at the next launch, and
//! [`scheduler`] the automatic backups. What is left here is the admin-facing
//! surface the HTTP routes call.

mod folder;
mod naming;
mod restore;
mod scheduler;
mod snapshot;

use std::fs;
use tokio::sync::Mutex;

use crate::domain::backup::{BackupInfo, BackupStatus};
use crate::domain::Actor;
use crate::services::guard;
use crate::utils::logging::log_error;
use crate::utils::paths::{get_backup_dir, get_db_path};
use crate::utils::AppError;

pub(crate) use restore::{apply_pending_restore, stage_restore_bytes};
pub use scheduler::{run_scheduler, BackupScheduler};
pub(crate) use snapshot::export_snapshot;

/// Run backup and cleanup — used by both manual trigger and scheduler
fn run_backup(retention_days: i64) -> Result<BackupInfo, AppError> {
    let db_path = get_db_path();
    if !db_path.exists() {
        return Err(AppError::NotFound("Database tidak ditemukan".into()));
    }

    let backup_dir = get_backup_dir();
    let info = snapshot::create_backup_file(&db_path, &backup_dir)?;
    if let Err(e) = folder::cleanup_old_backups(&backup_dir, retention_days) {
        log_error(&format!("Backup cleanup failed: {e}"));
    }
    snapshot::remove_stale_working_files(&backup_dir);
    Ok(info)
}

/// Run [`run_backup`] on the blocking pool — it snapshots and compresses the
/// whole database — and turn a join failure into an ordinary error.
async fn run_backup_blocking(retention_days: i64) -> Result<BackupInfo, AppError> {
    tokio::task::spawn_blocking(move || run_backup(retention_days))
        .await
        .map_err(|e| AppError::Internal(format!("tugas backup gagal: {e}")))?
}

/// Take a backup now, on an admin's request, and remember it as the latest.
pub async fn create(
    actor: &Actor,
    scheduler: &Mutex<BackupScheduler>,
) -> Result<BackupInfo, AppError> {
    guard::require_admin(actor)?;

    let retention_days = scheduler::read_backup_settings_from_db().retention_days;
    let info = run_backup_blocking(retention_days).await?;
    let mut s = scheduler.lock().await;
    s.last_backup = Some(info.clone());
    Ok(info)
}

pub async fn status(scheduler: &Mutex<BackupScheduler>) -> Result<BackupStatus, AppError> {
    let backup_dir = get_backup_dir();
    let backups = folder::collect_backups(&backup_dir).unwrap_or_default();
    let total_size: u64 = backups.iter().map(|b| b.size_bytes).sum();

    let s = scheduler.lock().await;

    Ok(BackupStatus {
        last_backup: s.last_backup.clone().or_else(|| backups.first().cloned()),
        total_backups: backups.len(),
        total_size_bytes: total_size,
        backup_dir: backup_dir.to_string_lossy().to_string(),
    })
}

pub fn list() -> Result<Vec<BackupInfo>, AppError> {
    folder::collect_backups(&get_backup_dir())
}

/// Stage a backup to become the live database at the next launch.
pub fn restore(actor: &Actor, filename: &str) -> Result<String, AppError> {
    guard::require_admin(actor)?;

    let backup_path = existing_backup_path(filename)?;
    restore::stage_restore_from_archive(&get_db_path(), &backup_path)?;

    Ok("Backup siap dipulihkan. Tutup dan buka kembali aplikasi untuk menerapkannya.".into())
}

pub fn delete(actor: &Actor, filename: &str) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    let backup_path = existing_backup_path(filename)?;
    fs::remove_file(&backup_path)
        .map_err(|e| AppError::Internal(format!("Gagal menghapus backup: {}", e)))?;

    Ok(())
}

/// The backup a client named, provided the name is a backup name and the file
/// is there.
fn existing_backup_path(filename: &str) -> Result<std::path::PathBuf, AppError> {
    let backup_path = naming::resolve_backup_path(&get_backup_dir(), filename)?;
    if !backup_path.exists() {
        return Err(AppError::NotFound("File backup tidak ditemukan".into()));
    }
    Ok(backup_path)
}
