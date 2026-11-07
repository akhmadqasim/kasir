//! The raster backend on Windows: GDI draws the text into a DIB, which is then
//! thresholded into dots.

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

use super::{line_height, Bitmap1bpp, CELL_WIDTH, GLYPH_HEIGHT, TYPEWRITER_TTF};
use crate::printing::receipt::{LineSize, ReceiptTextLine};

/// The face to draw with, best first. Both are monospace and both ship with
/// Windows; `Consolas` is the cleaner of the two at this size.
const FACES: [&str; 3] = [TYPEWRITER_FACE, "Consolas", "Courier New"];

/// The name the bundled face ([`TYPEWRITER_TTF`]) registers under.
const TYPEWRITER_FACE: &str = "MonospaceTypewriter";

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
                // GDI writes the count here even though the binding spells the
                // pointer `*const`, so it has to point at something mutable.
                std::ptr::from_mut(&mut installed).cast_const(),
            )
        };
        !handle.is_invalid() && installed > 0
    });
}

/// Draw `lines` into a `dots_wide` x `height` picture whose text block starts
/// `left` dots in.
pub(super) fn draw(
    lines: &[ReceiptTextLine],
    dots_wide: u32,
    height: u32,
    left: u32,
) -> Result<Bitmap1bpp, String> {
    // SAFETY: every handle created below is deleted before returning, and the
    // pixel buffer is only touched while the bitmap that owns it is alive.
    unsafe { draw_dib(lines, dots_wide, height, left as i32) }
}

unsafe fn draw_dib(
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
    let normal = font_for(dc, CELL_WIDTH, GLYPH_HEIGHT, FW_NORMAL.0);
    let emphasised = font_for(dc, CELL_WIDTH, GLYPH_HEIGHT, FW_BOLD.0);
    let doubled = font_for(dc, CELL_WIDTH * 2, GLYPH_HEIGHT * 2, FW_NORMAL.0);

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
    // One-dot strokes, deliberately. Every attempt at a heavier weight — a
    // synthetic bold, a one-dot smear sideways, even a one-dot smear downwards
    // — put the caps line over 180-210 dots a row for twenty rows running, and
    // this printer's supply browns out and reboots at that load at USB speed.
    let data = threshold(pixels, stride, dots_wide, height);

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

/// A font `glyph_height` dots tall whose characters advance no more than
/// `advance` dots.
///
/// Height and width are asked for separately: GDI scales a TrueType face
/// horizontally to the requested average width, so the glyphs can be taller
/// than the face would naturally be at this advance. The advance is then
/// measured rather than trusted — faces round differently — and the width
/// walked down a dot at a time until a run of characters really fits the cell.
unsafe fn font_for(dc: HDC, advance: u32, glyph_height: i32, weight: u32) -> HFONT {
    for face in FACES {
        for width in (1..=advance as i32).rev() {
            let font = create_font(face, -glyph_height, width, weight);
            if font.is_invalid() {
                continue;
            }

            match measured_advance(dc, font) {
                Some(measured) if measured <= advance => return font,
                _ => {
                    let _ = DeleteObject(font.into());
                }
            }
        }
    }

    // Nothing measurable at all — no face installed, or a DC that answers
    // nothing. The mapper will substitute something for this; a receipt in the
    // wrong font beats no receipt.
    create_font(FACES[2], -glyph_height, advance as i32, weight)
}

unsafe fn create_font(face: &str, height: i32, width: i32, weight: u32) -> HFONT {
    let name: Vec<u16> = face.encode_utf16().chain(std::iter::once(0)).collect();

    CreateFontW(
        height,
        width,
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
