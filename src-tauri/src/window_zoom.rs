//! The one handle the HTTP layer has on the till's window: its zoom.
//!
//! The screen used to scale itself with CSS `zoom` on `<html>`. That scales
//! the layout but not the viewport the browser reports, so anything positioned
//! against the viewport — every React Aria modal and popover, which size
//! themselves from `--visual-viewport-height` — landed off-screen the moment
//! the factor left 1. Real webview zoom (`WebviewWindow::set_zoom`, which is
//! WebView2's `ZoomFactor` on Windows) scales viewport and layout together, and
//! is what a browser's own Ctrl+/− does.
//!
//! The frontend has no Tauri IPC — the window loads a plain `http://127.0.0.1`
//! origin — so the zoom is driven the way the updater is: `PUT /api/window/zoom`
//! reaches this struct, which holds a closure `lib.rs` attached in `setup`.
//! Persistence is not here; `services::settings::save_ui_zoom` keeps the factor
//! in `store_info.additional_info` so a restart opens at the same size.

use std::future::Future;
use std::sync::OnceLock;

use crate::utils::AppError;

/// Applies a factor to the window. Written in `lib.rs` as a closure over the
/// `WebviewWindow` for the same reason the updater holds a closure and not an
/// `AppHandle`: naming a window method here would link the Wry runtime into the
/// test binary, and the tests only ever attach a stub.
pub type ZoomApplier = Box<dyn Fn(f64) -> tauri::Result<()> + Send + Sync>;

#[derive(Default)]
pub struct WindowZoom {
    /// Set once from Tauri's `setup`; empty in tests and before the window
    /// exists.
    applier: OnceLock<ZoomApplier>,
    /// Serialises [`WindowZoom::store_then_apply`]: two keypresses in flight
    /// at once must not store one factor and leave the window at the other.
    serial: tokio::sync::Mutex<()>,
}

impl WindowZoom {
    pub fn new() -> Self {
        Self::default()
    }

    /// Hand over the way to reach the window. A second call is ignored: there
    /// is one window, and it does not change.
    pub fn attach(&self, apply: impl Fn(f64) -> tauri::Result<()> + Send + Sync + 'static) {
        let _ = self.applier.set(Box::new(apply));
    }

    /// Whether there is a window to zoom at all. False in tests and in any
    /// process that serves the API without opening a window.
    pub fn is_attached(&self) -> bool {
        self.applier.get().is_some()
    }

    /// Zoom the window. The caller has already clamped and stored `factor`.
    pub fn apply(&self, factor: f64) -> Result<(), AppError> {
        let apply = self.applier.get().ok_or_else(|| {
            AppError::Internal("window zoom used before the window was attached".into())
        })?;
        apply(factor).map_err(|e| AppError::Internal(format!("failed to zoom the window: {e}")))
    }

    /// Run `store` — the write that persists the factor and answers it as
    /// stored — then zoom the window to that answer, with no other store/apply
    /// pair interleaving. Without the lock, requests A and B could run
    /// store(A), store(B), apply(B), apply(A): the window shows A while a
    /// restart would open at B.
    pub async fn store_then_apply(
        &self,
        store: impl Future<Output = Result<f64, AppError>>,
    ) -> Result<f64, AppError> {
        let _serial = self.serial.lock().await;
        let factor = store.await?;
        self.apply(factor)?;
        Ok(factor)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[test]
    fn nothing_is_attached_until_setup_says_so() {
        let zoom = WindowZoom::new();
        assert!(!zoom.is_attached());
        assert!(matches!(zoom.apply(1.5), Err(AppError::Internal(_))));
    }

    #[test]
    fn apply_reaches_the_attached_window_and_the_first_attachment_wins() {
        let zoom = WindowZoom::new();
        let seen = Arc::new(Mutex::new(Vec::new()));

        let sink = Arc::clone(&seen);
        zoom.attach(move |factor| {
            sink.lock().expect("lock").push(factor);
            Ok(())
        });
        zoom.attach(|_| panic!("a second window must not replace the first"));

        assert!(zoom.is_attached());
        zoom.apply(1.5).expect("applies");
        zoom.apply(0.8).expect("applies");
        assert_eq!(*seen.lock().expect("lock"), vec![1.5, 0.8]);
    }

    /// The window is only zoomed to what the store actually answered — which
    /// is what a restart will open at — and never when the store failed.
    #[tokio::test]
    async fn store_then_apply_zooms_to_the_stored_answer_or_not_at_all() {
        let zoom = WindowZoom::new();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        zoom.attach(move |factor| {
            sink.lock().expect("lock").push(factor);
            Ok(())
        });

        // Asked for 2.5, the store clamps to 2.0; the window gets 2.0.
        let stored = zoom.store_then_apply(async { Ok(2.0) }).await.expect("ok");
        assert_eq!(stored, 2.0);

        let failed = zoom
            .store_then_apply(async { Err(AppError::Validation("x".into())) })
            .await;
        assert!(matches!(failed, Err(AppError::Validation(_))));

        assert_eq!(*seen.lock().expect("lock"), vec![2.0]);
    }
}
