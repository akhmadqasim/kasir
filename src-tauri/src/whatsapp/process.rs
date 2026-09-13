//! Spawning the sidecar and pumping its stdout into the manager.
//!
//! Kept apart from the rest of the module so the state machine there can be
//! unit tested without a real child process: everything here talks to
//! `tauri_plugin_shell`, and nothing in [`super`]'s tests do.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_shell::process::{Command as ShellCommand, CommandEvent};
use tauri_plugin_shell::ShellExt;

use super::protocol::parse_line;
use super::WhatsappManager;
use crate::utils::{logging, AppError};

/// Debug builds run the sidecar straight from its build output in the
/// workspace, with the system's own `node` on `PATH` — no packaging involved,
/// so a saved `.ts` only needs `bun run build:sidecar`, not a Rust rebuild.
pub fn dev_spawn_factory(
    app: &tauri::AppHandle,
) -> impl Fn(&str) -> Result<ShellCommand, AppError> + Send + Sync + 'static {
    let app = app.clone();
    let script = dev_sidecar_script();
    move |session_dir: &str| {
        if !script.exists() {
            return Err(AppError::Internal(format!(
                "Sidecar WhatsApp belum dibangun. Jalankan `bun run build:sidecar` (berkas tidak ditemukan: {}).",
                script.display()
            )));
        }
        // Working directory = the session directory, so anything the
        // sidecar writes relative to its cwd lands there and never inside
        // `src-tauri/`, which the dev watcher would take as a source change.
        Ok(app
            .shell()
            .command("node")
            .current_dir(PathBuf::from(session_dir))
            .args([script.to_string_lossy().to_string(), session_dir.to_string()]))
    }
}

fn dev_sidecar_script() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../sidecar/whatsapp/dist/index.js"
    ))
}

/// Release builds run the bundled sidecar executable — see
/// `bundle.externalBin` in `tauri.conf.json` — pointed at the resource copy of
/// `dist/index.js` and the `node_modules` shipped next to it. That executable
/// is a renamed copy of `node.exe` rather than a Node single-executable
/// application; see `CLAUDE.md` for why SEA was not adopted for this sidecar.
pub fn release_spawn_factory(
    app: &tauri::AppHandle,
) -> impl Fn(&str) -> Result<ShellCommand, AppError> + Send + Sync + 'static {
    let app = app.clone();
    move |session_dir: &str| {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| AppError::Internal(format!("Direktori resource tidak ditemukan: {e}")))?;
        let script = resource_dir.join("whatsapp-sidecar").join("index.js");
        let command = app
            .shell()
            .sidecar("whatsapp-sidecar")
            .map_err(|e| AppError::Internal(format!("Sidecar WhatsApp tidak ditemukan: {e}")))?;
        Ok(command
            .current_dir(PathBuf::from(session_dir))
            .args([script.to_string_lossy().to_string(), session_dir.to_string()]))
    }
}

/// Spawn `command`, hand the child to the manager, then pump its stdout/exit
/// into the manager for as long as `generation` is still the current one.
pub(super) fn spawn_and_pump(
    manager: Arc<WhatsappManager>,
    command: ShellCommand,
    generation: u64,
) -> Result<(), AppError> {
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| AppError::Internal(format!("Gagal menjalankan proses WhatsApp: {e}")))?;

    manager.set_child(generation, child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(message) = parse_line(&line) {
                        manager.on_message(generation, message);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if !line.trim().is_empty() {
                        logging::log_error(&format!("[whatsapp-sidecar] {}", line.trim()));
                    }
                }
                CommandEvent::Error(message) => {
                    logging::log_error(&format!("whatsapp sidecar process error: {message}"));
                }
                CommandEvent::Terminated(_) => {
                    manager.on_exit(generation);
                }
                _ => {}
            }
        }
    });

    Ok(())
}
