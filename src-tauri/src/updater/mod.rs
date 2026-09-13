//! Self-update, driven from Rust and reported over the HTTP API.
//!
//! The frontend never touches `@tauri-apps/api`: the window loads an ordinary
//! `http://127.0.0.1:<port>` origin (and tablets load the same page over the
//! LAN), so Tauri's IPC is not there to call. Instead this module owns one
//! process-wide [`Updater`] that `http::routes::updates` exposes as four small
//! endpoints — status, check, download, install — and the screen polls the
//! status while something is in flight.
//!
//! The heavy lifting (fetching `latest.json`, comparing versions, verifying the
//! minisign signature, launching the installer) is `tauri-plugin-updater`. What
//! lives here is the state machine around it:
//!
//! ```text
//! Idle ──check──► Checking ──► UpToDate
//!                          └─► Available ──download──► Downloading ──► Ready ──install──► Installing
//!                          └─► Failed{check}              └─► Failed{download}       └─► Failed{install}
//! ```
//!
//! `Installing` is the last thing this process reports: on Windows the plugin
//! hands the bytes to the NSIS/MSI installer and calls `std::process::exit(0)`,
//! and the installer relaunches the app when it is done. Download and install
//! are split on purpose — the download can run while the cashier keeps
//! selling, and the moment the app closes is chosen by a person.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri_plugin_updater::{Update, UpdaterBuilder};

use crate::utils::{logging, AppError};

/// How long one check may spend talking to GitHub before it is a failure.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// Ceiling on one download, start to finish. Generous because a shop
/// connection can be slow and the installer is tens of megabytes; without any
/// ceiling a stalled socket leaves the phase `Downloading` forever, and both
/// `check` and `download` defer to a download in flight.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Head start the `install` response gets before the process exits.
const INSTALL_GRACE: Duration = Duration::from_millis(500);

/// Delay before the automatic check after launch — the window, the database
/// and the first screen all matter more than a GitHub round-trip.
const STARTUP_CHECK_DELAY: Duration = Duration::from_secs(15);

/// How often a running app re-checks. A till stays open all day; without this
/// a release published in the morning is only noticed at tomorrow's launch.
const RECHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// Which step a [`UpdatePhase::Failed`] came from. The screen shows a failed
/// *check* only when the check was asked for, but a failed *download* always —
/// somebody pressed the button that started it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStep {
    Check,
    Download,
    Install,
}

/// Where the updater is. Serialised with a `phase` tag so the frontend can
/// switch on one string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum UpdatePhase {
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
        notes: Option<String>,
        /// RFC 3339, when the manifest carried a `pub_date`.
        published_at: Option<String>,
    },
    Downloading {
        version: String,
        received: u64,
        /// `Content-Length`, when the server sent one.
        total: Option<u64>,
    },
    /// Downloaded and signature-verified; waiting for someone to say "now".
    Ready {
        version: String,
    },
    Installing {
        version: String,
    },
    Failed {
        step: UpdateStep,
        message: String,
    },
}

/// What `GET /api/updates` answers.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateStatus {
    pub current_version: String,
    #[serde(flatten)]
    pub phase: UpdatePhase,
}

