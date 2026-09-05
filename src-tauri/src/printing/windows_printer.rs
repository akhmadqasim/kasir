/// Windows printer API for GDI-based text printing
/// Uses GDI pipeline (through printer driver) for reliable USB thermal printing
use std::ffi::OsStr;
use std::mem::{align_of, size_of};
use std::os::windows::ffi::OsStrExt;

use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{DeleteDC, DeleteObject, SelectObject, HDC, HFONT, HGDIOBJ};
use windows::Win32::Graphics::Printing::{
    EnumPrintersW, GetDefaultPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
    PRINTER_INFO_2W,
};

/// Printer information returned to frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
    pub status: u32,
}

/// Convert Rust string to null-terminated wide string
fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

/// A byte buffer with the alignment `PRINTER_INFO_2W` requires.
///
/// `EnumPrintersW` writes an array of `PRINTER_INFO_2W` into a caller-supplied
/// byte buffer and appends the strings those structs point at. Reading it back
/// through `slice::from_raw_parts::<PRINTER_INFO_2W>` requires a pointer aligned
/// to `align_of::<PRINTER_INFO_2W>()` — 8, because the struct is full of
/// pointers — and a `Vec<u8>` only guarantees alignment 1. That the allocator
/// usually returns an aligned block does not make it defined behaviour.
/// Allocating `u64`s and viewing them as bytes gives the guarantee for real.
struct AlignedBuffer {
    words: Vec<u64>,
    len: usize,
}

impl AlignedBuffer {
    fn new(len: usize) -> Self {
        const _: () = assert!(align_of::<PRINTER_INFO_2W>() <= align_of::<u64>());
        let words = vec![0u64; len.div_ceil(size_of::<u64>()).max(1)];
        Self { words, len }
    }

    fn as_bytes_mut(&mut self) -> &mut [u8] {
        // SAFETY: `words` owns at least `len` bytes and `u8` has no alignment or
        // validity requirement that `u64` does not already satisfy.
        unsafe { std::slice::from_raw_parts_mut(self.words.as_mut_ptr().cast::<u8>(), self.len) }
    }

    fn as_ptr(&self) -> *const u8 {
        self.words.as_ptr().cast()
    }
}

/// List all available Windows printers, local and network.
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    unsafe {
        // PRINTER_ENUM_CONNECTIONS adds the printers this machine is connected to
        // over the network. Without it a shared thermal printer — the obvious
        // setup for a multi-terminal shop — never appeared in the list at all.
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut bytes_needed: u32 = 0;
        let mut count: u32 = 0;

        // First call to get required buffer size
        let _ = EnumPrintersW(flags, None, 2, None, &mut bytes_needed, &mut count);

        if bytes_needed == 0 {
            return Ok(vec![]);
        }

        let mut buffer = AlignedBuffer::new(bytes_needed as usize);

        let result = EnumPrintersW(
            flags,
            None,
            2,
            Some(buffer.as_bytes_mut()),
            &mut bytes_needed,
            &mut count,
        );

        if result.is_err() {
            return Err("Gagal menampilkan daftar printer".to_string());
        }

        let printers =
            std::slice::from_raw_parts(buffer.as_ptr() as *const PRINTER_INFO_2W, count as usize);

        let default_printer = get_default_printer();

        let mut result_list = Vec::new();
        for printer in printers {
            let name = pwstr_to_string(printer.pPrinterName);
            let is_default = default_printer.as_ref().is_some_and(|d| d == &name);
            result_list.push(PrinterInfo {
                name,
                is_default,
                status: printer.Status,
            });
        }

        Ok(result_list)
    }
}

// GDI document management functions (not exposed in windows crate v0.62)
#[link(name = "gdi32")]
extern "system" {
    #[link_name = "StartDocW"]
    fn GdiStartDocW(hdc: isize, lpdi: *const GdiDocInfoW) -> i32;
    #[link_name = "EndDoc"]
    fn GdiEndDoc(hdc: isize) -> i32;
    #[link_name = "StartPage"]
    fn GdiStartPage(hdc: isize) -> i32;
    #[link_name = "EndPage"]
    fn GdiEndPage(hdc: isize) -> i32;
}

/// DOCINFO struct for GDI StartDocW
#[repr(C)]
struct GdiDocInfoW {
    cb_size: i32,
    lpsz_doc_name: *const u16,
    lpsz_output: *const u16,
    lpsz_datatype: *const u16,
    fw_type: u32,
}

// --- RAII guards ---
//
// `send_gdi_text` has five exit paths (DC creation, font creation, StartDoc,
// StartPage, success). Each one repeated its own cleanup, and each one got the
// order wrong: `DeleteObject` was called on both fonts while one of them was
// still selected into the DC. Windows refuses to delete a selected object, and
// the failure was swallowed by `let _ =`, so every receipt leaked one or two
// GDI objects out of the 10.000-per-process limit — a busy shop eventually
// cannot print until the app is restarted.
//
// Drop runs in reverse declaration order, so declaring the DC first, then the
// fonts, then the selection guard gives exactly the required order: restore the
// DC's original object, delete the fonts, delete the DC.

struct GdiDc(HDC);

impl Drop for GdiDc {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteDC(self.0);
        }
    }
}

struct GdiFont(HFONT);

impl Drop for GdiFont {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(self.0.into());
        }
    }
}

