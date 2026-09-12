//! ESC/POS encoder: turns formatted receipt text lines into raw printer bytes.
//!
//! The bytes are sent straight to the printer through the Windows spooler with
//! datatype "RAW". Two shapes go down that pipe: `encode_lines` sends characters
//! for the printer's own font engine to set, and `encode_raster` sends a picture
//! drawn by `super::raster` — see `receipt::PrintMode` for which and why.
//!
//! The text path is modelled on the Mitra Indogrosir app's own print job,
//! captured off the phone with the till's Bluetooth posing as the printer. It
//! is plain Font A at single weight, thirty-two columns wide, `FS .` to cancel
//! Kanji mode, and `GS ! 0x11` — double width *and* height — for the token.
//! Nothing in it is emphasised. Line width is handled upstream by the
//! formatters (32 columns on 58mm, 42 on 80mm); weight and size come from one
//! `ESC !` print-mode byte per line, and the formatter that asks for a
//! double-size line is also the one that halved the width it wrapped to.
//!
//! An earlier version of this encoder emphasised every line, and the POS58
//! (TECH CLA58) on this till kept resetting mid-job — its USB device dropping
//! out for a second and the paper stopping. That was blamed in turn on `GS !`,
//! on setting both size bits, and on lines of exactly 32 characters. Probing the
//! head directly over USB found the real cause: the printer's supply browns out
//! when a run of rows each light more than roughly 180–200 dots at full speed,
//! which is what a bold 32-column line of capitals does. Plain Font A stays
//! well under that, as the Mitra print proves every day.
//!
//! Trailing feed and cut are this module's job alone — the formatters emit no
//! blank filler lines, so there is one place to tune how much paper a receipt
//! spends clearing the cutter or tear bar.

use super::receipt::{LineSize, ReceiptTextLine};

/// ESC @ — reset the printer to its power-on defaults.
const INIT: [u8; 2] = [0x1B, 0x40];
/// FS . — cancel Kanji character mode. The Mitra app sends it before every run
/// of text; a printer left in that mode pairs bytes up into CJK glyphs.
const CANCEL_KANJI: [u8; 2] = [0x1C, 0x2E];
/// ESC ! — select print mode. The byte that follows carries every attribute at
/// once, so one command says everything about how the next line looks and there
/// is no way for two toggles to disagree.
const PRINT_MODE: [u8; 2] = [0x1B, 0x21];
/// Bit 4 of the print-mode byte: double height. This is what a `bold: true` line
/// gets — a heading stands out by size, not weight, because weight is what
/// this printer's supply cannot carry (see the module docs).
const MODE_TALL: u8 = 0x10;
/// Bit 5 of the print-mode byte: double width.
const MODE_WIDE: u8 = 0x20;
/// The power-on print mode, what an ordinary line prints in, and what the
/// printer is left in after a job.
const MODE_PLAIN: u8 = 0x00;
/// The mode a `bold: true` line prints in.
const MODE_HEADING: u8 = MODE_TALL;
/// The mode a `LineSize::Double` line prints in: both size bits, the same
/// character size the Mitra app's `GS ! 0x11` gives its token. `bold` is
/// ignored for these — there is no weight to add.
const MODE_TOKEN: u8 = MODE_TALL | MODE_WIDE;
/// ESC d 6 — feed 6 lines so the last printed line clears the cutter or tear
/// bar (roughly 15-20mm past the print head on a 58mm unit). Six matches the
/// blank filler lines the text formatters used to append, so consolidating the
/// feed here does not change how much paper a receipt spends.
const FEED_LINES: [u8; 3] = [0x1B, 0x64, 0x06];
/// GS V 1 — partial cut. Printers with no cutter treat it as an unknown
/// command and skip it, which is why the feed above has to stand on its own.
const PARTIAL_CUT: [u8; 3] = [0x1D, 0x56, 0x01];
/// GS v 0 — print a raster bitmap. The four bytes that follow the mode carry
/// the width in bytes and the height in rows.
const RASTER: [u8; 3] = [0x1D, 0x76, 0x30];
/// Rows per `GS v 0` command. Around 3 KB a stripe on 58mm paper, which this
/// printer takes without pausing; a whole receipt in one command does not.
const STRIPE_ROWS: usize = 64;

