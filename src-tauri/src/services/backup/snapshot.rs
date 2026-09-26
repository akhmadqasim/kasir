//! Consistent copies of the live database: the compressed archive a backup
//! keeps, and the plain snapshot an export streams.

use chrono::Local;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use super::folder::system_time_to_utc_string;
use super::naming::{backup_filename_for, BACKUP_PREFIX};
use crate::domain::backup::BackupInfo;
use crate::utils::AppError;

/// Suffix of the uncompressed snapshot a backup is compressed from.
const SNAPSHOT_SUFFIX: &str = ".snapshot";
/// Suffix of an archive still being written.
const PARTIAL_SUFFIX: &str = ".partial";

/// Write a consistent copy of the live database to `out` with `VACUUM INTO`.
///
/// Reading `kasir.db` byte by byte is not a snapshot, even after a checkpoint:
/// an open reader can keep recent commits in `-wal`, and the pool's automatic
/// checkpoint can rewrite pages of the main file while it is being read, which
/// yields a torn image that still passes the header check on restore. SQLite
/// builds this copy inside a single read transaction, WAL contents included.
fn snapshot_database(db_path: &Path, out: &Path) -> Result<(), AppError> {
    let fail =
        |e: &dyn std::fmt::Display| AppError::Internal(format!("Gagal menyalin database: {}", e));
    let out = out
        .to_str()
        .ok_or_else(|| fail(&"path backup bukan UTF-8"))?;

    let conn = rusqlite::Connection::open(db_path).map_err(|e| fail(&e))?;
    let _ = conn.busy_timeout(Duration::from_secs(5));
    conn.execute("VACUUM INTO ?1", [out])
        .map_err(|e| fail(&e))?;
    Ok(())
}

/// A consistent snapshot of the live database for download, as an open handle
/// to a file that no longer has a name.
///
/// The snapshot is written to `work_dir` by [`snapshot_database`], opened, and
/// unlinked straight away: the handle keeps the bytes readable until it is
/// dropped, and nothing is left on disk whether the download finishes, the
/// client disconnects, or the caller errors out. (Rust opens files with
/// `FILE_SHARE_DELETE` on Windows, so the unlink succeeds there too.) Should the
/// process die between writing and unlinking, the working-file name is swept
/// by [`remove_stale_working_files`] on the next backup.
pub(crate) fn export_snapshot(db_path: &Path, work_dir: &Path) -> Result<fs::File, AppError> {
    fs::create_dir_all(work_dir)
        .map_err(|e| AppError::Internal(format!("Gagal membuat folder ekspor: {}", e)))?;
    let snapshot = work_dir.join(format!(
        "{BACKUP_PREFIX}export-{}{SNAPSHOT_SUFFIX}",
        uuid::Uuid::new_v4().simple()
    ));

    let opened = snapshot_database(db_path, &snapshot).and_then(|()| {
        fs::File::open(&snapshot)
            .map_err(|e| AppError::Internal(format!("Gagal membuka hasil ekspor: {}", e)))
    });
    let removed = fs::remove_file(&snapshot);
    let file = opened?;
    removed.map_err(|e| AppError::Internal(format!("Gagal membersihkan hasil ekspor: {}", e)))?;
    Ok(file)
}

/// Gzip `src` into `dest`, streaming, and flush it to disk.
fn compress_file(src: &Path, dest: &Path) -> Result<(), AppError> {
    let mut input = fs::File::open(src)
        .map_err(|e| AppError::Internal(format!("Gagal membaca database: {}", e)))?;
    let output = fs::File::create(dest)
        .map_err(|e| AppError::Internal(format!("Gagal membuat file backup: {}", e)))?;
    let mut encoder = GzEncoder::new(output, Compression::default());
    std::io::copy(&mut input, &mut encoder)
        .map_err(|e| AppError::Internal(format!("Gagal mengompres backup: {}", e)))?;
    encoder
        .finish()
        .and_then(|file| file.sync_all())
        .map_err(|e| AppError::Internal(format!("Gagal menyelesaikan backup: {}", e)))
}

