//! Backup filenames: the one shape a backup is written under, and the checks
//! that keep a client-supplied name inside the backup folder.

use chrono::Local;
use std::path::{Component, Path, PathBuf};

use crate::utils::AppError;

pub(super) const BACKUP_PREFIX: &str = "kasir_";
const BACKUP_SUFFIX: &str = ".db.gz";

/// The local calendar date encoded in a backup filename, plus the time of day
/// when the name carries one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct BackupName {
    pub(super) date: chrono::NaiveDate,
    pub(super) time: Option<chrono::NaiveTime>,
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
pub(super) fn parse_backup_filename(name: &str) -> Option<BackupName> {
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
pub(super) fn resolve_backup_path(backup_dir: &Path, filename: &str) -> Result<PathBuf, AppError> {
    let mut components = Path::new(filename).components();
    let single_component = matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    );

    if !single_component || parse_backup_filename(filename).is_none() {
        return Err(AppError::Validation(
            "Nama file backup tidak valid".to_string(),
        ));
    }

    Ok(backup_dir.join(filename))
}

/// Name for a backup taken at local time `now`.
///
/// The time used to be omitted, so a 3-hour interval wrote the same
/// `kasir_YYYY-MM-DD.db.gz` eight times a day: a database that broke at 10:00
/// had its healthy 09:00 snapshot overwritten at 12:00 by a copy of the broken
/// one, and the best recovery point silently moved back to yesterday. The name
/// is in local time because it is what the shop owner reads in the file list.
pub(super) fn backup_filename_for(now: chrono::DateTime<Local>) -> String {
    format!(
        "{}{}{}",
        BACKUP_PREFIX,
        now.format("%Y-%m-%d_%H%M%S"),
        BACKUP_SUFFIX
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, TimeZone};

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
}
