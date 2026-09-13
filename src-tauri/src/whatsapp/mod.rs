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
//! `disable` (and the app's own shutdown) is the only exit this manager
//! treats as deliberate, via [`Inner::stopping`] — set before asking the
//! sidecar to stop, read by [`WhatsappManager::on_exit`] to skip the restart.
//! It has to be a flag rather than only the generation counter: stopping the
//! child asks it to close its own browser and *waits* for that (see
//! [`WhatsappManager::stop_child`]), so there is a real gap between "decided
//! to stop" and "the process is actually gone" during which its `Terminated`
//! event, when it arrives, is still tagged with the generation it was spawned
//! under — nothing has re-spawned in that gap to make the generation counter
//! alone tell the two cases apart. Every *other* exit — a crash, a `logout`
//! invalidating the session — leaves `stopping` false, reaches the restart
//! logic, and is retried with backoff.
//!
//! Killing the child outright, without asking first, would not be enough on
//! its own: on Windows that is `TerminateProcess`, which Node cannot catch,
//! so `whatsapp-web.js` never gets to close the Chromium/Edge it launched —
//! that browser would keep running as an orphan every single time the
//! feature is turned off. [`WhatsappManager::stop_child`] asks first
//! (`Command::Shutdown`, which — unlike `Command::Logout` — does not
//! invalidate the linked session) and only kills the child if it has not
//! exited on its own within [`GRACEFUL_STOP_TIMEOUT`].

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

/// How long `disable`/the app's own shutdown wait for the sidecar to close
/// its own browser and exit on its own before giving up and killing it.
/// `Client.destroy()`/`logout()` closing a real headless browser is a
/// sub-second operation; this leaves generous room without making an admin
/// wait long for "Nonaktifkan" to answer.
const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_secs(5);

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

/// Releases a transaction's [`WhatsappManager::claim_send`] claim when
/// dropped — whether the send that follows succeeds, fails, or panics — so a
/// claim can never be stuck held forever by a caller that forgot to release
/// it explicitly.
pub struct SendClaim<'a> {
    manager: &'a WhatsappManager,
    transaction_id: i64,
}

impl std::fmt::Debug for SendClaim<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SendClaim")
            .field("transaction_id", &self.transaction_id)
            .finish()
    }
}

