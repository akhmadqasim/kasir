//! Compressed database snapshots: taking them, listing them, restoring them,
//! and the background schedule that keeps them coming.

use chrono::Local;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tokio::sync::Mutex;

use crate::domain::backup::{
    BackupInfo, BackupSettings, BackupStatus, MAX_RETENTION_DAYS, MIN_RETENTION_DAYS,
};
use crate::domain::Actor;
use crate::services::guard;
use crate::utils::AppError;

fn get_db_path() -> PathBuf {
    crate::utils::paths::get_db_path()
}

fn get_backup_dir() -> PathBuf {
    crate::utils::paths::get_backup_dir()
}

// --- Backup filename ---

const BACKUP_PREFIX: &str = "kasir_";
const BACKUP_SUFFIX: &str = ".db.gz";

/// The local calendar date encoded in a backup filename, plus the time of day
/// when the name carries one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackupName {
    pub date: chrono::NaiveDate,
    pub time: Option<chrono::NaiveTime>,
}

/// Parse `kasir_YYYY-MM-DD_HHMMSS.db.gz` or the legacy `kasir_YYYY-MM-DD.db.gz`,
/// returning `None` for anything else.
///
/// The legacy date-only shape is still accepted because a database that has been
/// running for a while has a backup folder full of them.
///
/// This replaces three copies of `&name[6..16]` that were guarded only by
/// `starts_with("kasir_") && ends_with(".db.gz")`. That guard admits
/// `kasir_.db.gz`, which is 12 bytes long, so the slice panicked on an index out
/// of range; a name with non-ASCII bytes could also split a UTF-8 boundary and
/// panic. Neither panic is local: inside the scheduler's spawned task it stops
/// every future automatic backup with nothing logged, and inside a command it
/// aborts the IPC call so the frontend promise never settles.
///
/// `strip_prefix`/`strip_suffix` and the chrono parsers are all
/// char-boundary-safe and reject rather than panic, so any file a user drops in
/// the backup folder is simply ignored.
pub fn parse_backup_filename(name: &str) -> Option<BackupName> {
    let stem = name
        .strip_prefix(BACKUP_PREFIX)?
        .strip_suffix(BACKUP_SUFFIX)?;

    match stem.split_once('_') {
        None => Some(BackupName {
            date: chrono::NaiveDate::parse_from_str(stem, "%Y-%m-%d").ok()?,
            time: None,
        }),
        Some((date_part, time_part)) => {
            // chrono's `%H%M%S` is not fixed-width — it happily reads "18300"
            // as 18:30:00 — so the shape is checked before parsing.
            if time_part.len() != 6 || !time_part.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            Some(BackupName {
                date: chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()?,
                time: Some(chrono::NaiveTime::parse_from_str(time_part, "%H%M%S").ok()?),
            })
        }
    }
}

/// Resolve a client-supplied backup filename to a path inside `backup_dir`.
///
/// B04: `backup_dir.join(&filename)` on its own is arbitrary file access.
/// `Path::join` **replaces** the base when its argument is absolute and passes
/// `..` through untouched, so `delete_backup("C:\\Users\\x\\AppData\\Roaming\\
/// com.kasir.pos\\kasir.db")` deleted the production database and
/// `restore_backup` could promote any gzip on disk to be the live database.
///
/// The filename must be a single normal path component AND parse as a backup
/// name. Validating the name instead of canonicalising the result also rejects
/// the Windows shapes `canonicalize` would happily accept: drive-relative paths
/// (`C:kasir.db`), UNC roots, and anything with a separator or an alternate data
/// stream in it.
fn resolve_backup_path(backup_dir: &Path, filename: &str) -> Result<PathBuf, AppError> {
    let mut components = Path::new(filename).components();
    let single_component = matches!(
        (components.next(), components.next()),
        (Some(std::path::Component::Normal(_)), None)
    );

    if !single_component || parse_backup_filename(filename).is_none() {
        return Err(AppError::Validation(
            "Nama file backup tidak valid".to_string(),
        ));
    }

    Ok(backup_dir.join(filename))
}

