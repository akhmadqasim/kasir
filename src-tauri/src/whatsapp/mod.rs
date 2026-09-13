//! WhatsApp receipt sending: a sidecar process wrapping `whatsapp-web.js`,
//! talked to over stdin/stdout JSON lines. See `sidecar/whatsapp/` for the
//! Node side and [`protocol`] for the wire format both sides speak.
//!
//! Kept out of `services/` — like `updater` — because it has to hold a real
//! child process and, in a release build, resolve the sidecar through the
//! Tauri app handle; `services/` modules must never import `tauri` so that
//! `cargo test --lib` can exercise every business rule without a running app.
//!
//! This module owns the live connection *only* — the process, its phase, and
//! an in-memory copy of whether the feature is switched on — and never
//! touches the database itself. [`crate::services::whatsapp`] owns the one
//! thing this module deliberately knows nothing about: that `enabled`
//! survives a restart. Its `enable`/`disable` persist the setting and then
//! call the plain (`db`-free) methods here, which is what keeps the
//! dependency one-directional — this module has no `services::whatsapp`
//! import, only the reverse.
//!
//! One process at a time, spawned when the feature is turned on and killed
//! when it is turned off — the process's lifetime *is* the live "connected"
//! state, independent of `enabled`, which is what survives a restart and
//! tells `services::whatsapp` whether to reconnect on the next launch.
//!
//! ```text
//! Off ──enable──► Starting ──► QrPending{qr} ──(scanned)──► Ready{number}
//!  ▲                                                            │
//!  │                                                    disconnected/crash
//!  └──────────────────── disable ──────────────────────────────┘
//!                                                          Disconnected{reason}
//!                                                     (auto-restart while enabled)
//! ```
//!
//! The generation counter is what makes `disable` the only deliberate exit:
//! it is bumped in the same locked section that kills the child, so the
//! `Terminated` event that kill produces always arrives tagged with a
//! generation [`WhatsappManager::on_exit`] no longer recognises as current,
//! and is dropped before the restart logic ever runs. Every *other* exit —
//! a crash, a `logout` invalidating the session, the browser closing — keeps
//! the generation it was spawned under, reaches the restart logic, and is
//! retried with backoff.

pub mod process;
pub mod protocol;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri_plugin_shell::process::{Command as ShellCommand, CommandChild};
use tokio::sync::oneshot;

use crate::utils::{logging, AppError};

use self::protocol::{Command, SidecarEvent, SidecarMessage};

/// How long a `send`/`logout` command may wait for its ack before the caller
/// is told it failed. The sidecar itself waits 2-6s before every send (see
/// its `whatsapp-client.ts`), so this has to clear that with room for the
/// message itself to actually go out.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// Backoff after an unexpected exit: 2s, 4s, 8s, ... capped at a minute, so a
/// sidecar that keeps crashing does not spin the shop PC's CPU.
const RESTART_BACKOFF_INITIAL: Duration = Duration::from_secs(2);
const RESTART_BACKOFF_MAX: Duration = Duration::from_secs(60);

/// Where the connection is right now. Independent of whether the feature is
/// turned on — see the module doc for how the two relate.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum WhatsappPhase {
    Off,
    Starting,
    QrPending { qr: String },
    Ready { number: String },
    Disconnected { reason: String },
}

/// `GET /api/whatsapp/status`. Cheap to read — no I/O — so the frontend can
/// poll it as often as it likes.
#[derive(Debug, Clone, Serialize)]
pub struct WhatsappStatus {
    /// Mirrors the persisted setting; kept in sync by
    /// `services::whatsapp::enable`/`disable`, which write it here in the
    /// same call that persists it.
    pub enabled: bool,
    #[serde(flatten)]
    pub phase: WhatsappPhase,
}

/// Builds the command that launches the sidecar for a given session
/// directory. Debug and release builds resolve a different program (`node` +
/// the workspace path, vs. the bundled sidecar executable + a resource path) —
/// see [`process::dev_spawn_factory`]/[`process::release_spawn_factory`].
/// Attached once from `lib.rs`'s `setup`, the same shape as
/// `updater::Updater`'s `BuilderFactory`: a closure captured over the
/// `AppHandle`, which does not exist yet when this manager is constructed.
pub type SpawnFactory = Box<dyn Fn(&str) -> Result<ShellCommand, AppError> + Send + Sync>;

struct Inner {
    enabled: bool,
    phase: WhatsappPhase,
    child: Option<CommandChild>,
    pending: HashMap<u64, oneshot::Sender<Result<(), String>>>,
    /// Bumped on every spawn and on every `disable`. The reader task and the
    /// restart timer close over the generation they belong to, so an event or
    /// exit from a process this manager has already superseded cannot be
    /// mistaken for the current one — see the module doc.
    generation: u64,
}

