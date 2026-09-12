//! Receipts as pictures.
//!
//! The Mitra Indogrosir app prints its struk over Bluetooth to this same 58mm
//! unit, and what comes out is a bitmap: one uniform medium-weight monospace
//! face, every line the same, the provider's own wrapping left exactly as it
//! arrived. Our ESC/POS text mode could not look like that — Font A's bold is a
//! different colour of black from its double-height, and the two together read
//! as three fonts on one slip.
//!
//! So the text is drawn here instead, with GDI, and sent as raster. That also
//! walks past every quirk this printer's text engine turned out to have: the
//! 32nd column that resets it, `GS !` that stops it mid-job, the print modes
//! that had to be tracked between lines. A bitmap has none of those opinions.
//!
//! Windows only, because GDI is. The text path in `escpos` stays for the test
//! page and for anyone who would rather have the speed.

use std::mem::size_of;

use std::sync::OnceLock;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, SIZE};

use windows::Win32::Graphics::Gdi::{
    AddFontMemResourceEx, CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC,
    DeleteObject, GdiFlush, GetDC, GetTextExtentPoint32W, GetTextMetricsW, ReleaseDC, SelectObject,
    SetBkMode, SetTextColor, TextOutW, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLIP_DEFAULT_PRECIS,
    DIB_RGB_COLORS, FF_MODERN, FIXED_PITCH, FW_BOLD, FW_NORMAL, HBITMAP, HDC, HFONT,
    NONANTIALIASED_QUALITY, OUT_TT_PRECIS, TEXTMETRICW, TRANSPARENT,
};

use super::receipt::{LineSize, ReceiptTextLine};

/// Dots across the printable area, 203 dpi: 58mm paper and 80mm paper.
pub const DOTS_58MM: u32 = 384;
pub const DOTS_80MM: u32 = 576;

/// One character cell. Shared with `receipt::columns`, which is where the
/// column counts come from: 12 dots across is what makes 32 of them come to
/// exactly the 384 dots 58mm paper is.
const CELL_WIDTH: u32 = super::receipt::CELL_DOTS as u32;
/// Cell height. Measured off the Mitra app's own print on this paper: 17 rows
/// of its PLN table span about 61 mm, a line pitch of 3.6 mm — 28 dots at
/// 203 dpi — with the typewriter face at the size whose advance is 12 dots.
const CELL_HEIGHT: u32 = 28;

/// The face to draw with, best first. Both are monospace and both ship with
/// Windows; `Consolas` is the cleaner of the two at this size.
const FACES: [&str; 3] = [TYPEWRITER_FACE, "Consolas", "Courier New"];

/// The face the Mitra Indogrosir app draws its struk with — it ships this very
/// file as `assets/fonts/monospace.ttf` — so a struk from this till and one
/// from the phone come out in the same letters. Manfred Klein's Monospace
/// Typewriter (2004), free for private and commercial use.
const TYPEWRITER_FACE: &str = "MonospaceTypewriter";
const TYPEWRITER_TTF: &[u8] = include_bytes!("../../fonts/MonospaceTypewriter.ttf");

/// Make the bundled face known to GDI for this process. The handle is never
/// released: the font is needed for as long as the process prints, and Windows
/// drops it at exit.
fn ensure_typewriter_font() {
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    REGISTERED.get_or_init(|| {
        let mut installed = 0_u32;
        // SAFETY: the byte slice outlives the call and GDI copies it.
        let handle = unsafe {
            AddFontMemResourceEx(
                TYPEWRITER_TTF.as_ptr().cast(),
                TYPEWRITER_TTF.len() as u32,
                None,
                &mut installed,
            )
        };
        !handle.is_invalid() && installed > 0
    });
}

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
    let height: u32 = lines.iter().map(line_height).sum::<u32>().max(CELL_HEIGHT);
    // The text block is as wide as the columns it was laid out in, centred on
    // the paper. On 58mm the two are the same — 32 cells of 12 dots is exactly
    // the 384 the head is — and on 80mm, where Font A's 42 columns come to 504
    // of 576, this is what keeps a centred line centred on the paper rather
    // than on the left three-quarters of it.
    let block = (columns as u32 * CELL_WIDTH).min(dots_wide);
    let left = (dots_wide - block) / 2;

    // SAFETY: every handle created below is deleted before returning, and the
    // pixel buffer is only touched while the bitmap that owns it is alive.
    unsafe { draw(lines, dots_wide, height, left as i32) }
}

