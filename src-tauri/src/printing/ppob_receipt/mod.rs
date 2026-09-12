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
//! The layout is the Mitra app's, byte for byte where it can be. Its print job
//! was captured off the phone — the till's Bluetooth posing as the printer —
//! and it is plain ESC/POS text in the printer's own font: the outlet's name
//! centred, a blank, `Stroom/Token` centred, a blank, the token in double-size
//! characters, a blank, then the provider's slip as sent with the token lines
//! taken out of it, a rule of dashes, three total lines with the label padded
//! to eighteen columns, a blank, and the provider's closing prose. Nothing of
//! ours goes on it beyond the store name and the totals: no receipt number, no
//! cashier, no heading we wrote.
//!
//! The judgements this module does make are about what the provider *meant* —
//! that a twenty-digit run of digits is a PLN token and a reference number is
//! not, that a table ends at its last labelled line only when the provider
//! left a blank line under it. They live here rather than in the service layer
//! because each one is a decision about what belongs on the paper, and because
//! the fixtures that justify them are the ones in this file's tests.
//!
//! Pure and side-effect free: it takes a [`PpobReceiptData`] and returns lines.
//! Loading that struct out of the database is `services::receipt`'s job.

use super::receipt::{center_text, columns, format_rupiah, ReceiptTextLine};

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

/// Width of the key column in the fallback block. Sized to the widest key we
/// emit, `NO PELANGGAN`, so a normal-length value still fits on 32 columns —
/// the Mitra app's own 17-column keys leave too little room for ours.
const KEY_WIDTH: usize = 12;

/// The label column of the three total lines. The Mitra print pads `Total`,
/// `Biaya Layanan` and `Grand Total` to eighteen characters and writes the
/// figure straight after, left-aligned — not out at the right edge.
const TOTAL_LABEL_WIDTH: usize = 18;

/// A provider line long enough to have been wrapped starts its continuation
/// with this many spaces. The threshold is loose because the indent Mitra
/// actually emits wobbles between services.
const MIN_CONTINUATION_SPACES: usize = 10;

/// Everything a PPOB struk needs. Every provider-sourced field is optional
/// because every one of them is missing for some service.
pub struct PpobReceiptData {
    /// The only thing on the struk that says where it was printed, exactly as
    /// Mitra's own slip carries nothing but `CAHAYA513 MM`.
    pub store_name: String,
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
}

/// Render a PPOB struk: the store's name, the token if there is one, the
/// provider's own slip, our totals, and the provider's closing lines.
///
/// The shape is the Mitra app's, deliberately. A customer who has taken one of
/// their slips to a PLN counter before should not have to work out that this is
/// the same document. `paper_width_mm` picks the column count through
/// [`super::receipt::columns`].
pub fn format_ppob_receipt(data: &PpobReceiptData, paper_width_mm: u8) -> Vec<ReceiptTextLine> {
    let cpl = columns(paper_width_mm);
    let mut lines = Vec::new();

    lines.push(ReceiptTextLine::plain(center_text(&data.store_name, cpl)));
    lines.push(ReceiptTextLine::plain(String::new()));

    let has_token = push_token_block(&mut lines, data, cpl);

    let block = non_empty(data.provider_receipt_text.as_deref()).map(provider_lines);
    let (body, footer) = match block {
        Some(block) => split_body_footer(block, cpl),
        None => (Vec::new(), Vec::new()),
    };
    // The token is already on the paper in characters twice the size; the
    // provider's own `STROOM/TOKEN : …` lines would print it a second time,
    // and the Mitra app leaves them out.
    let body = if has_token {
        without_token_lines(body, cpl)
    } else {
        body
    };

    if body.is_empty() {
        push_fallback_body(&mut lines, data, cpl);
    } else {
        lines.extend(
            body.iter()
                .flat_map(|line| fit_verbatim(line, cpl))
                .map(ReceiptTextLine::plain),
        );
    }

    push_totals(&mut lines, data, cpl);
    push_footer(&mut lines, footer, cpl);

    lines
}

