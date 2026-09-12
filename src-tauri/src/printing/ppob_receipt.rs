//! Struk for a PPOB line, shaped like the one the Mitra Indogrosir Android app
//! prints from its "Cetak Struk" screen.
//!
//! A PPOB struk is not a sales receipt with different words on it. The customer
//! keeps it as proof towards a third party — PLN, PDAM, BPJS — so what matters
//! is the provider's own wording: the meter number, the tariff, the KWH figure,
//! the call-centre line at the bottom. Most services hand that back already
//! formatted, one key per line, in `receipt_text` (some call it
//! `invoice_string`), and when they do the honest thing is to print it verbatim
//! rather than re-derive it from fields whose names change per service.
//!
//! This module therefore does three things and no more: wraps our own header
//! and totals around that block, re-wraps any provider line too long for the
//! paper, and synthesises a minimal block from the fields we did capture when
//! the provider sent no preformatted text at all.
//!
//! Pure and side-effect free: it takes a [`PpobReceiptData`] and returns lines.
//! Loading that struct out of the database is `services::receipt`'s job.

use super::receipt::{center_text, format_rupiah, two_col_text, ReceiptTextLine};

/// A field worth printing: present, and something other than whitespace.
///
/// The provider sends `""` and `"  "` for fields it did not fill in as readily
/// as it omits them, and a struk line with nothing after the colon is worse
/// than no line at all.
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|text| !text.is_empty())
}

/// Width of the key column in the fallback block. Sized to the widest key we
/// emit, `NO PELANGGAN`, so a normal-length value still fits on 32 columns —
/// the Mitra app's own 17-column keys leave too little room for ours.
const KEY_WIDTH: usize = 12;

/// Everything a PPOB struk needs. Every provider-sourced field is optional
/// because every one of them is missing for some service.
pub struct PpobReceiptData {
    pub store_name: String,
    pub store_address: Option<String>,
    pub store_phone: Option<String>,
    pub receipt_number: String,
    pub date_time: String,
    pub cashier_name: String,
    /// `pln`, `pulsa`, `data`, `pdam`, `bpjs`, `pp`, `transfer`, `emoney`.
    pub service_type: String,
    /// PLN only: `"0"` prepaid (token), `"1"` postpaid (bill).
    pub flag_id: Option<String>,
    pub product_name: Option<String>,
    pub customer_id: Option<String>,
    pub customer_name: Option<String>,
    /// Token for PLN prepaid, serial number for everything else.
    pub serial_number: Option<String>,
    pub reference_number: Option<String>,
    /// The provider's preformatted key/value block, printed verbatim.
    pub provider_receipt_text: Option<String>,
    pub amount: f64,
    pub admin_fee: f64,
    /// What the provider charged us — the figure their own struk shows.
    pub total: f64,
    /// Our own margin on this line: what the customer paid minus `total`.
    pub service_fee: f64,
    /// Free text the provider wants at the bottom (call centre, etc).
    pub footer_text: Option<String>,
}

impl PpobReceiptData {
    /// True when this is a PLN prepaid purchase, the one case that prints a
    /// token in double-size characters.
    fn is_pln_prepaid(&self) -> bool {
        self.service_type == "pln" && self.flag_id.as_deref() == Some("0")
    }

    /// The heading the provider's own struk uses for this service.
    fn title(&self) -> &'static str {
        match self.service_type.as_str() {
            "pln" if self.is_pln_prepaid() => "STRUK PEMBELIAN LISTRIK PRABAYAR",
            "pln" => "STRUK PEMBAYARAN LISTRIK PASCABAYAR",
            "pulsa" => "STRUK PEMBELIAN PULSA",
            "data" => "STRUK PEMBELIAN PAKET DATA",
            "pdam" => "STRUK PEMBAYARAN PDAM",
            "bpjs" => "STRUK PEMBAYARAN BPJS KESEHATAN",
            "pp" => "STRUK PEMBAYARAN PAYMENT POINT",
            "transfer" => "STRUK TRANSFER UANG",
            "emoney" => "STRUK TOP UP E-MONEY",
            _ => "STRUK TRANSAKSI PPOB",
        }
    }
}

/// Render a PPOB struk. `paper_width_mm` picks the column count the same way
/// [`super::receipt::format_receipt_text`] does: 32 for 58mm, 42 for 80mm.
pub fn format_ppob_receipt(data: &PpobReceiptData, paper_width_mm: u8) -> Vec<ReceiptTextLine> {
    let cpl: usize = if paper_width_mm >= 80 { 42 } else { 32 };
    let mut lines = Vec::new();

    push_header(&mut lines, data, cpl);
    push_serial_block(&mut lines, data, cpl);

    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    for wrapped in wrap_line(data.title(), cpl) {
        lines.push(ReceiptTextLine::bold(wrapped));
    }

    push_detail_block(&mut lines, data, cpl);
    push_totals(&mut lines, data, cpl);
    push_footer(&mut lines, data, cpl);

    lines
}

