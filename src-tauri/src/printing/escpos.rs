//! ESC/POS encoder: turns formatted receipt text lines into raw printer bytes.
//!
//! The bytes are sent straight to the printer through the Windows spooler with
//! datatype "RAW", so the printer renders its own built-in font instead of the
//! driver rasterising a bitmap. Line width is already handled upstream by
//! `format_receipt_text` / `format_test_page_text` (32 cols for 58mm, 42 for
//! 80mm), which matches Font A. The one size command this module emits is the
//! double-size toggle a line asks for through [`LineSize`]; the formatter that
//! asks for it is also the one that halved the width it wrapped to.
//!
//! Trailing feed and cut are this module's job alone — the formatters emit no
//! blank filler lines, so there is one place to tune how much paper a receipt
//! spends clearing the cutter or tear bar.

use super::receipt::{LineSize, ReceiptTextLine};

/// ESC @ — reset the printer to its power-on defaults.
const INIT: [u8; 2] = [0x1B, 0x40];
/// ESC E 1 — emphasised (bold) on.
const BOLD_ON: [u8; 3] = [0x1B, 0x45, 0x01];
/// ESC E 0 — emphasised (bold) off.
const BOLD_OFF: [u8; 3] = [0x1B, 0x45, 0x00];
/// GS ! 0x11 — double width and double height (the high nibble is the width
/// multiplier, the low nibble the height, both 1 meaning "twice").
const SIZE_DOUBLE: [u8; 3] = [0x1D, 0x21, 0x11];
/// GS ! 0x00 — back to the single-size character.
const SIZE_NORMAL: [u8; 3] = [0x1D, 0x21, 0x00];
/// ESC d 6 — feed 6 lines so the last printed line clears the cutter or tear
/// bar (roughly 15-20mm past the print head on a 58mm unit). Six matches the
/// blank filler lines the text formatters used to append, so consolidating the
/// feed here does not change how much paper a receipt spends.
const FEED_LINES: [u8; 3] = [0x1B, 0x64, 0x06];
/// GS V 1 — partial cut. Printers with no cutter treat it as an unknown
/// command and skip it, which is why the feed above has to stand on its own.
const PARTIAL_CUT: [u8; 3] = [0x1D, 0x56, 0x01];

/// Encode receipt lines as ESC/POS bytes ready for `send_raw_data`.
pub fn encode_lines(lines: &[ReceiptTextLine]) -> Vec<u8> {
    let mut out = Vec::with_capacity(INIT.len() + lines.len() * 40 + 8);
    out.extend_from_slice(&INIT);

    let mut bold = false;
    let mut size = LineSize::Normal;
    for line in lines {
        if line.bold != bold {
            out.extend_from_slice(if line.bold { &BOLD_ON } else { &BOLD_OFF });
            bold = line.bold;
        }
        if line.size != size {
            out.extend_from_slice(match line.size {
                LineSize::Double => &SIZE_DOUBLE,
                LineSize::Normal => &SIZE_NORMAL,
            });
            size = line.size;
        }
        push_ascii(&mut out, &line.text);
        out.push(b'\n');
    }

    // Leave the printer in its default state: the feed below and the next job
    // both assume single-size, unemphasised characters.
    if bold {
        out.extend_from_slice(&BOLD_OFF);
    }
    if size != LineSize::Normal {
        out.extend_from_slice(&SIZE_NORMAL);
    }

    out.extend_from_slice(&FEED_LINES);
    out.extend_from_slice(&PARTIAL_CUT);
    out
}

