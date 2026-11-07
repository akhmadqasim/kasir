//! Receipts as pictures.
//!
//! Text mode prints in the printer's own Font A, whose bold is a different
//! colour of black from its double-height: the two together read as three
//! fonts on one slip. Drawn here instead, the whole slip is one uniform
//! medium-weight monospace face and goes out as raster. That also walks past
//! every quirk this printer's text engine turned out to have: the 32nd column
//! that resets it, `GS !` that stops it mid-job, the print modes that had to be
//! tracked between lines. A bitmap has none of those opinions.
//!
//! The drawing itself is per platform: GDI on Windows (`gdi`), the pure-Rust
//! `ab_glyph` on Linux (`glyphs`). Both use the bundled face on the same
//! cell grid. Text mode (`escpos`) stays the default: it is faster, and it is
//! what the Mitra Indogrosir app prints.

use super::receipt::{LineSize, ReceiptTextLine};

#[cfg(windows)]
mod gdi;
#[cfg(windows)]
use gdi::draw;

#[cfg(target_os = "linux")]
mod glyphs;
#[cfg(target_os = "linux")]
use glyphs::draw;

/// Dots across the printable area, 203 dpi: 58mm paper and 80mm paper.
pub const DOTS_58MM: u32 = 384;
pub const DOTS_80MM: u32 = 576;

/// One character cell. Shared with `layout::columns`, which is where the
/// column counts come from: 12 dots across is what makes 32 of them come to
/// exactly the 384 dots 58mm paper is.
const CELL_WIDTH: u32 = super::layout::CELL_DOTS as u32;
/// Cell height. The Mitra app's print measures a 28-dot line pitch; four more
/// dots here keep one line's descenders clear of the next line's ascenders now
/// that the glyphs are taller than that print's.
const CELL_HEIGHT: u32 = 32;
/// Glyph height — ascent plus descent, no internal leading — inside a normal
/// cell. The face at its natural proportions comes to only 19 dots on a 12-dot
/// advance, which the shop found small; they asked for bigger twice, and this
/// is as tall as a 12-dot-wide glyph goes before the cell has to grow again.
/// `CreateFontW` takes this negative to mean exactly the character height, and
/// `glyphs` scales the face's em to it.
const GLYPH_HEIGHT: i32 = 28;

/// The face the Mitra Indogrosir app ships as `assets/fonts/monospace.ttf` and
/// shows its payment screens in (its printed struk is the printer's own Font
/// A). Manfred Klein's Monospace Typewriter (2004), free for private and
/// commercial use.
const TYPEWRITER_TTF: &[u8] = include_bytes!("../../fonts/MonospaceTypewriter.ttf");

/// A one-bit-per-pixel image, packed the way `GS v 0` wants it: rows top to
/// bottom, within a row the leftmost dot in the high bit, a set bit meaning a
/// dot the printer burns black.
pub struct Bitmap1bpp {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Bitmap1bpp {
    pub fn bytes_per_row(&self) -> u32 {
        self.width.div_ceil(8)
    }

