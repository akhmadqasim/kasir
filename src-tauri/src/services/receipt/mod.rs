//! Building a receipt from a transaction and getting it onto paper.
//!
//! [`sale`] is the shop's own receipt, [`ppob`] the provider's struk for a PPOB
//! line (assembled in [`ppob_data`]), [`printer`] the path both take to the
//! print queue and [`settings`] the paper and printer configuration they read.

mod ppob;
mod ppob_data;
mod printer;
mod sale;
mod settings;

pub use ppob::{ppob_history_receipt, print_ppob_history, print_ppob_item};
pub use printer::{list_printers, test_print};
pub use sale::{print, receipt_data, sale_receipt_lines};
pub use settings::{printer_settings, update_printer_settings};
