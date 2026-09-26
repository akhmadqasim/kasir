//! What is in the backup folder, and which of it the retention policy drops.

use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::naming::parse_backup_filename;
use crate::domain::backup::{BackupInfo, MAX_RETENTION_DAYS, MIN_RETENTION_DAYS};
use crate::utils::time::format_ts;
use crate::utils::AppError;

/// One file in the backup folder.
pub(super) struct BackupEntry {
    pub(super) path: PathBuf,
    pub(super) filename: String,
    pub(super) size_bytes: u64,
    pub(super) modified: SystemTime,
}

/// Render a file timestamp in the `"YYYY-MM-DD HH:MM:SS"` UTC shape the rest of
/// the API uses, which is what the frontend's `parseBackendDate` assumes.
pub(super) fn system_time_to_utc_string(t: Option<SystemTime>) -> String {
    format_ts(chrono::DateTime::<chrono::Utc>::from(
        t.unwrap_or(SystemTime::UNIX_EPOCH),
    ))
}

/// Every backup in `backup_dir`, newest first, with its real modified time.
///
/// The single directory walk behind `list`, `status` and
/// `cleanup_old_backups`. A missing directory is an empty list, not an error —
/// it just means no backup has run yet.
fn read_backup_entries(backup_dir: &Path) -> Result<Vec<BackupEntry>, AppError> {
    let mut entries_out: Vec<BackupEntry> = Vec::new();

    if !backup_dir.exists() {
        return Ok(entries_out);
    }

    let entries = fs::read_dir(backup_dir)
        .map_err(|e| AppError::Internal(format!("Gagal membaca folder backup: {}", e)))?;

    for entry in entries.flatten() {
        let filename = entry.file_name().to_string_lossy().to_string();
        if parse_backup_filename(&filename).is_none() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        entries_out.push(BackupEntry {
            path: entry.path(),
            filename,
            size_bytes: meta.len(),
            modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        });
    }

    entries_out.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| b.filename.cmp(&a.filename))
    });
    Ok(entries_out)
}

/// Every backup in `backup_dir` as the API reports it, newest first.
pub(super) fn collect_backups(backup_dir: &Path) -> Result<Vec<BackupInfo>, AppError> {
    Ok(read_backup_entries(backup_dir)?
        .into_iter()
        .map(|e| BackupInfo {
            filename: e.filename,
            size_bytes: e.size_bytes,
            created_at: system_time_to_utc_string(Some(e.modified)),
        })
        .collect())
}

/// Check if a backup was already taken today (local calendar day).
///
/// Used only to skip the launch-time backup. Since the filename now carries a
/// time this can no longer be a single `exists()` check.
pub(super) fn has_todays_backup(backup_dir: &Path) -> bool {
    let today = Local::now().date_naive();
    let Ok(entries) = fs::read_dir(backup_dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        parse_backup_filename(&entry.file_name().to_string_lossy())
            .is_some_and(|parsed| parsed.date == today)
    })
}

// --- Retention ---

/// Backups kept regardless of age.
///
/// Age alone is not a safe retention rule: a shop that leaves the app closed for
/// longer than `retention_days` would come back to an empty folder, and the very
/// first thing the app does on launch is take a backup — of the database it is
/// about to be asked to restore.
const MIN_BACKUPS_KEPT: usize = 5;

/// Delete backups that are both older than the retention window and outside the
/// most recent [`MIN_BACKUPS_KEPT`].
///
/// Age is taken from the file's own modified time rather than from its name: the
/// name only ever carried a date, so before the filename gained a time this
/// could not distinguish two snapshots taken on the same day.
pub(super) fn cleanup_old_backups(
    backup_dir: &Path,
    retention_days: i64,
) -> Result<usize, AppError> {
    let cutoff = retention_cutoff(retention_days, SystemTime::now());
    let entries = read_backup_entries(backup_dir)?;

    let mut deleted = 0;
    for entry in expired_backups(&entries, cutoff) {
        if fs::remove_file(&entry.path).is_ok() {
            deleted += 1;
        }
    }

    Ok(deleted)
}

/// The instant before which a backup is old enough to drop.
///
/// `retention_days` is clamped first: a negative value put this cutoff in the
/// *future*, so `run_backup` created a backup and `cleanup_old_backups` deleted
/// it again on the same tick.
fn retention_cutoff(retention_days: i64, now: SystemTime) -> SystemTime {
    let days = retention_days.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
    now.checked_sub(Duration::from_secs(days as u64 * 24 * 60 * 60))
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

/// The entries the retention policy deletes, given `entries` newest first.
fn expired_backups(entries: &[BackupEntry], cutoff: SystemTime) -> Vec<&BackupEntry> {
    entries
        .iter()
        .skip(MIN_BACKUPS_KEPT)
        .filter(|entry| entry.modified < cutoff)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, age_days: u64) -> BackupEntry {
        BackupEntry {
            path: PathBuf::from(name),
            filename: name.to_string(),
            size_bytes: 1,
            modified: SystemTime::UNIX_EPOCH + Duration::from_secs(365 * 86_400)
                - Duration::from_secs(age_days * 86_400),
        }
    }

    /// `now` for the retention tests: one year after the epoch, so ages can be
    /// subtracted without underflow.
    fn fixed_now() -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(365 * 86_400)
    }

    #[test]
    fn retention_deletes_only_what_is_both_old_and_surplus() {
        let entries: Vec<BackupEntry> = (0..8)
            .map(|i| entry(&format!("kasir_backup_{i}"), i * 10))
            .collect();
        let cutoff = retention_cutoff(30, fixed_now());

        let doomed: Vec<&str> = expired_backups(&entries, cutoff)
            .iter()
            .map(|e| e.filename.as_str())
            .collect();

        // Ages are 0,10,...,70 days. The first MIN_BACKUPS_KEPT are kept
        // whatever their age; of the rest only those past 30 days go.
        assert_eq!(
            doomed,
            vec!["kasir_backup_5", "kasir_backup_6", "kasir_backup_7"]
        );
    }

    #[test]
    fn retention_keeps_the_newest_backups_even_when_all_are_stale() {
        let entries: Vec<BackupEntry> = (0..7)
            .map(|i| entry(&format!("kasir_backup_{i}"), 400 + i))
            .collect();
        let cutoff = retention_cutoff(30, fixed_now());

        assert_eq!(
            expired_backups(&entries, cutoff).len(),
            7 - MIN_BACKUPS_KEPT
        );
    }

    /// A negative retention put the cutoff in the future, so every backup —
    /// including the one just written — was expired.
    #[test]
    fn retention_cutoff_is_never_in_the_future() {
        let now = fixed_now();
        for days in [-365, -1, 0] {
            assert!(
                retention_cutoff(days, now) < now,
                "cutoff for {days} days must be in the past"
            );
        }
        assert_eq!(
            retention_cutoff(-1, now),
            retention_cutoff(MIN_RETENTION_DAYS, now)
        );
    }
}