impl Drop for SendClaim<'_> {
    fn drop(&mut self) {
        self.manager.lock().sending.remove(&self.transaction_id);
    }
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
    /// Bumped on every spawn. The reader task and the restart timer close
    /// over the generation they belong to, so an event or exit from a
    /// process this manager has already superseded cannot be mistaken for
    /// the current one.
    generation: u64,
    /// True for the duration of [`WhatsappManager::stop_child`]. See the
    /// module doc for why the generation counter alone cannot make that
    /// exit's `Terminated` event distinguishable from a crash.
    stopping: bool,
    /// Transaction ids with a send in flight right now — see
    /// [`WhatsappManager::claim_send`]. Not a general de-duplication scheme
    /// (a deliberate resend a few seconds later is expected and fine, and is
    /// what `whatsapp_sends` is for); this only closes the narrower gap where
    /// two devices with the same transaction open — the till and a tablet —
    /// both press "Kirim WhatsApp" within the same few seconds.
    sending: std::collections::HashSet<i64>,
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
                stopping: false,
                sending: std::collections::HashSet::new(),
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

    /// Mark the feature disabled and stop the sidecar — see
    /// [`Self::stop_child`] for why that is more than just killing it.
    pub async fn disable(self: &Arc<Self>) -> Result<WhatsappStatus, AppError> {
        let _serial = self.lifecycle.lock().await;

        self.stop_child().await;

        let mut inner = self.lock();
        inner.enabled = false;
        inner.phase = WhatsappPhase::Off;
        fail_pending(&mut inner, "WhatsApp dinonaktifkan.");
        Ok(WhatsappStatus {
            enabled: inner.enabled,
            phase: inner.phase.clone(),
        })
    }

    /// Stop the sidecar the same deliberate way `disable` does, without
    /// touching `enabled` or the persisted setting — called once, from the
    /// app's own shutdown. The only path that must not leave the sidecar (and
    /// the browser it launched) running after the till's own window has
    /// closed.
    pub async fn shutdown(self: &Arc<Self>) {
        let _serial = self.lifecycle.lock().await;
        self.stop_child().await;
    }

    /// Ask the sidecar to close its own browser and exit
    /// ([`Command::Shutdown`], not [`Command::Logout`] — this must not
    /// invalidate the linked session), wait up to [`GRACEFUL_STOP_TIMEOUT`]
    /// for it to do so, and kill it if it has not. A hard kill alone is
    /// `TerminateProcess` on Windows, which Node cannot catch, so
    /// `whatsapp-web.js` would never get a chance to close the browser it
    /// launched — asking first is what keeps that browser from outliving
    /// this process as an orphan every time the feature is turned off. A
    /// no-op if nothing is running.
    async fn stop_child(self: &Arc<Self>) {
        if self.lock().child.is_none() {
            return;
        }
        self.lock().stopping = true;

        // The sidecar's own protocol never acks a command sent with no id
        // (see `whatsapp-client.ts`) — it just exits, which resolves this the
        // same way a crash resolves a pending `send`: `on_exit`'s
        // `fail_pending` wakes it, just promptly and on purpose rather than
        // by surprise. Bounded so a sidecar that does not exit on its own
        // cannot make `disable` (or the app closing) hang.
        let waited = tokio::time::timeout(
            GRACEFUL_STOP_TIMEOUT,
            self.send_command_awaiting_ack(Command::Shutdown { id: None }),
        )
        .await;
        if waited.is_err() {
            logging::log_error("WhatsApp sidecar did not exit within the grace period; killing it");
        }

        let child = self.lock().child.take();
        if let Some(child) = child {
            if let Err(e) = child.kill() {
                logging::log_error(&format!("failed to stop the WhatsApp sidecar: {e}"));
            }
        }
        self.lock().stopping = false;
    }

    /// Ask the sidecar to invalidate its linked session. `Client.logout()`
    /// already closes its own browser before the sidecar exits (unlike a
    /// hard kill, this is the sidecar closing itself, not Windows
    /// terminating it), so this only has to send the command; the ordinary
    /// crash-restart path spawns a fresh process, and a fresh QR, once it
    /// exits, for as long as the feature is still enabled.
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

    /// Claim the right to send `transaction_id`'s receipt right now, refusing
    /// a second concurrent attempt while the first is still in flight — see
    /// [`Inner::sending`]. Held by the caller for the duration of one `send`
    /// (it releases the claim when dropped), so `services::whatsapp::send_receipt`
    /// only has to keep the guard alive across its own `await` points.
    pub fn claim_send(&self, transaction_id: i64) -> Result<SendClaim<'_>, AppError> {
        let mut inner = self.lock();
        if !inner.sending.insert(transaction_id) {
            return Err(AppError::Validation(
                "Struk untuk transaksi ini sedang dikirim ke WhatsApp. Tunggu sampai selesai."
                    .into(),
            ));
        }
        Ok(SendClaim {
            manager: self,
            transaction_id,
        })
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
    /// exited, for whatever reason). A stale generation means a fresh spawn
    /// has already superseded this one; `stopping` is what says whether the
    /// exit itself was asked for — see the module doc for why the generation
    /// counter alone cannot tell a deliberate stop from a crash here.
    fn on_exit(self: &Arc<Self>, generation: u64) {
        let restart = {
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            inner.child = None;
            fail_pending(&mut inner, "Proses WhatsApp berhenti.");
            let restart = !inner.stopping;
            if !inner.stopping && !matches!(inner.phase, WhatsappPhase::Disconnected { .. }) {
                inner.phase = WhatsappPhase::Disconnected {
                    reason: "Proses berhenti tak terduga.".to_string(),
                };
            }
            restart
        };
        if restart {
            self.schedule_restart(RESTART_BACKOFF_INITIAL);
        }
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
    // No double-send: a second concurrent claim on the same transaction is
    // refused — the till and a tablet both open on the same sale, both
    // pressed "Kirim WhatsApp" within the same few seconds.
    // ------------------------------------------------------------------

    #[test]
    fn a_second_claim_on_the_same_transaction_is_refused_while_the_first_is_held() {
        let manager = manager();
        let _first = manager.claim_send(42).expect("first claim");

        let err = manager.claim_send(42).expect_err("already claimed");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn a_claim_on_a_different_transaction_is_unaffected() {
        let manager = manager();
        let _first = manager.claim_send(42).expect("first claim");

        assert!(manager.claim_send(43).is_ok());
    }

    #[test]
    fn dropping_a_claim_frees_it_for_the_next_send() {
        let manager = manager();
        {
            let _first = manager.claim_send(42).expect("first claim");
            // dropped at the end of this block
        }

        assert!(manager.claim_send(42).is_ok());
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

    /// This is the case the module doc describes: `stopping` is what marks an
    /// exit deliberate, because during a graceful stop the generation the
    /// exit is tagged with has not changed — nothing has re-spawned in the
    /// gap between asking the sidecar to stop and it actually exiting.
    #[test]
    fn on_exit_while_stopping_does_not_restart_or_overwrite_the_phase() {
        let manager = manager();
        {
            let mut inner = manager.lock();
            inner.stopping = true;
            inner.phase = WhatsappPhase::Off;
        }
        manager.on_exit(0);
        assert_eq!(manager.lock().phase, WhatsappPhase::Off);
    }

    /// A generation the manager has already moved past (a fresh spawn
    /// superseded this one) is also a no-op, independent of `stopping`.
    #[test]
    fn on_exit_tagged_with_a_superseded_generation_is_a_no_op() {
        let manager = manager();
        {
            let mut inner = manager.lock();
            inner.phase = WhatsappPhase::Starting;
            inner.generation = 1;
        }
        manager.on_exit(0);
        assert_eq!(manager.lock().phase, WhatsappPhase::Starting);
    }

    #[test]
    fn on_exit_after_a_crash_reports_disconnected_and_asks_for_a_restart() {
        let manager = manager();
        manager.lock().phase = WhatsappPhase::Ready { number: "x".into() };
        manager.on_exit(0);
        assert!(matches!(
            manager.lock().phase,
            WhatsappPhase::Disconnected { .. }
        ));
        // `stopping` was never set, so this was read as a crash — the phase
        // above is exactly what a person watching the settings tab needs to
        // see, and the (untestable without a real process) restart timer this
        // also kicks off is what gets them back without touching anything.
    }

    #[test]
    fn a_pending_command_fails_promptly_when_the_connection_drops() {
        let manager = manager();
        let (tx, mut rx) = oneshot::channel();
        manager.lock().pending.insert(1, tx);

        manager.on_exit(0);

        assert!(rx.try_recv().expect("answered").is_err());
    }

    // ------------------------------------------------------------------
    // Graceful stop: with no real child process, `stop_child` has nothing to
    // ask and nothing to kill — it is exercised for real by the manual sidecar
    // run in the task notes (enable, reach the QR stage, then disable and
    // confirm the sidecar and its browser both exit).
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn disabling_a_manager_with_no_child_does_not_wait_out_the_grace_period() {
        let manager = manager();
        let started = std::time::Instant::now();

        let status = manager.disable().await.expect("disable");

        assert_eq!(status.phase, WhatsappPhase::Off);
        assert!(
            started.elapsed() < GRACEFUL_STOP_TIMEOUT,
            "disable with no child must not wait out the grace period"
        );
    }

    #[tokio::test]
    async fn shutdown_with_no_child_returns_immediately() {
        let manager = manager();
        manager.shutdown().await; // must not hang
    }
}
