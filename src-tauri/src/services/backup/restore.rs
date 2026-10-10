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

    /// A scratch folder per test, removed when the guard drops.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("kasir-restore-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).expect("scratch dir");
            Self(dir)
        }

        fn db(&self) -> PathBuf {
            self.0.join("kasir.db")
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// A real SQLite file at `path` holding one table named `table`.
    fn sqlite_with_table(path: &Path, table: &str) {
        let conn = rusqlite::Connection::open(path).expect("open");
        conn.execute_batch(&format!(
            "CREATE TABLE {table} (id INTEGER); INSERT INTO {table} VALUES (1);"
        ))
        .expect("schema");
    }

    fn has_table(path: &Path, table: &str) -> bool {
        let conn = rusqlite::Connection::open(path).expect("open");
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get::<_, i64>(0),
        )
        .expect("query")
            == 1
    }

    #[test]
    fn with_nothing_staged_the_live_database_is_left_alone() {
        let scratch = Scratch::new();
        sqlite_with_table(&scratch.db(), "live_rows");

        assert!(!apply_pending_restore(&scratch.db()).expect("no-op"));
        assert!(has_table(&scratch.db(), "live_rows"));
        assert!(!pre_restore_path(&scratch.db()).exists());
    }

    /// Bytes that are not a database never become a pending restore.
    #[test]
    fn a_non_sqlite_image_is_refused_and_nothing_is_staged() {
        let scratch = Scratch::new();

        let error = stage_restore_bytes(&scratch.db(), b"PK\x03\x04 a zip, not a database")
            .expect_err("refused");
        assert!(matches!(error, AppError::Validation(_)), "{error:?}");
        assert!(!pending_restore_path(&scratch.db()).exists());
        assert!(!staging_restore_path(&scratch.db()).exists());
    }

    /// The swap installs the staged image, keeps the replaced database as
    /// `.pre-restore`, and removes the old database's `-wal`/`-shm`, which
    /// would otherwise be replayed over the restored file.
    #[test]
    fn a_staged_restore_replaces_the_live_database_and_keeps_the_old_one() {
        let scratch = Scratch::new();
        sqlite_with_table(&scratch.db(), "old_rows");

        let image_path = scratch.0.join("image.db");
        sqlite_with_table(&image_path, "restored_rows");
        let image = fs::read(&image_path).expect("read image");
        stage_restore_bytes(&scratch.db(), &image).expect("stage");
        assert!(pending_restore_path(&scratch.db()).exists());

        fs::write(sibling_path(&scratch.db(), "-wal"), b"stale wal").expect("wal");
        fs::write(sibling_path(&scratch.db(), "-shm"), b"stale shm").expect("shm");

        assert!(apply_pending_restore(&scratch.db()).expect("applied"));

        assert!(has_table(&scratch.db(), "restored_rows"));
        assert!(!has_table(&scratch.db(), "old_rows"));
        assert!(has_table(&pre_restore_path(&scratch.db()), "old_rows"));
        assert!(!pending_restore_path(&scratch.db()).exists());
        assert!(
            !sibling_path(&scratch.db(), "-wal").exists() || {
                // Opening the restored file above may legitimately create a fresh
                // sidecar; what must not survive is the stale content.
                fs::read(sibling_path(&scratch.db(), "-wal")).unwrap_or_default() != b"stale wal"
            }
        );
        assert_ne!(
            fs::read(sibling_path(&scratch.db(), "-shm")).unwrap_or_default(),
            b"stale shm"
        );

        // Applied once; a second launch has nothing to do.
        assert!(!apply_pending_restore(&scratch.db()).expect("no-op"));
    }

    /// A pending file that lost its header (crash, disk trouble) is thrown
    /// away, and the live database is not touched.
    #[test]
    fn a_corrupt_pending_restore_is_discarded_and_the_live_database_kept() {
        let scratch = Scratch::new();
        sqlite_with_table(&scratch.db(), "live_rows");
        fs::write(pending_restore_path(&scratch.db()), b"SQLite").expect("truncated pending");

        assert!(apply_pending_restore(&scratch.db()).is_err());
        assert!(!pending_restore_path(&scratch.db()).exists());
        assert!(has_table(&scratch.db(), "live_rows"));
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        use std::io::Write;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(bytes).expect("gzip");
        encoder.finish().expect("gzip")
    }

    #[test]
    fn an_archive_restores_only_when_it_holds_a_database() {
        let scratch = Scratch::new();

        let not_gzip = scratch.0.join("plain.db.gz");
        fs::write(&not_gzip, b"not gzip at all").expect("write");
        assert!(stage_restore_from_archive(&scratch.db(), &not_gzip).is_err());

        let gz_text = scratch.0.join("text.db.gz");
        fs::write(&gz_text, gzip(b"hello, not sqlite")).expect("write");
        assert!(matches!(
            stage_restore_from_archive(&scratch.db(), &gz_text),
            Err(AppError::Validation(_))
        ));
        assert!(!pending_restore_path(&scratch.db()).exists());

        let image_path = scratch.0.join("image.db");
        sqlite_with_table(&image_path, "restored_rows");
        let good = scratch.0.join("good.db.gz");
        fs::write(&good, gzip(&fs::read(&image_path).expect("read"))).expect("write");
        stage_restore_from_archive(&scratch.db(), &good).expect("staged");
        assert!(pending_restore_path(&scratch.db()).exists());
    }
}
