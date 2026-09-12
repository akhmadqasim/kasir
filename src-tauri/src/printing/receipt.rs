//! Receipt formatter: takes store info + transaction data and produces text lines for ESC/POS printing

/// All data needed to generate a receipt
pub struct ReceiptData {
    pub store_name: String,
    pub store_address: Option<String>,
    pub store_phone: Option<String>,
    pub receipt_number: String,
    pub date_time: String,
    pub cashier_name: String,
    pub items: Vec<ReceiptItem>,
    pub subtotal_amount: f64,
    pub discount_amount: f64,
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: f64,
    pub payment_breakdown: Vec<ReceiptPaymentSplit>,
    pub footer_text: Option<String>,
    pub is_deleted: bool,
    pub deleted_reason: Option<String>,
    pub deleted_by_name: Option<String>,
    pub original_total_amount: f64,
}

pub struct ReceiptPaymentSplit {
    pub payment_method: String,
    pub bank_name: Option<String>,
    pub amount: f64,
}

pub struct ReceiptItem {
    pub name: String,
    pub quantity: i32,
    pub price: f64,
    pub subtotal: f64,
}

/// Format currency in Indonesian style: 100.000
pub(super) fn format_rupiah(amount: f64) -> String {
    let rounded = amount.round() as i64;
    if rounded == 0 {
        return "0".to_string();
    }

    let is_negative = rounded < 0;
    let abs_val = rounded.unsigned_abs();
    let s = abs_val.to_string();
    let mut result = String::new();

    for (i, ch) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            result.push('.');
        }
        result.push(ch);
    }

    let formatted: String = result.chars().rev().collect();
    if is_negative {
        format!("-{}", formatted)
    } else {
        formatted
    }
}

/// Translate payment method to Indonesian
fn payment_method_label(method: &str) -> &str {
    match method {
        "cash" => "Tunai",
        "qris" => "QRIS",
        "debit" => "Debit",
        "ewallet" => "E-Wallet",
        "transfer" => "Transfer",
        "mixed" => "Campuran",
        _ => method,
    }
}

fn payment_method_label_with_bank(method: &str, bank_name: Option<&str>) -> String {
    let label = payment_method_label(method);
    match bank_name.map(str::trim).filter(|name| !name.is_empty()) {
        Some(bank_name) => format!("{} ({})", label, bank_name),
        None => label.to_string(),
    }
}

/// Character size for one printed line.
///
/// `Double` is ESC/POS double width *and* double height, so the line only fits
/// half the columns the paper otherwise holds — 16 on 58mm. The PLN token block
/// is the only thing that asks for it, and it is the reason a customer can read
/// the token off the paper at arm's length.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LineSize {
    #[default]
    Normal,
    Double,
}

/// A single line of receipt text for ESC/POS printing
#[derive(Debug, Clone, Default)]
pub struct ReceiptTextLine {
    pub text: String,
    pub bold: bool,
    pub size: LineSize,
}

impl ReceiptTextLine {
    /// Normal weight, normal size — the great majority of every receipt.
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::default()
        }
    }

    /// Emphasised, still normal size.
    pub fn bold(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            bold: true,
            ..Self::default()
        }
    }

    /// Double width and height. Callers must wrap the text to half the usual
    /// column count themselves; the printer will not do it for them.
    pub fn double(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            size: LineSize::Double,
            ..Self::default()
        }
    }
}

/// Printable columns for a paper width.
///
/// Font A on 58mm paper is 32 characters wide and on 80mm 42 — and this returns
/// one less on purpose. A line that fills the row exactly (32 characters then
/// a line feed) makes the POS58 (TECH CLA58) on this till reset: its USB
/// device drops out for about a second, the printer power-cycles and whatever
/// was left of the job is gone. A 148-byte job of three full-width rules
/// reproduced it while jobs with 31- and 33-character lines did not, so every
/// formatter stays one column short of the edge and `"=".repeat(cpl)` never
/// reaches it.
pub fn columns(paper_width_mm: u8) -> usize {
    if paper_width_mm >= 80 {
        41
    } else {
        31
    }
}

/// Center text within given width using space padding (monospace)
pub(super) fn center_text(text: &str, width: usize) -> String {
    let text_len = text.chars().count();
    let pad = width.saturating_sub(text_len) / 2;
    format!("{}{}", " ".repeat(pad), text)
}

/// Two-column text padded to given width (left-aligned left, right-aligned right)
pub(super) fn two_col_text(left: &str, right: &str, width: usize) -> String {
    let left_len = left.chars().count();
    let right_len = right.chars().count();
    let spaces = width.saturating_sub(left_len + right_len).max(1);
    format!("{}{}{}", left, " ".repeat(spaces), right)
}