fn line_height(line: &ReceiptTextLine) -> u32 {
    match line.size {
        LineSize::Double => CELL_HEIGHT * 2,
        LineSize::Normal => CELL_HEIGHT,
    }
}

unsafe fn draw(
    lines: &[ReceiptTextLine],
    dots_wide: u32,
    height: u32,
    left: i32,
) -> Result<Bitmap1bpp, String> {
    let screen = GetDC(Some(HWND::default()));
    let dc = CreateCompatibleDC(Some(screen));
    let _ = ReleaseDC(Some(HWND::default()), screen);
    if dc.is_invalid() {
        return Err("Gagal menyiapkan gambar struk".to_string());
    }

    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: dots_wide as i32,
            // Negative: rows run top to bottom, the order the printer wants them.
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 24,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    // On failure `bits` is left as it was, so both have to be checked: a null
    // pointer here would be a slice over address zero, which is not a bug that
    // announces itself politely.
    let bitmap: HBITMAP =
        match CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bitmap) if !bitmap.is_invalid() && !bits.is_null() => bitmap,
            _ => {
                let _ = DeleteDC(dc);
                return Err("Gagal menyiapkan gambar struk".to_string());
            }
        };

    let stride = (dots_wide as usize * 3).div_ceil(4) * 4;
    let len = stride * height as usize;
    {
        // White paper. The DIB arrives zeroed, which would be a solid black
        // slip. The mutable view ends here: from the next line on GDI writes
        // this memory, and holding a `&mut` across that would be two writers.
        let pixels = std::slice::from_raw_parts_mut(bits.cast::<u8>(), len);
        pixels.fill(0xFF);
    }

    let previous = SelectObject(dc, bitmap.into());
    let _ = SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, windows::Win32::Foundation::COLORREF(0x00_00_00));

    ensure_typewriter_font();
    let normal = font_for(dc, CELL_WIDTH, FW_NORMAL.0);
    let emphasised = font_for(dc, CELL_WIDTH, FW_BOLD.0);
    let doubled = font_for(dc, CELL_WIDTH * 2, FW_NORMAL.0);

    let mut y = 0_i32;
    for line in lines {
        let font = match (line.size, line.bold) {
            (LineSize::Double, _) => doubled,
            (LineSize::Normal, true) => emphasised,
            (LineSize::Normal, false) => normal,
        };
        let cell = line_height(line) as i32;

        if !line.text.trim().is_empty() {
            let old = SelectObject(dc, font.into());
            let wide: Vec<u16> = line.text.encode_utf16().collect();
            // Centre the glyphs in their cell: the face is shorter than the
            // cell, and the difference is what gives the print its air.
            let mut metrics = TEXTMETRICW::default();
            let _ = GetTextMetricsW(dc, &mut metrics);
            let top = y + (cell - metrics.tmHeight).max(0) / 2;
            let _ = TextOutW(dc, left, top, &wide);
            SelectObject(dc, old);
        }

        y += cell;
    }

    // GDI batches drawing and the DIB's memory is only guaranteed current after
    // a flush. Without this the tail of a long receipt can come out blank, and
    // nothing anywhere reports an error.
    let _ = GdiFlush();

    let pixels = std::slice::from_raw_parts(bits.cast::<u8>(), len);
    let mut data = threshold(pixels, stride, dots_wide, height);
    // The phone draws antialiased glyphs and the head burns every grey that is
    // not near-white, so its stems come out two dots wide; ours are drawn
    // without antialiasing and would be one. Widen them to match.
    thicken(&mut data, dots_wide.div_ceil(8) as usize);

    SelectObject(dc, previous);
    let _ = DeleteObject(normal.into());
    let _ = DeleteObject(emphasised.into());
    let _ = DeleteObject(doubled.into());
    let _ = DeleteObject(bitmap.into());
    let _ = DeleteDC(dc);

    Ok(Bitmap1bpp {
        width: dots_wide,
        height,
        data,
    })
}