/// Append `text` as single-byte ASCII, replacing anything outside 0x20..=0x7E
/// with `?`. The printer's default codepage cannot render UTF-8, and a raw
/// multi-byte sequence would print as garbage.
fn push_ascii(out: &mut Vec<u8>, text: &str) {
    for ch in text.chars() {
        let byte = match ch {
            ' '..='~' => ch as u8,
            _ => b'?',
        };
        out.push(byte);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, bold: bool) -> ReceiptTextLine {
        if bold {
            ReceiptTextLine::bold(text)
        } else {
            ReceiptTextLine::plain(text)
        }
    }

    #[test]
    fn starts_with_init_and_ends_with_feed_and_cut() {
        let bytes = encode_lines(&[line("Halo", false)]);
        assert_eq!(&bytes[..2], &[0x1B, 0x40]);
        assert_eq!(
            &bytes[bytes.len() - 6..],
            &[0x1B, 0x64, 0x06, 0x1D, 0x56, 0x01]
        );
    }

    #[test]
    fn plain_lines_are_ascii_plus_line_feed() {
        let bytes = encode_lines(&[line("AB", false), line("CD", false)]);
        // ESC @ + "AB\n" + "CD\n" + feed + cut
        assert_eq!(bytes, b"\x1B\x40AB\nCD\n\x1B\x64\x06\x1D\x56\x01".to_vec());
    }

    #[test]
    fn empty_line_emits_only_a_line_feed() {
        let bytes = encode_lines(&[line("", false)]);
        assert_eq!(bytes, b"\x1B\x40\n\x1B\x64\x06\x1D\x56\x01".to_vec());
    }

    #[test]
    fn bold_toggles_only_on_state_change() {
        let bytes = encode_lines(&[
            line("a", false),
            line("b", true),
            line("c", true),
            line("d", false),
        ]);
        assert_eq!(
            bytes,
            b"\x1B\x40a\n\x1B\x45\x01b\nc\n\x1B\x45\x00d\n\x1B\x64\x06\x1D\x56\x01".to_vec()
        );
    }

    #[test]
    fn first_line_bold_emits_bold_on_once() {
        let bytes = encode_lines(&[line("x", true), line("y", true)]);
        assert_eq!(bytes.windows(3).filter(|w| *w == BOLD_ON).count(), 1);
        // Bold is reset before the trailing feed so the next job starts clean.
        assert_eq!(bytes.windows(3).filter(|w| *w == BOLD_OFF).count(), 1);
    }

    #[test]
    fn double_size_is_switched_on_and_back_off_around_the_line() {
        let bytes = encode_lines(&[
            line("a", false),
            ReceiptTextLine::double("T"),
            line("b", false),
        ]);
        assert_eq!(
            bytes,
            b"\x1B\x40a\n\x1D\x21\x11T\n\x1D\x21\x00b\n\x1B\x64\x06\x1D\x56\x01".to_vec()
        );
    }

    #[test]
    fn double_size_toggles_only_on_state_change() {
        let bytes = encode_lines(&[
            ReceiptTextLine::double("6991-4243"),
            ReceiptTextLine::double("8030-6764"),
        ]);
        assert_eq!(bytes.windows(3).filter(|w| *w == SIZE_DOUBLE).count(), 1);
        // Reset once, at the end, so the feed and the next job print normally.
        assert_eq!(bytes.windows(3).filter(|w| *w == SIZE_NORMAL).count(), 1);
        assert_eq!(
            &bytes[bytes.len() - 9..],
            &[0x1D, 0x21, 0x00, 0x1B, 0x64, 0x06, 0x1D, 0x56, 0x01]
        );
    }

    /// Size and weight are independent commands; a line can ask for both.
    #[test]
    fn bold_and_double_size_are_emitted_independently() {
        let bytes = encode_lines(&[ReceiptTextLine {
            text: "X".to_string(),
            bold: true,
            size: LineSize::Double,
        }]);
        assert_eq!(
            bytes,
            b"\x1B\x40\x1B\x45\x01\x1D\x21\x11X\n\x1B\x45\x00\x1D\x21\x00\x1B\x64\x06\x1D\x56\x01"
                .to_vec()
        );
    }

    /// Anything outside printable ASCII — multi-byte UTF-8 and embedded control
    /// characters alike — collapses to a single `?` byte, so the printer never
    /// sees a stray byte it would render as garbage or act on as a command.
    #[test]
    fn non_printable_characters_become_question_marks() {
        let bytes = encode_lines(&[line("Kopi — Rp5.000 ☕\tA\nB", false)]);
        let text = String::from_utf8_lossy(&bytes[2..bytes.len() - 7]);
        assert_eq!(text, "Kopi ? Rp5.000 ??A?B");
    }

    #[test]
    fn no_lines_still_produces_init_feed_and_cut() {
        let bytes = encode_lines(&[]);
        assert_eq!(bytes, b"\x1B\x40\x1B\x64\x06\x1D\x56\x01".to_vec());
    }
}