pub struct WhatsappManager {
    session_dir: PathBuf,
    spawn: OnceLock<SpawnFactory>,
    inner: Mutex<Inner>,
    next_id: AtomicU64,
    /// Serialises `enable`/`disable`/`logout`, so two admins pressing buttons
    /// at once cannot spawn two children or kill one that a `send` just
    /// started depending on.
    lifecycle: tokio::sync::Mutex<()>,
}

impl WhatsappManager {
    /// `session_dir` is where `LocalAuth` keeps the linked session — see
    /// `utils::paths::get_whatsapp_session_dir`, under the app data dir so it
    /// survives an update but not an uninstall.
    pub fn new(session_dir: PathBuf) -> Self {
        Self {
            session_dir,
            spawn: OnceLock::new(),
            inner: Mutex::new(Inner {
                enabled: false,
                phase: WhatsappPhase::Off,
                child: None,
                pending: HashMap::new(),
                generation: 0,
            }),
            next_id: AtomicU64::new(1),
            lifecycle: tokio::sync::Mutex::new(()),
        }
    }

    pub fn attach(
        &self,
        spawn: impl Fn(&str) -> Result<ShellCommand, AppError> + Send + Sync + 'static,
    ) {
        let _ = self.spawn.set(Box::new(spawn));
    }

    pub fn status(&self) -> WhatsappStatus {
        let inner = self.lock();
        WhatsappStatus {
            enabled: inner.enabled,
            phase: inner.phase.clone(),
        }
    }

    /// Mark the feature enabled and spawn the sidecar if it is not already
    /// running (a second `enable` while one is already starting or connected
    /// is a no-op on the live side). Persisting the setting is
    /// `services::whatsapp::enable`'s job, not this one's.
    pub async fn enable(self: &Arc<Self>) -> Result<WhatsappStatus, AppError> {
        let _serial = self.lifecycle.lock().await;

        let already_running = {
            let mut inner = self.lock();
            inner.enabled = true;
            !matches!(inner.phase, WhatsappPhase::Off)
        };
        if !already_running {
            self.spawn_now()?;
        }

        Ok(self.status())
    }

    /// Mark the feature disabled and kill the sidecar. See the module doc for
    /// why bumping the generation here — before the kill — is what makes this
    /// exit deliberate rather than a crash worth restarting from.
    pub async fn disable(self: &Arc<Self>) -> Result<WhatsappStatus, AppError> {
        let _serial = self.lifecycle.lock().await;

        let child = {
            let mut inner = self.lock();
            inner.enabled = false;
            inner.phase = WhatsappPhase::Off;
            inner.generation = inner.generation.wrapping_add(1);
            fail_pending(&mut inner, "WhatsApp dinonaktifkan.");
            inner.child.take()
        };
        if let Some(child) = child {
            if let Err(e) = child.kill() {
                logging::log_error(&format!("failed to stop the WhatsApp sidecar: {e}"));
            }
        }

        Ok(self.status())
    }

    /// Ask the sidecar to invalidate its linked session. The sidecar exits
    /// once it has (see `whatsapp-client.ts`); nothing here marks that exit
    /// deliberate — the generation is not bumped — so the ordinary
    /// crash-restart path spawns a fresh process, and a fresh QR, for as long
    /// as the feature is still enabled.
    pub async fn logout(self: &Arc<Self>) -> Result<(), AppError> {
        let _serial = self.lifecycle.lock().await;

        let has_child = self.lock().child.is_some();
        if !has_child {
            return Err(AppError::Validation("WhatsApp belum aktif.".into()));
        }

        // Best-effort: the sidecar exits either way, and a reply lost to that
        // exit racing the ack is not a reason to tell the admin logout failed.
        let _ = self
            .send_command_awaiting_ack(Command::Logout { id: None })
            .await;
        Ok(())
    }

    /// Send a struk image (or plain text, if no image is given) to `to`.
    /// Requires the connection to be [`WhatsappPhase::Ready`] — normalising
    /// the number and checking WhatsApp registration both happen in the
    /// sidecar, which is the side that can actually ask WhatsApp.
    pub async fn send(
        &self,
        to: &str,
        text: Option<String>,
        image_png_base64: Option<String>,
    ) -> Result<(), AppError> {
        if !matches!(self.lock().phase, WhatsappPhase::Ready { .. }) {
            return Err(AppError::Validation(
                "WhatsApp belum terhubung. Tautkan perangkat dulu di Pengaturan.".into(),
            ));
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.send_command_awaiting_ack_with_id(
            id,
            Command::Send {
                id,
                to: to.to_string(),
                text,
                image_png_base64,
            },
        )
        .await
    }

    async fn send_command_awaiting_ack(&self, command: Command) -> Result<(), AppError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.send_command_awaiting_ack_with_id(id, command).await
    }

