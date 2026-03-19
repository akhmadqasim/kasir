/// Windows printer API for raw data printing via winspool
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use windows::core::PCWSTR;
use windows::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW,
    OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
    PRINTER_DEFAULTSW, PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_2W,
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
        let _ = EnumPrintersW(
            flags,
            None,
            2,
            None,
            &mut bytes_needed,
            &mut count,
        );

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

        let printers = std::slice::from_raw_parts(
            buffer.as_ptr() as *const PRINTER_INFO_2W,
            count as usize,
        );

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

/// Send raw bytes to a named printer
pub fn send_raw_data(printer_name: &str, data: &[u8]) -> Result<(), String> {
    unsafe {
        let printer_name_wide = to_wide(printer_name);
        let mut handle = PRINTER_HANDLE::default();

        let mut datatype_wide = to_wide("RAW");
        let defaults = PRINTER_DEFAULTSW {
            pDatatype: windows::core::PWSTR(datatype_wide.as_mut_ptr()),
            ..Default::default()
        };

        OpenPrinterW(
            PCWSTR(printer_name_wide.as_ptr()),
            &mut handle,
            Some(&defaults),
        )
        .map_err(|e| format!("Gagal membuka printer: {}", e))?;

        let mut doc_name = to_wide("POS Receipt");
        let mut data_type = to_wide("RAW");

        let doc_info = DOC_INFO_1W {
            pDocName: windows::core::PWSTR(doc_name.as_mut_ptr()),
            pDatatype: windows::core::PWSTR(data_type.as_mut_ptr()),
            pOutputFile: windows::core::PWSTR::null(),
        };

        let job_id = StartDocPrinterW(handle, 1, &doc_info as *const DOC_INFO_1W as *const _);
        if job_id == 0 {
            let _ = ClosePrinter(handle);
            return Err("Gagal memulai dokumen print".to_string());
        }

        let page_result = StartPagePrinter(handle);
        if !page_result.as_bool() {
            let _ = EndDocPrinter(handle);
            let _ = ClosePrinter(handle);
            return Err("Gagal memulai halaman print".to_string());
        }

        let mut written: u32 = 0;
        let write_result = WritePrinter(
            handle,
            data.as_ptr() as *const _,
            data.len() as u32,
            &mut written,
        );

        let _ = EndPagePrinter(handle);
        let _ = EndDocPrinter(handle);
        let _ = ClosePrinter(handle);

        if !write_result.as_bool() {
            return Err("Gagal mengirim data ke printer".to_string());
        }

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
        let result = GetDefaultPrinterW(
            Some(windows::core::PWSTR(buffer.as_mut_ptr())),
            &mut size,
        );

        if result.as_bool() {
            // Remove trailing null
            let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
            Some(String::from_utf16_lossy(&buffer[..len]))
        } else {
            None
        }
    }
}

/// Convert PCWSTR to Rust String
unsafe fn pcwstr_to_string(ptr: PCWSTR) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let len = (0..).take_while(|&i| *ptr.0.add(i) != 0).count();
    let slice = std::slice::from_raw_parts(ptr.0, len);
    String::from_utf16_lossy(slice)
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
