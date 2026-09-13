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

/// How a receipt reaches the paper.
///
/// `Text` sends characters for the printer's own font engine to set. It is the
/// default because it is what the Mitra Indogrosir app does — its print job,
/// captured off the phone, is plain Font A — and because it is a few kilobytes
/// where a picture is sixty. `Raster` draws the text with GDI in a bundled
/// typewriter face and sends the picture: one uniform face across the slip, at
/// the cost of speed and of being Windows-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PrintMode {
    Raster,
    #[default]
    Text,
}

impl PrintMode {
    /// What the settings JSON calls it.
    pub fn from_setting(value: Option<&str>) -> Self {
        match value {
            Some("raster") => Self::Raster,
            _ => Self::Text,
        }
    }

    pub fn as_setting(self) -> &'static str {
        match self {
            Self::Raster => "raster",
            Self::Text => "text",
        }
    }
}

/// Width of one character cell when a receipt is drawn rather than typeset.
///
/// Font A is twelve dots wide at 203 dpi and the renderer matches it, which is
/// what lets one set of column counts serve both modes.
pub const CELL_DOTS: usize = 12;

/// Printable columns for a paper width.
///
/// Font A on 58mm paper is 32 characters wide and on 80mm 42, and the same
/// counts serve a raster: the cell the renderer draws into is [`CELL_DOTS`]
/// wide, so 32 of them come to exactly the 384 dots the narrow paper is. The
/// wide paper has 576 and Font A only ever used 504 of them, so the renderer
/// centres the block and leaves the difference as a margin either side rather
/// than inventing six columns the text formatters have never had.
///
/// Every column is used. The Mitra app's own job prints `STRUK PEMBELIAN
/// LISTRIK PRABAYAR` — exactly 32 characters — as one line, and so do we.
pub fn columns(paper_width_mm: u8) -> usize {
    if paper_width_mm >= 80 {
        42
    } else {
        32
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

/// The shop's own name and contact details. Sales receipt only — a PPOB
/// struk opens with the store's name and nothing else, because it is the
/// provider's document and Mitra's own slip carries no address either.
///
/// Draws no rule of its own; the caller puts one `-` line between this and
/// whatever comes next, so the same banner works whether it is followed
/// straight by the transaction header or by a VOID heading first.
pub(super) fn push_store_banner(
    lines: &mut Vec<ReceiptTextLine>,
    store_name: &str,
    store_address: Option<&str>,
    store_phone: Option<&str>,
    cpl: usize,
) {
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
}

/// The date/time and cashier name on one line, date/time flush left and the
/// cashier's full name flush right. Names are not truncated — a long enough
/// name (a long-name test covers this) pushes the pair onto two lines instead
/// of overflowing the paper width, date/time on its own line and the cashier
/// name right-aligned below it.
fn push_transaction_meta(
    lines: &mut Vec<ReceiptTextLine>,
    date_time: &str,
    cashier_name: &str,
    cpl: usize,
) {
    // `two_col_text` pads to exactly `cpl` when the two sides fit, and only
    // overshoots once its forced single space can't make them fit — so
    // measuring its own output tells us which case this is, without
    // re-deriving the same fits-or-not rule from the two lengths by hand.
    let one_line = two_col_text(date_time, cashier_name, cpl);
    if one_line.chars().count() <= cpl {
        lines.push(ReceiptTextLine::plain(one_line));
    } else {
        lines.push(ReceiptTextLine::plain(date_time.to_string()));
        lines.push(ReceiptTextLine::plain(two_col_text("", cashier_name, cpl)));
    }
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
    }
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));

    lines.push(ReceiptTextLine::plain(data.receipt_number.clone()));
    push_transaction_meta(&mut lines, &data.date_time, &data.cashier_name, cpl);
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
                &method_label,
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
                "Kembali",
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
            &method_label,
            &format_rupiah(data.payment_amount),
            cpl,
        )));
        if data.payment_method == "cash" && data.change_amount > 0.0 {
            lines.push(ReceiptTextLine::plain(two_col_text(
                "Kembali",
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

    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));

    // Footer
    if let Some(ref footer) = data.footer_text {
        for line in footer.lines() {
            lines.push(ReceiptTextLine::plain(center_text(line, cpl)));
        }
    } else {
        lines.push(ReceiptTextLine::plain(center_text("Terima kasih!", cpl)));
    }

    lines
}

/// Generate test page as text lines for ESC/POS printing
pub fn format_test_page_text(store_name: &str, paper_width_mm: u8) -> Vec<ReceiptTextLine> {
    let cpl = columns(paper_width_mm);
    let mut lines = Vec::new();

    // The same shapes a real receipt uses, so what comes out of the printer
    // here is what a customer will get: a bold heading, plain detail lines,
    // a dashed rule and a two-column money line.
    lines.push(ReceiptTextLine::bold(center_text(store_name, cpl)));
    lines.push(ReceiptTextLine::plain(center_text(
        "Tes cetak printer",
        cpl,
    )));
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Lebar kertas",
        &format!("{}mm", paper_width_mm),
        cpl,
    )));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Karakter/baris",
        &cpl.to_string(),
        cpl,
    )));
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    lines.push(ReceiptTextLine::plain("Contoh Barang".to_string()));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "  2 x 5.000",
        "10.000",
        cpl,
    )));
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    lines.push(ReceiptTextLine::bold(two_col_text("TOTAL", "10.000", cpl)));
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
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

    fn sample_receipt_data() -> ReceiptData {
        ReceiptData {
            store_name: "Cahaya513 Mini Mart".to_string(),
            store_address: Some("Jl. Contoh No. 1 Samarinda".to_string()),
            store_phone: Some("0812-xxxx-xxxx".to_string()),
            receipt_number: "TRX-20260913-0001".to_string(),
            date_time: "13/09/2026 07:15".to_string(),
            cashier_name: "Dini Fadilah".to_string(),
            items: vec![
                ReceiptItem {
                    name: "Indomie Goreng".to_string(),
                    quantity: 3,
                    price: 3500.0,
                    subtotal: 10500.0,
                },
                ReceiptItem {
                    name: "Gula Pasir 1kg".to_string(),
                    quantity: 1,
                    price: 17000.0,
                    subtotal: 17000.0,
                },
            ],
            subtotal_amount: 27500.0,
            discount_amount: 0.0,
            payment_method: "cash".to_string(),
            payment_amount: 30000.0,
            change_amount: 2500.0,
            payment_breakdown: vec![ReceiptPaymentSplit {
                payment_method: "cash".to_string(),
                bank_name: None,
                amount: 27500.0,
            }],
            footer_text: None,
            is_deleted: false,
            deleted_reason: None,
            deleted_by_name: None,
            original_total_amount: 27500.0,
        }
    }

    /// The approved 58mm layout, reproduced line for line: banner, a `-` rule,
    /// the receipt number alone, date/time and cashier on one line, items,
    /// totals with the new payment labels, and the single-line default footer.
    #[test]
    fn test_format_receipt_text() {
        let data = sample_receipt_data();
        let cpl = columns(58);
        let dash = "-".repeat(cpl);

        let lines = format_receipt_text(&data, 58);
        let rendered: Vec<String> = lines.iter().map(|l| l.text.clone()).collect();

        assert_eq!(
            rendered,
            vec![
                center_text("Cahaya513 Mini Mart", cpl),
                center_text("Jl. Contoh No. 1 Samarinda", cpl),
                center_text("Telp: 0812-xxxx-xxxx", cpl),
                dash.clone(),
                "TRX-20260913-0001".to_string(),
                two_col_text("13/09/2026 07:15", "Dini Fadilah", cpl),
                dash.clone(),
                "Indomie Goreng".to_string(),
                two_col_text("  3 x 3.500", "10.500", cpl),
                "Gula Pasir 1kg".to_string(),
                two_col_text("  1 x 17.000", "17.000", cpl),
                dash.clone(),
                two_col_text("TOTAL", "27.500", cpl),
                two_col_text("Tunai", "30.000", cpl),
                two_col_text("Kembali", "2.500", cpl),
                dash.clone(),
                center_text("Terima kasih!", cpl),
            ]
        );

        assert!(lines[0].bold, "the store name banner is the heading");
        let total_line = lines
            .iter()
            .find(|l| l.text.trim_start().starts_with("TOTAL"))
            .expect("TOTAL line present");
        assert!(total_line.bold, "TOTAL is the other heading");
    }

    /// Every rule on a sales receipt is `-`; `=` never appears anywhere on it.
    #[test]
    fn sales_receipt_never_uses_a_double_rule() {
        let lines = format_receipt_text(&sample_receipt_data(), 58);
        assert!(
            lines.iter().all(|l| !l.text.contains('=')),
            "found a `=` rule on the sales receipt"
        );
    }

    /// Date/time and cashier name share one line when they fit.
    #[test]
    fn date_and_cashier_share_one_line_when_they_fit() {
        let lines = format_receipt_text(&sample_receipt_data(), 58);
        assert!(lines
            .iter()
            .any(|l| l.text.contains("13/09/2026 07:15") && l.text.contains("Dini Fadilah")));
    }

    /// A cashier name long enough that `date_time + " " + cashier_name`
    /// overflows the line splits onto two lines instead of running past the
    /// paper width.
    #[test]
    fn date_and_cashier_wrap_to_two_lines_for_a_long_name() {
        let mut data = sample_receipt_data();
        data.cashier_name = "Kartika Wulandari Puspitasari".to_string();

        let cpl = columns(58);
        let lines = format_receipt_text(&data, 58);
        let rendered: Vec<&str> = lines.iter().map(|l| l.text.as_str()).collect();

        let date_pos = rendered
            .iter()
            .position(|text| *text == "13/09/2026 07:15")
            .expect("date/time printed on its own line");
        assert!(
            rendered[date_pos + 1].contains("Kartika Wulandari Puspitasari"),
            "cashier name follows on the next line"
        );
        assert!(
            rendered
                .iter()
                .all(|text| text.chars().count() <= cpl || text.contains("Kartika")),
            "no unrelated line overflows the paper width"
        );
    }

    /// The new label: `Kembali`, never the old `Kembalian`, and no `Bayar
    /// (...)` wrapper around the payment method line.
    #[test]
    fn payment_lines_use_the_new_labels() {
        let lines = format_receipt_text(&sample_receipt_data(), 58);
        let all_text: String = lines
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(all_text.contains("Kembali"));
        assert!(!all_text.contains("Kembalian"));
        assert!(!all_text.contains("Bayar ("));
        assert!(all_text.contains("Tunai"));
    }

    /// The default footer (no `footer_text` configured) is exactly one
    /// centred line: "Terima kasih!" and nothing else.
    #[test]
    fn default_footer_is_a_single_line() {
        let lines = format_receipt_text(&sample_receipt_data(), 58);
        let cpl = columns(58);
        let dash = "-".repeat(cpl);

        let last_dash = lines
            .iter()
            .rposition(|l| l.text == dash)
            .expect("closing rule present");
        let footer_lines = &lines[last_dash + 1..];

        assert_eq!(footer_lines.len(), 1);
        assert_eq!(footer_lines[0].text, center_text("Terima kasih!", cpl));
    }
}