/// Puts the object a DC held before `SelectObject` back when dropped, so the
/// fonts are no longer selected by the time they are deleted.
struct SelectedGdiObject {
    hdc: HDC,
    previous: HGDIOBJ,
}

impl Drop for SelectedGdiObject {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.hdc, self.previous);
        }
    }
}

/// Send receipt text lines to printer using GDI pipeline (goes through printer driver).
/// This is more reliable than RAW for cheap USB thermal printers.
pub fn send_gdi_text(
    printer_name: &str,
    lines: &[super::receipt::ReceiptTextLine],
) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, CreateFontW, GetDeviceCaps, GetTextMetricsW, TextOutW, CLIP_DEFAULT_PRECIS,
        DEFAULT_CHARSET, DEFAULT_QUALITY, FIXED_PITCH, FW_BOLD, FW_NORMAL, LOGPIXELSY,
        OUT_DEFAULT_PRECIS, TEXTMETRICW,
    };

    unsafe {
        let printer_wide = to_wide(printer_name);
        let hdc = CreateDCW(
            PCWSTR::null(),
            PCWSTR(printer_wide.as_ptr()),
            PCWSTR::null(),
            None,
        );

        if hdc.0.is_null() {
            return Err(format!("Gagal membuat printer DC untuk '{}'", printer_name));
        }
        let hdc_raw = hdc.0 as isize;
        let _dc = GdiDc(hdc);

        let dpi_y = GetDeviceCaps(Some(hdc), LOGPIXELSY);
        let font_height = -(7 * dpi_y / 72); // 7pt

        eprintln!(
            "[gdi] DC created for '{}', DPI_Y={}, font_height={}",
            printer_name, dpi_y, font_height
        );

        let font_name_wide = to_wide("Consolas");
        let make_font = |weight: i32| {
            CreateFontW(
                font_height,
                0,
                0,
                0,
                weight,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                DEFAULT_QUALITY,
                FIXED_PITCH.0 as u32,
                PCWSTR(font_name_wide.as_ptr()),
            )
        };

        let normal_font = GdiFont(make_font(FW_NORMAL.0 as i32));
        let bold_font = GdiFont(make_font(FW_BOLD.0 as i32));

        if normal_font.0.is_invalid() || bold_font.0.is_invalid() {
            return Err("Gagal membuat font untuk struk".to_string());
        }

        // Select normal font and get text metrics for line height. The object the
        // DC held first has to go back before the fonts are deleted.
        let previous = SelectObject(hdc, normal_font.0.into());
        let _selection = SelectedGdiObject { hdc, previous };

        let mut tm = TEXTMETRICW::default();
        let _ = GetTextMetricsW(hdc, &mut tm);
        let line_height = tm.tmHeight + tm.tmExternalLeading;

        // Start document using manually linked GDI functions
        let doc_name_wide = to_wide("POS Receipt");
        let doc_info = GdiDocInfoW {
            cb_size: size_of::<GdiDocInfoW>() as i32,
            lpsz_doc_name: doc_name_wide.as_ptr(),
            lpsz_output: std::ptr::null(),
            lpsz_datatype: std::ptr::null(),
            fw_type: 0,
        };

        if GdiStartDocW(hdc_raw, &doc_info) <= 0 {
            return Err("StartDocW gagal".to_string());
        }

        if GdiStartPage(hdc_raw) <= 0 {
            GdiEndDoc(hdc_raw);
            return Err("StartPage gagal".to_string());
        }

        // Print each line
        let mut y = 0i32;
        for line in lines {
            SelectObject(
                hdc,
                if line.bold {
                    bold_font.0.into()
                } else {
                    normal_font.0.into()
                },
            );

            let text_wide: Vec<u16> = OsStr::new(&line.text).encode_wide().collect();
            if !text_wide.is_empty() {
                let _ = TextOutW(hdc, 0, y, &text_wide);
            }
            y += line_height;
        }

        GdiEndPage(hdc_raw);
        GdiEndDoc(hdc_raw);

        eprintln!("[gdi] Print completed, {} lines", lines.len());
        Ok(())
    }
}

/// Get the default Windows printer name
fn get_default_printer() -> Option<String> {
    unsafe {
        let mut size: u32 = 0;
        let _ = GetDefaultPrinterW(None, &mut size);

        if size == 0 {
            return None;
        }

        let mut buffer = vec![0u16; size as usize];
        let result = GetDefaultPrinterW(Some(windows::core::PWSTR(buffer.as_mut_ptr())), &mut size);

        if result.as_bool() {
            // Remove trailing null
            let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
            Some(String::from_utf16_lossy(&buffer[..len]))
        } else {
            None
        }
    }
}

/// Convert PWSTR to Rust String
unsafe fn pwstr_to_string(ptr: windows::core::PWSTR) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let len = (0..).take_while(|&i| *ptr.0.add(i) != 0).count();
    let slice = std::slice::from_raw_parts(ptr.0, len);
    String::from_utf16_lossy(slice)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aligned_buffer_is_aligned_for_printer_info() {
        for len in [1usize, 7, 8, 9, 1024, 4095] {
            let mut buffer = AlignedBuffer::new(len);
            assert_eq!(buffer.as_bytes_mut().len(), len);
            assert_eq!(
                buffer.as_ptr() as usize % align_of::<PRINTER_INFO_2W>(),
                0,
                "buffer of {len} bytes is misaligned"
            );
        }
    }
}