    async fn send_command_awaiting_ack_with_id(
        &self,
        id: u64,
        command: Command,
    ) -> Result<(), AppError> {
        let (tx, rx) = oneshot::channel();
        let write_result = {
            let mut inner = self.lock();
            if inner.child.is_none() {
                return Err(AppError::Validation("WhatsApp belum aktif.".into()));
            }
            inner.pending.insert(id, tx);
            // Separate from the check above so the mutable borrow of `child`
            // does not overlap the one `pending.insert` just took.
            inner
                .child
                .as_mut()
                .expect("checked above")
                .write(command.to_line().as_bytes())
        };

        if let Err(e) = write_result {
            self.lock().pending.remove(&id);
            return Err(AppError::Internal(format!(
                "Gagal mengirim perintah ke proses WhatsApp: {e}"
            )));
        }

        match tokio::time::timeout(COMMAND_TIMEOUT, rx).await {
            Ok(Ok(Ok(()))) => Ok(()),
            Ok(Ok(Err(message))) => Err(AppError::Validation(message)),
            Ok(Err(_)) => Err(AppError::Internal(
                "Proses WhatsApp berhenti sebelum menjawab.".into(),
            )),
            Err(_) => {
                self.lock().pending.remove(&id);
                Err(AppError::Internal(
                    "Proses WhatsApp tidak menjawab tepat waktu.".into(),
                ))
            }
        }
    }

    fn spawn_now(self: &Arc<Self>) -> Result<(), AppError> {
        let session_dir = self.session_dir.to_string_lossy().to_string();
        let make = self
            .spawn
            .get()
            .ok_or_else(|| AppError::Internal("WhatsApp sidecar belum siap dijalankan.".into()))?;
        let command = make(&session_dir)?;

        let generation = {
            let mut inner = self.lock();
            inner.phase = WhatsappPhase::Starting;
            inner.generation = inner.generation.wrapping_add(1);
            inner.generation
        };

        process::spawn_and_pump(Arc::clone(self), command, generation)
    }

    /// Called by [`process::spawn_and_pump`] once the child is actually
    /// running. If a newer generation has already superseded this spawn (a
    /// `disable` raced the spawn itself), the child is stopped immediately
    /// instead of being adopted — there must never be two live children.
    fn set_child(&self, generation: u64, child: CommandChild) {
        let mut inner = self.lock();
        if inner.generation == generation {
            inner.child = Some(child);
        } else {
            drop(inner);
            let _ = child.kill();
        }
    }

    /// Called by the reader task in [`process`] for every line the sidecar
    /// wrote to stdout, tagged with the generation it was read under.
    fn on_message(self: &Arc<Self>, generation: u64, message: SidecarMessage) {
        let mut inner = self.lock();
        if inner.generation != generation {
            return;
        }
        match message {
            SidecarMessage::Event(event) => apply_event(&mut inner, event),
            SidecarMessage::Ack { id, result } => {
                if let Some(tx) = inner.pending.remove(&id) {
                    let _ = tx.send(result);
                }
            }
        }
    }

    /// Called by the reader task once the child's stdout closes (the process
    /// exited, for whatever reason). A stale generation here means `disable`
    /// already handled this exact exit — see the module doc — so there is
    /// nothing left to do but return.
    fn on_exit(self: &Arc<Self>, generation: u64) {
        {
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            inner.child = None;
            fail_pending(&mut inner, "Proses WhatsApp berhenti.");
            if !matches!(inner.phase, WhatsappPhase::Disconnected { .. }) {
                inner.phase = WhatsappPhase::Disconnected {
                    reason: "Proses berhenti tak terduga.".to_string(),
                };
            }
        }
        self.schedule_restart(RESTART_BACKOFF_INITIAL);
    }

    fn schedule_restart(self: &Arc<Self>, delay: Duration) {
        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(delay).await;
            // Disabled (or re-enabled and already running) while this was
            // waiting: nothing to do.
            let should_restart =
                { matches!(this.lock().phase, WhatsappPhase::Disconnected { .. }) };
            if !should_restart {
                return;
            }
            if let Err(e) = this.spawn_now() {
                logging::log_error(&format!(
                    "WhatsApp sidecar restart failed, retrying in {:?}: {e}",
                    (delay * 2).min(RESTART_BACKOFF_MAX)
                ));
                this.schedule_restart((delay * 2).min(RESTART_BACKOFF_MAX));
            }
        });
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Every pending command fails the same way when the connection drops out
/// from under it — a `send` on a sidecar that just crashed is not going to
/// hear back, and holding the sender open would leak the oneshot and time the
/// caller out instead of telling them promptly.
fn fail_pending(inner: &mut Inner, message: &str) {
    for (_, tx) in inner.pending.drain() {
        let _ = tx.send(Err(message.to_string()));
    }
}

