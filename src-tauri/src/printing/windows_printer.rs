//! Windows printer API: enumerate print queues and send raw ESC/POS bytes
//! through the spooler (winspool, datatype "RAW").

use std::ffi::OsStr;
use std::mem::{align_of, size_of};
use std::os::windows::ffi::OsStrExt;

use windows::core::{HRESULT, PCWSTR, PWSTR};
use windows::Win32::Foundation::GetLastError;
use windows::Win32::Graphics::Printing::{
    AbortPrinter, ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW,
    OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
    PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_2W,
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

/// Send raw bytes to a named print queue with datatype "RAW", so the spooler
/// hands them to the device untouched instead of letting the driver rasterise
/// them. This is what makes ESC/POS text print in the printer's own font.
pub fn send_raw_data(printer_name: &str, data: &[u8]) -> Result<(), String> {
    unsafe {
        let printer_name_wide = to_wide(printer_name);
        let mut handle = PRINTER_HANDLE::default();

        // pDefault stays None so the spooler grants PRINTER_ACCESS_USE. Passing
        // a PRINTER_DEFAULTSW whose DesiredAccess is left at 0 yields a handle
        // with no rights, and the job then fails with ERROR_ACCESS_DENIED for
        // non-elevated users. The datatype is set per job in DOC_INFO_1W below.
        OpenPrinterW(PCWSTR(printer_name_wide.as_ptr()), &mut handle, None)
            .map_err(|e| format!("Gagal membuka printer '{}': {}", printer_name, e))?;

        let result = write_job(handle, data);

        let _ = ClosePrinter(handle);
        result
    }
}

/// Run one spooler job on an already-open printer handle. Kept separate from
/// `send_raw_data` so its early returns cannot skip `ClosePrinter`.
unsafe fn write_job(handle: PRINTER_HANDLE, data: &[u8]) -> Result<(), String> {
    let mut doc_name = to_wide("POS Receipt");
    let mut datatype = to_wide("RAW");

    let doc_info = DOC_INFO_1W {
        pDocName: PWSTR(doc_name.as_mut_ptr()),
        pDatatype: PWSTR(datatype.as_mut_ptr()),
        pOutputFile: PWSTR::null(),
    };

    if StartDocPrinterW(handle, 1, &doc_info) == 0 {
        return Err(format!("Gagal memulai dokumen print: {}", last_error()));
    }

    if !StartPagePrinter(handle).as_bool() {
        let err = last_error();
        let _ = EndDocPrinter(handle);
        return Err(format!("Gagal memulai halaman print: {}", err));
    }

    // A half-written job must be discarded, not committed: a truncated receipt
    // still comes out of the printer, and the cashier — who only sees the error
    // — reprints and hands the customer two receipts.
    if let Err(e) = write_all(handle, data) {
        let _ = AbortPrinter(handle);
        return Err(e);
    }

    if !EndPagePrinter(handle).as_bool() {
        let err = last_error();
        let _ = AbortPrinter(handle);
        return Err(format!("Gagal menutup halaman print: {}", err));
    }

    // Only EndDocPrinter tells us the spooler actually accepted the job, so its
    // failure must surface rather than be reported to the cashier as success.
    if !EndDocPrinter(handle).as_bool() {
        return Err(format!(
            "Gagal menyelesaikan dokumen print: {}",
            last_error()
        ));
    }

    Ok(())
}

/// `WritePrinter` may accept fewer bytes than asked for, so keep writing until
/// the whole buffer is in the spool file.
unsafe fn write_all(handle: PRINTER_HANDLE, data: &[u8]) -> Result<(), String> {
    let mut offset = 0usize;
    while offset < data.len() {
        let chunk = &data[offset..];
        let mut written: u32 = 0;
        let ok = WritePrinter(
            handle,
            chunk.as_ptr() as *const std::ffi::c_void,
            chunk.len() as u32,
            &mut written,
        );

        if !ok.as_bool() {
            return Err("Gagal mengirim data ke printer".to_string());
        }
        if written == 0 {
            return Err("Printer berhenti menerima data sebelum selesai".to_string());
        }
        offset += written as usize;
    }
    Ok(())
}

/// The calling thread's last Win32 error, rendered as a readable message, for
/// the messages a user may have to relay when a print fails in the field.
fn last_error() -> windows::core::Error {
    let code = unsafe { GetLastError() };
    windows::core::Error::from_hresult(HRESULT::from_win32(code.0))
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
        let result = GetDefaultPrinterW(Some(PWSTR(buffer.as_mut_ptr())), &mut size);

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
unsafe fn pwstr_to_string(ptr: PWSTR) -> String {
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
    use crate::printing::escpos::encode_lines;
    use crate::printing::receipt::format_test_page_text;

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

    /// Physical smoke test: pushes a real test page through the whole encode →
    /// spool path. Ignored by default because it needs the hardware attached;
    /// run it with `cargo test -- --ignored` on a machine with that queue.
    #[test]
    #[ignore = "needs a physical POS58 printer attached"]
    fn sends_a_test_page_to_the_pos58_queue() {
        let bytes = encode_lines(&format_test_page_text("Toko Test", 58));
        send_raw_data("POS58 Printer", &bytes).expect("test page should reach the printer");
    }

    /// A queue that does not exist must surface an error, so a successful
    /// `send_raw_data` really means the spooler accepted the job.
    #[test]
    fn an_unknown_queue_reports_an_error() {
        let err = send_raw_data("No Such Printer XYZ", b"\x1B\x40test\n")
            .expect_err("opening a missing queue must fail");
        assert!(err.contains("Gagal membuka printer"), "unexpected: {}", err);
    }
}