/// Remove working files an interrupted backup left behind. Only ones older
/// than an hour, so a backup running right now keeps its own.
pub(super) fn remove_stale_working_files(backup_dir: &Path) {
    let Ok(entries) = fs::read_dir(backup_dir) else {
        return;
    };
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(60 * 60))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let working = name.starts_with(BACKUP_PREFIX)
            && (name.ends_with(SNAPSHOT_SUFFIX) || name.ends_with(PARTIAL_SUFFIX));
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .is_ok_and(|modified| modified < cutoff);
        if working && stale {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Create a compressed backup of the database
pub(super) fn create_backup_file(
    db_path: &Path,
    backup_dir: &Path,
) -> Result<BackupInfo, AppError> {
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

    // Neither working file parses as a backup name, so one left behind by a
    // crash or a full disk is never listed, restored, or counted as one of the
    // backups retention keeps. Only a finished archive gets the real name.
    let snapshot = backup_dir.join(format!("{filename}{SNAPSHOT_SUFFIX}"));
    let partial = backup_dir.join(format!("{filename}{PARTIAL_SUFFIX}"));

    let written = snapshot_database(db_path, &snapshot)
        .and_then(|()| compress_file(&snapshot, &partial))
        .and_then(|()| {
            fs::rename(&partial, &backup_path)
                .map_err(|e| AppError::Internal(format!("Gagal menyimpan backup: {}", e)))
        });
    let _ = fs::remove_file(&snapshot);
    if let Err(e) = written {
        let _ = fs::remove_file(&partial);
        return Err(e);
    }

    let metadata = fs::metadata(&backup_path)
        .map_err(|e| AppError::Internal(format!("Gagal membaca info backup: {}", e)))?;

    Ok(BackupInfo {
        filename,
        size_bytes: metadata.len(),
        created_at: system_time_to_utc_string(metadata.modified().ok()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::backup::restore::is_sqlite_database;
    use std::io::Read;

    /// A backup holds what is committed even while it still sits in `-wal`
    /// behind an open connection, and leaves only the finished archive behind.
    #[test]
    fn a_backup_is_a_complete_snapshot_under_its_final_name_only() {
        let root = std::env::temp_dir().join(format!("kasir-backup-test-{}", uuid::Uuid::new_v4()));
        let backup_dir = root.join("backups");
        fs::create_dir_all(&root).expect("temp dir");
        let db_path = root.join("kasir.db");

        // Stays open, as the pool does, so the rows are not checkpointed.
        let live = rusqlite::Connection::open(&db_path).expect("open");
        live.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;
             CREATE TABLE sales (id INTEGER PRIMARY KEY);
             INSERT INTO sales DEFAULT VALUES; INSERT INTO sales DEFAULT VALUES;",
        )
        .expect("seed");

        let info = create_backup_file(&db_path, &backup_dir).expect("backup");

        let names: Vec<String> = fs::read_dir(&backup_dir)
            .expect("list")
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec![info.filename.clone()]);

        let mut restored = Vec::new();
        flate2::read::GzDecoder::new(fs::File::open(backup_dir.join(&info.filename)).unwrap())
            .read_to_end(&mut restored)
            .expect("decompress");
        let restored_path = root.join("restored.db");
        fs::write(&restored_path, &restored).expect("write");
        let count: i64 = rusqlite::Connection::open(&restored_path)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .expect("count");
        assert_eq!(count, 2);

        drop(live);
        let _ = fs::remove_dir_all(&root);
    }

    /// The export holds rows committed a moment before it, while they are still
    /// only in `-wal` behind an open connection, and leaves no file behind.
    #[test]
    fn an_export_includes_rows_still_in_the_wal_and_leaves_nothing_on_disk() {
        let root = std::env::temp_dir().join(format!("kasir-export-test-{}", uuid::Uuid::new_v4()));
        let work_dir = root.join("backups");
        fs::create_dir_all(&root).expect("temp dir");
        let db_path = root.join("kasir.db");

        // Stays open, as the pool does, so nothing is checkpointed.
        let live = rusqlite::Connection::open(&db_path).expect("open");
        live.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;
             CREATE TABLE sales (id INTEGER PRIMARY KEY);
             INSERT INTO sales DEFAULT VALUES;",
        )
        .expect("seed");
        // Written just before exporting.
        live.execute_batch("INSERT INTO sales DEFAULT VALUES; INSERT INTO sales DEFAULT VALUES;")
            .expect("late sales");
        let wal = root.join("kasir.db-wal");
        assert!(fs::metadata(&wal).map(|m| m.len() > 0).unwrap_or(false));

        let mut file = export_snapshot(&db_path, &work_dir).expect("export");
        assert_eq!(
            fs::read_dir(&work_dir).expect("list").count(),
            0,
            "the snapshot must not outlive its handle's name"
        );

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).expect("read export");
        drop(file);
        assert!(is_sqlite_database(&bytes));
        let exported_path = root.join("exported.db");
        fs::write(&exported_path, &bytes).expect("write");
        let count: i64 = rusqlite::Connection::open(&exported_path)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .expect("count");
        assert_eq!(count, 3);

        drop(live);
        let _ = fs::remove_dir_all(&root);
    }
}
