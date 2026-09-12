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
//! This module therefore wraps our own header and totals around that block,
//! re-lays out any provider line too long for the paper, and synthesises a
//! minimal block from the fields we did capture when the provider sent no
//! preformatted text at all.
//!
//! It also carries a handful of judgements about what the provider *meant* —
//! that a twenty-digit run of digits is a PLN token and a reference number is
//! not, that what BPJS returns as a serial is the payer's phone, that a fused
//! `TerdekatDownload` was two words before their wrapper got to it. They live
//! here rather than in the service layer because each one is a decision about
//! what belongs on the paper, and because the fixtures that justify them are the
//! ones in this file's tests.
//!
//! Pure and side-effect free: it takes a [`PpobReceiptData`] and returns lines.
//! Loading that struct out of the database is `services::receipt`'s job.

use std::borrow::Cow;

use super::receipt::{
    center_text, format_rupiah, push_sale_details, push_store_banner, two_col_text, ReceiptTextLine,
};

/// A field worth printing: present, and something other than whitespace.
///
/// The provider sends `""` and `"  "` for fields it did not fill in as readily
/// as it omits them, and a struk line with nothing after the colon is worse
/// than no line at all.
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|text| !text.is_empty())
}

/// As [`non_empty`], plus the two placeholders Mitra uses for "no value here":
/// `-` (PDAM's idea of an absent token) and `0` (payment point's).
fn meaningful(value: Option<&str>) -> Option<&str> {
    non_empty(value).filter(|text| *text != "-" && *text != "0")
}

/// An Indonesian mobile number: `08` or `62` and ten to thirteen digits in all.
///
/// A twenty-digit PLN token cannot be mistaken for one, and neither can a pulsa
/// serial, which is longer and mixes in letters.
fn looks_like_phone_number(value: &str) -> bool {
    let digits: String = value.chars().filter(char::is_ascii_digit).collect();
    if digits.len() != value.chars().filter(|c| !c.is_whitespace()).count() {
        return false;
    }

    (10..=13).contains(&digits.len()) && (digits.starts_with("08") || digits.starts_with("62"))
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
    /// Mitra's `payment_code`, e.g. `L14337486261-1-260910124538`.
    pub payment_code: Option<String>,
    /// The provider's `description`, e.g. `Telkom Indihome - 161312001945`.
    /// The part before the dash is the biller a payment-point struk is titled
    /// after; there is no other field that names it.
    pub service_description: Option<String>,
    /// The provider's `igr_desc`, e.g. `Pre paid dengan nomor meter`.
    pub provider_description: Option<String>,
    /// The provider's preformatted key/value block, printed verbatim.
    pub provider_receipt_text: Option<String>,
    /// The bill itself, before the admin fee.
    pub amount: f64,
    pub admin_fee: f64,
    /// What the provider charged us, admin fee included — the figure their own
    /// struk and their PDF invoice both call the total.
    pub total: f64,
    /// What the customer handed us for this line. The difference from `total`
    /// is our own margin, or a discount when the sale carried one.
    pub grand_total: f64,
    /// Free text the provider wants at the bottom (call centre, etc).
    pub footer_text: Option<String>,
}

impl PpobReceiptData {
    /// True when this is a PLN prepaid purchase, the one case that prints a
    /// token in double-size characters.
    ///
    /// `flag_id` is ours, set at checkout, and answers on its own when present.
    /// The three fallbacks — the provider's `igr_desc`, its own heading, and a
    /// token that is actually there — are for a line whose flag never reached
    /// the blob.
    fn is_pln_prepaid(&self) -> bool {
        if self.service_type != "pln" {
            return false;
        }

        // `flag_id` is ours, set at checkout from what the cashier chose, and it
        // decides on its own when it is there. The rest are guesses for a line
        // whose flag never made it into the blob, and a guess must not be able
        // to overrule the fact.
        match self.flag_id.as_deref() {
            Some("0") => return true,
            Some("1") => return false,
            _ => {}
        }

        self.provider_description
            .as_deref()
            .is_some_and(|desc| desc.to_lowercase().contains("pre paid"))
            || self
                .provider_receipt_text
                .as_deref()
                .is_some_and(|text| text.contains("PRABAYAR"))
            || self.token().is_some()
    }

    /// The token, if this line has one.
    ///
    /// A PLN token is twenty digits, always, and Mitra sends it as
    /// `4617 5400 1832 5962 7611` — five groups, spaces between. When there is
    /// no token the field holds `""`, `"-"` or `"0"`, one placeholder per
    /// service. Insisting on exactly twenty digits out of digits-and-spaces is
    /// what stops a reference number like `22002500CLH2H8976AA371713A6EA533`
    /// being stripped down to its digits and printed as a token that does not
    /// exist.
    fn token(&self) -> Option<String> {
        let serial = meaningful(self.serial_number.as_deref())?;
        if !serial.chars().all(|c| c.is_ascii_digit() || c == ' ') {
            return None;
        }

        let digits: String = serial.chars().filter(char::is_ascii_digit).collect();
        (digits.len() == 20).then_some(digits)
    }

    /// The serial number, when there is one worth printing.
    ///
    /// BPJS answers with the payer's mobile number in both `serial_number` and
    /// `token_number` — `08125520208`, the number on the account — which is not
    /// a serial and is not proof of anything. Pulsa and data return a real SN,
    /// so the block is worth keeping for them.
    fn printable_serial(&self) -> Option<&str> {
        if self.service_type == "bpjs" {
            return None;
        }

        let serial = meaningful(self.serial_number.as_deref())?;
        if looks_like_phone_number(serial) {
            return None;
        }
        if meaningful(self.customer_id.as_deref()) == Some(serial) {
            return None;
        }

        Some(serial)
    }

    /// The heading, for the services whose `receipt_text` does not carry one.
    fn title(&self) -> Cow<'static, str> {
        match self.service_type.as_str() {
            "pln" if self.is_pln_prepaid() => Cow::Borrowed("STRUK PEMBELIAN LISTRIK PRABAYAR"),
            "pln" => Cow::Borrowed("STRUK PEMBAYARAN TAGIHAN LISTRIK"),
            "pulsa" => Cow::Borrowed("STRUK PEMBELIAN PULSA"),
            "data" => Cow::Borrowed("STRUK PEMBELIAN PAKET DATA"),
            "pdam" => Cow::Borrowed("STRUK PEMBAYARAN PDAM"),
            "bpjs" => Cow::Borrowed("STRUK PEMBAYARAN BPJS KESEHATAN"),
            "transfer" => Cow::Borrowed("STRUK TRANSFER UANG"),
            "emoney" => Cow::Borrowed("STRUK TOP UP E-MONEY"),
            // Payment point is a hundred billers behind one service code, so the
            // heading has to come from the transaction: `Telkom Indihome -
            // 161312001945` is titled after the half before the dash.
            _ => match self.biller() {
                Some(biller) => Cow::Owned(format!("STRUK PEMBAYARAN {}", biller)),
                None => Cow::Borrowed("STRUK PEMBAYARAN"),
            },
        }
    }

    fn biller(&self) -> Option<&str> {
        let described = meaningful(self.service_description.as_deref())
            .map(|desc| desc.split(" - ").next().unwrap_or(desc));

        described.or_else(|| meaningful(self.product_name.as_deref()))
    }
}