/// The shop's own name and contact details, between two rules.
///
/// Shared with the PPOB struk, which opens exactly the same way: a customer
/// holding both pieces of paper should be in no doubt they came from the same
/// till, and one copy of this means an address line added here appears on both.
pub(super) fn push_store_banner(
    lines: &mut Vec<ReceiptTextLine>,
    store_name: &str,
    store_address: Option<&str>,
    store_phone: Option<&str>,
    cpl: usize,
) {
    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));
    lines.push(ReceiptTextLine::bold(center_text(store_name, cpl)));

    if let Some(address) = store_address.map(str::trim).filter(|a| !a.is_empty()) {
        lines.push(ReceiptTextLine::plain(center_text(address, cpl)));
    }
    if let Some(phone) = store_phone.map(str::trim).filter(|p| !p.is_empty()) {
        lines.push(ReceiptTextLine::plain(center_text(
            &format!("Telp: {}", phone),
            cpl,
        )));
    }

    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));
}

/// Which sale this is: its number, when it happened, who rang it up.
pub(super) fn push_sale_details(
    lines: &mut Vec<ReceiptTextLine>,
    receipt_number: &str,
    date_time: &str,
    cashier_name: &str,
    cpl: usize,
) {
    lines.push(ReceiptTextLine::plain(two_col_text(
        "No:",
        receipt_number,
        cpl,
    )));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Tanggal:", date_time, cpl,
    )));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Kasir:",
        cashier_name,
        cpl,
    )));
}

/// Generate receipt as text lines for ESC/POS printing
pub fn format_receipt_text(data: &ReceiptData, paper_width_mm: u8) -> Vec<ReceiptTextLine> {
    let cpl = columns(paper_width_mm);
    let mut lines = Vec::new();

    push_store_banner(
        &mut lines,
        &data.store_name,
        data.store_address.as_deref(),
        data.store_phone.as_deref(),
        cpl,
    );
    if data.is_deleted {
        lines.push(ReceiptTextLine::bold(center_text(
            "RECEIPT SALINAN (VOID)",
            cpl,
        )));
        lines.push(ReceiptTextLine::plain("=".repeat(cpl)));
    }

    push_sale_details(
        &mut lines,
        &data.receipt_number,
        &data.date_time,
        &data.cashier_name,
        cpl,
    );
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));

    // Items
    for item in &data.items {
        let price_str = format_rupiah(item.price);
        let subtotal_str = format_rupiah(item.subtotal);
        let qty_price = format!("  {} x {}", item.quantity, price_str);
        lines.push(ReceiptTextLine::plain(item.name.clone()));
        lines.push(ReceiptTextLine::plain(two_col_text(
            &qty_price,
            &subtotal_str,
            cpl,
        )));
    }

    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));

    // Totals
    if data.discount_amount > 0.0 {
        lines.push(ReceiptTextLine::plain(two_col_text(
            "Subtotal",
            &format_rupiah(data.subtotal_amount),
            cpl,
        )));
        lines.push(ReceiptTextLine::plain(two_col_text(
            "Diskon",
            &format!("-{}", format_rupiah(data.discount_amount)),
            cpl,
        )));
    }
    lines.push(ReceiptTextLine::bold(two_col_text(
        "TOTAL",
        &format_rupiah(data.original_total_amount),
        cpl,
    )));
    if data.payment_breakdown.len() > 1 {
        for split in &data.payment_breakdown {
            let method_label =
                payment_method_label_with_bank(&split.payment_method, split.bank_name.as_deref());
            lines.push(ReceiptTextLine::plain(two_col_text(
                &format!("Bayar ({})", method_label),
                &format_rupiah(split.amount),
                cpl,
            )));
        }
        if data.change_amount > 0.0 {
            lines.push(ReceiptTextLine::plain(two_col_text(
                "Dibayar",
                &format_rupiah(data.payment_amount),
                cpl,
            )));
            lines.push(ReceiptTextLine::plain(two_col_text(
                "Kembalian",
                &format_rupiah(data.change_amount),
                cpl,
            )));
        }
    } else {
        let method_label = payment_method_label_with_bank(
            &data.payment_method,
            data.payment_breakdown
                .first()
                .and_then(|split| split.bank_name.as_deref()),
        );
        lines.push(ReceiptTextLine::plain(two_col_text(
            &format!("Bayar ({})", method_label),
            &format_rupiah(data.payment_amount),
            cpl,
        )));
        if data.payment_method == "cash" && data.change_amount > 0.0 {
            lines.push(ReceiptTextLine::plain(two_col_text(
                "Kembalian",
                &format_rupiah(data.change_amount),
                cpl,
            )));
        }
    }

    if data.is_deleted {
        lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
        if let Some(ref deleted_by_name) = data.deleted_by_name {
            lines.push(ReceiptTextLine::plain(two_col_text(
                "Void By:",
                deleted_by_name,
                cpl,
            )));
        }
        if let Some(ref deleted_reason) = data.deleted_reason {
            lines.push(ReceiptTextLine::plain("Alasan Void:".to_string()));
            lines.push(ReceiptTextLine::plain(deleted_reason.clone()));
        }
    }

    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));

    // Footer
    if let Some(ref footer) = data.footer_text {
        for line in footer.lines() {
            lines.push(ReceiptTextLine::plain(center_text(line, cpl)));
        }
    } else {
        lines.push(ReceiptTextLine::plain(center_text("Terima kasih!", cpl)));
        lines.push(ReceiptTextLine::plain(center_text(
            "Barang yang sudah dibeli",
            cpl,
        )));
        lines.push(ReceiptTextLine::plain(center_text(
            "tidak dapat dikembalikan",
            cpl,
        )));
    }

    lines
}

