/// Windows printer API for GDI-based text printing
/// Uses GDI pipeline (through printer driver) for reliable USB thermal printing
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use windows::core::PCWSTR;
use windows::Win32::Graphics::Printing::{
    EnumPrintersW, GetDefaultPrinterW, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
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

/// List all available Windows printers
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    unsafe {
        let flags = PRINTER_ENUM_LOCAL;
        let mut bytes_needed: u32 = 0;
        let mut count: u32 = 0;

        // First call to get required buffer size
        let _ = EnumPrintersW(flags, None, 2, None, &mut bytes_needed, &mut count);

        if bytes_needed == 0 {
            return Ok(vec![]);
        }

        let mut buffer = vec![0u8; bytes_needed as usize];

        let result = EnumPrintersW(
            flags,
            None,
            2,
            Some(&mut buffer),
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
            let is_default = default_printer.as_ref().map_or(false, |d| d == &name);
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

/// Send receipt text lines to printer using GDI pipeline (goes through printer driver).
/// This is more reliable than RAW for cheap USB thermal printers.
pub fn send_gdi_text(
    printer_name: &str,
    lines: &[super::receipt::ReceiptTextLine],
) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, CreateFontW, DeleteDC, DeleteObject, GetDeviceCaps, GetTextMetricsW,
        SelectObject, TextOutW, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_QUALITY, FIXED_PITCH,
        FW_BOLD, FW_NORMAL, LOGPIXELSY, OUT_DEFAULT_PRECIS, TEXTMETRICW,
    };

    unsafe {
        let printer_wide = to_wide(printer_name);
        let hdc = CreateDCW(
            PCWSTR::null(),
            PCWSTR(printer_wide.as_ptr()),
            PCWSTR::null(),
            None,
        );

        let hdc_raw = hdc.0 as isize;
        if hdc.0.is_null() {
            return Err(format!("Gagal membuat printer DC untuk '{}'", printer_name));
        }

        let dpi_y = GetDeviceCaps(Some(hdc), LOGPIXELSY);
        let font_height = -(7 * dpi_y / 72); // 7pt

        eprintln!(
            "[gdi] DC created for '{}', DPI_Y={}, font_height={}",
            printer_name, dpi_y, font_height
        );

        let font_name_wide = to_wide("Consolas");
        let normal_font = CreateFontW(
            font_height,
            0,
            0,
            0,
            FW_NORMAL.0 as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            DEFAULT_QUALITY,
            FIXED_PITCH.0 as u32,
            PCWSTR(font_name_wide.as_ptr()),
        );

        let bold_font = CreateFontW(
            font_height,
            0,
            0,
            0,
            FW_BOLD.0 as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            DEFAULT_QUALITY,
            FIXED_PITCH.0 as u32,
            PCWSTR(font_name_wide.as_ptr()),
        );

        // Select normal font and get text metrics for line height
        SelectObject(hdc, normal_font.into());
        let mut tm = TEXTMETRICW::default();
        let _ = GetTextMetricsW(hdc, &mut tm);
        let line_height = tm.tmHeight + tm.tmExternalLeading;

        // Start document using manually linked GDI functions
        let doc_name_wide = to_wide("POS Receipt");
        let doc_info = GdiDocInfoW {
            cb_size: std::mem::size_of::<GdiDocInfoW>() as i32,
            lpsz_doc_name: doc_name_wide.as_ptr(),
            lpsz_output: std::ptr::null(),
            lpsz_datatype: std::ptr::null(),
            fw_type: 0,
        };

        let doc_id = GdiStartDocW(hdc_raw, &doc_info);
        if doc_id <= 0 {
            let _ = DeleteObject(normal_font.into());
            let _ = DeleteObject(bold_font.into());
            let _ = DeleteDC(hdc);
            return Err("StartDocW gagal".to_string());
        }

        if GdiStartPage(hdc_raw) <= 0 {
            GdiEndDoc(hdc_raw);
            let _ = DeleteObject(normal_font.into());
            let _ = DeleteObject(bold_font.into());
            let _ = DeleteDC(hdc);
            return Err("StartPage gagal".to_string());
        }

        // Print each line
        let mut y = 0i32;
        for line in lines {
            if line.bold {
                SelectObject(hdc, bold_font.into());
            } else {
                SelectObject(hdc, normal_font.into());
            }

            let text_wide: Vec<u16> = OsStr::new(&line.text).encode_wide().collect();
            if !text_wide.is_empty() {
                let _ = TextOutW(hdc, 0, y, &text_wide);
            }
            y += line_height;
        }

        GdiEndPage(hdc_raw);
        GdiEndDoc(hdc_raw);

        let _ = DeleteObject(normal_font.into());
        let _ = DeleteObject(bold_font.into());
        let _ = DeleteDC(hdc);

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