/// Render a PPOB struk. `paper_width_mm` picks the column count the same way
/// [`super::receipt::format_receipt_text`] does: 32 for 58mm, 42 for 80mm.
pub fn format_ppob_receipt(data: &PpobReceiptData, paper_width_mm: u8) -> Vec<ReceiptTextLine> {
    let cpl: usize = if paper_width_mm >= 80 { 42 } else { 32 };
    let mut lines = Vec::new();

    // The provider's block, folded back into whole lines, is needed twice: once
    // to print, and once to know where its labels sit so ours can line up.
    let block = non_empty(data.provider_receipt_text.as_deref()).map(unfold_provider_text);

    push_header(&mut lines, data, cpl);
    push_serial_block(&mut lines, data, cpl);
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    let layout = LabelLayout::of(block.as_deref().unwrap_or(&[]), cpl);

    push_detail_block(&mut lines, data, block.as_deref(), layout, cpl);
    if block.is_some() {
        push_reference_block(&mut lines, data, layout, cpl);
    }
    push_totals(&mut lines, data, cpl);
    push_footer(&mut lines, data, cpl);

    lines
}

/// A provider line long enough to have been wrapped starts its continuation
/// with this many spaces. The threshold is loose because the indent Mitra
/// actually emits wobbles between services.
const MIN_CONTINUATION_SPACES: usize = 10;

/// How much of a continuation line is the indent itself. Exactly 18, even where
/// the key column is 17 wide, and even where the 19th character is a space that
/// belongs to the value — `STROOM/TOKEN : 4617 5400 1832` continues with
/// `" 5962 7611"`, space and all. Stripping a fixed 18 keeps that space and
/// drops the padding.
const CONTINUATION_INDENT: usize = 18;

fn push_header(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    push_store_banner(
        lines,
        &data.store_name,
        data.store_address.as_deref(),
        data.store_phone.as_deref(),
        cpl,
    );
    push_sale_details(
        lines,
        &data.receipt_number,
        &data.date_time,
        &data.cashier_name,
        cpl,
    );
}

/// The token (PLN prepaid) or the serial number (everything else).
///
/// A PLN token is the whole reason the customer keeps the paper — they type
/// twenty digits into a meter on a wall — so it prints in double-size
/// characters, grouped in fours. Every other service's serial is a reference
/// nobody retypes under pressure, so bold at normal size is enough.
fn push_serial_block(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    if let Some(token) = data.token().filter(|_| data.is_pln_prepaid()) {
        lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
        lines.push(ReceiptTextLine::plain(center_text("Stroom / Token", cpl)));
        // Double-size characters are twice as wide, so they fit half the columns.
        for row in group_token(&token, cpl / 2) {
            lines.push(ReceiptTextLine::double(center_text(&row, cpl / 2)));
        }
        return;
    }

    let Some(serial) = data.printable_serial() else {
        return;
    };

    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    lines.push(ReceiptTextLine::plain(center_text("No. Seri", cpl)));
    for row in wrap_words(serial, cpl) {
        lines.push(ReceiptTextLine::bold(center_text(&row, cpl)));
    }
}

/// Undo the provider's own line wrapping.
///
/// Mitra wraps `receipt_text` to about 32 columns before sending it, and does it
/// by counting characters: `NAMA : ABDUL MUKTI RI` continues with `AD`, mid-word
/// and mid-name. Their width is not ours — 80mm paper has ten more columns, and
/// even on 58mm their wrap leaves `Call Center 12` / `3 Atau hubungi` — so the
/// text is folded back into whole logical lines here and re-wrapped afterwards
/// at our own width, on word boundaries.
///
/// Blank lines survive as separators but never in runs, and the leading pair
/// every PLN text starts with is dropped: on paper they are just wasted feed.
fn unfold_provider_text(text: &str) -> Vec<String> {
    let mut folded: Vec<String> = Vec::new();

    for raw in text.split('\n') {
        // `receipt_text` is CRLF-delimited.
        let line = raw.trim_end_matches('\r').trim_end();
        // Counted in characters, not bytes: the slice below has to land on a
        // character boundary, and one stray non-breaking space in the padding
        // would otherwise panic the print rather than misalign it.
        let indent = line.chars().take_while(|c| c.is_whitespace()).count();

        match folded.last_mut() {
            Some(previous) if indent >= MIN_CONTINUATION_SPACES && !previous.is_empty() => {
                if indent >= CONTINUATION_INDENT {
                    // Drop the padding, keep whatever follows it — including a
                    // 19th space, which belongs to the value.
                    previous.extend(line.chars().skip(CONTINUATION_INDENT));
                } else {
                    // Too shallow to be one of the provider's fixed-width
                    // continuations, so it is indented prose: join it as a word.
                    previous.push(' ');
                    previous.push_str(line.trim_start());
                }
            }
            _ => folded.push(line.to_string()),
        }
    }

    let mut out: Vec<String> = Vec::new();
    for line in folded {
        let line = line.trim_end().to_string();
        let blank = line.trim().is_empty();
        if blank && (out.is_empty() || out.last().is_some_and(|last| last.trim().is_empty())) {
            continue;
        }
        out.extend(
            expand_pipe_segments(&line)
                .into_iter()
                .map(|segment| unglue_prose(&segment)),
        );
    }
    while out.last().is_some_and(|last| last.trim().is_empty()) {
        out.pop();
    }

    out
}

