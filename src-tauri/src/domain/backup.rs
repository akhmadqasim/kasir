//! Backup settings and the shapes the backup screens read.

use serde::{Deserialize, Serialize};

use crate::utils::AppError;

const DEFAULT_INTERVAL_HOURS: u64 = 3;
const DEFAULT_RETENTION_DAYS: i64 = 90;

/// A zero interval panics `tokio::time::interval`; a week is already far longer
/// than the longest option the UI offers.
const MIN_INTERVAL_HOURS: u64 = 1;
const MAX_INTERVAL_HOURS: u64 = 24 * 7;

/// A retention below one day (in particular zero or negative) puts the cleanup
/// cutoff at or after "now", so a backup is deleted on the tick that created it.
pub const MIN_RETENTION_DAYS: i64 = 1;
pub const MAX_RETENTION_DAYS: i64 = 3650;

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

impl BackupSettings {
    /// Reject values the scheduler cannot survive. Called from
    /// `services::settings::update_app_settings`, the only write boundary for
    /// these fields.
    pub fn validate(&self) -> Result<(), AppError> {
        if !(MIN_INTERVAL_HOURS..=MAX_INTERVAL_HOURS).contains(&self.interval_hours) {
            return Err(AppError::Validation(format!(
                "Interval backup harus antara {} dan {} jam",
                MIN_INTERVAL_HOURS, MAX_INTERVAL_HOURS
            )));
        }
        if !(MIN_RETENTION_DAYS..=MAX_RETENTION_DAYS).contains(&self.retention_days) {
            return Err(AppError::Validation(format!(
                "Retensi backup harus antara {} dan {} hari",
                MIN_RETENTION_DAYS, MAX_RETENTION_DAYS
            )));
        }
        Ok(())
    }

    /// The same bounds applied by clamping instead of rejecting.
    ///
    /// Validating at the write boundary is not enough on its own: the settings
    /// live in a free-form JSON blob in `store_info.additional_info` that can be
    /// hand-edited or written by an older build, and the consequences of a bad
    /// value are silent. `interval_hours = 0` makes
    /// `tokio::time::interval(Duration::ZERO)` panic inside the scheduler's
    /// spawned task, which kills every future automatic backup with nothing
    /// logged anywhere; `retention_days <= 0` makes `cleanup_old_backups` delete
    /// the backup `run_backup` just created.
    pub fn sanitized(&self) -> Self {
        Self {
            interval_hours: self
                .interval_hours
                .clamp(MIN_INTERVAL_HOURS, MAX_INTERVAL_HOURS),
            retention_days: self
                .retention_days
                .clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS),
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A zero interval reaches `tokio::time::interval`, which panics, and the
    /// panic is invisible because it happens in a spawned task.
    #[test]
    fn sanitize_lifts_a_zero_interval_off_the_panic() {
        let s = BackupSettings {
            interval_hours: 0,
            retention_days: 90,
        }
        .sanitized();
        assert_eq!(s.interval_hours, MIN_INTERVAL_HOURS);
        assert!(s.interval_hours * 3600 > 0);
    }

    /// A negative retention put the cleanup cutoff in the future, so the backup
    /// `run_backup` had just created was deleted by `cleanup_old_backups`.
    #[test]
    fn sanitize_lifts_a_negative_retention() {
        let s = BackupSettings {
            interval_hours: 3,
            retention_days: -7,
        }
        .sanitized();
        assert_eq!(s.retention_days, MIN_RETENTION_DAYS);
    }

    #[test]
    fn sanitize_leaves_usable_values_alone_and_caps_absurd_ones() {
        let ok = BackupSettings {
            interval_hours: 6,
            retention_days: 30,
        };
        assert_eq!(ok.sanitized().interval_hours, 6);
        assert_eq!(ok.sanitized().retention_days, 30);

        let huge = BackupSettings {
            interval_hours: u64::MAX,
            retention_days: i64::MAX,
        }
        .sanitized();
        assert_eq!(huge.interval_hours, MAX_INTERVAL_HOURS);
        assert_eq!(huge.retention_days, MAX_RETENTION_DAYS);
        // Would have overflowed `interval_hours * 3600` before clamping.
        assert!(huge.interval_hours.checked_mul(3600).is_some());
    }

    #[test]
    fn validate_rejects_what_sanitize_would_have_had_to_clamp() {
        for (interval, retention) in [(0, 90), (u64::MAX, 90), (3, 0), (3, -1), (3, i64::MAX)] {
            let s = BackupSettings {
                interval_hours: interval,
                retention_days: retention,
            };
            assert!(
                s.validate().is_err(),
                "should reject interval={interval} retention={retention}"
            );
        }
        // Every option the settings UI offers must pass.
        for interval in [1, 2, 3, 6, 12, 24] {
            for retention in [30, 60, 90, 180, 365] {
                assert!(BackupSettings {
                    interval_hours: interval,
                    retention_days: retention,
                }
                .validate()
                .is_ok());
            }
        }
    }
}
