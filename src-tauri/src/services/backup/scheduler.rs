//! The background schedule that keeps automatic backups coming.

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use super::folder::has_todays_backup;
use super::run_backup_blocking;
use crate::domain::backup::{BackupInfo, BackupSettings};
use crate::domain::settings::parse_app_settings;
use crate::utils::logging::log_error;
use crate::utils::paths::{get_backup_dir, get_db_path};

/// Shared state for the backup scheduler
pub struct BackupScheduler {
    pub last_backup: Option<BackupInfo>,
}

impl BackupScheduler {
    pub fn new() -> Self {
        Self { last_backup: None }
    }
}

/// Read backup settings from the database.
///
/// Always returns `sanitized()` values: this is the single choke point every
/// caller goes through, so nothing downstream has to defend itself against a
/// zero interval or a negative retention that was written by an older build or
/// edited into the JSON blob by hand.
pub(super) fn read_backup_settings_from_db() -> BackupSettings {
    let db_path = get_db_path();
    if !db_path.exists() {
        return BackupSettings::default();
    }

    let additional_info =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .and_then(|conn| {
                conn.query_row(
                    "SELECT additional_info FROM store_info WHERE id = 1",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
            })
            .ok()
            .flatten();

    parse_app_settings(&additional_info).backup.sanitized()
}

/// An automatic backup; a failure is logged, since nobody is waiting for it.
async fn run_scheduled_backup(scheduler: &Mutex<BackupScheduler>, retention_days: i64) {
    match run_backup_blocking(retention_days).await {
        Ok(info) => scheduler.lock().await.last_backup = Some(info),
        Err(e) => log_error(&format!("Automatic backup failed: {e}")),
    }
}

/// How often the scheduler wakes to re-read the interval, so a changed
/// interval takes effect within a minute rather than after the old one ran out.
const SCHEDULER_TICK: Duration = Duration::from_secs(60);

/// The scheduler's body. Spawned once at startup by the transport layer, which
/// owns the choice of runtime; everything it decides lives here.
pub async fn run_scheduler(scheduler: Arc<Mutex<BackupScheduler>>) {
    // Already sanitized by read_backup_settings_from_db().
    let settings = read_backup_settings_from_db();

    // Initial backup on startup (skip if today's backup already exists)
    if !has_todays_backup(&get_backup_dir()) {
        run_scheduled_backup(&scheduler, settings.retention_days).await;
    }

    let mut last_run = tokio::time::Instant::now();
    loop {
        // Re-read (and re-clamp) the settings every tick: this both picks
        // up an interval the admin changed since launch and keeps a bad
        // stored value from reaching the timer. `sleep` is used rather than
        // `tokio::time::interval`, which PANICS on a zero period — and a
        // panic here happens inside this spawned task, so automatic backups
        // would simply stop with nothing logged and nothing shown in the UI.
        tokio::time::sleep(SCHEDULER_TICK).await;
        let current_settings = read_backup_settings_from_db();
        let period = Duration::from_secs(current_settings.interval_hours * 3600);
        if last_run.elapsed() < period {
            continue;
        }
        last_run = tokio::time::Instant::now();
        run_scheduled_backup(&scheduler, current_settings.retention_days).await;
    }
}