/// Put back the space the provider lost when it wrapped its own prose.
///
/// PLN's footer arrives as `...PLN TerdekatDownload PLN Mobile`: their wrapper
/// broke the sentence across lines and dropped the space at the seam, so folding
/// the lines back leaves two words fused. A lowercase letter immediately
/// followed by a capital is that seam, and nothing else on a struk looks like
/// it — reference numbers are all caps, codes carry digits and dashes, and a
/// `LABEL : value` line is left alone entirely.
fn unglue_prose(line: &str) -> String {
    let is_code = line.contains('-') && line.chars().any(|c| c.is_ascii_digit());
    if line.contains(':') || is_code {
        return line.to_string();
    }

    line.split(' ')
        .map(|word| {
            // Only a word long enough to be two words: `TerdekatDownload` is
            // sixteen characters, while the camel-case biller names payment
            // point is full of — `MyRepublic`, `ShopeePay`, `LinkAja` — are ten
            // or fewer and must survive intact.
            if word.chars().count() <= GLUED_WORD_MIN {
                return word.to_string();
            }

            let mut out = String::with_capacity(word.len() + 1);
            let mut previous: Option<char> = None;
            for ch in word.chars() {
                if ch.is_uppercase() && previous.is_some_and(|p| p.is_lowercase()) {
                    out.push(' ');
                }
                out.push(ch);
                previous = Some(ch);
            }
            out
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Shortest word we will take for two words fused together. Above every
/// camel-case brand name Mitra's payment-point catalogue is known to carry.
const GLUED_WORD_MIN: usize = 12;

/// `MKM` and its like: the app naming itself, not something a customer reads.
fn is_channel_code(segment: &str) -> bool {
    !segment.is_empty()
        && segment.chars().count() <= 4
        && segment
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// Flatten the pipe-delimited footer PLN postpaid ends with:
/// `MKM|"Informasi Hubungi Call Center 123 ..."|Download PLN Mobile`.
///
/// The short all-caps segment is a channel code — `MKM` is the app's own name
/// for itself, not something the customer should read — and the quotes are the
/// provider's, not part of the sentence.
fn expand_pipe_segments(line: &str) -> Vec<String> {
    if !line.contains('|') {
        return vec![line.to_string()];
    }

    let mut segments: Vec<&str> = line.split('|').map(str::trim).collect();

    // Only the leading segment is ever a channel code. Dropping every short
    // all-caps segment would also eat a real value: `Golongan : D2|A1` is two
    // tariff classes, not a code and a class.
    if segments.first().is_some_and(|first| is_channel_code(first)) {
        segments.remove(0);
    }

    let joined = segments
        .into_iter()
        .map(|segment| {
            // Quotes the provider wrapped a whole segment in are its own; a
            // quote inside a value stays where it is.
            match segment.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
                Some(unquoted) => unquoted.trim(),
                None => segment,
            }
        })
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    vec![joined]
}

/// The provider's own block if they sent one, our reconstruction otherwise.
///
/// PLN's text already opens with its own heading, so ours would be the second
/// one on the paper; the other services send no heading at all and get one.
fn push_detail_block(
    lines: &mut Vec<ReceiptTextLine>,
    data: &PpobReceiptData,
    block: Option<&[String]>,
    layout: LabelLayout,
    cpl: usize,
) {
    let Some(block) = block else {
        push_title(lines, data, cpl);
        for (key, value) in fallback_fields(data) {
            for line in label_value_lines(key, &value, KEY_WIDTH, cpl) {
                lines.push(ReceiptTextLine::plain(line));
            }
        }
        // `fallback_fields` is the whole block in this case, reference and admin
        // fee included, so there is nothing left for `push_reference_block` to
        // add and no way for it to print either of them twice.
        return;
    };

    if !block.iter().any(|line| is_title_line(line)) {
        push_title(lines, data, cpl);
    }

    lines.extend(layout_block(block, layout, cpl));
}

/// A `LABEL : VALUE` line, split into its parts.
///
/// The colon has to be early enough in the line to plausibly end a label, and
/// the label itself free of the brackets that mark out a trace line — otherwise
/// `[I001IGR1-(10/09/2026 12:45:39)-CA]` reads as a label of `[I001IGR1-(10/09/2026 12`.
fn split_pair(line: &str, cpl: usize) -> Option<(&str, usize, &str)> {
    let (left, right) = line.split_once(':')?;
    let column = left.chars().count();

    let label = left.trim();
    if label.is_empty() || column > cpl.saturating_sub(10) || label.contains(['(', '[']) {
        return None;
    }

    Some((label, column, right.trim()))
}

/// Lay the provider's block out for our paper.
///
/// Mitra pads its labels to a column of its own choosing — 19 for PDAM, 18 for
/// BPJS — which on 58mm paper leaves eleven or twelve columns for the value and
/// breaks `Kota Samarinda` across two lines. Where the provider padded wider
/// than its own longest label needs, the column is pulled back in; where it did
/// not (PLN, whose 16 is one more than its longest label), the block is left
/// exactly as it came.
///
/// A value that still does not fit goes on its own indented lines rather than
/// in a narrow ravine down the right-hand side.
fn layout_block(block: &[String], layout: LabelLayout, cpl: usize) -> Vec<ReceiptTextLine> {
    let mut out = Vec::with_capacity(block.len());
    for line in block {
        // A key the provider had no value for is a colon and nothing else. On a
        // screen it is a gap; on paper it is a line of ink saying nothing.
        if is_empty_pair(line) {
            continue;
        }

        // Weight is decided by the line the provider sent, not by the rows it
        // was cut into, so a heading that has to wrap stays bold throughout.
        let emphasise = is_title_line(line);
        let rows = match (layout, split_pair(line, cpl)) {
            (LabelLayout::Repad(width), Some((label, _, value))) => {
                label_value_lines(label, value, width, cpl)
            }
            _ => wrap_line(line, cpl),
        };

        out.extend(rows.into_iter().map(|row| {
            if emphasise {
                ReceiptTextLine::bold(row)
            } else {
                ReceiptTextLine::plain(row)
            }
        }));
    }

    out
}

/// One `LABEL : VALUE` line at a chosen label width, wrapped if it has to be.
fn label_value_lines(label: &str, value: &str, width: usize, cpl: usize) -> Vec<String> {
    let head = format!("{:<width$}: ", label, width = width);

    if head.chars().count() + value.chars().count() <= cpl {
        return vec![format!("{}{}", head, value)];
    }

    // Two columns of indent under the label reads as "this belongs to the line
    // above" and still leaves the value nearly the whole paper, where wrapping
    // it under the colon would leave it a ravine ten characters wide.
    let mut out = vec![head.trim_end().to_string()];
    out.extend(
        wrap_words(value, cpl.saturating_sub(2))
            .into_iter()
            .map(|row| format!("  {}", row)),
    );
    out
}

/// Where the labels of a block sit, and whether we chose that or the provider did.
#[derive(Clone, Copy)]
enum LabelLayout {
    /// The provider's own column, left exactly as it came.
    AsSent(usize),
    /// Our column, because the provider's wasted too much of the paper.
    Repad(usize),
}

impl LabelLayout {
    fn of(block: &[String], cpl: usize) -> Self {
        let target = if cpl >= 42 { 18 } else { 14 };
        let pairs: Vec<(&str, usize, &str)> = block
            .iter()
            .filter_map(|line| split_pair(line, cpl))
            .collect();

        let Some(column) = pairs.iter().map(|(_, column, _)| *column).max() else {
            return Self::AsSent(KEY_WIDTH);
        };
        let widest = pairs
            .iter()
            .map(|(label, ..)| label.chars().count())
            .max()
            .unwrap_or(0);

        // Re-lay out only when the provider padded wider than its own longest
        // label ever needed, and wider than the column we would have chosen.
        // PLN prepaid pads to 16 for a longest label of 15 and is left exactly
        // as it came; PDAM pads to 19 for a longest of 13.
        //
        // The new column is the longest label itself, never narrower: a label
        // that did not fit would push its own colon out and take the block's
        // alignment — the very thing being fixed — with it.
        if column > widest + 1 && column > target {
            Self::Repad(widest)
        } else {
            Self::AsSent(column)
        }
    }

    /// The column our own added lines should line up with.
    fn column(self) -> usize {
        match self {
            Self::AsSent(column) | Self::Repad(column) => column,
        }
    }
}

fn is_title_line(line: &str) -> bool {
    line.trim_start().starts_with("STRUK ")
}

/// `Periode         : ` — a key, a colon, and nothing after it. A separator such
/// as `----- Peserta 1 -----` has no colon and is not one of these.
fn is_empty_pair(line: &str) -> bool {
    match line.split_once(':') {
        Some((key, value)) => !key.trim().is_empty() && value.trim().is_empty(),
        None => false,
    }
}

fn push_title(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    for wrapped in wrap_words(&data.title(), cpl) {
        lines.push(ReceiptTextLine::bold(wrapped));
    }
}

/// What the provider's own block leaves out.
///
/// PLN prints its admin fee and its reference inside `receipt_text`; PDAM, BPJS
/// and payment point print neither, and a struk with no reference on it is no
/// use at the counter when the customer comes back to query the payment.
fn push_reference_block(
    lines: &mut Vec<ReceiptTextLine>,
    data: &PpobReceiptData,
    layout: LabelLayout,
    cpl: usize,
) {
    let text = data.provider_receipt_text.as_deref().unwrap_or("");
    // Line our labels up with the block above, whether that column is the
    // provider's or the one we chose for it, so the two read as one table.
    let key_width = layout.column();
    let upper = text.to_uppercase();
    let shows_admin = upper.contains("ADMIN");
    let shows_reference = upper.contains("NO REF");

    let mut extras: Vec<(&str, String)> = Vec::new();
    if !shows_admin && data.admin_fee > 0.0 {
        extras.push(("Admin Fee", format!("Rp {}", format_rupiah(data.admin_fee))));
    }
    // Both of these hang off the same question — did the provider already give
    // the customer something to quote back? Where it did, ours would be a second
    // number under a near-identical label, and the shop can find the payment
    // from the provider's own reference anyway. PLN is the only one that does.
    if !shows_reference {
        if let Some(reference) = meaningful(data.reference_number.as_deref()) {
            extras.push(("No. Ref", reference.to_string()));
        }
        if let Some(code) = meaningful(data.payment_code.as_deref()) {
            extras.push(("Kode Bayar", code.to_string()));
        }
    }

    for (key, value) in extras {
        for line in label_value_lines(key, &value, key_width, cpl) {
            lines.push(ReceiptTextLine::plain(line));
        }
    }
}

/// What we can say about the transaction without the provider's help. Only
/// fields we actually have are emitted; a struk with three lines on it beats
/// one with seven, four of which read `-`.
fn fallback_fields(data: &PpobReceiptData) -> Vec<(&'static str, String)> {
    let mut fields: Vec<(&'static str, String)> = Vec::new();

    let mut push_optional = |key: &'static str, value: &Option<String>| {
        if let Some(value) = meaningful(value.as_deref()) {
            fields.push((key, value.to_string()));
        }
    };

    push_optional("PRODUK", &data.product_name);
    push_optional("NO PELANGGAN", &data.customer_id);
    push_optional("NAMA", &data.customer_name);
    push_optional("NO REF", &data.reference_number);
    push_optional("KODE BAYAR", &data.payment_code);

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
    //
    // Half a rupiah of slack because `grand_total` carries a prorated share of
    // the cart discount: a line sold at cost can land a billionth below it, and
    // `Diskon  -Rp 0` is not what that means.
    let service_fee = data.grand_total - data.total;
    let (fee_label, fee_amount) = if service_fee < -0.5 {
        ("Diskon", format!("-Rp {}", format_rupiah(-service_fee)))
    } else {
        (
            "Biaya Layanan",
            format!("Rp {}", format_rupiah(service_fee)),
        )
    };
    lines.push(ReceiptTextLine::plain(two_col_text(
        fee_label,
        &fee_amount,
        cpl,
    )));
    lines.push(ReceiptTextLine::bold(two_col_text(
        "Grand Total",
        &format!("Rp {}", format_rupiah(data.grand_total)),
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

    // The value column, when this is one of the provider's key/value lines.
    // `split_pair` is the one place that decides what counts as one.
    let Some((_, column, _)) = split_pair(text, width) else {
        return wrap_words(text, width);
    };

    let indent = column + 2;
    let colon = text.find(':').expect("split_pair found one");
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

    /// The provider texts below are anonymised copies of real Mitra responses:
    /// the customer names, meter numbers, IDs and tokens are made up, while the
    /// shape — CRLF line endings, the leading blank lines, the 18-space
    /// continuation indent, the mid-word wrap, the pipe-delimited footer — is
    /// reproduced exactly as the provider sent it.
    const PLN_PREPAID_TEXT: &str = "\r\n\r\nSTRUK PEMBELIAN LISTRIK PRABAYAR\r\n\r\nNO METER        : 14300000001\r\nIDPEL           : 231000000001\r\nNAMA            : BUDI SANTOSA W\r\n                  IJAYA\r\nTARIF/DAYA      : R1/000001300VA\r\nNO REF          : 11002500AAA1A1\r\n                  111AA111AA1111\r\n                  AA11\r\nRP BAYAR        : Rp 23.500,00\r\nMETERAI         : Rp 0,00\r\nPPN             : Rp 0,00\r\nPBJT-TL         : Rp 1.819,00\r\nANGSURAN        : Rp 0,00\r\nRP STROOM/TOKEN : Rp 18.181,00\r\nJML KWH         : 12,6\r\nSTROOM/TOKEN    : 1111 2222 3333\r\n                   4444 5555\r\nADMIN BANK      : Rp 3.500\r\n\r\nInformasi Hubungi Call Center 12\r\n                  3 Atau hubungi PLN TerdekatDownl\r\n                  oad PLN Mobile\r\n\r\n[I001IGR1-(10/09/2026 12:45:39)-\r\n                  CA]";

    const PLN_POSTPAID_TEXT: &str = "\r\n\r\nSTRUK PEMBAYARAN TAGIHAN LISTRIK\r\n\r\nIDPEL          : 231000000002\r\nNAMA           : PT.CONTOH SEJA H\r\n                  TERA\r\nTARIF/DAYA     : R1/000000450VA\r\nSTAND METER    : 11701-11847\r\nBL/TH          : SEP26\r\nRP TAG PLN     : Rp 69.729,00\r\nNO REF         : 11002500AAA1A11\r\n                  11AA111111A1AA1\r\n                  11\r\n\r\nADMIN BANK     : Rp 3.500,00\r\nTOTAL BAYAR    : Rp 73.229,00\r\n\r\nMKM|\"Informasi Hubungi Call Center 123 Atau Hub PLN Terdekat :\"|Download PLN Mobile\r\n[I001IGR1-(11/09/2026 10:11:51)-\r\n                  CA]";

    const PDAM_TEXT: &str = "Nama PDAM          : Kota Samarinda\r\nNo. Pelanggan      : 1100001\r\nNama               : Siti Aminah\r\nAlamat             : JL MELATI PRM CONTOH D\r\nGolongan           : D2\r\nNo. Sambungan      : 1100001\r\n\r\nPeriode - 202608\r\nMeter Lalu         : 9\r\nMeter Kini         : 22\r\nPemakaian          : 13 M3\r\nTotal              : 69,163\r\n\r\nTotal Tagihan      : 69,163";

    const BPJS_TEXT: &str = "Nomor VA          : 8888800000000001\r\nPeriode           : 1 BULAN\r\nNomor Telepon     : 00\r\nJumlah Peserta    : 1\r\n\r\n----- Peserta 1 -----\r\nNomor Peserta     : 8888800000000001\r\nNama Peserta      : AHMAD FAUZI NUGROHO\r\nKode Cabang       : 1601\r\nNama Cabang       : SAMARINDA\r\nSaldo             : 150,000\r\nPremi             : 150,000\r\n\r\nTotal Saldo       : 150,000\r\nTotal Premi       : 150,000\r\nTotal Tagihan     : 150,000\r\n";

    const PAYMENT_POINT_TEXT: &str = "Merchant/Biller: Indihome\r\nNo.Pelanggan   : 161300000001\r\nNama Pelanggan : RIZKY PRATAMA\r\n--Detail Tagihan 1--\r\nPeriode 09-2026\r\nNilai   316350\r\n";

    fn base() -> PpobReceiptData {
        PpobReceiptData {
            store_name: "Cahaya513 Mini Mart".to_string(),
            store_address: Some("Jl. Raya No. 1".to_string()),
            store_phone: Some("08123456789".to_string()),
            receipt_number: "TRX-20260912-0007".to_string(),
            date_time: "12/09/2026 14:30".to_string(),
            cashier_name: "Ahmad".to_string(),
            service_type: "pln".to_string(),
            flag_id: None,
            product_name: None,
            customer_id: None,
            customer_name: None,
            serial_number: None,
            reference_number: None,
            payment_code: None,
            service_description: None,
            provider_description: None,
            provider_receipt_text: None,
            amount: 0.0,
            admin_fee: 0.0,
            total: 0.0,
            grand_total: 0.0,
            footer_text: None,
        }
    }

    fn pln_prepaid() -> PpobReceiptData {
        PpobReceiptData {
            flag_id: Some("0".to_string()),
            product_name: Some("Token PLN 20.000".to_string()),
            customer_id: Some("14300000001".to_string()),
            serial_number: Some("1111 2222 3333 4444 5555".to_string()),
            reference_number: Some("13514299".to_string()),
            payment_code: Some("L14300000001-1-260910124538".to_string()),
            service_description: Some("PLN - 14300000001".to_string()),
            provider_description: Some("Pre paid dengan nomor meter".to_string()),
            provider_receipt_text: Some(PLN_PREPAID_TEXT.to_string()),
            amount: 20000.0,
            admin_fee: 3500.0,
            total: 23500.0,
            grand_total: 25000.0,
            ..base()
        }
    }

    fn pln_postpaid() -> PpobReceiptData {
        PpobReceiptData {
            flag_id: Some("1".to_string()),
            customer_id: Some("231000000002".to_string()),
            serial_number: Some(String::new()),
            reference_number: Some("13516345".to_string()),
            payment_code: Some("L231000000002-2-260911101150".to_string()),
            service_description: Some("PLN - 231000000002".to_string()),
            provider_description: Some("Post paid".to_string()),
            provider_receipt_text: Some(PLN_POSTPAID_TEXT.to_string()),
            amount: 69729.0,
            admin_fee: 3500.0,
            total: 73229.0,
            grand_total: 75000.0,
            ..base()
        }
    }

    fn pdam() -> PpobReceiptData {
        PpobReceiptData {
            service_type: "pdam".to_string(),
            customer_id: Some("1100001".to_string()),
            serial_number: Some("-".to_string()),
            reference_number: Some("1212031".to_string()),
            payment_code: Some("A1100001-80-260911101312".to_string()),
            service_description: Some("PDAM - 1100001".to_string()),
            provider_receipt_text: Some(PDAM_TEXT.to_string()),
            amount: 69163.0,
            admin_fee: 2500.0,
            total: 71663.0,
            grand_total: 73000.0,
            ..base()
        }
    }

    fn bpjs() -> PpobReceiptData {
        PpobReceiptData {
            service_type: "bpjs".to_string(),
            customer_id: Some("01100000001".to_string()),
            serial_number: Some("08120000001".to_string()),
            reference_number: Some("E86846143A9C74D4".to_string()),
            payment_code: Some("B01100000001-1-260911083601".to_string()),
            service_description: Some("BPJSKES - 01100000001".to_string()),
            provider_description: Some("BPJSKES".to_string()),
            provider_receipt_text: Some(BPJS_TEXT.to_string()),
            amount: 150000.0,
            admin_fee: 2500.0,
            total: 152500.0,
            grand_total: 154000.0,
            ..base()
        }
    }

    fn payment_point() -> PpobReceiptData {
        PpobReceiptData {
            service_type: "pp".to_string(),
            customer_id: Some("161300000001".to_string()),
            serial_number: Some("0".to_string()),
            reference_number: Some("4323384".to_string()),
            payment_code: Some("PP161300000001-354-260911094954".to_string()),
            service_description: Some("Telkom Indihome - 161300000001".to_string()),
            provider_receipt_text: Some(PAYMENT_POINT_TEXT.to_string()),
            amount: 316350.0,
            admin_fee: 3000.0,
            total: 319350.0,
            grand_total: 321000.0,
            ..base()
        }
    }

    pub(super) fn text_of(lines: &[ReceiptTextLine]) -> String {
        lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn all_fixtures() -> Vec<PpobReceiptData> {
        vec![
            pln_prepaid(),
            pln_postpaid(),
            pdam(),
            bpjs(),
            payment_point(),
        ]
    }

    #[test]
    fn every_line_of_every_service_fits_the_paper() {
        for data in all_fixtures() {
            for paper in [58_u8, 80] {
                let cpl = if paper >= 80 { 42 } else { 32 };
                for line in format_ppob_receipt(&data, paper) {
                    let limit = if line.size == LineSize::Double {
                        cpl / 2
                    } else {
                        cpl
                    };
                    assert!(
                        line.text.chars().count() <= limit,
                        "{} at {}mm over {} cols: {:?}",
                        data.service_type,
                        paper,
                        limit,
                        line.text
                    );
                }
            }
        }
    }

    /// The provider wraps by counting characters, so it breaks names and
    /// reference numbers mid-word. Folding those continuations back is what lets
    /// us re-wrap on word boundaries — and what stops `BUDI SANTOSA W` / `IJAYA`
    /// reaching the paper as two lines with a hole in the name.
    #[test]
    fn provider_continuations_are_folded_back_before_rewrapping() {
        let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58));

        assert!(text.contains("NAMA            : BUDI SANTOSA"));
        assert!(text.contains("WIJAYA"));

        // The reference arrives as three provider lines and is one value again
        // before anything is wrapped; at 32 columns it then has to break, but on
        // our terms rather than theirs.
        let folded = unfold_provider_text(PLN_PREPAID_TEXT);
        assert!(folded
            .iter()
            .any(|line| line.contains("11002500AAA1A1111AA111AA1111AA11")));
    }

    /// Mitra's own text opens with `STRUK PEMBELIAN LISTRIK PRABAYAR`. Printing
    /// ours as well would put two headings on one slip.
    #[test]
    fn a_provider_title_is_not_doubled_up_and_prints_bold() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58);
        let text = text_of(&lines);

        assert_eq!(text.matches("STRUK PEMBELIAN LISTRIK PRABAYAR").count(), 1);
        let title = lines
            .iter()
            .find(|line| line.text.contains("STRUK PEMBELIAN"))
            .expect("title printed");
        assert!(title.bold);
    }

    /// PDAM, BPJS and payment point send no heading at all.
    #[test]
    fn services_without_a_provider_title_get_ours() {
        assert!(text_of(&format_ppob_receipt(&pdam(), 58)).contains("STRUK PEMBAYARAN PDAM"));
        assert!(
            text_of(&format_ppob_receipt(&bpjs(), 58)).contains("STRUK PEMBAYARAN BPJS KESEHATAN")
        );
        // A hundred billers hide behind one payment-point code, so the heading
        // is taken from the transaction's own description.
        assert!(text_of(&format_ppob_receipt(&payment_point(), 58))
            .contains("STRUK PEMBAYARAN Telkom Indihome"));
    }

    #[test]
    fn a_payment_point_with_no_description_falls_back_to_a_bare_heading() {
        let mut data = payment_point();
        data.service_description = None;
        data.product_name = None;
        let text = text_of(&format_ppob_receipt(&data, 58));

        assert!(text.contains("STRUK PEMBAYARAN\n"));
    }

    /// The provider's leading blank lines, and its double blank before the
    /// footer, are feed nobody paid for.
    #[test]
    fn leading_and_repeated_blank_lines_are_dropped() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58);
        let body: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();

        let title = body
            .iter()
            .position(|line| line.contains("STRUK PEMBELIAN"))
            .expect("title printed");
        assert!(!body[title - 1].trim().is_empty(), "blank above the title");
        assert!(!body
            .windows(2)
            .any(|pair| pair[0].trim().is_empty() && pair[1].trim().is_empty()));
    }

    #[test]
    fn the_token_is_normalised_from_space_groups_and_printed_double_size() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58);
        let token_rows: Vec<&str> = lines
            .iter()
            .filter(|line| line.size == LineSize::Double)
            .map(|line| line.text.trim())
            .collect();

        assert_eq!(token_rows, vec!["1111-2222-3333-", "4444-5555"]);
        assert!(text_of(&lines).contains("Stroom / Token"));
    }

    /// Postpaid PLN sends `""`, PDAM `"-"` and payment point `"0"`. All three
    /// mean the same thing and none of them belongs on paper.
    #[test]
    fn the_placeholders_mitra_uses_for_no_token_print_nothing() {
        for data in [pln_postpaid(), pdam(), payment_point()] {
            let text = text_of(&format_ppob_receipt(&data, 58));
            assert!(!text.contains("Stroom / Token"), "{}", data.service_type);
            assert!(!text.contains("No. Seri"), "{}", data.service_type);
        }
    }

    /// Pulsa returns a serial that really is one, so it prints — bold, at normal
    /// size, since nobody retypes it into a meter on a wall.
    #[test]
    fn a_real_serial_prints_bold_at_normal_size() {
        let lines = format_ppob_receipt(&pulsa(), 58);
        let serial = lines
            .iter()
            .find(|line| line.text.contains("SN0001234567890123"))
            .expect("serial printed");

        assert!(serial.bold);
        assert_eq!(serial.size, LineSize::Normal);
        assert!(text_of(&lines).contains("No. Seri"));
    }

    /// What BPJS returns as a serial is the payer's mobile number — it matches
    /// the phone on the account — and printing it under `No. Seri` tells the
    /// customer their own number back while implying it proves something.
    #[test]
    fn a_phone_number_dressed_as_a_serial_is_not_printed() {
        let text = text_of(&format_ppob_receipt(&bpjs(), 58));
        assert!(!text.contains("No. Seri"));
        assert!(!text.contains("08120000001"));

        // Not just BPJS: any service answering with a mobile number.
        let mut phoned = pulsa();
        phoned.serial_number = Some("081200000001".to_string());
        assert!(!text_of(&format_ppob_receipt(&phoned, 58)).contains("No. Seri"));

        // And not a serial that merely happens to be numeric.
        let mut numeric = pulsa();
        numeric.serial_number = Some("770012345678901".to_string());
        assert!(text_of(&format_ppob_receipt(&numeric, 58)).contains("No. Seri"));
    }

    fn pulsa() -> PpobReceiptData {
        PpobReceiptData {
            service_type: "pulsa".to_string(),
            product_name: Some("Telkomsel 25.000".to_string()),
            customer_id: Some("081200000002".to_string()),
            serial_number: Some("SN0001234567890123".to_string()),
            reference_number: Some("4323384".to_string()),
            payment_code: Some("TS25-1-260911094954".to_string()),
            service_description: Some("PULSA - 081200000002".to_string()),
            amount: 25000.0,
            admin_fee: 0.0,
            total: 25000.0,
            grand_total: 27000.0,
            ..base()
        }
    }

    /// PLN's postpaid footer arrives as `MKM|"..."|Download PLN Mobile`. The
    /// channel code is the app talking to itself.
    #[test]
    fn the_pipe_delimited_footer_is_flattened_into_a_sentence() {
        let text = text_of(&format_ppob_receipt(&pln_postpaid(), 58));

        assert!(!text.contains("MKM"));
        assert!(!text.contains('|'));
        assert!(!text.contains('"'));
        assert!(text.contains("Informasi Hubungi Call Center"));
        assert!(text.contains("Download PLN Mobile"));
    }

    /// PLN prints its own admin fee and reference; the others print neither, and
    /// a struk with no reference is no use when the customer comes back to ask
    /// about the payment.
    #[test]
    fn only_the_services_that_omit_them_get_our_reference_lines() {
        // PLN prints its own admin fee and its own reference, so ours would be
        // a second line saying the same thing — or worse, a different number
        // under the same word. The payment code no service prints, and it is
        // the one the shop quotes back to Mitra.
        let pln = text_of(&format_ppob_receipt(&pln_prepaid(), 58));
        assert!(!pln.contains("Admin Fee"));
        assert!(!pln.contains("No. Ref          :"));
        assert!(!pln.contains("Kode Bayar"));

        // Our labels line up with the block above them, at the column the block
        // was laid out to — 13 for PDAM, pulled in from the provider's 19.
        let water = text_of(&format_ppob_receipt(&pdam(), 58));
        assert!(water.contains("Admin Fee    : Rp 2.500"));
        assert!(water.contains("No. Ref      : 1212031"));
        assert!(water.contains(
            "Kode Bayar   :
  A1100001-80-260911101312"
        ));
    }

    /// `amount` from the provider already includes the admin fee — 23.500 is
    /// 20.000 of electricity plus a 3.500 bank charge — so the struk's Total is
    /// that figure, not that figure plus the fee a second time.
    #[test]
    fn the_totals_block_matches_what_the_provider_billed() {
        let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58));

        assert!(text.contains(&two_col_text("Total", "Rp 23.500", 32)));
        assert!(text.contains(&two_col_text("Biaya Layanan", "Rp 1.500", 32)));
        assert!(text.contains(&two_col_text("Grand Total", "Rp 25.000", 32)));
    }

    /// A cart-wide discount is shared out over every line, PPOB included, so the
    /// shop can end up having sold the line below what the provider charged.
    /// That is a discount, and the slip has to read like one.
    #[test]
    fn a_line_sold_below_the_provider_total_prints_a_discount_not_a_negative_fee() {
        let mut data = pln_prepaid();
        data.grand_total = 23_000.0;
        let text = text_of(&format_ppob_receipt(&data, 58));

        assert!(text.contains(&two_col_text("Diskon", "-Rp 500", 32)));
        assert!(!text.contains("Biaya Layanan"));
        assert!(text.contains(&two_col_text("Grand Total", "Rp 23.000", 32)));
    }

    /// Numbers inside the provider's block are theirs: they mix `69,163` and
    /// `Rp 69.729,00` between services and we are not the ones to correct it.
    #[test]
    fn provider_numbers_are_printed_exactly_as_sent() {
        assert!(text_of(&format_ppob_receipt(&pdam(), 58)).contains("Total Tagihan: 69,163"));
        assert!(text_of(&format_ppob_receipt(&pln_postpaid(), 58))
            .contains("RP TAG PLN : Rp 69.729,00"));
    }

    /// PDAM pads its labels to nineteen columns for a longest label of thirteen,
    /// which on 58mm paper leaves eleven for the value and splits `Kota
    /// Samarinda` in half. Pulling the column in fixes most lines outright.
    #[test]
    fn a_provider_column_wider_than_its_labels_need_is_pulled_in() {
        let text = text_of(&format_ppob_receipt(&pdam(), 58));

        assert!(text.contains("Nama PDAM    : Kota Samarinda"));
        assert!(text.contains("No. Pelanggan: 1100001"));
        assert!(text.contains("Total Tagihan: 69,163"));
    }

    /// A value that still does not fit goes on its own lines, indented two, not
    /// into a ravine down the right-hand edge of the paper.
    #[test]
    fn a_value_too_long_even_then_moves_to_its_own_lines() {
        let lines = format_ppob_receipt(&pdam(), 58);
        let rows: Vec<&str> = lines
            .iter()
            .map(|line| line.text.as_str())
            .skip_while(|text| !text.starts_with("Alamat"))
            .take(2)
            .collect();

        assert_eq!(rows[0], "Alamat       :");
        assert_eq!(rows[1], "  JL MELATI PRM CONTOH D");
    }

    /// PLN pads to sixteen for a longest label of fifteen — nothing to reclaim —
    /// so its block has to come out exactly as the provider sent it, values
    /// wrapping under the colon as before.
    #[test]
    fn a_provider_column_that_fits_its_labels_is_left_alone() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58);
        let rows: Vec<&str> = lines
            .iter()
            .map(|line| line.text.as_str())
            .skip_while(|text| !text.starts_with("NO METER"))
            .take(4)
            .collect();

        assert_eq!(rows[0], "NO METER        : 14300000001");
        assert_eq!(rows[1], "IDPEL           : 231000000001");
        assert_eq!(rows[2], "NAMA            : BUDI SANTOSA");
        assert_eq!(rows[3], "                  WIJAYA");
    }

    #[test]
    fn the_header_carries_the_shop_and_the_sale() {
        let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58));

        assert!(text.contains("Cahaya513 Mini Mart"));
        assert!(text.contains("Jl. Raya No. 1"));
        assert!(text.contains("Telp: 08123456789"));
        assert!(text.contains("TRX-20260912-0007"));
        assert!(text.contains("12/09/2026 14:30"));
        assert!(text.contains("Ahmad"));
    }

    /// An item stored before migration 023 has no provider text at all.
    #[test]
    fn without_provider_text_the_captured_fields_are_printed_instead() {
        let mut data = pln_prepaid();
        data.provider_receipt_text = None;
        data.customer_name = Some("BUDI SANTOSA".to_string());
        let text = text_of(&format_ppob_receipt(&data, 58));

        assert!(text.contains("STRUK PEMBELIAN LISTRIK PRABAYAR"));
        assert!(text.contains("PRODUK      : Token PLN 20.000"));
        assert!(text.contains("NO PELANGGAN: 14300000001"));
        assert!(text.contains("NAMA        : BUDI SANTOSA"));
        assert!(text.contains("NOMINAL     : Rp 20.000"));
        assert!(text.contains("ADMIN BANK  : Rp 3.500"));
        assert!(text.contains(
            "KODE BAYAR  :
  L14300000001-1-260910124538"
        ));
        // The token block does not depend on the provider's text.
        assert!(text.contains("1111-2222-3333-"));

        // This block *is* the reference block here, so nothing may supplement
        // it: a struk carrying both `NO REF` and `No. Ref` with the same number
        // under two spellings is the sort of thing a customer queries.
        assert_eq!(text.matches("NO REF").count(), 1);
        assert_eq!(text.matches("ADMIN BANK").count(), 1);
        assert!(!text.contains("Admin Fee"));
        assert!(!text.contains("No. Ref"));
        assert!(!text.contains("Kode Bayar"));
    }

    #[test]
    fn eighty_millimetre_paper_uses_the_wider_column_count() {
        let lines = format_ppob_receipt(&pln_prepaid(), 80);

        assert!(lines.iter().any(|line| line.text == "=".repeat(42)));
        let token_rows: Vec<&str> = lines
            .iter()
            .filter(|line| line.size == LineSize::Double)
            .map(|line| line.text.trim())
            .collect();
        assert_eq!(token_rows, vec!["1111-2222-3333-4444-", "5555"]);
        // Wider paper re-wraps the provider's 32-column text to 42.
        assert!(text_of(&lines).contains("NAMA            : BUDI SANTOSA WIJAYA"));
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

    /// The provider's wrapper drops the space where it cut, so folding the lines
    /// back leaves two words fused. Putting it back must not reach the camel-case
    /// brand names payment point is full of.
    #[test]
    fn a_word_fused_by_the_providers_wrapper_is_split_but_a_brand_name_is_not() {
        assert_eq!(
            unglue_prose("Atau hubungi PLN TerdekatDownload PLN Mobile"),
            "Atau hubungi PLN Terdekat Download PLN Mobile"
        );

        for brand in ["MyRepublic", "ShopeePay", "LinkAja", "GoPay", "Indihome"] {
            let line = format!("Merchant {}", brand);
            assert_eq!(unglue_prose(&line), line, "{} was split", brand);
        }

        // Key/value lines and codes are left alone whatever they contain.
        assert_eq!(
            unglue_prose("NAMA : BudiSantosaWijaya"),
            "NAMA : BudiSantosaWijaya"
        );
        assert_eq!(
            unglue_prose("[I001IGR1-(10/09/2026 12:45:39)-CA]"),
            "[I001IGR1-(10/09/2026 12:45:39)-CA]"
        );
    }

    #[test]
    fn unfolding_an_empty_or_blank_text_yields_nothing() {
        assert!(unfold_provider_text("").is_empty());
        assert!(unfold_provider_text("\r\n\r\n   \r\n").is_empty());
    }
}