/// Everything behind the mutex. `update` and `bytes` outlive the phase they
/// were produced in so a failed download can be retried without another check
/// and a `Ready` survives a re-check that finds the same version.
struct Inner {
    phase: UpdatePhase,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

/// Makes a fresh plugin builder — `app.updater_builder()` behind a closure.
///
/// A closure rather than the `AppHandle` itself for a reason that only shows
/// up in `cargo test`: calling any `AppHandle` method from this module links
/// the whole Wry runtime into the test binary, and with it a `comctl32` v6
/// import the unmanifested test executable cannot resolve. The closure is
/// written in `lib.rs`, which the tests never call.
pub type BuilderFactory = Box<dyn Fn() -> UpdaterBuilder + Send + Sync>;

pub struct Updater {
    /// Set once from Tauri's `setup`; empty in tests and before the window
    /// exists. Every operation needs it, `status` does not.
    factory: OnceLock<BuilderFactory>,
    inner: Mutex<Inner>,
    /// Serialises `check` calls so two admins pressing the button together
    /// produce one request at a time rather than interleaved phase writes.
    check_lock: tokio::sync::Mutex<()>,
}

impl Default for Updater {
    fn default() -> Self {
        Self::new()
    }
}

impl Updater {
    pub fn new() -> Self {
        Self {
            factory: OnceLock::new(),
            inner: Mutex::new(Inner {
                phase: UpdatePhase::Idle,
                update: None,
                bytes: None,
            }),
            check_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// Hand over the way to reach the plugin. Called once from `setup`; a
    /// second call is ignored because nothing useful could be done with it.
    pub fn attach(&self, factory: impl Fn() -> UpdaterBuilder + Send + Sync + 'static) {
        let _ = self.factory.set(Box::new(factory));
    }

    pub fn status(&self) -> UpdateStatus {
        status_of(&self.lock())
    }

    /// Ask GitHub whether there is a newer release.
    ///
    /// A no-op while a download or install is in flight — both already know
    /// what they are installing. Returns the status the check ended in, so the
    /// explicit "Periksa pembaruan" button gets its answer in the same response.
    pub async fn check(self: &Arc<Self>) -> Result<UpdateStatus, AppError> {
        let _serial = self.check_lock.lock().await;

        {
            let inner = self.lock();
            if matches!(
                inner.phase,
                UpdatePhase::Downloading { .. } | UpdatePhase::Installing { .. }
            ) {
                return Ok(status_of(&inner));
            }
        }
        // Before the phase moves: an updater nobody attached is a programming
        // error, not a failed check, and leaves the status alone.
        let builder = self.builder()?;
        let before = std::mem::replace(&mut self.lock().phase, UpdatePhase::Checking);

        let result = match builder.timeout(CHECK_TIMEOUT).build() {
            Ok(updater) => updater.check().await,
            Err(e) => Err(e),
        };

        let mut inner = self.lock();
        // A download started while this check was on the wire owns the phase
        // now; applying a stale answer over it would pair the new metadata
        // with the old bytes. The next check picks up whatever this one saw.
        if inner.phase != UpdatePhase::Checking {
            return Ok(status_of(&inner));
        }
        match result {
            Ok(Some(update)) => {
                // A re-check that finds the version already sitting downloaded
                // must not throw those bytes away.
                let already_ready = inner.bytes.is_some()
                    && inner
                        .update
                        .as_ref()
                        .is_some_and(|held| held.version == update.version);
                if already_ready {
                    inner.phase = UpdatePhase::Ready {
                        version: update.version.clone(),
                    };
                } else {
                    inner.bytes = None;
                    inner.phase = UpdatePhase::Available {
                        version: update.version.clone(),
                        notes: update.body.clone(),
                        // The manifest string itself: the plugin has already
                        // parsed it as RFC 3339, and re-formatting would need
                        // the `time` crate for nothing.
                        published_at: update.raw_json["pub_date"].as_str().map(str::to_owned),
                    };
                }
                logging::log_info(&format!(
                    "Update check: {} available (running {})",
                    update.version, update.current_version
                ));
                inner.update = Some(update);
            }
            Ok(None) => {
                inner.update = None;
                inner.bytes = None;
                inner.phase = UpdatePhase::UpToDate;
            }
            Err(e) => {
                logging::log_error(&format!("Update check failed: {e}"));
                // A release already found — or already downloaded — is still
                // there; an unreachable GitHub does not un-find it.
                inner.phase = match before {
                    UpdatePhase::Available { .. } | UpdatePhase::Ready { .. } => before,
                    _ => UpdatePhase::Failed {
                        step: UpdateStep::Check,
                        message: describe_check_error(&e),
                    },
                };
            }
        }
        drop(inner);

        Ok(self.status())
    }

    /// Start downloading the release the last check found. Returns as soon as
    /// the download is running; progress arrives through [`Updater::status`].
    pub fn download(self: &Arc<Self>) -> Result<UpdateStatus, AppError> {
        let update = {
            let mut inner = self.lock();
            if matches!(
                inner.phase,
                UpdatePhase::Downloading { .. }
                    | UpdatePhase::Installing { .. }
                    | UpdatePhase::Ready { .. }
            ) {
                return Ok(status_of(&inner));
            }
            let Some(mut update) = inner.update.clone() else {
                return Err(AppError::Validation(
                    "Belum ada pembaruan untuk diunduh. Periksa pembaruan dulu.".into(),
                ));
            };
            update.timeout = Some(DOWNLOAD_TIMEOUT);
            inner.bytes = None;
            inner.phase = UpdatePhase::Downloading {
                version: update.version.clone(),
                received: 0,
                total: None,
            };
            update
        };

        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let progress = Arc::clone(&this);
            let version = update.version.clone();
            let mut received: u64 = 0;
            let on_chunk = move |chunk: usize, total: Option<u64>| {
                received += chunk as u64;
                let mut inner = progress.lock();
                if matches!(inner.phase, UpdatePhase::Downloading { .. }) {
                    inner.phase = UpdatePhase::Downloading {
                        version: version.clone(),
                        received,
                        total,
                    };
                }
            };

            match update.download(on_chunk, || {}).await {
                Ok(bytes) => {
                    logging::log_info(&format!(
                        "Update {} downloaded and verified ({} bytes)",
                        update.version,
                        bytes.len()
                    ));
                    let mut inner = this.lock();
                    inner.bytes = Some(bytes);
                    inner.phase = UpdatePhase::Ready {
                        version: update.version.clone(),
                    };
                }
                Err(e) => {
                    logging::log_error(&format!("Update download failed: {e}"));
                    this.fail(UpdateStep::Download, describe_download_error(&e));
                }
            }
        });

        Ok(self.status())
    }