/// The provider's slip, as they sent it.
///
/// The only tidying: drop the carriage returns, the blank lines they open
/// with, and any run of blanks in the middle. Their wrapping stays theirs — it
/// is already the width of the paper, and re-flowing it would be us deciding we
/// know their document better than they do.
fn provider_lines(text: &str) -> Vec<String> {
    collapse_blanks(
        text.split('\n')
            .map(|raw| raw.trim_end_matches('\r').to_string()),
    )
}

/// Trim each line, drop the blanks a block opens and closes with, and let no run
/// of them through. One blank separates; two are wasted paper.
fn collapse_blanks(lines: impl Iterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    for line in lines {
        let line = line.trim_end().to_string();
        if line.is_empty() && out.last().is_none_or(String::is_empty) {
            continue;
        }
        out.push(line);
    }

    while out.last().is_some_and(String::is_empty) {
        out.pop();
    }

    out
}

/// The provider's block without its `STROOM/TOKEN : …` line and the
/// continuation rows under it.
///
/// `RP STROOM/TOKEN : Rp 18.181,00` is a different label — the rupiah value of
/// the electricity — and stays, as it does on the Mitra print.
fn without_token_lines(body: Vec<String>, cpl: usize) -> Vec<String> {
    let mut out = Vec::with_capacity(body.len());
    let mut skipping = false;

    for line in body {
        let indent = line.chars().take_while(|c| c.is_whitespace()).count();
        let is_continuation = !line.trim().is_empty() && indent >= MIN_CONTINUATION_SPACES;

        if skipping && is_continuation {
            continue;
        }
        skipping = split_pair(&line, cpl).is_some_and(|(label, ..)| label == "STROOM/TOKEN");
        if !skipping {
            out.push(line);
        }
    }

    out
}

/// Get one of the provider's lines onto the paper without rewriting it.
///
/// Most of them already fit — they wrapped to the same 32 columns we print in.
/// The ones that do not are their continuation lines, eighteen columns of
/// padding on top of a full-width run of text: PLN's footer arrives as eighteen
/// spaces then `3 Atau hubungi PLN TerdekatDownl`. A printer given that line
/// cuts it at the column, mid-word, padding and all — and that is what the
/// Mitra print shows, so it is cut the same way here rather than tidied.
fn fit_verbatim(line: &str, cpl: usize) -> Vec<String> {
    if line.chars().count() <= cpl {
        return vec![line.to_string()];
    }

    line.chars()
        .collect::<Vec<_>>()
        .chunks(cpl)
        .map(|chunk| chunk.iter().collect::<String>().trim_end().to_string())
        .collect()
}

/// The provider's closing prose, under our totals.
fn push_footer(lines: &mut Vec<ReceiptTextLine>, footer: Vec<String>, cpl: usize) {
    if footer.is_empty() {
        return;
    }
    // One line of air between the totals and the prose, as on the Mitra print.
    lines.push(ReceiptTextLine::plain(""));

    for line in footer {
        lines.extend(
            fit_verbatim(&line, cpl)
                .into_iter()
                .map(ReceiptTextLine::plain),
        );
    }
}