/// Generate test page as text lines for ESC/POS printing
pub fn format_test_page_text(store_name: &str, paper_width_mm: u8) -> Vec<ReceiptTextLine> {
    let cpl = columns(paper_width_mm);
    let mut lines = Vec::new();

    lines.push(ReceiptTextLine::bold(center_text("TEST PRINT", cpl)));
    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));
    lines.push(ReceiptTextLine::plain(center_text(store_name, cpl)));
    lines.push(ReceiptTextLine::plain(center_text(
        &format!("Lebar: {}mm", paper_width_mm),
        cpl,
    )));
    lines.push(ReceiptTextLine::plain(center_text(
        &format!("{} karakter/baris", cpl),
        cpl,
    )));
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    lines.push(ReceiptTextLine::plain("Normal text".to_string()));
    lines.push(ReceiptTextLine::bold("Bold text".to_string()));
    lines.push(ReceiptTextLine::plain(two_col_text("Kiri", "Kanan", cpl)));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Item panjang sekali",
        "100.000",
        cpl,
    )));
    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));
    lines.push(ReceiptTextLine::plain(center_text("Printer OK!", cpl)));

    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_rupiah() {
        assert_eq!(format_rupiah(0.0), "0");
        assert_eq!(format_rupiah(500.0), "500");
        assert_eq!(format_rupiah(1000.0), "1.000");
        assert_eq!(format_rupiah(100000.0), "100.000");
        assert_eq!(format_rupiah(1500000.0), "1.500.000");
    }

    #[test]
    fn test_center_text() {
        let centered = center_text("Hello", 32);
        assert!(centered.starts_with("             "));
        assert!(centered.contains("Hello"));
    }

    #[test]
    fn test_two_col_text() {
        let line = two_col_text("TOTAL", "100.000", 32);
        assert_eq!(line.len(), 32);
        assert!(line.starts_with("TOTAL"));
        assert!(line.ends_with("100.000"));
    }

    #[test]
    fn test_format_receipt_text() {
        let data = ReceiptData {
            store_name: "Toko Makmur".to_string(),
            store_address: Some("Jl. Raya No. 1".to_string()),
            store_phone: Some("08123456789".to_string()),
            receipt_number: "TRX-20250118-0001".to_string(),
            date_time: "18/01/2025 14:30".to_string(),
            cashier_name: "Ahmad".to_string(),
            items: vec![
                ReceiptItem {
                    name: "Beras 5kg".to_string(),
                    quantity: 1,
                    price: 65000.0,
                    subtotal: 65000.0,
                },
                ReceiptItem {
                    name: "Minyak Goreng 1L".to_string(),
                    quantity: 2,
                    price: 18000.0,
                    subtotal: 36000.0,
                },
            ],
            subtotal_amount: 101000.0,
            discount_amount: 0.0,
            payment_method: "cash".to_string(),
            payment_amount: 110000.0,
            change_amount: 9000.0,
            payment_breakdown: vec![ReceiptPaymentSplit {
                payment_method: "cash".to_string(),
                bank_name: None,
                amount: 101000.0,
            }],
            footer_text: None,
            is_deleted: false,
            deleted_reason: None,
            deleted_by_name: None,
            original_total_amount: 101000.0,
        };

        let lines = format_receipt_text(&data, 58);
        assert!(!lines.is_empty());

        let all_text: String = lines
            .iter()
            .map(|l| l.text.clone())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(all_text.contains("Toko Makmur"));
        assert!(all_text.contains("TRX-20250118-0001"));
        assert!(all_text.contains("Beras 5kg"));
        assert!(all_text.contains("Terima kasih!"));
    }
}
