//! Struk for a PPOB line, shaped like the one the Mitra Indogrosir Android app
//! prints from its "Cetak Struk" screen.
//!
//! A PPOB struk is not a sales receipt with different words on it. The customer
//! keeps it as proof towards a third party — PLN, PDAM, BPJS — so what matters
//! is the provider's own wording: the meter number, the tariff, the KWH figure,
//! the call-centre line at the bottom. Most services hand that back already
//! formatted, one key per line, in `receipt_text` (some call it
//! `invoice_string`), and when they do the honest thing is to print their own
//! wording rather than re-derive it from fields whose names change per
//! service — but not their own line breaks. The provider wraps that text for
//! its *own* printer, at its own column count, and does it sloppily (a
//! continuation line eighteen spaces deep next to a label column that is
//! seventeen wide overflows by one character); reflowing it for our paper
//! before it goes out is not us improving on their document, it is printing
//! the same words the Mitra app itself shows on screen, which re-flows this
//! same text rather than showing the provider's raw line breaks.
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
//! left a blank line under it, that a line the provider cut off mid-word to
//! fit its own column count is one field, however many lines it takes on
//! ours. They live here rather than in the service layer because each one is
//! a decision about what belongs on the paper, and because the fixtures that
//! justify them are the ones in this module's tests.
//!
//! Pulsa and paket data are the one exception to all of the above. Mitra's own
//! `pulsa/v2` API never answers with a `receipt_text` — there is no provider
//! slip to print verbatim — so its Android app composes the struk itself from
//! the same history fields this module holds, and
//! [`pulsa::format_pulsa_receipt`] reconstructs that composition rather than
//! falling back to the generic `LABEL : VALUE` block every other service
//! without a slip gets. A pulsa or data line that *does* carry a
//! `provider_receipt_text` (a provider that changes its mind, or a future
//! service reusing these two keys) still prints it verbatim, same as PLN or
//! PDAM would.
//!
//! Pure and side-effect free: it takes a [`PpobReceiptData`] and returns lines.
//! Loading that struct out of the database is `services::receipt`'s job.

mod provider_text;
mod pulsa;

use super::layout::{center_text, center_wrapped, columns, format_rupiah, wrap_words};
use super::receipt::ReceiptTextLine;
use provider_text::{
    provider_lines, reflow_provider_lines, split_body_footer, without_token_lines, wrap_joined_line,
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

/// Width of the key column in the fallback block. Sized to the widest key we
/// emit, `NO PELANGGAN`, so a normal-length value still fits on 32 columns —
/// the Mitra app's own 17-column keys leave too little room for ours.
const KEY_WIDTH: usize = 12;

/// The label column of the three total lines. The Mitra print pads `Total`,
/// `Biaya Layanan` and `Grand Total` to eighteen characters and writes the
/// figure straight after, left-aligned — not out at the right edge.
const TOTAL_LABEL_WIDTH: usize = 18;

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

    // -- Pulsa/data only. See `pulsa::format_pulsa_receipt`; every other
    // service ignores these four fields entirely. --
    /// `27-03-2026`, already in display form. The provider's own timestamp
    /// when it sent one — Mitra's are always WIB, never anything else — or
    /// our own `transaction_items.created_at` converted from UTC. See
    /// `services::receipt` for which, and why the conversion is a fixed
    /// +7h rather than the machine's own time zone.
    pub date: Option<String>,
    /// `09:13 WIB`, alongside `date`.
    pub time: Option<String>,
    /// Mitra's own transaction id for this line — its history's `trx_id`
    /// (`services::ppob::history::HistoryPaymentItem::trx_id`, also `id` on
    /// the wire), or the same field read off a stored payment response.
    /// `None` when neither said one, which [`PpobReceiptData::invoice_number`]
    /// falls back for.
    pub mitra_invoice_number: Option<String>,
    /// Our own sale's receipt number ("TRX-YYYYMMDD-XXXX"), the invoice
    /// line's fallback when Mitra sent no id of its own. `None` for a struk
    /// printed from Mitra's history, where there is no sale of ours behind
    /// it to fall back to.
    pub our_receipt_number: Option<String>,
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
/// [`super::layout::columns`].
pub fn format_ppob_receipt(data: &PpobReceiptData, paper_width_mm: u8) -> Vec<ReceiptTextLine> {
    let cpl = columns(paper_width_mm);

    // Pulsa and data print Mitra's own "Cetak Struk" layout, but only when
    // there is no provider slip to print instead — a provider that does send
    // one is handled exactly like every other service, below.
    // `meaningful`, not `non_empty`: the history endpoint answers `"-"` for
    // a pulsa/data line's `receipt_text`, and a struk that is one dash is not
    // a slip.
    if matches!(data.service_type.as_str(), "pulsa" | "data")
        && meaningful(data.provider_receipt_text.as_deref()).is_none()
    {
        return pulsa::format_pulsa_receipt(data, cpl);
    }

    let mut lines = Vec::new();

    push_store_name(&mut lines, &data.store_name, cpl);
    lines.push(ReceiptTextLine::plain(String::new()));

    let has_token = push_token_block(&mut lines, data, cpl);

    // Re-flow first — join every field back to one logical line, whatever
    // the provider cut it into — so `split_body_footer` and
    // `without_token_lines` below see the same one-line-per-field shape they
    // were written against, rather than the provider's own wrapping (which
    // is wobbly enough to plant a stray colon at the start of a line it
    // never meant as a label; see `reflow_provider_lines`'s doc for why this
    // has to run before them, not after).
    let block = meaningful(data.provider_receipt_text.as_deref()).map(provider_lines);
    let (body, footer) = match block {
        Some(block) => split_body_footer(reflow_provider_lines(&block, cpl), cpl),
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
                .flat_map(|line| wrap_joined_line(line, cpl))
                .map(ReceiptTextLine::plain),
        );
    }

    push_totals(&mut lines, data, cpl);
    push_footer(&mut lines, footer, cpl);

    lines
}

/// The outlet's name, centred — the only thing on a PPOB struk that says
/// where it was printed. Wrapped rather than run off the paper when the name
/// is longer than a line.
fn push_store_name(lines: &mut Vec<ReceiptTextLine>, store_name: &str, cpl: usize) {
    lines.extend(
        center_wrapped(store_name, cpl)
            .into_iter()
            .map(ReceiptTextLine::plain),
    );
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
            wrap_joined_line(&line, cpl)
                .into_iter()
                .map(ReceiptTextLine::plain),
        );
    }
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

#[cfg(test)]
mod tests;

#[cfg(all(test, windows))]
mod samples;