fn push_header(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));
    lines.push(ReceiptTextLine::bold(center_text(&data.store_name, cpl)));

    if let Some(address) = non_empty(data.store_address.as_deref()) {
        lines.push(ReceiptTextLine::plain(center_text(address, cpl)));
    }
    if let Some(phone) = non_empty(data.store_phone.as_deref()) {
        lines.push(ReceiptTextLine::plain(center_text(
            &format!("Telp: {}", phone),
            cpl,
        )));
    }

    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "No:",
        &data.receipt_number,
        cpl,
    )));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Tanggal:",
        &data.date_time,
        cpl,
    )));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Kasir:",
        &data.cashier_name,
        cpl,
    )));
}

/// The token (PLN prepaid) or the serial number (everything else).
///
/// A PLN token is the whole reason the customer keeps the paper — they type
/// twenty digits into a meter on a wall — so it prints in double-size
/// characters, grouped in fours. Every other service's serial is a reference
/// nobody retypes under pressure, so bold at normal size is enough.
fn push_serial_block(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    let Some(serial) = non_empty(data.serial_number.as_deref()) else {
        return;
    };

    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));

    if data.is_pln_prepaid() {
        lines.push(ReceiptTextLine::plain(center_text("Stroom / Token", cpl)));
        // Double-size characters are twice as wide, so they fit half the columns.
        for row in group_token(serial, cpl / 2) {
            lines.push(ReceiptTextLine::double(center_text(&row, cpl / 2)));
        }
    } else {
        lines.push(ReceiptTextLine::plain(center_text("No. Seri", cpl)));
        for row in wrap_words(serial, cpl) {
            lines.push(ReceiptTextLine::bold(center_text(&row, cpl)));
        }
    }
}

/// The provider's own block if they sent one, our reconstruction otherwise.
fn push_detail_block(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    let provider_text = non_empty(data.provider_receipt_text.as_deref());

    if let Some(text) = provider_text {
        for raw in text.lines() {
            for wrapped in wrap_line(raw.trim_end(), cpl) {
                lines.push(ReceiptTextLine::plain(wrapped));
            }
        }
        return;
    }

    for (key, value) in fallback_fields(data) {
        for wrapped in wrap_line(&format!("{:<KEY_WIDTH$}: {}", key, value), cpl) {
            lines.push(ReceiptTextLine::plain(wrapped));
        }
    }
}

/// What we can say about the transaction without the provider's help. Only
/// fields we actually have are emitted; a struk with three lines on it beats
/// one with seven, four of which read `-`.
fn fallback_fields(data: &PpobReceiptData) -> Vec<(&'static str, String)> {
    let mut fields: Vec<(&'static str, String)> = Vec::new();

    let mut push_optional = |key: &'static str, value: &Option<String>| {
        if let Some(value) = non_empty(value.as_deref()) {
            fields.push((key, value.to_string()));
        }
    };

    push_optional("PRODUK", &data.product_name);
    push_optional("NO PELANGGAN", &data.customer_id);
    push_optional("NAMA", &data.customer_name);
    push_optional("NO REF", &data.reference_number);

    fields.push(("NOMINAL", format!("Rp {}", format_rupiah(data.amount))));
    if data.admin_fee != 0.0 {
        fields.push((
            "ADMIN BANK",
            format!("Rp {}", format_rupiah(data.admin_fee)),
        ));
    }

    fields
}

fn push_totals(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Total",
        &format!("Rp {}", format_rupiah(data.total)),
        cpl,
    )));
    // Our markup on the line. It comes out negative when the sale carried a
    // cart-wide discount, because that discount is shared out over every line
    // and PPOB ones are not excluded. `Biaya Layanan  Rp -500` on a slip the
    // customer takes to PLN reads like a mistake, so a negative figure is
    // labelled as the discount it actually is.
    let (fee_label, fee_amount) = if data.service_fee < 0.0 {
        (
            "Diskon",
            format!("-Rp {}", format_rupiah(-data.service_fee)),
        )
    } else {
        (
            "Biaya Layanan",
            format!("Rp {}", format_rupiah(data.service_fee)),
        )
    };
    lines.push(ReceiptTextLine::plain(two_col_text(
        fee_label,
        &fee_amount,
        cpl,
    )));
    lines.push(ReceiptTextLine::bold(two_col_text(
        "Grand Total",
        &format!("Rp {}", format_rupiah(data.total + data.service_fee)),
        cpl,
    )));
    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));
}