    /// The image as a binary PBM, for a human to look at before it costs paper.
    ///
    /// Only the sample generator wants this, and that is a test.
    #[cfg(test)]
    pub fn to_pbm(&self) -> Vec<u8> {
        let mut out = format!("P4\n{} {}\n", self.width, self.height).into_bytes();
        out.extend_from_slice(&self.data);
        out
    }
}

/// Draw the lines and hand back the picture.
///
/// Every line occupies a whole number of cells, so the layout the formatters
/// computed in columns survives unchanged: centring by padding with spaces lands
/// exactly where it did on paper.
pub fn render_lines(
    lines: &[ReceiptTextLine],
    columns: usize,
    dots_wide: u32,
) -> Result<Bitmap1bpp, String> {
    let height = raster_height(lines)?;
    // The text block is as wide as the columns it was laid out in, centred on
    // the paper. On 58mm the two are the same — 32 cells of 12 dots is exactly
    // the 384 the head is — and on 80mm, where Font A's 42 columns come to 504
    // of 576, this is what keeps a centred line centred on the paper rather
    // than on the left three-quarters of it.
    let block = (columns as u32 * CELL_WIDTH).min(dots_wide);
    let left = (dots_wide - block) / 2;

    draw(lines, dots_wide, height, left)
}

/// Tallest picture we draw: 800 normal lines, about 2.5x a full 100-item sale.
/// On 80mm that is a 1.8 MB picture, and a ~45 MB DIB while GDI draws it.
const MAX_RASTER_HEIGHT: u32 = CELL_HEIGHT * 800;

/// Height of the picture for `lines`, refused before any allocation when it
/// would pass [`MAX_RASTER_HEIGHT`].
fn raster_height(lines: &[ReceiptTextLine]) -> Result<u32, String> {
    let height = lines
        .iter()
        .try_fold(0_u32, |sum, line| {
            sum.checked_add(line_height(line))
                .filter(|h| *h <= MAX_RASTER_HEIGHT)
        })
        .ok_or_else(|| {
            "Struk terlalu panjang untuk dicetak sebagai gambar. Ganti mode cetak ke teks di Pengaturan Printer.".to_string()
        })?;
    Ok(height.max(CELL_HEIGHT))
}

fn line_height(line: &ReceiptTextLine) -> u32 {
    match line.size {
        LineSize::Double => CELL_HEIGHT * 2,
        LineSize::Normal => CELL_HEIGHT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A huge receipt (e.g. megabytes of notes) is refused before the DIB is
    /// allocated; one at the cap still renders.
    #[test]
    fn a_receipt_taller_than_the_cap_is_refused() {
        let max_lines = (MAX_RASTER_HEIGHT / CELL_HEIGHT) as usize;
        let at_cap = vec![ReceiptTextLine::plain("x"); max_lines];
        assert_eq!(raster_height(&at_cap), Ok(MAX_RASTER_HEIGHT));

        let over = vec![ReceiptTextLine::plain("x"); max_lines + 1];
        let err = render_lines(&over, 32, DOTS_58MM)
            .err()
            .expect("an over-tall receipt must be refused");
        assert!(err.contains("terlalu panjang"), "{err}");
    }

    #[test]
    fn a_blank_slip_is_one_empty_cell() {
        let bitmap = render_lines(&[], 32, DOTS_58MM).expect("rendered");

        assert_eq!(bitmap.width, DOTS_58MM);
        assert_eq!(bitmap.height, CELL_HEIGHT);
        assert_eq!(bitmap.bytes_per_row(), 48);
        assert!(bitmap.data.iter().all(|byte| *byte == 0), "nothing to burn");
    }

    #[test]
    fn each_line_takes_a_cell_and_a_double_line_takes_two() {
        let bitmap = render_lines(
            &[
                ReceiptTextLine::plain("one"),
                ReceiptTextLine::bold("two"),
                ReceiptTextLine::double("three"),
            ],
            32,
            DOTS_58MM,
        )
        .expect("rendered");

        assert_eq!(bitmap.height, CELL_HEIGHT * 4);
        assert_eq!(bitmap.data.len(), 48 * CELL_HEIGHT as usize * 4);
    }

    /// The one thing only a real rasterizer can answer: that glyphs actually land
    /// on the bitmap, in the cell they were asked for and nowhere else.
    #[test]
    fn text_is_drawn_as_dots_inside_its_own_cell() {
        let bitmap = render_lines(
            &[
                ReceiptTextLine::plain(""),
                ReceiptTextLine::plain("XXXX"),
                ReceiptTextLine::plain(""),
            ],
            32,
            DOTS_58MM,
        )
        .expect("rendered");

        let row_has_dots = |y: u32| {
            let start = (y * bitmap.bytes_per_row()) as usize;
            bitmap.data[start..start + bitmap.bytes_per_row() as usize]
                .iter()
                .any(|byte| *byte != 0)
        };

        assert!(
            (CELL_HEIGHT..CELL_HEIGHT * 2).any(row_has_dots),
            "the X's cell is empty"
        );
        assert!(!(0..CELL_HEIGHT).any(row_has_dots), "ink above the line");
        assert!(
            !(CELL_HEIGHT * 2..CELL_HEIGHT * 3).any(row_has_dots),
            "ink below the line"
        );
    }

    /// Thirty-two characters have to fill the paper exactly, because that is the
    /// width every formatter in this module tree lays out to.
    #[test]
    fn thirty_two_characters_span_the_whole_width() {
        let bitmap = render_lines(&[ReceiptTextLine::plain("X".repeat(32))], 32, DOTS_58MM)
            .expect("rendered");

        let last_byte_has_dots = bitmap.data[bitmap.bytes_per_row() as usize - 1..]
            .iter()
            .step_by(bitmap.bytes_per_row() as usize)
            .any(|byte| *byte != 0);

        assert!(last_byte_has_dots, "the 32nd character fell off the paper");
    }

    #[test]
    fn a_pbm_carries_the_header_and_every_row() {
        let bitmap = render_lines(&[ReceiptTextLine::plain("X")], 32, DOTS_58MM).expect("rendered");
        let pbm = bitmap.to_pbm();

        let header = format!("P4\n384 {CELL_HEIGHT}\n");
        assert!(pbm.starts_with(header.as_bytes()));
        assert_eq!(pbm.len(), header.len() + 48 * CELL_HEIGHT as usize);
    }
}
