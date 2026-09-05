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

use sea_orm::DatabaseConnection;

use crate::utils::require_role;
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

/// Parse `kasir_YYYY-MM-DD.db.gz`, returning `None` for anything else.
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
    let date = chrono::NaiveDate::parse_from_str(stem, "%Y-%m-%d").ok()?;
    Some(BackupName { date, time: None })
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

/// Create a compressed backup of the database
fn create_backup_file(db_path: &Path, backup_dir: &Path) -> Result<BackupInfo, AppError> {
    fs::create_dir_all(backup_dir)
        .map_err(|e| AppError::Internal(format!("Gagal membuat folder backup: {}", e)))?;

    let now = Local::now();
    let filename = format!("kasir_{}.db.gz", now.format("%Y-%m-%d"));
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
        created_at: now.format("%Y-%m-%d %H:%M:%S").to_string(),
    })
}

/// Every backup in `backup_dir`, newest first.
///
/// The single place that turns directory entries into `BackupInfo`; both
/// `list_backups` and `get_backup_status` used to carry their own copy of this
/// loop, complete with their own copy of the panicking name slice. A missing
/// directory is an empty list, not an error — it just means no backup has run
/// yet.
fn collect_backups(backup_dir: &Path) -> Result<Vec<BackupInfo>, AppError> {
    let mut backups: Vec<BackupInfo> = Vec::new();

    if !backup_dir.exists() {
        return Ok(backups);
    }

    let entries = fs::read_dir(backup_dir)
        .map_err(|e| AppError::Internal(format!("Gagal membaca folder backup: {}", e)))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(parsed) = parse_backup_filename(&name) else {
            continue;
        };
        let Ok(meta) = entry.metadata() else { continue };
        backups.push(BackupInfo {
            filename: name,
            size_bytes: meta.len(),
            created_at: format!("{} 00:00:00", parsed.date.format("%Y-%m-%d")),
        });
    }

    backups.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(backups)
}

/// Delete backups older than retention period
fn cleanup_old_backups(backup_dir: &Path, retention_days: i64) -> Result<usize, AppError> {
    let cutoff = (Local::now() - chrono::Duration::days(retention_days)).date_naive();
    let mut deleted = 0;

    if !backup_dir.exists() {
        return Ok(0);
    }

    let entries = fs::read_dir(backup_dir)
        .map_err(|e| AppError::Internal(format!("Gagal membaca folder backup: {}", e)))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(parsed) = parse_backup_filename(&name) else {
            continue;
        };
        if parsed.date < cutoff && fs::remove_file(entry.path()).is_ok() {
            deleted += 1;
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

        // Initial backup on startup (skip if today's backup already exists)
        let backup_dir = get_backup_dir();
        if !has_todays_backup(&backup_dir) {
            match run_backup(retention_days) {
                Ok(info) => {
                    let mut s = scheduler.lock().await;
                    s.last_backup = Some(info);
                }
                Err(_) => {}
            }
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
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    scheduler: State<'_, Arc<Mutex<BackupScheduler>>>,
) -> Result<BackupInfo, AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

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

#[tauri::command]
pub async fn list_backups() -> Result<Vec<BackupInfo>, AppError> {
    collect_backups(&get_backup_dir())
}

#[tauri::command]
pub async fn restore_backup(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    filename: String,
) -> Result<String, AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let backup_dir = get_backup_dir();
    let backup_path = resolve_backup_path(&backup_dir, &filename)?;

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

    if !is_sqlite_database(&db_data) {
        return Err(AppError::Validation(
            "File backup bukan database SQLite yang valid".to_string(),
        ));
    }

    // Stage next to the live database instead of writing over it. The sea-orm
    // pool still holds `kasir.db` open, so an in-process overwrite races SQLite's
    // page cache; `apply_pending_restore` performs the swap at the next launch,
    // before the pool is created.
    let pending = pending_restore_path(&db_path);
    let staging = {
        let mut p = pending.as_os_str().to_os_string();
        p.push(".tmp");
        PathBuf::from(p)
    };

    fs::write(&staging, &db_data)
        .map_err(|e| AppError::Internal(format!("Gagal menulis file restore: {}", e)))?;
    fs::rename(&staging, &pending).map_err(|e| {
        let _ = fs::remove_file(&staging);
        AppError::Internal(format!("Gagal menyiapkan file restore: {}", e))
    })?;

    Ok("Backup siap dipulihkan. Tutup dan buka kembali aplikasi untuk menerapkannya.".into())
}

#[tauri::command]
pub async fn delete_backup(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    filename: String,
) -> Result<(), AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let backup_dir = get_backup_dir();
    let backup_path = resolve_backup_path(&backup_dir, &filename)?;

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
    use chrono::NaiveDate;

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