fn push_footer(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    let footer = non_empty(data.footer_text.as_deref());

    let Some(footer) = footer else {
        lines.push(ReceiptTextLine::plain(center_text(
            "Simpan struk ini sebagai",
            cpl,
        )));
        lines.push(ReceiptTextLine::plain(center_text(
            "bukti pembayaran yang sah",
            cpl,
        )));
        return;
    };

    for raw in footer.lines() {
        for wrapped in wrap_line(raw.trim(), cpl) {
            lines.push(ReceiptTextLine::plain(center_text(&wrapped, cpl)));
        }
    }
}

/// Split a PLN token into groups of four digits joined by dashes, packed into
/// rows no wider than `width`.
///
/// `69915243803067642910` at width 16 becomes `6991-5243-8030-` / `6764-2910`,
/// which is what the Mitra app prints: the dash stays at the end of the row it
/// broke on, so a customer reading the rows in order never loses their place.
/// Anything that is not a plain run of digits is handed back wrapped as-is —
/// grouping a reference number would only corrupt it.
fn group_token(serial: &str, width: usize) -> Vec<String> {
    if !serial.chars().all(|c| c.is_ascii_digit()) {
        return wrap_words(serial, width);
    }

    let groups: Vec<String> = serial
        .chars()
        .collect::<Vec<_>>()
        .chunks(4)
        .map(|chunk| chunk.iter().collect())
        .collect();

    let mut rows: Vec<String> = Vec::new();
    let mut row = String::new();
    for (index, group) in groups.iter().enumerate() {
        let is_last = index + 1 == groups.len();
        // Every group but the last is followed by the dash that joins it to
        // the next one, and that dash has to fit on the same row.
        let piece = if is_last {
            group.clone()
        } else {
            format!("{}-", group)
        };
        if !row.is_empty() && row.chars().count() + piece.chars().count() > width {
            rows.push(std::mem::take(&mut row));
        }
        row.push_str(&piece);
    }
    if !row.is_empty() {
        rows.push(row);
    }
    rows
}

/// Break one line to fit `width`.
///
/// A provider line is `KEY<padding>: VALUE`, so when one is too long the key
/// side is left exactly as the provider aligned it and only the value wraps,
/// indented to the value column. Re-flowing the whole line as words would throw
/// that padding away and leave a column of keys that no longer line up.
/// Anything without a usable key column wraps on word boundaries instead.
fn wrap_line(text: &str, width: usize) -> Vec<String> {
    if width == 0 || text.chars().count() <= width {
        return vec![text.to_string()];
    }

    // Everything up to and including the colon, plus the space after it. Only
    // worth honouring if it leaves the value at least a third of the paper.
    let key_column = text.find(':').and_then(|colon| {
        let indent = text[..colon].chars().count() + 2;
        (indent * 3 < width * 2).then_some((colon, indent))
    });

    let Some((colon, indent)) = key_column else {
        return wrap_words(text, width);
    };

    let (head, value) = text.split_at(colon + 1);
    let mut rows = wrap_words(value.trim(), width - indent).into_iter();
    let first = rows.next().unwrap_or_default();

    let mut out = vec![format!("{} {}", head, first)];
    out.extend(rows.map(|row| format!("{}{}", " ".repeat(indent), row)));
    out
}