/// Rendering captured transactions to disk, so a human can print them and
/// compare against the Mitra app's own output. Nothing here asserts anything;
/// it is a tool that happens to be spelled as a test.
#[cfg(test)]
mod sample_output {
    use super::tests::text_of;
    use super::*;

    /// Render three real captured transactions to disk, for a human to send to
    /// a printer and compare against the Mitra app's own output.
    ///
    /// Ignored, and deliberately not a test of anything: it reads fixtures that
    /// only exist on the machine they were captured on and writes files nobody
    /// asserts against. Run it with
    /// `cargo test --lib writes_sample_struks_for_the_printer -- --ignored`.
    /// The captured responses carry real customer names and meter numbers, which
    /// is why they live in the temp directory and never in this repository.
    #[test]
    #[ignore = "writes sample files from locally captured Mitra fixtures"]
    fn writes_sample_struks_for_the_printer() {
        use crate::printing::escpos::encode_lines;

        let root = std::env::temp_dir().join("ppob");
        let out = root.join("out");
        std::fs::create_dir_all(&out).expect("create output directory");

        for name in ["pln-111194906366", "pdam-111194917241", "bpjs-111194915846"] {
            let path = root.join("receipts").join(format!("{name}.json"));
            let json = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
            let fixture: serde_json::Value =
                serde_json::from_str(&json).expect("fixture is valid JSON");

            let data = from_history_fixture(&fixture);
            let lines = format_ppob_receipt(&data, 58);

            std::fs::write(out.join(format!("{name}.bin")), encode_lines(&lines))
                .expect("write bytes");
            std::fs::write(out.join(format!("{name}.txt")), text_of(&lines))
                .expect("write preview");
        }

        println!("wrote samples to {}", out.display());
    }

