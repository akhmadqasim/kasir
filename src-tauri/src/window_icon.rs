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

/// Largest icon side accepted. The page draws 256 px; this bounds the decoded
/// size (about 4 MiB RGBA) whatever the compressed size.
const MAX_ICON_SIDE: u32 = 1024;

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

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
        if let Some(bytes) = png {
            check_png_size(bytes)?;
        }
        apply(png)
            .map_err(|e| AppError::Validation(format!("Ikon jendela tidak bisa dipasang: {e}")))
    }
}

/// Read width and height from the PNG header and refuse anything that is not
/// a PNG or is larger than [`MAX_ICON_SIDE`], before any decoding.
fn check_png_size(bytes: &[u8]) -> Result<(), AppError> {
    let invalid = || AppError::Validation("Ikon jendela harus berupa PNG.".into());
    if bytes.len() < 24 || &bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return Err(invalid());
    }
    let side =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let (width, height) = (side(16), side(20));
    if width == 0 || height == 0 || width > MAX_ICON_SIDE || height > MAX_ICON_SIDE {
        return Err(AppError::Validation(format!(
            "Ikon jendela terlalu besar ({width}x{height}); maksimal {MAX_ICON_SIDE}x{MAX_ICON_SIDE} piksel."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    /// Just the PNG signature and IHDR chunk header: enough for the size check.
    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

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

        let png = png_header(256, 256);
        icon.apply(Some(&png)).unwrap();
        icon.apply(None).unwrap();
        assert_eq!(*seen.lock().unwrap(), vec![Some(png), None]);
    }

    #[test]
    fn a_window_that_rejects_the_image_is_a_validation_error() {
        let icon = WindowIcon::new();
        icon.attach(|_| Err(tauri::Error::InvalidIcon(std::io::Error::other("bad png"))));
        assert!(matches!(
            icon.apply(Some(&png_header(256, 256))),
            Err(AppError::Validation(_))
        ));
    }

    /// A small PNG that claims huge dimensions never reaches the decoder.
    #[test]
    fn an_oversized_or_non_png_icon_is_refused_before_decoding() {
        let calls = Arc::new(Mutex::new(0));
        let icon = WindowIcon::new();
        let counter = calls.clone();
        icon.attach(move |_| {
            *counter.lock().unwrap() += 1;
            Ok(())
        });

        for bad in [
            png_header(23_170, 23_170),
            png_header(MAX_ICON_SIDE + 1, 16),
            png_header(16, MAX_ICON_SIDE + 1),
            png_header(0, 16),
            b"not a png at all, not at all".to_vec(),
            png_header(16, 16)[..20].to_vec(),
        ] {
            assert!(matches!(
                icon.apply(Some(&bad)),
                Err(AppError::Validation(_))
            ));
        }
        assert_eq!(*calls.lock().unwrap(), 0);

        icon.apply(Some(&png_header(MAX_ICON_SIDE, MAX_ICON_SIDE)))
            .unwrap();
        assert_eq!(*calls.lock().unwrap(), 1);
    }
}
