//! The printers a Linux till can reach: USB printers straight through `usblp`
//! and paired Bluetooth printers through BlueZ, in one list.

use std::sync::{Mutex, PoisonError};

use super::{bluetooth_printer, usb_printer, PrinterInfo};

/// One job at a time. On Windows the spooler queues jobs; here nothing else
/// does, and `usblp` takes one writer at a time while BlueZ hands the kept SPP
/// profile one connection at a time.
static PRINTING: Mutex<()> = Mutex::new(());

pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    let mut printers = usb_printer::list_printers();
    printers.extend(bluetooth_printer::list_printers());
    Ok(printers)
}

/// Route by the id's shape: Bluetooth ids carry their prefix, the rest are USB.
pub fn send_raw_data(printer_id: &str, data: &[u8]) -> Result<(), String> {
    // A job that panicked left nothing half-done behind the lock worth
    // refusing every later receipt over.
    let _turn = PRINTING.lock().unwrap_or_else(PoisonError::into_inner);
    if printer_id.starts_with(bluetooth_printer::ID_PREFIX) {
        bluetooth_printer::send_raw_data(printer_id, data)
    } else {
        usb_printer::send_raw_data(printer_id, data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::printing::UNKNOWN_PRINTER;

    /// A `bt:` id goes to Bluetooth, which refuses an address it cannot parse
    /// before touching BlueZ.
    #[test]
    fn a_bluetooth_id_with_a_bad_address_is_an_unknown_printer() {
        assert_eq!(
            send_raw_data("bt:not-an-address", b"x"),
            Err(UNKNOWN_PRINTER.to_string())
        );
    }

    /// Anything else is a USB id; one that matches no plugged-in printer says
    /// to plug it in rather than calling it unknown.
    #[test]
    fn any_other_id_is_looked_up_among_usb_printers() {
        let error = send_raw_data("ffff:ffff/no-such-printer", b"x").unwrap_err();
        assert!(error.contains("tidak tersambung"), "{error}");
    }
}