// --- Restore staging ---

/// The 16-byte magic every SQLite database file starts with.
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

/// True when `bytes` begins with the SQLite file header.
///
/// Guards the restore and import paths so a truncated download, a gzip of
/// something else, or a text file cannot be installed as the live database and
/// only fail at the next launch.
pub fn is_sqlite_database(bytes: &[u8]) -> bool {
    bytes.starts_with(SQLITE_HEADER)
}

/// Where a restore is staged until the next launch: `kasir.db.restore-pending`.
fn pending_restore_path(db_path: &Path) -> PathBuf {
    let mut p = db_path.as_os_str().to_os_string();
    p.push(".restore-pending");
    PathBuf::from(p)
}

/// Copy of the database that a restore replaced, kept as a safety net.
fn pre_restore_path(db_path: &Path) -> PathBuf {
    let mut p = db_path.as_os_str().to_os_string();
    p.push(".pre-restore");
    PathBuf::from(p)
}

/// Half-written staging file, renamed onto [`pending_restore_path`] once
/// complete so a crash mid-write can never leave a partial "pending restore".
fn staging_restore_path(db_path: &Path) -> PathBuf {
    let mut p = pending_restore_path(db_path).as_os_str().to_os_string();
    p.push(".tmp");
    PathBuf::from(p)
}

/// Publish a fully written staging file as the pending restore.
fn publish_staged_restore(db_path: &Path, staging: &Path) -> Result<(), AppError> {
    fs::rename(staging, pending_restore_path(db_path)).map_err(|e| {
        let _ = fs::remove_file(staging);
        AppError::Internal(format!("Gagal menyiapkan file restore: {}", e))
    })
}

/// Stage an in-memory database image to replace `db_path` at the next launch.
pub fn stage_restore_bytes(db_path: &Path, data: &[u8]) -> Result<(), AppError> {
    if !is_sqlite_database(data) {
        return Err(AppError::Validation(
            "File bukan database SQLite yang valid".to_string(),
        ));
    }

    let staging = staging_restore_path(db_path);
    fs::write(&staging, data)
        .map_err(|e| AppError::Internal(format!("Gagal menulis file restore: {}", e)))?;
    publish_staged_restore(db_path, &staging)
}

/// Stage an on-disk database file to replace `db_path` at the next launch.
///
/// Used by `import_database`, which used to `fs::copy` straight over the live
/// `kasir.db`: that raced the open sea-orm pool and left the old `-wal` next to
/// the new database, so the previous WAL was replayed over the import on the
/// next start. Going through the staging path fixes both, and rejects a file
/// that is not a SQLite database before anything is replaced.
pub fn stage_restore_from_file(db_path: &Path, source: &Path) -> Result<(), AppError> {
    let mut header = [0u8; 16];
    let readable = fs::File::open(source)
        .and_then(|mut f| f.read_exact(&mut header))
        .is_ok();

    if !readable || !is_sqlite_database(&header) {
        return Err(AppError::Validation(
            "File bukan database SQLite yang valid".to_string(),
        ));
    }

    let staging = staging_restore_path(db_path);
    fs::copy(source, &staging)
        .map_err(|e| AppError::Internal(format!("Gagal menyalin file import: {}", e)))?;
    publish_staged_restore(db_path, &staging)
}

/// Flush committed WAL pages into the main `.db` file.
///
/// Exposed for `settings::export_database`, which used to `fs::copy` the file
/// with WAL on and therefore silently dropped every transaction committed since
/// the last checkpoint — the day's sales, in an export the UI banner tells
/// admins to use when moving versions.
pub fn checkpoint_database_wal(db_path: &Path) {
    checkpoint_wal(db_path);
}

