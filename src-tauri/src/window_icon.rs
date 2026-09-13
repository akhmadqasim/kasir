//! The till window's icon: the store's logo when it has one.
//!
//! The icon baked into the executable — the `LogoRustore` mark on the accent
//! blue in `icons/`, the same default the sidebar draws — is what the taskbar
//! and title bar show until the frontend says otherwise. The frontend, not this
//! crate, turns the uploaded logo into a PNG: the webview already decodes every
//! format the upload accepts (PNG, JPEG, WebP and SVG), whereas doing it here
//! would mean an image stack plus an SVG rasteriser for one 256-pixel square.
//! So `POST /api/window/icon` carries a PNG the page drew, and `DELETE` puts
//! the built-in icon back.
//!
//! Same shape as [`crate::window_zoom`]: the window is reached through a
//! closure `lib.rs` attaches in `setup`, so this module names no window type
//! and the test binary links no runtime.

use std::sync::OnceLock;

use crate::utils::AppError;

/// Sets the window icon to the PNG given, or to the built-in icon on `None`.
pub type IconApplier = Box<dyn Fn(Option<&[u8]>) -> tauri::Result<()> + Send + Sync>;

#[derive(Default)]
pub struct WindowIcon {
    /// Set once from Tauri's `setup`; empty in tests and before the window
    /// exists.
    applier: OnceLock<IconApplier>,
}

impl WindowIcon {
    pub fn new() -> Self {
        Self::default()
    }

    /// Hand over the way to reach the window. A second call is ignored: there
    /// is one window, and it does not change.
    pub fn attach(
        &self,
        apply: impl Fn(Option<&[u8]>) -> tauri::Result<()> + Send + Sync + 'static,
    ) {
        let _ = self.applier.set(Box::new(apply));
    }

    /// Whether there is a window whose icon could change. False in tests and
    /// in any process that serves the API without opening a window.
    pub fn is_attached(&self) -> bool {
        self.applier.get().is_some()
    }

    /// Show `png` on the window, or the built-in icon when there is none.
    pub fn apply(&self, png: Option<&[u8]>) -> Result<(), AppError> {
        let apply = self.applier.get().ok_or_else(|| {
            AppError::Internal("window icon used before the window was attached".into())
        })?;
        apply(png).map_err(|e| AppError::Validation(format!("Ikon jendela tidak bisa dipasang: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[test]
    fn unattached_icon_is_reported_and_refuses_to_apply() {
        let icon = WindowIcon::new();
        assert!(!icon.is_attached());
        assert!(matches!(icon.apply(None), Err(AppError::Internal(_))));
    }

    #[test]
    fn apply_hands_the_bytes_or_the_reset_to_the_window() {
        let seen: Arc<Mutex<Vec<Option<Vec<u8>>>>> = Arc::default();
        let icon = WindowIcon::new();
        let sink = seen.clone();
        icon.attach(move |png| {
            sink.lock().unwrap().push(png.map(<[u8]>::to_vec));
            Ok(())
        });

        icon.apply(Some(b"png")).unwrap();
        icon.apply(None).unwrap();
        assert_eq!(*seen.lock().unwrap(), vec![Some(b"png".to_vec()), None]);
    }

    #[test]
    fn a_window_that_rejects_the_image_is_a_validation_error() {
        let icon = WindowIcon::new();
        icon.attach(|_| Err(tauri::Error::InvalidIcon(std::io::Error::other("bad png"))));
        assert!(matches!(icon.apply(Some(b"x")), Err(AppError::Validation(_))));
    }
}