/// Greedy word wrap. A word longer than `width` is chopped — there is nothing
/// cleverer to do on 32 columns, and dropping characters would be worse.
fn wrap_words(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![text.to_string()];
    }

    let mut rows: Vec<String> = Vec::new();
    let mut row = String::new();

    for word in text.split_whitespace() {
        if !row.is_empty() && row.chars().count() + 1 + word.chars().count() > width {
            rows.push(std::mem::take(&mut row));
        } else if !row.is_empty() {
            row.push(' ');
        }
        for ch in word.chars() {
            if row.chars().count() >= width {
                rows.push(std::mem::take(&mut row));
            }
            row.push(ch);
        }
    }

    if !row.is_empty() {
        rows.push(row);
    }
    if rows.is_empty() {
        rows.push(String::new());
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::printing::receipt::LineSize;

    fn pln_prepaid() -> PpobReceiptData {
        PpobReceiptData {
            store_name: "Toko Makmur".to_string(),
            store_address: Some("Jl. Raya No. 1".to_string()),
            store_phone: Some("08123456789".to_string()),
            receipt_number: "TRX-20260912-0007".to_string(),
            date_time: "12/09/2026 14:30".to_string(),
            cashier_name: "Ahmad".to_string(),
            service_type: "pln".to_string(),
            flag_id: Some("0".to_string()),
            product_name: Some("Token PLN 50.000".to_string()),
            customer_id: Some("231001678084".to_string()),
            customer_name: Some("EDA RUSDIANI".to_string()),
            serial_number: Some("69915243803067642910".to_string()),
            reference_number: Some("22002500CLH2H88B69".to_string()),
            provider_receipt_text: Some(
                "NO METER         : 45094614059\n\
                 IDPEL            : 231001678084\n\
                 NAMA             : EDA RUSDIANI\n\
                 TARIF/DAYA       : R1M/900VA\n\
                 NO REF           : 22002500CLH2H88B69ABC\n\
                 RP BAYAR         : Rp 54.500,00\n\
                 JML KWH          : 33,7"
                    .to_string(),
            ),
            amount: 50000.0,
            admin_fee: 4500.0,
            total: 54500.0,
            service_fee: 0.0,
            footer_text: Some(
                "Informasi Hubungi Call Center 123\nAtau hubungi PLN Terdekat".to_string(),
            ),
        }
    }

    fn text_of(lines: &[ReceiptTextLine]) -> String {
        lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn every_line_fits_the_paper() {
        for data in [pln_prepaid(), pulsa()] {
            for line in format_ppob_receipt(&data, 58) {
                let limit = if line.size == LineSize::Double {
                    16
                } else {
                    32
                };
                assert!(
                    line.text.chars().count() <= limit,
                    "line over {} cols: {:?}",
                    limit,
                    line.text
                );
            }
        }
    }

    #[test]
    fn pln_prepaid_prints_the_provider_block_verbatim() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58);
        let text = text_of(&lines);

        assert!(text.contains("Toko Makmur"));
        assert!(text.contains("TRX-20260912-0007"));
        assert!(text.contains("STRUK PEMBELIAN LISTRIK PRABAYAR"));
        assert!(text.contains("NO METER         : 45094614059"));
        assert!(text.contains("TARIF/DAYA       : R1M/900VA"));
        assert!(text.contains("JML KWH          : 33,7"));
        assert!(text.contains("Informasi Hubungi Call Center"));
        // The provider block is authoritative, so nothing we could have
        // reconstructed is printed alongside it.
        assert!(!text.contains("NO PELANGGAN"));
    }

    #[test]
    fn pln_prepaid_prints_the_token_double_size_in_groups_of_four() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58);
        let token_rows: Vec<&str> = lines
            .iter()
            .filter(|line| line.size == LineSize::Double)
            .map(|line| line.text.trim())
            .collect();

        assert_eq!(token_rows, vec!["6991-5243-8030-", "6764-2910"]);
        assert!(text_of(&lines).contains("Stroom / Token"));
    }

    #[test]
    fn totals_add_our_service_fee_to_the_provider_total() {
        let mut data = pln_prepaid();
        data.service_fee = 1500.0;
        let text = text_of(&format_ppob_receipt(&data, 58));

        assert!(text.contains(&two_col_text("Total", "Rp 54.500", 32)));
        assert!(text.contains(&two_col_text("Biaya Layanan", "Rp 1.500", 32)));
        assert!(text.contains(&two_col_text("Grand Total", "Rp 56.000", 32)));
    }

    /// A cart-wide discount is shared out over every line, PPOB included, so
    /// the shop can end up having sold the line below what the provider charged.
    /// That is a discount, and the slip the customer takes to PLN has to read
    /// like one rather than like a negative fee.
    #[test]
    fn a_line_sold_below_the_provider_total_prints_a_discount_not_a_negative_fee() {
        let mut data = pln_prepaid();
        data.service_fee = -500.0;
        let text = text_of(&format_ppob_receipt(&data, 58));

        assert!(text.contains(&two_col_text("Diskon", "-Rp 500", 32)));
        assert!(!text.contains("Biaya Layanan"));
        assert!(text.contains(&two_col_text("Grand Total", "Rp 54.000", 32)));
    }

    #[test]
    fn without_provider_text_the_captured_fields_are_printed_instead() {
        let mut data = pln_prepaid();
        data.provider_receipt_text = None;
        let text = text_of(&format_ppob_receipt(&data, 58));

        assert!(text.contains("PRODUK      : Token PLN 50.000"));
        assert!(text.contains("NO PELANGGAN: 231001678084"));
        assert!(text.contains("NAMA        : EDA RUSDIANI"));
        assert!(text.contains("NOMINAL     : Rp 50.000"));
        assert!(text.contains("ADMIN BANK  : Rp 4.500"));
        // Still a PLN prepaid struk: the token block does not depend on the
        // provider's preformatted text.
        assert!(text.contains("6991-5243-8030-"));
    }

    #[test]
    fn a_long_value_wraps_under_the_value_column() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58);
        let rows: Vec<&str> = lines
            .iter()
            .map(|line| line.text.as_str())
            .skip_while(|text| !text.starts_with("NO REF"))
            .take(2)
            .collect();

        // The key column keeps the provider's own padding; the value continues
        // under itself rather than back at column zero.
        assert_eq!(rows[0], "NO REF           : 22002500CLH2H");
        assert_eq!(rows[1], "                   88B69ABC");
    }

    fn pulsa() -> PpobReceiptData {
        PpobReceiptData {
            store_name: "Toko Makmur".to_string(),
            store_address: None,
            store_phone: None,
            receipt_number: "TRX-20260912-0008".to_string(),
            date_time: "12/09/2026 14:35".to_string(),
            cashier_name: "Ahmad".to_string(),
            service_type: "pulsa".to_string(),
            flag_id: None,
            product_name: Some("Telkomsel 25.000".to_string()),
            customer_id: Some("081234567890".to_string()),
            customer_name: None,
            serial_number: Some("SN1234567890123".to_string()),
            reference_number: None,
            provider_receipt_text: None,
            amount: 25000.0,
            admin_fee: 0.0,
            total: 25500.0,
            service_fee: 1000.0,
            footer_text: None,
        }
    }

    #[test]
    fn pulsa_shows_a_bold_serial_and_its_own_title() {
        let lines = format_ppob_receipt(&pulsa(), 58);
        let text = text_of(&lines);

        assert!(text.contains("STRUK PEMBELIAN PULSA"));
        assert!(text.contains("No. Seri"));
        assert!(text.contains("NO PELANGGAN: 081234567890"));
        // No admin fee from the provider, so no empty line claiming one.
        assert!(!text.contains("ADMIN BANK"));
        assert!(text.contains("Simpan struk ini sebagai"));

        let serial = lines
            .iter()
            .find(|line| line.text.contains("SN1234567890123"))
            .expect("serial printed");
        assert!(serial.bold);
        assert_eq!(serial.size, LineSize::Normal);
    }

    #[test]
    fn eighty_millimetre_paper_uses_the_wider_column_count() {
        let lines = format_ppob_receipt(&pln_prepaid(), 80);

        assert!(lines.iter().any(|line| line.text == "=".repeat(42)));
        for line in &lines {
            let limit = if line.size == LineSize::Double {
                21
            } else {
                42
            };
            assert!(line.text.chars().count() <= limit, "{:?}", line.text);
        }
        // Wider paper fits one more group on the first row.
        let token_rows: Vec<&str> = lines
            .iter()
            .filter(|line| line.size == LineSize::Double)
            .map(|line| line.text.trim())
            .collect();
        assert_eq!(token_rows, vec!["6991-5243-8030-6764-", "2910"]);
    }

    #[test]
    fn postpaid_pln_prints_the_bill_title_and_no_token_block() {
        let mut data = pln_prepaid();
        data.flag_id = Some("1".to_string());
        data.serial_number = Some("ABC123456".to_string());
        let text = text_of(&format_ppob_receipt(&data, 58));

        // 35 characters, so it wraps on the word boundary.
        assert!(text.contains("STRUK PEMBAYARAN LISTRIK\nPASCABAYAR"));
        assert!(!text.contains("Stroom / Token"));
        assert!(text.contains("No. Seri"));
    }

    #[test]
    fn a_missing_serial_drops_the_block_rather_than_printing_an_empty_one() {
        let mut data = pulsa();
        data.serial_number = None;
        let text = text_of(&format_ppob_receipt(&data, 58));

        assert!(!text.contains("No. Seri"));
        assert!(!text.contains("Stroom / Token"));
    }

    #[test]
    fn group_token_leaves_a_non_numeric_serial_alone() {
        assert_eq!(group_token("ABC-123", 16), vec!["ABC-123"]);
        assert_eq!(group_token("12345678", 16), vec!["1234-5678"]);
    }

    #[test]
    fn wrap_line_breaks_on_words_when_there_is_no_key_column() {
        assert_eq!(
            wrap_line("Informasi Hubungi Call Center 123 Atau PLN", 32),
            vec!["Informasi Hubungi Call Center", "123 Atau PLN"]
        );
    }
}
