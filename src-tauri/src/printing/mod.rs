pub mod escpos;
pub mod layout;
pub mod ppob_receipt;
#[cfg(windows)]
pub mod raster;
pub mod receipt;

#[cfg(windows)]
pub mod windows_printer;

/// Shown when a printer name is not one the spooler lists.
pub const UNKNOWN_PRINTER: &str =
    "Printer tidak ditemukan di daftar printer Windows. Pilih ulang printer di Pengaturan.";

/// Only a queue Windows itself lists may be opened. A free-typed name such as
/// `\\host\queue` would make the till connect (and authenticate) to that host.
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