    /// Map one captured `HistoryPaymentItem` onto the struk. Test-only glue: the
    /// history endpoint answers in camelCase while the payment endpoints the
    /// service layer reads answer in snake_case.
    fn from_history_fixture(fixture: &serde_json::Value) -> PpobReceiptData {
        let text = |key: &str| {
            fixture
                .get(key)
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        };
        let number = |key: &str| {
            fixture
                .get(key)
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0)
        };

        let service_type = match text("serviceType").unwrap_or_default().as_str() {
            "PLN" => "pln",
            "PDAM" => "pdam",
            "BPJS" => "bpjs",
            _ => "pp",
        };
        // What the provider billed. The samples are printed at cost, so the
        // service fee prints as zero rather than inventing a markup.
        let total = number("amount");

        PpobReceiptData {
            store_name: "Cahaya513 Mini Mart".to_string(),
            store_address: None,
            store_phone: None,
            receipt_number: format!("TRX-{}", text("trxId").unwrap_or_default()),
            date_time: text("createdAt").unwrap_or_default(),
            cashier_name: "Kasir".to_string(),
            service_type: service_type.to_string(),
            flag_id: None,
            product_name: text("productName"),
            customer_id: text("customerNo"),
            customer_name: None,
            serial_number: text("tokenNumber").or_else(|| text("serialNumber")),
            reference_number: text("noRef"),
            payment_code: text("paymentCode"),
            service_description: text("description"),
            provider_description: text("igrDesc"),
            provider_receipt_text: text("receiptText"),
            amount: number("basePrice"),
            admin_fee: number("adminFee"),
            total,
            grand_total: total,
            footer_text: None,
        }
    }
}