/// The largest size of the face at its natural proportions whose characters
/// advance no more than `advance` dots.
///
/// The em size that produces a given advance is a property of the face, so it
/// is measured rather than assumed: walk the heights, keep the last one whose
/// run of characters still fits the cell. Natural proportions matter — the
/// Mitra print is this face at exactly that size, and condensing or stretching
/// it to some other height is what made ours look like a different font.
unsafe fn font_for(dc: HDC, advance: u32, weight: u32) -> HFONT {
    let mut best: Option<HFONT> = None;

    for face in FACES {
        for height in 8..=(advance as i32 * 4) {
            let font = create_font(face, height, weight);
            if font.is_invalid() {
                continue;
            }

            match measured_advance(dc, font) {
                Some(measured) if measured <= advance => {
                    if let Some(previous) = best.replace(font) {
                        let _ = DeleteObject(previous.into());
                    }
                }
                _ => {
                    let _ = DeleteObject(font.into());
                    break;
                }
            }
        }

        if best.is_some() {
            break;
        }
    }

    // Nothing measurable at all — no face installed, or a DC that answers
    // nothing. The mapper will substitute something for this; a receipt in the
    // wrong font beats no receipt.
    best.unwrap_or_else(|| create_font(FACES[2], advance as i32, weight))
}

unsafe fn create_font(face: &str, height: i32, weight: u32) -> HFONT {
    let name: Vec<u16> = face.encode_utf16().chain(std::iter::once(0)).collect();

    CreateFontW(
        height,
        0,
        0,
        0,
        weight as i32,
        0,
        0,
        0,
        windows::Win32::Graphics::Gdi::DEFAULT_CHARSET,
        OUT_TT_PRECIS,
        CLIP_DEFAULT_PRECIS,
        NONANTIALIASED_QUALITY,
        (FIXED_PITCH.0 | FF_MODERN.0) as u32,
        PCWSTR(name.as_ptr()),
    )
}

/// How far one character advances, measured on a run of them so rounding in the
/// face's own metrics cannot mislead by a dot.
unsafe fn measured_advance(dc: HDC, font: HFONT) -> Option<u32> {
    const SAMPLE: &str = "0123456789ABCDEFGHIJ";

    let old = SelectObject(dc, font.into());
    let wide: Vec<u16> = SAMPLE.encode_utf16().collect();
    let mut size = SIZE::default();
    let measured = GetTextExtentPoint32W(dc, &wide, &mut size).as_bool();
    SelectObject(dc, old);

    measured.then(|| size.cx as u32 / SAMPLE.len() as u32)
}

/// Turn the drawing into dots: anything not near-white is a dot to burn.
///
/// A single threshold is right here rather than dithering — the source is
/// antialiasing-free text on white, so every pixel is already one or the other
/// apart from a handful on the edges of curves.
/// Widen every stroke by one dot to the right.
///
/// The Mitra app's print has heavier strokes than a one-dot-wide GDI stem on a
/// 203 dpi head, and asking the face for a bolder weight clogs the counters of
/// a glyph condensed to a 12-dot advance. Smearing each set dot one dot to the
/// right thickens every stroke by the same amount, straight or curved, without
/// changing the letterforms.
fn thicken(data: &mut [u8], bytes_per_row: usize) {
    for row in data.chunks_mut(bytes_per_row) {
        let mut carry = 0_u8;
        for byte in row.iter_mut() {
            let next_carry = (*byte & 1) << 7;
            *byte |= (*byte >> 1) | carry;
            carry = next_carry;
        }
    }
}

fn threshold(pixels: &[u8], stride: usize, width: u32, height: u32) -> Vec<u8> {
    let bytes_per_row = width.div_ceil(8) as usize;
    let mut data = vec![0_u8; bytes_per_row * height as usize];

    for y in 0..height as usize {
        let row = &pixels[y * stride..];
        for x in 0..width as usize {
            let blue = row[x * 3] as u16;
            let green = row[x * 3 + 1] as u16;
            let red = row[x * 3 + 2] as u16;
            if (blue + green + red) / 3 < 128 {
                data[y * bytes_per_row + x / 8] |= 0x80 >> (x % 8);
            }
        }
    }

    data
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// The one thing only the real GDI can answer: that glyphs actually land on
    /// the bitmap, in the cell they were asked for and nowhere else.
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

    /// A single dot becomes two; a run keeps its left edge and grows one dot on
    /// the right, across a byte boundary too.
    #[test]
    fn thicken_smears_every_dot_one_to_the_right() {
        let mut row = vec![0b1000_0000, 0b0000_0001, 0b0000_0000];
        thicken(&mut row, 3);
        assert_eq!(row, vec![0b1100_0000, 0b0000_0001, 0b1000_0000]);
    }

    #[test]
    fn a_pbm_carries_the_header_and_every_row() {
        let bitmap = render_lines(&[ReceiptTextLine::plain("X")], 32, DOTS_58MM).expect("rendered");
        let pbm = bitmap.to_pbm();

        assert!(pbm.starts_with(b"P4\n384 28\n"));
        assert_eq!(pbm.len(), 10 + 48 * 28);
    }
}