/// Install a staged restore over the live database. Called from `run()` BEFORE
/// `db::setup_database`, which is the only moment no connection holds the file.
///
/// A restore cannot be done in process: `restore_backup` used to `fs::write`
/// over `kasir.db` while the sea-orm pool still had it open, so SQLite's page
/// cache could flush stale pages on top of the restored bytes and the `-wal`
/// belonging to the old database was still live. Staging the decompressed file
/// and swapping it here sidesteps both.
///
/// Returns `Ok(true)` when a restore was applied. The previous database is kept
/// as `kasir.db.pre-restore` so a restore from the wrong file is recoverable.
pub fn apply_pending_restore(db_path: &Path) -> Result<bool, AppError> {
    let pending = pending_restore_path(db_path);
    if !pending.exists() {
        return Ok(false);
    }

    // Re-validate: the staged file may have been truncated by a crash between
    // the write and the swap, and it is plain a file on disk in between.
    let mut header = [0u8; 16];
    let valid = fs::File::open(&pending)
        .and_then(|mut f| f.read_exact(&mut header).map(|_| ()))
        .is_ok()
        && is_sqlite_database(&header);

    if !valid {
        let _ = fs::remove_file(&pending);
        return Err(AppError::Internal(
            "File restore yang tertunda rusak dan telah dibuang".to_string(),
        ));
    }

    // Copy (not rename) so the live database is never missing if this fails.
    if db_path.exists() {
        let keep = pre_restore_path(db_path);
        let _ = fs::remove_file(&keep);
        if let Err(e) = fs::copy(db_path, &keep) {
            eprintln!("[backup] Gagal menyimpan salinan pra-restore: {}", e);
        }
    }

    fs::rename(&pending, db_path)
        .map_err(|e| AppError::Internal(format!("Gagal memasang database hasil restore: {}", e)))?;

    // The old WAL belongs to the database we just replaced; replaying it would
    // corrupt the restored one.
    remove_sqlite_sidecars(db_path);

    Ok(true)
}

/// Flush committed WAL pages into the main `.db` file before it is copied for a
/// backup. Without this, a plain file read of `kasir.db` misses everything still
/// sitting in `kasir.db-wal`. Best-effort: a transient BUSY must not abort the
/// backup — a PASSIVE checkpoint still lands committed frames in the main file.
fn checkpoint_wal(db_path: &Path) {
    match rusqlite::Connection::open(db_path) {
        Ok(conn) => {
            if let Err(e) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
                eprintln!("[backup] WAL checkpoint gagal (dilewati): {}", e);
            }
        }
        Err(e) => {
            eprintln!(
                "[backup] Gagal membuka DB untuk checkpoint (dilewati): {}",
                e
            );
        }
    }
}

/// Remove SQLite sidecar files (`-wal`, `-shm`) next to the main db. After a
/// restore overwrites `kasir.db`, a stale `kasir.db-wal` would be replayed on
/// next open and clobber the restored data.
fn remove_sqlite_sidecars(db_path: &Path) {
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = db_path.as_os_str().to_os_string();
        sidecar.push(suffix);
        let sidecar = PathBuf::from(sidecar);
        if sidecar.exists() {
            if let Err(e) = fs::remove_file(&sidecar) {
                eprintln!(
                    "[backup] Gagal menghapus {}: {}",
                    sidecar.to_string_lossy(),
                    e
                );
            }
        }
    }
}

/// Name for a backup taken at local time `now`.
///
/// The time used to be omitted, so a 3-hour interval wrote the same
/// `kasir_YYYY-MM-DD.db.gz` eight times a day: a database that broke at 10:00
/// had its healthy 09:00 snapshot overwritten at 12:00 by a copy of the broken
/// one, and the best recovery point silently moved back to yesterday. The name
/// is in local time because it is what the shop owner reads in the file list.
fn backup_filename_for(now: chrono::DateTime<Local>) -> String {
    format!(
        "{}{}{}",
        BACKUP_PREFIX,
        now.format("%Y-%m-%d_%H%M%S"),
        BACKUP_SUFFIX
    )
}