/// Split the provider's slip where its table of figures ends.
///
/// Everything up to and including the last `label : value` line is the body,
/// which belongs above our totals; whatever follows is the closing prose — the
/// call-centre line, the app's own advertisement, the trace stamp — which
/// belongs below them, exactly where Mitra puts it. A slip with no key/value
/// line at all is all body and no footer.
fn split_body_footer(block: Vec<String>, cpl: usize) -> (Vec<String>, Vec<String>) {
    // PLN's pipe-delimited footer has a colon fifty-five columns in and is
    // prose, not a label.
    let last_pair = block
        .iter()
        .rposition(|line| split_pair(line, cpl).is_some());

    let Some(end) = last_pair else {
        return (block, Vec::new());
    };

    // A blank line is how the provider says "the table ends here". Without one,
    // what follows the last labelled line is more table — Telkom Indihome closes
    // with `--Detail Tagihan 1--` / `Periode 09-2026` / `Nilai 316350` straight
    // after `Nama Pelanggan`, and those are figures, not a sign-off.
    if !block
        .get(end + 1)
        .is_some_and(|line| line.trim().is_empty())
    {
        return (block, Vec::new());
    }

    let mut body = block;
    let footer = body.split_off(end + 1);

    // The prose keeps the provider's own paragraph breaks — one blank line
    // between the call-centre note and the trace stamp, as on the Mitra print —
    // but not the blank that separated it from the table, nor any trailing air.
    (body, collapse_blanks(footer.into_iter()))
}

/// The PLN token, and only for PLN prepaid. Returns whether a block was printed.
///
/// It is the whole reason the customer keeps the paper — twenty digits to type
/// into a meter on a wall — so it prints double size, grouped in fours, under
/// the label the Mitra app uses, with a blank line either side of the label. No
/// other service gets a block here: what they return as a serial is a reference
/// nobody retypes, or the payer's own phone number, and Mitra prints neither.
fn push_token_block(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) -> bool {
    let Some(token) = data.token().filter(|_| data.is_pln_prepaid()) else {
        return false;
    };

    lines.push(ReceiptTextLine::plain(center_text("Stroom/Token", cpl)));
    lines.push(ReceiptTextLine::plain(String::new()));
    // Double-size characters take two columns each, so they fit half of them.
    for row in group_token(&token, cpl / 2) {
        lines.push(ReceiptTextLine::double(center_text(&row, cpl / 2)));
    }
    lines.push(ReceiptTextLine::plain(String::new()));
    true
}

/// What we can print when the provider sent no slip of its own.
fn push_fallback_body(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    for (key, value) in fallback_fields(data) {
        for line in label_value_lines(key, &value, KEY_WIDTH, cpl) {
            lines.push(ReceiptTextLine::plain(line));
        }
    }
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

/// A rule, then the three total lines laid out the way the Mitra print has
/// them: label padded to [`TOTAL_LABEL_WIDTH`], figure straight after.
fn push_totals(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    lines.push(ReceiptTextLine::plain(total_line(
        "Total",
        &format!("Rp {}", format_rupiah(data.total)),
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
    lines.push(ReceiptTextLine::plain(total_line(fee_label, &fee_amount)));
    lines.push(ReceiptTextLine::plain(total_line(
        "Grand Total",
        &format!("Rp {}", format_rupiah(data.grand_total)),
    )));
}

/// `Total             Rp 23.500` — the label in an eighteen-column field.
fn total_line(label: &str, amount: &str) -> String {
    format!("{label:<TOTAL_LABEL_WIDTH$}{amount}")
}

/// Split a PLN token into groups of four digits joined by dashes, packed into
/// rows no wider than `width`.
///
/// `69915243803067642910` at width 16 becomes `6991-5243-8030` / `6764-2910`,
/// which is what the Mitra app prints: no dash hangs off the end of a row.
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
    for group in &groups {
        // Groups on one row are joined by dashes; a row never ends in one —
        // the Mitra print breaks `4617-5400-1832` / `5962-7611`, not
        // `4617-5400-1832-`.
        let needed = if row.is_empty() {
            group.chars().count()
        } else {
            row.chars().count() + 1 + group.chars().count()
        };
        if !row.is_empty() && needed > width {
            rows.push(std::mem::take(&mut row));
        }
        if !row.is_empty() {
            row.push('-');
        }
        row.push_str(group);
    }
    if !row.is_empty() {
        rows.push(row);
    }
    rows
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
mod tests;

#[cfg(all(test, windows))]
mod samples;
