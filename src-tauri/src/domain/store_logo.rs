//! The store logo as a file: which formats are accepted, and how a blob of
//! uploaded bytes is checked before it becomes one.
//!
//! The check reads the bytes, never the filename or the `Content-Type` a client
//! sent along — both are whatever the client says they are. A PNG is a PNG
//! because it starts with the PNG signature, and an SVG is an SVG because it
//! parses as XML with an `<svg>` root.

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::utils::AppError;

/// Ceiling on an uploaded logo. A 58 mm receipt header and a 36 px sidebar
/// avatar do not need more, and the file is read into memory in one piece.
pub const MAX_LOGO_BYTES: usize = 1024 * 1024;

/// Every format a logo may be stored in. The list is closed on purpose: the
/// extension written to disk and the `Content-Type` sent back are both derived
/// from this enum, so nothing a client sends can name either.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogoFormat {
    Png,
    Jpeg,
    Webp,
    Svg,
}

impl LogoFormat {
    pub const ALL: [LogoFormat; 4] = [
        LogoFormat::Png,
        LogoFormat::Jpeg,
        LogoFormat::Webp,
        LogoFormat::Svg,
    ];

    /// The file extension the logo is saved under.
    pub fn extension(self) -> &'static str {
        match self {
            LogoFormat::Png => "png",
            LogoFormat::Jpeg => "jpg",
            LogoFormat::Webp => "webp",
            LogoFormat::Svg => "svg",
        }
    }

    pub fn content_type(self) -> &'static str {
        match self {
            LogoFormat::Png => "image/png",
            LogoFormat::Jpeg => "image/jpeg",
            LogoFormat::Webp => "image/webp",
            LogoFormat::Svg => "image/svg+xml",
        }
    }

    /// The format a stored extension stands for, or `None` for anything that is
    /// not one of ours — which is how a `logo_path` that was tampered with on
    /// disk is refused rather than served.
    pub fn from_extension(extension: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|f| f.extension() == extension)
    }

    /// Decide what `bytes` are from their content, or refuse them.
    ///
    /// Raster formats are recognised by their signatures. SVG has none, so it
    /// has to parse as XML whose root element is `svg`; a `<script>` element
    /// anywhere inside is refused too, because the same file is later served
    /// from the app's own origin.
    pub fn sniff(bytes: &[u8]) -> Result<Self, AppError> {
        if bytes.is_empty() {
            return Err(AppError::Validation("Berkas logo kosong".into()));
        }
        if bytes.len() > MAX_LOGO_BYTES {
            return Err(AppError::Validation("Ukuran logo maksimal 1 MB".into()));
        }

        if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Ok(LogoFormat::Png);
        }
        if bytes.starts_with(b"\xFF\xD8\xFF") {
            return Ok(LogoFormat::Jpeg);
        }
        if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
            return Ok(LogoFormat::Webp);
        }
        if is_svg(bytes) {
            return Ok(LogoFormat::Svg);
        }

        Err(AppError::Validation(
            "Format logo harus PNG, JPEG, WebP, atau SVG".into(),
        ))
    }
}

/// True when `bytes` are well-formed XML with an `svg` root and no `script`
/// element. Anything the parser trips over — a truncated file, a stray `<`,
/// a binary that happens to be text — is simply not an SVG.
fn is_svg(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };

    let mut reader = Reader::from_str(text);
    let mut root_seen = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(tag)) | Ok(Event::Empty(tag)) => {
                let name = tag.local_name();
                let name = name.as_ref();
                if name.eq_ignore_ascii_case(b"script") {
                    return false;
                }
                if !root_seen {
                    if !name.eq_ignore_ascii_case(b"svg") {
                        return false;
                    }
                    root_seen = true;
                }
            }
            Ok(Event::Eof) => return root_seen,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raster_signatures_are_recognised() {
        assert_eq!(
            LogoFormat::sniff(b"\x89PNG\r\n\x1a\n rest").unwrap(),
            LogoFormat::Png
        );
        assert_eq!(
            LogoFormat::sniff(b"\xFF\xD8\xFF\xE0 rest").unwrap(),
            LogoFormat::Jpeg
        );
        assert_eq!(
            LogoFormat::sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 ").unwrap(),
            LogoFormat::Webp
        );
    }

    #[test]
    fn an_svg_is_xml_with_an_svg_root() {
        let svg = br#"<?xml version="1.0"?>
<!-- toko -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle r="8"/></svg>"#;
        assert_eq!(LogoFormat::sniff(svg).unwrap(), LogoFormat::Svg);
    }

    #[test]
    fn an_svg_with_a_script_is_refused() {
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>";
        assert!(LogoFormat::sniff(svg).is_err());
    }

    #[test]
    fn xml_that_is_not_an_svg_is_refused() {
        assert!(LogoFormat::sniff(b"<html><svg/></html>").is_err());
        assert!(
            LogoFormat::sniff(b"<svg><g></svg>").is_err(),
            "unclosed tag"
        );
    }

    #[test]
    fn text_and_other_binaries_are_refused() {
        assert!(LogoFormat::sniff(b"ini bukan gambar").is_err());
        assert!(LogoFormat::sniff(b"GIF89a").is_err());
        assert!(LogoFormat::sniff(b"").is_err());
    }

    #[test]
    fn the_size_ceiling_is_enforced_before_the_format() {
        let mut big = b"\x89PNG\r\n\x1a\n".to_vec();
        big.resize(MAX_LOGO_BYTES + 1, 0);
        assert!(matches!(
            LogoFormat::sniff(&big),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn extensions_round_trip() {
        for format in LogoFormat::ALL {
            assert_eq!(LogoFormat::from_extension(format.extension()), Some(format));
        }
        assert_eq!(LogoFormat::from_extension("exe"), None);
    }
}