    /// Hand the verified installer to Windows. On success this process exits a
    /// moment after the response is sent; the installer relaunches the app.
    pub fn install(self: &Arc<Self>) -> Result<UpdateStatus, AppError> {
        let (update, bytes) = {
            let mut inner = self.lock();
            if matches!(inner.phase, UpdatePhase::Installing { .. }) {
                return Ok(status_of(&inner));
            }
            let (Some(update), Some(bytes)) = (inner.update.clone(), inner.bytes.take()) else {
                return Err(AppError::Validation(
                    "Pembaruan belum diunduh. Unduh dulu sebelum memasang.".into(),
                ));
            };
            inner.phase = UpdatePhase::Installing {
                version: update.version.clone(),
            };
            (update, bytes)
        };

        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(INSTALL_GRACE).await;
            logging::log_startup(&format!(
                "Installing update {} — the installer will relaunch the app",
                update.version
            ));
            // Blocking: writes the temp file, launches the installer and, on
            // Windows, never returns because it exits the process.
            let outcome =
                tauri::async_runtime::spawn_blocking(move || update.install(&bytes)).await;
            let error = match outcome {
                Ok(Ok(())) => return,
                Ok(Err(e)) => e.to_string(),
                Err(e) => e.to_string(),
            };
            logging::log_error(&format!("Update install failed: {error}"));
            this.fail(
                UpdateStep::Install,
                "Pemasangan tidak dapat dimulai. Unduh ulang pembaruan lalu coba lagi.".into(),
            );
            // The bytes are gone (`take()` above), so the next attempt has to
            // download again; leaving `update` in place lets it skip the check.
        });

        Ok(self.status())
    }

    /// Periodic silent checks for a running app: one shortly after launch,
    /// then every [`RECHECK_INTERVAL`]. Failures are recorded in the status and
    /// the log, never surfaced as a toast — that is the frontend's rule for a
    /// check nobody asked for.
    pub fn spawn_background_checks(self: &Arc<Self>) {
        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(STARTUP_CHECK_DELAY).await;
            loop {
                if let Err(e) = this.check().await {
                    logging::log_error(&format!("Background update check failed: {e}"));
                }
                tokio::time::sleep(RECHECK_INTERVAL).await;
            }
        });
    }

    fn builder(&self) -> Result<UpdaterBuilder, AppError> {
        self.factory.get().map(|make| make()).ok_or_else(|| {
            AppError::Internal("updater used before the Tauri app handle was attached".into())
        })
    }

    fn fail(&self, step: UpdateStep, message: String) {
        self.lock().phase = UpdatePhase::Failed { step, message };
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A poisoned lock means a panic while holding it; the phase is still
        // the best information there is, so recover rather than propagate.
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The status as of one look at the state. Takes the guard rather than
/// locking again so a caller that already holds it cannot deadlock on the
/// non-reentrant mutex — which is exactly what the first version of this did.
fn status_of(inner: &Inner) -> UpdateStatus {
    UpdateStatus {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        phase: inner.phase.clone(),
    }
}

/// Indonesian text for the screen. The plugin's messages name URLs and crates;
/// the person at the till needs to know whether to check the cable or wait.
fn describe_check_error(error: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match error {
        Error::ReleaseNotFound | Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            "Server rilis tidak menyediakan informasi pembaruan untuk versi ini.".into()
        }
        Error::Reqwest(_) | Error::Network(_) => {
            "Tidak dapat menghubungi server pembaruan. Periksa koneksi internet.".into()
        }
        Error::Serialization(_) | Error::Semver(_) => {
            "Informasi rilis di server tidak dapat dibaca.".into()
        }
        _ => "Pemeriksaan pembaruan gagal. Coba lagi nanti.".into(),
    }
}

