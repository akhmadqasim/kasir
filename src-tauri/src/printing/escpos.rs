//! ESC/POS encoder: turns formatted receipt text lines into raw printer bytes.
//!
//! The bytes are sent straight to the printer through the Windows spooler with
//! datatype "RAW", so the printer renders its own built-in font instead of the
//! driver rasterising a bitmap. Line width is already handled upstream by
//! `format_receipt_text` / `format_test_page_text` (32 cols for 58mm, 42 for
//! 80mm), which matches Font A. Weight and size come from one `ESC !` print-mode
//! byte per line, and the formatter that asks for a double-size line is also the
//! one that halved the width it wrapped to.
//!
//! **`GS !` is banned here.** It is the command most ESC/POS documentation
//! reaches for to set character size, and on the POS58 (TECH CLA58) on this till
//! it stops the print dead: isolation tests showed a job of plain text followed
//! by `GS ! 0x11` printing the text and then nothing at all, while the same job
//! byte-for-byte with `ESC ! 0x30` printed to the end. A short job with `GS !`
//! had worked earlier, so the firmware only chokes on it once its buffer has
//! filled — which is exactly the case a receipt is. `ESC !`, `ESC E`, `ESC d`,
//! `GS V` and jobs of two kilobytes are all proven good on the same unit.
//!
//! Trailing feed and cut are this module's job alone — the formatters emit no
//! blank filler lines, so there is one place to tune how much paper a receipt
//! spends clearing the cutter or tear bar.

use super::receipt::{LineSize, ReceiptTextLine};

/// ESC @ — reset the printer to its power-on defaults.
const INIT: [u8; 2] = [0x1B, 0x40];
/// ESC ! — select print mode. The byte that follows carries every attribute at
/// once, so one command says everything about how the next line looks and there
/// is no way for two toggles to disagree.
const PRINT_MODE: [u8; 2] = [0x1B, 0x21];
/// Bit 3 of the print-mode byte: emphasised.
const MODE_BOLD: u8 = 0x08;
/// Bits 4 and 5 of the print-mode byte: double height and double width.
const MODE_DOUBLE: u8 = 0x30;
/// The power-on print mode, and what the printer is left in.
const MODE_PLAIN: u8 = 0x00;
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

    let mut mode = MODE_PLAIN;
    for line in lines {
        let wanted = print_mode(line);
        if wanted != mode {
            push_mode(&mut out, wanted);
            mode = wanted;
        }
        push_ascii(&mut out, &line.text);
        out.push(b'\n');
    }

    // Leave the printer in its default state: the feed below and the next job
    // both assume single-size, unemphasised characters.
    if mode != MODE_PLAIN {
        push_mode(&mut out, MODE_PLAIN);
    }

    out.extend_from_slice(&FEED_LINES);
    out.extend_from_slice(&PARTIAL_CUT);
    out
}

fn push_mode(out: &mut Vec<u8>, mode: u8) {
    out.extend_from_slice(&PRINT_MODE);
    out.push(mode);
}

/// Everything the printer needs to know about one line's appearance, in the one
/// byte `ESC !` takes.
fn print_mode(line: &ReceiptTextLine) -> u8 {
    let bold = if line.bold { MODE_BOLD } else { 0 };
    let size = match line.size {
        LineSize::Double => MODE_DOUBLE,
        LineSize::Normal => 0,
    };

    bold | size
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
    fn bold_switches_the_print_mode_only_on_a_change() {
        let bytes = encode_lines(&[
            line("a", false),
            line("b", true),
            line("c", true),
            line("d", false),
        ]);
        assert_eq!(
            bytes,
            b"\x1B\x40a\n\x1B\x21\x08b\nc\n\x1B\x21\x00d\n\x1B\x64\x06\x1D\x56\x01".to_vec()
        );
    }

    #[test]
    fn a_job_that_opens_bold_sets_the_mode_once_and_clears_it_once() {
        let bytes = encode_lines(&[line("x", true), line("y", true)]);
        assert_eq!(mode_bytes(&bytes), vec![MODE_BOLD, MODE_PLAIN]);
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
            b"\x1B\x40a\n\x1B\x21\x30T\n\x1B\x21\x00b\n\x1B\x64\x06\x1D\x56\x01".to_vec()
        );
    }

    #[test]
    fn double_size_toggles_only_on_state_change() {
        let bytes = encode_lines(&[
            ReceiptTextLine::double("6991-4243"),
            ReceiptTextLine::double("8030-6764"),
        ]);
        assert_eq!(mode_bytes(&bytes), vec![MODE_DOUBLE, MODE_PLAIN]);
        // Reset before the trailing feed, so it feeds at single height and the
        // next job starts clean.
        assert_eq!(
            &bytes[bytes.len() - 9..],
            &[0x1B, 0x21, 0x00, 0x1B, 0x64, 0x06, 0x1D, 0x56, 0x01]
        );
    }

    /// Weight and size ride in the same byte, so a line asking for both costs
    /// one command and cannot end up half-applied.
    #[test]
    fn bold_and_double_size_share_one_print_mode_byte() {
        let bytes = encode_lines(&[ReceiptTextLine {
            text: "X".to_string(),
            bold: true,
            size: LineSize::Double,
        }]);
        assert_eq!(
            bytes,
            b"\x1B\x40\x1B\x21\x38X\n\x1B\x21\x00\x1B\x64\x06\x1D\x56\x01".to_vec()
        );
    }

    /// Going straight from one attribute to another is one command, not a reset
    /// and a set. This is where the two-toggle scheme used to leak: clearing the
    /// size with `GS ! 0x00` left bold on, clearing bold with `ESC E 0` left the
    /// size, and the order they were written in decided what came out.
    #[test]
    fn moving_between_attributes_costs_a_single_command() {
        let bytes = encode_lines(&[
            line("bold", true),
            ReceiptTextLine::double("6991-5243-8030-"),
            line("plain", false),
        ]);

        assert_eq!(mode_bytes(&bytes), vec![MODE_BOLD, MODE_DOUBLE, MODE_PLAIN]);
    }

    /// `GS !` is what most ESC/POS documentation reaches for to set character
    /// size, and it is the one command that kills this printer mid-job. Nothing
    /// this encoder emits may contain it.
    #[test]
    fn no_gs_bang_anywhere_in_the_output() {
        let bytes = encode_lines(&[
            line("plain", false),
            line("bold", true),
            ReceiptTextLine::double("6991-5243-8030-"),
            line("plain again", false),
        ]);

        assert!(
            !bytes.windows(2).any(|pair| pair == [0x1D, 0x21]),
            "GS ! must never reach the printer"
        );
    }

    /// Every print-mode byte in a job, in order.
    fn mode_bytes(bytes: &[u8]) -> Vec<u8> {
        bytes
            .windows(3)
            .filter(|window| window[..2] == PRINT_MODE)
            .map(|window| window[2])
            .collect()
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
