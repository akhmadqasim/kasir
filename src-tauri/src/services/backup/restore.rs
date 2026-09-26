//! Replacing the live database: staging an image now, installing it at the
//! next launch, before anything holds the file open.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::utils::AppError;

/// The 16-byte magic every SQLite database file starts with.
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

/// True when `bytes` begins with the SQLite file header.
///
/// Guards the restore and import paths so a truncated download, a gzip of
/// something else, or a text file cannot be installed as the live database and
/// only fail at the next launch.
pub(super) fn is_sqlite_database(bytes: &[u8]) -> bool {
    bytes.starts_with(SQLITE_HEADER)
}

/// `db_path` with `suffix` appended to its file name.
fn sibling_path(db_path: &Path, suffix: &str) -> PathBuf {
    let mut p = db_path.as_os_str().to_os_string();
    p.push(suffix);
    PathBuf::from(p)
}

/// Where a restore is staged until the next launch: `kasir.db.restore-pending`.
fn pending_restore_path(db_path: &Path) -> PathBuf {
    sibling_path(db_path, ".restore-pending")
}

/// Copy of the database that a restore replaced, kept as a safety net.
fn pre_restore_path(db_path: &Path) -> PathBuf {
    sibling_path(db_path, ".pre-restore")
}

/// Half-written staging file, renamed onto [`pending_restore_path`] once
/// complete so a crash mid-write can never leave a partial "pending restore".
fn staging_restore_path(db_path: &Path) -> PathBuf {
    sibling_path(db_path, ".restore-pending.tmp")
}

/// Publish a fully written staging file as the pending restore.
fn publish_staged_restore(db_path: &Path, staging: &Path) -> Result<(), AppError> {
    fs::rename(staging, pending_restore_path(db_path)).map_err(|e| {
        let _ = fs::remove_file(staging);
        AppError::Internal(format!("Gagal menyiapkan file restore: {}", e))
    })
}

/// Stage an in-memory database image to replace `db_path` at the next launch.
pub(crate) fn stage_restore_bytes(db_path: &Path, data: &[u8]) -> Result<(), AppError> {
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

/// Decompress a backup archive and stage it to replace `db_path` at the next
/// launch.
///
/// Staged next to the live database instead of written over it: the sea-orm
/// pool still holds `kasir.db` open, so an in-process overwrite races SQLite's
/// page cache; [`apply_pending_restore`] performs the swap at the next launch,
/// before the pool is created.
pub(super) fn stage_restore_from_archive(db_path: &Path, archive: &Path) -> Result<(), AppError> {
    let archive_file = fs::File::open(archive)
        .map_err(|e| AppError::Internal(format!("Gagal membuka backup: {}", e)))?;
    let mut db_data = Vec::new();
    flate2::read::GzDecoder::new(archive_file)
        .read_to_end(&mut db_data)
        .map_err(|e| AppError::Internal(format!("Gagal dekompresi backup: {}", e)))?;

    stage_restore_bytes(db_path, &db_data)
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
pub(crate) fn apply_pending_restore(db_path: &Path) -> Result<bool, AppError> {
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
        // The last session's sales are usually still in `-wal` (the pool is
        // never closed on exit), and that file is deleted below. Nothing holds
        // the database yet, so this checkpoint lands all of it in the copy.
        checkpoint_wal(db_path);
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

/// Flush committed WAL pages into the main `.db` file before it is copied as a
/// plain file (the pre-restore safety copy, taken before anything holds it open).
/// Without this, a read of `kasir.db` misses everything still sitting in
/// `kasir.db-wal` — the day's sales. Best-effort: a transient BUSY must not
/// abort the caller, and the busy timeout gives open readers a moment to finish
/// so the checkpoint is not skipped just because a request was mid-query.
fn checkpoint_wal(db_path: &Path) {
    match rusqlite::Connection::open(db_path) {
        Ok(conn) => {
            let _ = conn.busy_timeout(Duration::from_secs(5));
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
        let sidecar = sibling_path(db_path, suffix);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_header_is_required() {
        assert!(is_sqlite_database(b"SQLite format 3\0some more pages"));
        assert!(!is_sqlite_database(b"SQLite format 3"));
        assert!(!is_sqlite_database(b""));
        assert!(!is_sqlite_database(b"<html>not a database</html>"));
    }
}