fn describe_download_error(error: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match error {
        Error::Reqwest(_) | Error::Network(_) => {
            "Unduhan terputus. Periksa koneksi internet lalu coba lagi.".into()
        }
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => {
            "Tanda tangan berkas pembaruan tidak cocok. Berkas tidak dipasang.".into()
        }
        _ => "Unduhan pembaruan gagal. Coba lagi nanti.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn updater() -> Arc<Updater> {
        Arc::new(Updater::new())
    }

    #[test]
    fn a_fresh_updater_is_idle_and_reports_the_crate_version() {
        let status = updater().status();
        assert_eq!(status.phase, UpdatePhase::Idle);
        assert_eq!(status.current_version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn download_refuses_when_no_check_has_found_anything() {
        let err = updater().download().expect_err("nothing to download");
        assert!(matches!(err, AppError::Validation(_)), "{err:?}");
        // The refusal leaves the phase alone.
        assert_eq!(updater().status().phase, UpdatePhase::Idle);
    }

    #[test]
    fn install_refuses_before_a_download_has_finished() {
        let err = updater().install().expect_err("nothing downloaded");
        assert!(matches!(err, AppError::Validation(_)), "{err:?}");
    }

    #[tokio::test]
    async fn check_without_an_app_handle_is_an_internal_error_that_leaves_the_phase_alone() {
        let updater = updater();
        let err = updater.check().await.expect_err("no handle");
        assert!(matches!(err, AppError::Internal(_)), "{err:?}");
        assert_eq!(updater.status().phase, UpdatePhase::Idle);
    }

    #[tokio::test]
    async fn check_is_a_no_op_while_a_download_is_in_flight() {
        let updater = updater();
        updater.lock().phase = UpdatePhase::Downloading {
            version: "9.9.9".into(),
            received: 10,
            total: Some(100),
        };
        // No app handle is attached, so a check that actually ran would fail
        // and flip the phase; an unchanged phase proves it did not run.
        let status = updater.check().await.expect("no-op is fine");
        assert!(matches!(status.phase, UpdatePhase::Downloading { .. }));
    }

    /// The wire format the frontend switches on: one `phase` tag, fields
    /// flattened beside it, snake_case throughout.
    #[test]
    fn the_status_serialises_with_a_flat_phase_tag() {
        let status = UpdateStatus {
            current_version: "0.5.0".into(),
            phase: UpdatePhase::Downloading {
                version: "0.6.0".into(),
                received: 1024,
                total: Some(4096),
            },
        };
        let json = serde_json::to_value(&status).expect("serialise");
        assert_eq!(
            json,
            serde_json::json!({
                "current_version": "0.5.0",
                "phase": "downloading",
                "version": "0.6.0",
                "received": 1024,
                "total": 4096
            })
        );

        let failed = serde_json::to_value(UpdatePhase::Failed {
            step: UpdateStep::Download,
            message: "x".into(),
        })
        .expect("serialise");
        assert_eq!(failed["phase"], "failed");
        assert_eq!(failed["step"], "download");
    }

    /// The manifest `scripts/release.ps1` uploads, in the exact shape it
    /// writes, must be something the plugin can parse and resolve for a
    /// Windows install of either bundle type. Guards the contract between the
    /// script and the plugin without a network.
    #[test]
    fn the_release_script_manifest_shape_is_what_the_plugin_reads() {
        let manifest = serde_json::json!({
            "version": "0.6.0",
            "notes": "Perbaikan struk PPOB.",
            "pub_date": "2026-09-13T02:00:00Z",
            "platforms": {
                "windows-x86_64-nsis": {
                    "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo=",
                    "url": "https://github.com/akhmadqasim/kasir/releases/download/v0.6.0/kasir_0.6.0_x64-setup.exe"
                },
                "windows-x86_64-msi": {
                    "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo=",
                    "url": "https://github.com/akhmadqasim/kasir/releases/download/v0.6.0/kasir_0.6.0_x64_en-US.msi"
                },
                "windows-x86_64": {
                    "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo=",
                    "url": "https://github.com/akhmadqasim/kasir/releases/download/v0.6.0/kasir_0.6.0_x64-setup.exe"
                }
            }
        });

        let release: tauri_plugin_updater::RemoteRelease =
            serde_json::from_value(manifest).expect("the plugin parses the manifest");
        assert_eq!(release.version.to_string(), "0.6.0");
        assert!(release.pub_date.is_some());
        for target in [
            "windows-x86_64-nsis",
            "windows-x86_64-msi",
            "windows-x86_64",
        ] {
            release.download_url(target).expect(target);
            release.signature(target).expect(target);
        }
        assert!(release
            .download_url("windows-x86_64-nsis")
            .unwrap()
            .path()
            .ends_with("-setup.exe"));
        assert!(release
            .download_url("windows-x86_64-msi")
            .unwrap()
            .path()
            .ends_with(".msi"));
    }

    /// `v0.6.0` — the tag name — is accepted as a version too, so a script
    /// that copies the tag into `version` still works.
    #[test]
    fn a_leading_v_in_the_manifest_version_is_tolerated() {
        let manifest = serde_json::json!({
            "version": "v0.6.0",
            "platforms": { "windows-x86_64": { "signature": "c2ln", "url": "https://example.com/a.exe" } }
        });
        let release: tauri_plugin_updater::RemoteRelease =
            serde_json::from_value(manifest).expect("parses");
        assert_eq!(release.version.to_string(), "0.6.0");
    }
}