/// Encode receipt lines as ESC/POS bytes ready for `send_raw_data`.
pub fn encode_lines(lines: &[ReceiptTextLine]) -> Vec<u8> {
    let mut out = Vec::with_capacity(INIT.len() + CANCEL_KANJI.len() + lines.len() * 40 + 8);
    out.extend_from_slice(&INIT);
    out.extend_from_slice(&CANCEL_KANJI);

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
    match (line.size, line.bold) {
        (LineSize::Double, _) => MODE_TOKEN,
        (LineSize::Normal, true) => MODE_HEADING,
        (LineSize::Normal, false) => MODE_PLAIN,
    }
}

/// Send a rendered receipt as dots.
///
/// `GS v 0` takes a raster and burns it, which is how the Mitra app prints and
/// the only way to get one uniform face across a whole slip. It also steps
/// around everything the text engine on this unit turned out to dislike: no
/// print modes to track, no `GS !`, no 32nd column.
///
/// The image goes in stripes rather than as one command. A full receipt is tens
/// of kilobytes and this printer's buffer is not; sixty-four rows at a time is
/// about 3 KB, which it swallows without complaint.
#[cfg(windows)]
pub fn encode_raster(bitmap: &super::raster::Bitmap1bpp) -> Vec<u8> {
    let bytes_per_row = bitmap.bytes_per_row() as usize;
    debug_assert_eq!(bitmap.data.len(), bytes_per_row * bitmap.height as usize);

    let mut out = Vec::with_capacity(INIT.len() + bitmap.data.len() + 64);
    out.extend_from_slice(&INIT);

    for stripe in bitmap.data.chunks(bytes_per_row * STRIPE_ROWS) {
        // Measured off the data, not counted down from the height: a header
        // that promised more rows than follow it would have the printer read
        // the feed and cut as picture.
        let rows = stripe.len() / bytes_per_row.max(1);

        // GS v 0 m xL xH yL yH — m = 0 is normal size, x counted in bytes and
        // y in rows, both little-endian.
        out.extend_from_slice(&RASTER);
        out.push(0);
        out.extend_from_slice(&(bytes_per_row as u16).to_le_bytes());
        out.extend_from_slice(&(rows as u16).to_le_bytes());
        out.extend_from_slice(stripe);
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

    /// `ESC @` then `FS .`, as the Mitra job opens; feed and cut to close.
    #[test]
    fn starts_with_init_and_ends_with_feed_and_cut() {
        let bytes = encode_lines(&[line("Halo", false)]);
        assert_eq!(&bytes[..4], &[0x1B, 0x40, 0x1C, 0x2E]);
        assert_eq!(
            &bytes[bytes.len() - 6..],
            &[0x1B, 0x64, 0x06, 0x1D, 0x56, 0x01]
        );
    }

    /// Plain is the power-on mode, so plain lines need no mode command at all:
    /// the job is the characters and their line feeds and nothing else.
    #[test]
    fn plain_lines_are_ascii_plus_line_feed() {
        let bytes = encode_lines(&[line("AB", false), line("CD", false)]);
        assert_eq!(
            bytes,
            b"\x1B\x40\x1C\x2EAB\nCD\n\x1B\x64\x06\x1D\x56\x01".to_vec()
        );
    }

    #[test]
    fn empty_line_emits_only_a_line_feed() {
        let bytes = encode_lines(&[line("", false)]);
        assert_eq!(
            bytes,
            b"\x1B\x40\x1C\x2E\n\x1B\x64\x06\x1D\x56\x01".to_vec()
        );
    }

    /// A heading is double height, switched on once for the run and back off
    /// after it.
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
            b"\x1B\x40\x1C\x2Ea\n\x1B\x21\x10b\nc\n\x1B\x21\x00d\n\x1B\x64\x06\x1D\x56\x01"
                .to_vec()
        );
    }

    /// A job that ends in a heading still resets before the trailing feed, so
    /// it feeds at single height and the next job starts clean.
    #[test]
    fn a_job_that_opens_bold_sets_the_mode_once_and_clears_it_once() {
        let bytes = encode_lines(&[line("x", true), line("y", true)]);
        assert_eq!(mode_bytes(&bytes), vec![MODE_HEADING, MODE_PLAIN]);
        assert_eq!(
            &bytes[bytes.len() - 9..],
            &[0x1B, 0x21, 0x00, 0x1B, 0x64, 0x06, 0x1D, 0x56, 0x01]
        );
    }

    /// The token is double width and double height — `ESC ! 0x30`, the same
    /// character size as the `GS ! 0x11` in the Mitra job.
    #[test]
    fn double_size_is_switched_on_and_back_off_around_the_line() {
        let bytes = encode_lines(&[
            line("a", false),
            ReceiptTextLine::double("T"),
            line("b", false),
        ]);
        assert_eq!(
            bytes,
            b"\x1B\x40\x1C\x2Ea\n\x1B\x21\x30T\n\x1B\x21\x00b\n\x1B\x64\x06\x1D\x56\x01".to_vec()
        );
    }

    #[test]
    fn double_size_toggles_only_on_state_change() {
        let bytes = encode_lines(&[
            ReceiptTextLine::double("6991-4243"),
            ReceiptTextLine::double("8030-6764"),
        ]);
        assert_eq!(mode_bytes(&bytes), vec![MODE_TOKEN, MODE_PLAIN]);
    }

    /// A double line ignores `bold`: there is no weight in this scheme to add,
    /// and the size is already both bits.
    #[test]
    fn a_double_line_ignores_bold() {
        let bytes = encode_lines(&[ReceiptTextLine {
            text: "X".to_string(),
            bold: true,
            size: LineSize::Double,
        }]);
        assert_eq!(
            bytes,
            b"\x1B\x40\x1C\x2E\x1B\x21\x30X\n\x1B\x21\x00\x1B\x64\x06\x1D\x56\x01".to_vec()
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
            ReceiptTextLine::double("6991-5243-8030"),
            line("plain", false),
        ]);

        assert_eq!(
            mode_bytes(&bytes),
            vec![MODE_HEADING, MODE_TOKEN, MODE_PLAIN]
        );
    }

    /// Nothing is ever emphasised: bit 3 of the mode byte stays clear on every
    /// line, because a bold 32-column line is what browns this printer out.
    #[test]
    fn no_mode_byte_ever_asks_for_emphasis() {
        let bytes = encode_lines(&[
            line("plain", false),
            line("heading", true),
            ReceiptTextLine::double("6991-5243-8030"),
            ReceiptTextLine {
                text: "bold double".to_string(),
                bold: true,
                size: LineSize::Double,
            },
        ]);

        assert!(
            mode_bytes(&bytes).iter().all(|mode| mode & 0x08 == 0),
            "no print-mode byte may set the emphasis bit"
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
        // Skip ESC @ and FS .; drop the line feed, feed and cut.
        let text = String::from_utf8_lossy(&bytes[4..bytes.len() - 7]);
        assert_eq!(text, "Kopi ? Rp5.000 ??A?B");
    }

    /// A raster job opens with `ESC @`, carries one `GS v 0` per stripe of at
    /// most sixty-four rows, and closes with the feed and cut a text job ends
    /// with. Each header's row count and byte width have to match the bytes that
    /// follow it, or the printer reads the next header as picture.
    #[cfg(windows)]
    #[test]
    fn every_stripe_header_declares_its_own_size() {
        use crate::printing::raster::{render_lines, DOTS_58MM};

        // 100 rows: 24 per line over four lines is 96, plus one more line.
        let lines: Vec<ReceiptTextLine> = (0..5).map(|_| ReceiptTextLine::plain("X")).collect();
        let bitmap = render_lines(&lines, 32, DOTS_58MM).expect("rendered");
        let bytes_per_row = bitmap.bytes_per_row() as usize;
        let bytes = encode_raster(&bitmap);

        assert_eq!(&bytes[..2], &INIT);

        let mut at = INIT.len();
        let mut rows_seen = 0_usize;
        while at + 7 <= bytes.len() && bytes[at..at + 3] == RASTER {
            assert_eq!(bytes[at + 3], 0, "normal size");
            let width = u16::from_le_bytes([bytes[at + 4], bytes[at + 5]]) as usize;
            let rows = u16::from_le_bytes([bytes[at + 6], bytes[at + 7]]) as usize;
            assert_eq!(width, bytes_per_row);
            assert!(rows <= STRIPE_ROWS);

            rows_seen += rows;
            at += 8 + width * rows;
        }

        assert_eq!(rows_seen, bitmap.height as usize);
        assert_eq!(&bytes[at..], &[0x1B, 0x64, 0x06, 0x1D, 0x56, 0x01]);
    }

    #[test]
    fn no_lines_still_produces_init_feed_and_cut() {
        let bytes = encode_lines(&[]);
        assert_eq!(bytes, b"\x1B\x40\x1C\x2E\x1B\x64\x06\x1D\x56\x01".to_vec());
    }
}
