pub mod escpos;
pub mod layout;
pub mod ppob_receipt;
pub mod raster;
pub mod receipt;

#[cfg(target_os = "linux")]
mod bluetooth_printer;
#[cfg(target_os = "linux")]
pub mod linux_printer;
#[cfg(target_os = "linux")]
mod usb_printer;
#[cfg(windows)]
pub mod windows_printer;

/// The system's printers: spooler queues on Windows; USB (through `usblp`) and
/// paired Bluetooth printers on Linux. Both modules offer the same
/// `list_printers` and `send_raw_data`.
#[cfg(target_os = "linux")]
pub use linux_printer as system_printer;
#[cfg(windows)]
pub use windows_printer as system_printer;

/// One printer, as `services::receipt::list_printers` needs it.
#[derive(Debug)]
pub struct PrinterInfo {
    /// What the settings store and `send_raw_data` takes back.
    pub id: String,
    pub name: String,
    pub kind: PrinterKind,
    pub is_default: bool,
}

/// How a printer is reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrinterKind {
    /// A Windows spooler queue.
    #[cfg(windows)]
    Spooler,
    /// A `usblp` node.
    #[cfg(target_os = "linux")]
    Usb,
    /// A paired Bluetooth SPP device.
    #[cfg(target_os = "linux")]
    Bluetooth,
}

impl PrinterKind {
    /// The `printer_type` the API reports.
    pub fn as_str(self) -> &'static str {
        match self {
            #[cfg(windows)]
            Self::Spooler => "windows",
            #[cfg(target_os = "linux")]
            Self::Usb => "usb",
            #[cfg(target_os = "linux")]
            Self::Bluetooth => "bluetooth",
        }
    }
}

/// Shown when a printer name is not one the system lists.
pub const UNKNOWN_PRINTER: &str =
    "Printer tidak ditemukan di daftar printer komputer ini. Pilih ulang printer di Pengaturan.";

/// Only a printer the system itself lists may be saved as the till's printer.
/// A free-typed Windows queue name such as `\\host\queue` would make the till
/// connect (and authenticate) to that host.
pub fn ensure_listed_printer<'a>(
    name: &str,
    mut listed: impl Iterator<Item = &'a str>,
) -> Result<(), String> {
    if !name.is_empty() && listed.any(|known| known == name) {
        Ok(())
    } else {
        Err(UNKNOWN_PRINTER.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_listed_printer_name_is_accepted() {
        let listed = ["POS58 Printer", r"\\kasir-2\POS80"];
        assert!(ensure_listed_printer("POS58 Printer", listed.into_iter()).is_ok());
        assert!(ensure_listed_printer(r"\\kasir-2\POS80", listed.into_iter()).is_ok());
        for bad in [r"\\10.0.0.5\share", "pos58 printer", "", "POS58 Printer "] {
            assert_eq!(
                ensure_listed_printer(bad, listed.into_iter()),
                Err(UNKNOWN_PRINTER.to_string()),
                "{bad:?}"
            );
        }
    }
}