/// Create a compressed backup of the database
fn create_backup_file(db_path: &Path, backup_dir: &Path) -> Result<BackupInfo, AppError> {
    fs::create_dir_all(backup_dir)
        .map_err(|e| AppError::Internal(format!("Gagal membuat folder backup: {}", e)))?;

    // Two backups in the same second (a manual one racing the scheduler) would
    // otherwise still collide on the name.
    let mut now = Local::now();
    let mut filename = backup_filename_for(now);
    while backup_dir.join(&filename).exists() {
        now += chrono::Duration::seconds(1);
        filename = backup_filename_for(now);
    }
    let backup_path = backup_dir.join(&filename);

    // Flush the WAL into the main file so the copy below is complete & consistent.
    checkpoint_wal(db_path);

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
        created_at: system_time_to_utc_string(metadata.modified().ok()),
    })
}

/// One file in the backup folder.
struct BackupEntry {
    path: PathBuf,
    filename: String,
    size_bytes: u64,
    modified: SystemTime,
}

/// Render a file timestamp in the `"YYYY-MM-DD HH:MM:SS"` UTC shape the rest of
/// the API uses, which is what the frontend's `parseBackendDate` assumes.
fn system_time_to_utc_string(t: Option<SystemTime>) -> String {
    chrono::DateTime::<chrono::Utc>::from(t.unwrap_or(SystemTime::UNIX_EPOCH))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// Every backup in `backup_dir`, newest first, with its real modified time.
///
/// The single directory walk behind `list_backups`, `get_backup_status` and
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

fn collect_backups(backup_dir: &Path) -> Result<Vec<BackupInfo>, AppError> {
    Ok(read_backup_entries(backup_dir)?
        .into_iter()
        .map(|e| BackupInfo {
            filename: e.filename,
            size_bytes: e.size_bytes,
            created_at: system_time_to_utc_string(Some(e.modified)),
        })
        .collect())
}

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
fn cleanup_old_backups(backup_dir: &Path, retention_days: i64) -> Result<usize, AppError> {
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

/// Check if a backup was already taken today (local calendar day).
///
/// Used only to skip the launch-time backup. Since the filename now carries a
/// time this can no longer be a single `exists()` check.
fn has_todays_backup(backup_dir: &Path) -> bool {
    let today = Local::now().date_naive();
    let Ok(entries) = fs::read_dir(backup_dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        parse_backup_filename(&entry.file_name().to_string_lossy())
            .is_some_and(|parsed| parsed.date == today)
    })
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

/// Read backup settings from the database.
///
/// Always returns `sanitized()` values: this is the single choke point every
/// caller goes through, so nothing downstream has to defend itself against a
/// zero interval or a negative retention that was written by an older build or
/// edited into the JSON blob by hand.
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
        .sanitized()
}

/// The scheduler's body. Spawned once at startup by the transport layer, which
/// owns the choice of runtime; everything it decides lives here.
pub async fn run_scheduler(scheduler: std::sync::Arc<Mutex<BackupScheduler>>) {
    // Already sanitized by read_backup_settings_from_db().
    let settings = read_backup_settings_from_db();
    let retention_days = settings.retention_days;

    {
        let mut s = scheduler.lock().await;
        s.settings = settings;
    }

    // Initial backup on startup (skip if today's backup already exists)
    let backup_dir = get_backup_dir();
    if !has_todays_backup(&backup_dir) {
        if let Ok(info) = run_backup(retention_days) {
            let mut s = scheduler.lock().await;
            s.last_backup = Some(info);
        }
    }

    loop {
        // Re-read (and re-clamp) the settings every cycle: this both picks
        // up an interval the admin changed since launch and keeps a bad
        // stored value from reaching the timer. `sleep` is used rather than
        // `tokio::time::interval`, which PANICS on a zero period — and a
        // panic here happens inside this spawned task, so automatic backups
        // would simply stop with nothing logged and nothing shown in the UI.
        let current_settings = read_backup_settings_from_db();
        let period = std::time::Duration::from_secs(current_settings.interval_hours * 3600);
        tokio::time::sleep(period).await;

        if let Ok(info) = run_backup(current_settings.retention_days) {
            let mut s = scheduler.lock().await;
            s.last_backup = Some(info);
            s.settings = current_settings;
        }
    }
}

/// Take a backup now, on an admin's request, and remember it as the latest.
pub async fn create(
    actor: &Actor,
    scheduler: &Mutex<BackupScheduler>,
) -> Result<BackupInfo, AppError> {
    guard::require_admin(actor)?;

    let info = run_backup(read_backup_settings_from_db().retention_days)?;
    let mut s = scheduler.lock().await;
    s.last_backup = Some(info.clone());
    Ok(info)
}

pub async fn status(scheduler: &Mutex<BackupScheduler>) -> Result<BackupStatus, AppError> {
    let backup_dir = get_backup_dir();
    let backups = collect_backups(&backup_dir).unwrap_or_default();
    let total_size: u64 = backups.iter().map(|b| b.size_bytes).sum();

    let s = scheduler.lock().await;

    Ok(BackupStatus {
        last_backup: s.last_backup.clone().or_else(|| backups.first().cloned()),
        total_backups: backups.len(),
        total_size_bytes: total_size,
        backup_dir: backup_dir.to_string_lossy().to_string(),
        settings: s.settings.clone(),
    })
}

pub fn list() -> Result<Vec<BackupInfo>, AppError> {
    collect_backups(&get_backup_dir())
}

/// Stage a backup to become the live database at the next launch.
pub fn restore(actor: &Actor, filename: &str) -> Result<String, AppError> {
    guard::require_admin(actor)?;

    let backup_dir = get_backup_dir();
    let backup_path = resolve_backup_path(&backup_dir, filename)?;

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

    // Stage next to the live database instead of writing over it. The sea-orm
    // pool still holds `kasir.db` open, so an in-process overwrite races SQLite's
    // page cache; `apply_pending_restore` performs the swap at the next launch,
    // before the pool is created.
    stage_restore_bytes(&db_path, &db_data)?;

    Ok("Backup siap dipulihkan. Tutup dan buka kembali aplikasi untuk menerapkannya.".into())
}

pub fn delete(actor: &Actor, filename: &str) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    let backup_dir = get_backup_dir();
    let backup_path = resolve_backup_path(&backup_dir, filename)?;

    if !backup_path.exists() {
        return Err(AppError::NotFound("File backup tidak ditemukan".into()));
    }

    fs::remove_file(&backup_path)
        .map_err(|e| AppError::Internal(format!("Gagal menghapus backup: {}", e)))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, TimeZone};

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

    /// The name the old `&name[6..16]` slice panicked on: it passes
    /// `starts_with("kasir_") && ends_with(".db.gz")` but is only 12 bytes long.
    #[test]
    fn parse_rejects_the_shortest_passing_name() {
        assert_eq!(parse_backup_filename("kasir_.db.gz"), None);
    }

    /// A non-ASCII name whose 6..16 byte window lands inside a UTF-8 sequence.
    /// Slicing it panicked with "byte index is not a char boundary".
    #[test]
    fn parse_rejects_non_ascii_names() {
        assert_eq!(
            parse_backup_filename("kasir_\u{3053}\u{3093}\u{306b}\u{3061}\u{306f}.db.gz"),
            None
        );
        assert_eq!(parse_backup_filename("kasir_caf\u{e9}-2026.db.gz"), None);
    }

    #[test]
    fn parse_accepts_a_valid_name() {
        let parsed = parse_backup_filename("kasir_2026-09-05.db.gz").expect("valid name");
        assert_eq!(parsed.date, NaiveDate::from_ymd_opt(2026, 9, 5).unwrap());
        assert_eq!(parsed.time, None);
    }

    /// The timestamped shape written since a date-only name was found to let a
    /// 3-hour interval overwrite the same file eight times a day.
    #[test]
    fn parse_accepts_a_timestamped_name() {
        let parsed = parse_backup_filename("kasir_2026-09-05_183000.db.gz").expect("valid name");
        assert_eq!(parsed.date, NaiveDate::from_ymd_opt(2026, 9, 5).unwrap());
        assert_eq!(parsed.time, chrono::NaiveTime::from_hms_opt(18, 30, 0));
    }

    #[test]
    fn generated_names_round_trip_and_differ_within_a_day() {
        let nine = Local.with_ymd_and_hms(2026, 9, 5, 9, 0, 0).unwrap();
        let noon = Local.with_ymd_and_hms(2026, 9, 5, 12, 0, 0).unwrap();

        let early = backup_filename_for(nine);
        let later = backup_filename_for(noon);
        assert_ne!(
            early, later,
            "two snapshots on the same day must not share a name"
        );
        assert!(early < later, "names must sort chronologically");

        let parsed = parse_backup_filename(&early).expect("generated names parse");
        assert_eq!(parsed.date, NaiveDate::from_ymd_opt(2026, 9, 5).unwrap());
        assert_eq!(parsed.time, chrono::NaiveTime::from_hms_opt(9, 0, 0));
    }

    #[test]
    fn parse_rejects_a_malformed_time_part() {
        for name in [
            "kasir_2026-09-05_.db.gz",
            "kasir_2026-09-05_18300.db.gz",
            "kasir_2026-09-05_996100.db.gz",
            "kasir_2026-09-05_1830_00.db.gz",
        ] {
            assert_eq!(parse_backup_filename(name), None, "should reject {name:?}");
        }
    }

    /// B04: every one of these used to resolve outside the backup folder,
    /// because `Path::join` replaces the base for an absolute argument and lets
    /// `..` through.
    #[test]
    fn resolve_rejects_anything_that_escapes_the_backup_folder() {
        let dir = Path::new("C:\\data\\backups");
        for filename in [
            "C:\\Users\\kasir\\AppData\\Roaming\\com.kasir.pos\\kasir.db",
            "\\\\?\\C:\\Windows\\System32\\config\\SAM",
            "..\\kasir.db",
            "..\\..\\kasir_2026-09-05.db.gz",
            "sub\\kasir_2026-09-05.db.gz",
            "sub/kasir_2026-09-05.db.gz",
            "/etc/passwd",
            "C:kasir_2026-09-05.db.gz",
            ".",
            "..",
            "",
            "kasir.db",
            "kasir_.db.gz",
        ] {
            assert!(
                resolve_backup_path(dir, filename).is_err(),
                "should reject {filename:?}"
            );
        }
    }

    #[test]
    fn resolve_accepts_a_backup_name_in_the_backup_folder() {
        let dir = Path::new("C:\\data\\backups");
        let resolved = resolve_backup_path(dir, "kasir_2026-09-05.db.gz").expect("valid name");
        assert_eq!(resolved, dir.join("kasir_2026-09-05.db.gz"));
    }

    #[test]
    fn sqlite_header_is_required() {
        assert!(is_sqlite_database(b"SQLite format 3\0some more pages"));
        assert!(!is_sqlite_database(b"SQLite format 3"));
        assert!(!is_sqlite_database(b""));
        assert!(!is_sqlite_database(b"<html>not a database</html>"));
    }

    #[test]
    fn parse_rejects_unrelated_files() {
        for name in [
            "",
            "kasir_2026-09-05.db",
            "notes.txt",
            "kasir_2026-13-45.db.gz",
            "kasir_2026-09-05 .db.gz",
            "backup_2026-09-05.db.gz",
        ] {
            assert_eq!(parse_backup_filename(name), None, "should reject {name:?}");
        }
    }
}
