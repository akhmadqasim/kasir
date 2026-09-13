//! Printer configuration and the receipt payload the preview renders.

use serde::{Deserialize, Serialize};

use crate::printing::receipt::{LineSize, ReceiptTextLine};

#[derive(Debug, Serialize)]
pub struct PrinterInfoItem {
    pub id: String,
    pub name: String,
    pub printer_type: String, // "windows" or "usb"
    pub is_default: bool,
}

/// Printer configuration as stored in `store_info.additional_info`.
#[derive(Debug, Deserialize)]
pub struct PrinterSettings {
    pub printer_id: Option<String>,
    pub paper_width: Option<u8>,
    pub auto_print: Option<bool>,
    pub footer_text: Option<String>,
    /// `"text"` (the default) or `"raster"`. See `printing::receipt::PrintMode`.
    pub print_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdatePrinterSettingsInput {
    pub printer_id: Option<String>,
    pub paper_width: Option<u8>,
    pub auto_print: Option<bool>,
    pub footer_text: Option<String>,
    pub print_mode: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PrinterSettingsResponse {
    pub printer_id: Option<String>,
    pub paper_width: Option<u8>,
    pub auto_print: Option<bool>,
    pub footer_text: Option<String>,
    pub print_mode: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReceiptDataResponse {
    pub store_name: String,
    pub store_address: Option<String>,
    pub store_phone: Option<String>,
    pub receipt_number: String,
    pub date_time: String,
    pub cashier_name: String,
    pub items: Vec<ReceiptItemResponse>,
    pub subtotal_amount: f64,
    pub discount_amount: f64,
    pub total_amount: f64,
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: f64,
    pub payment_breakdown: Vec<ReceiptPaymentSplitResponse>,
    pub footer_text: Option<String>,
    pub notes: Option<String>,
    pub is_deleted: bool,
    pub deleted_reason: Option<String>,
    pub deleted_by_name: Option<String>,
    pub original_total_amount: f64,
}

#[derive(Debug, Serialize)]
pub struct ReceiptItemResponse {
    pub name: String,
    pub quantity: i32,
    pub price: f64,
    pub subtotal: f64,
}

#[derive(Debug, Serialize)]
pub struct ReceiptPaymentSplitResponse {
    pub payment_method: String,
    pub bank_name: Option<String>,
    pub amount: f64,
}

/// One line of a struk as the preview draws it: the same text, weight and
/// size the printer is about to be handed.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct ReceiptLineResponse {
    pub text: String,
    pub bold: bool,
    /// `"normal"`, or `"double"` for a line set at double width and height —
    /// the PLN token, which fits half the columns of the paper.
    pub size: &'static str,
}

impl From<ReceiptTextLine> for ReceiptLineResponse {
    fn from(line: ReceiptTextLine) -> Self {
        Self {
            text: line.text,
            bold: line.bold,
            size: match line.size {
                LineSize::Normal => "normal",
                LineSize::Double => "double",
            },
        }
    }
}