fn apply_event(inner: &mut Inner, event: SidecarEvent) {
    inner.phase = match event {
        SidecarEvent::Qr { qr } => WhatsappPhase::QrPending { qr },
        SidecarEvent::Ready { number } => WhatsappPhase::Ready { number },
        SidecarEvent::Disconnected { reason } => WhatsappPhase::Disconnected { reason },
        SidecarEvent::Error { message } => WhatsappPhase::Disconnected { reason: message },
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> Arc<WhatsappManager> {
        Arc::new(WhatsappManager::new(PathBuf::from("test-session")))
    }

    #[test]
    fn a_fresh_manager_is_off_and_disabled() {
        let status = manager().status();
        assert_eq!(status.phase, WhatsappPhase::Off);
        assert!(!status.enabled);
    }

    #[tokio::test]
    async fn enable_without_a_spawn_factory_attached_is_an_internal_error() {
        let err = manager().enable().await.expect_err("no factory attached");
        assert!(matches!(err, AppError::Internal(_)));
    }

    #[tokio::test]
    async fn disable_turns_a_fresh_manager_off() {
        let manager = manager();
        let status = manager.disable().await.expect("disable");
        assert_eq!(status.phase, WhatsappPhase::Off);
        assert!(!status.enabled);
    }

    #[tokio::test]
    async fn sending_without_a_ready_connection_is_refused() {
        let manager = manager();
        let err = manager
            .send("6281234567890", Some("hi".into()), None)
            .await
            .expect_err("not ready");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn logout_without_a_live_child_is_refused() {
        let err = manager().logout().await.expect_err("nothing to log out of");
        assert!(matches!(err, AppError::Validation(_)));
    }

    // ------------------------------------------------------------------
    // The state machine, driven directly — no process involved.
    // ------------------------------------------------------------------

    #[test]
    fn a_qr_event_moves_to_qr_pending() {
        let manager = manager();
        apply_event(&mut manager.lock(), SidecarEvent::Qr { qr: "2@abc".into() });
        assert_eq!(
            manager.lock().phase,
            WhatsappPhase::QrPending { qr: "2@abc".into() }
        );
    }

    #[test]
    fn a_ready_event_moves_to_ready_with_the_number() {
        let manager = manager();
        apply_event(
            &mut manager.lock(),
            SidecarEvent::Ready {
                number: "6281234567890".into(),
            },
        );
        assert_eq!(
            manager.lock().phase,
            WhatsappPhase::Ready {
                number: "6281234567890".into()
            }
        );
    }

    #[test]
    fn an_error_event_is_reported_as_disconnected() {
        let manager = manager();
        apply_event(
            &mut manager.lock(),
            SidecarEvent::Error {
                message: "Chrome tidak ditemukan".into(),
            },
        );
        assert_eq!(
            manager.lock().phase,
            WhatsappPhase::Disconnected {
                reason: "Chrome tidak ditemukan".into()
            }
        );
    }

    #[test]
    fn a_message_tagged_with_a_superseded_generation_is_ignored() {
        let manager = manager();
        manager.lock().generation = 5;
        manager.on_message(
            4,
            SidecarMessage::Event(SidecarEvent::Ready { number: "x".into() }),
        );
        assert_eq!(manager.lock().phase, WhatsappPhase::Off);
    }

    /// This is the case the module doc describes: a `disable` bumps the
    /// generation and kills the child in the same critical section, so the
    /// `on_exit` that kill eventually produces arrives tagged with the old
    /// generation and is dropped — `disable`'s own `Off` is never overwritten
    /// and no restart is scheduled.
    #[test]
    fn on_exit_tagged_with_a_generation_disable_already_moved_past_is_a_no_op() {
        let manager = manager();
        {
            let mut inner = manager.lock();
            inner.phase = WhatsappPhase::Off;
            inner.generation = 1;
        }
        manager.on_exit(0);
        assert_eq!(manager.lock().phase, WhatsappPhase::Off);
    }

    #[test]
    fn on_exit_after_a_crash_reports_disconnected() {
        let manager = manager();
        manager.lock().phase = WhatsappPhase::Ready { number: "x".into() };
        manager.on_exit(0);
        assert!(matches!(
            manager.lock().phase,
            WhatsappPhase::Disconnected { .. }
        ));
    }

    #[test]
    fn a_pending_command_fails_promptly_when_the_connection_drops() {
        let manager = manager();
        let (tx, mut rx) = oneshot::channel();
        manager.lock().pending.insert(1, tx);

        manager.on_exit(0);

        assert!(rx.try_recv().expect("answered").is_err());
    }
}
