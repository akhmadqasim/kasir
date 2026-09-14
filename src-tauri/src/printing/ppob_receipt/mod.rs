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
//! justify them are the ones in this file's tests.
//!
//! Pulsa and paket data are the one exception to all of the above. Mitra's own
//! `pulsa/v2` API never answers with a `receipt_text` — there is no provider
//! slip to print verbatim — so its Android app composes the struk itself from
//! the same history fields this module holds, and [`format_pulsa_receipt`]
//! reconstructs that composition rather than falling back to the generic
//! `LABEL : VALUE` block every other service without a slip gets. A pulsa or
//! data line that *does* carry a `provider_receipt_text` (a provider that
//! changes its mind, or a future service reusing these two keys) still prints
//! it verbatim, same as PLN or PDAM would.
//!
//! Pure and side-effect free: it takes a [`PpobReceiptData`] and returns lines.
//! Loading that struct out of the database is `services::receipt`'s job.

use super::receipt::{center_text, columns, format_rupiah, two_col_text, ReceiptTextLine};

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

    // -- Pulsa/data only. See `format_pulsa_receipt`; every other service
    // ignores these four fields entirely. --
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

    /// The invoice number line's value: Mitra's own id if it sent one, our
    /// own sale's receipt number otherwise. `None` only when neither
    /// exists — a struk with no invoice line at all beats one that reads
    /// `Nomor Invoice #` with nothing after the `#`.
    fn invoice_number(&self) -> Option<&str> {
        non_empty(self.mitra_invoice_number.as_deref())
            .or_else(|| non_empty(self.our_receipt_number.as_deref()))
    }

    /// The pulsa/data token line: a real token or serial if there is one,
    /// `-` otherwise — Mitra's own placeholder for "no token", which is
    /// every pulsa and data top-up there is.
    ///
    /// `serial_number` on these two services is `token_number` if the
    /// provider sent one (always `-`, in practice) or else our own
    /// `ppob_serial_number` column, which for at least one real row holds a
    /// copy of the reference number rather than an actual token — printing
    /// it here would show the same digits twice under two different
    /// labels, so a value equal to `reference_number` is treated as no
    /// value at all.
    fn pulsa_token(&self) -> &str {
        // The history endpoint copies the phone number into `token_number`
        // and `serial_number` for a top-up, and our own row keeps the
        // reference digits there; neither is a token.
        match meaningful(self.serial_number.as_deref()) {
            Some(value)
                if Some(value) != non_empty(self.reference_number.as_deref())
                    && Some(value) != non_empty(self.customer_id.as_deref()) =>
            {
                value
            }
            _ => "-",
        }
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

    // Pulsa and data print Mitra's own "Cetak Struk" layout, but only when
    // there is no provider slip to print instead — a provider that does send
    // one is handled exactly like every other service, below.
    // `meaningful`, not `non_empty`: the history endpoint answers `"-"` for
    // a pulsa/data line's `receipt_text`, and a struk that is one dash is not
    // a slip.
    if matches!(data.service_type.as_str(), "pulsa" | "data")
        && meaningful(data.provider_receipt_text.as_deref()).is_none()
    {
        return format_pulsa_receipt(data, cpl);
    }

    let mut lines = Vec::new();

    lines.push(ReceiptTextLine::plain(center_text(&data.store_name, cpl)));
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
        Some(block) => split_body_footer(reflow_provider_lines(&block), cpl),
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

/// Render a pulsa or data struk the way Mitra's own app prints it from its
/// "Cetak Struk" screen — the layout the module doc explains, minus the
/// "MITRA INDOGROSIR" line and the "Struk ini merupakan bukti pembayaran
/// yang sah" footer, which the shop asked to leave off.
///
/// Only reached when there is no `provider_receipt_text` to print verbatim
/// instead; see [`format_ppob_receipt`].
fn format_pulsa_receipt(data: &PpobReceiptData, cpl: usize) -> Vec<ReceiptTextLine> {
    let mut lines = Vec::new();

    lines.push(ReceiptTextLine::plain(center_text(&data.store_name, cpl)));
    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));

    // Date left, time right, on one line — skipped entirely rather than
    // printed as bare padding when neither is known.
    if data.date.is_some() || data.time.is_some() {
        lines.push(ReceiptTextLine::plain(two_col_text(
            data.date.as_deref().unwrap_or(""),
            data.time.as_deref().unwrap_or(""),
            cpl,
        )));
    }
    if let Some(invoice) = data.invoice_number() {
        lines.push(ReceiptTextLine::plain(format!("Nomor Invoice #{invoice}")));
    }
    lines.push(ReceiptTextLine::plain("=".repeat(cpl)));

    lines.push(ReceiptTextLine::plain("TRANSAKSI:".to_string()));
    let (description_first, description_second) = pulsa_description(
        data.provider_description.as_deref(),
        data.product_name.as_deref(),
    );
    let phone = non_empty(data.customer_id.as_deref());
    let heading = match (phone, description_first.is_empty()) {
        // History's `description` already reads "<phone> - <product>".
        (Some(phone), false) if description_first.starts_with(&format!("{phone} - ")) => {
            description_first
        }
        (Some(phone), false) => format!("{phone} - {description_first}"),
        (Some(phone), true) => phone.to_string(),
        (None, _) => description_first,
    };
    if !heading.is_empty() {
        lines.extend(
            wrap_words(&heading, cpl)
                .into_iter()
                .map(ReceiptTextLine::plain),
        );
    }
    if let Some(second) = description_second {
        lines.extend(
            wrap_words(&second, cpl)
                .into_iter()
                .map(ReceiptTextLine::plain),
        );
    }

    lines.push(ReceiptTextLine::plain(String::new()));
    lines.push(ReceiptTextLine::plain(data.pulsa_token().to_string()));
    lines.push(ReceiptTextLine::plain(String::new()));

    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Biaya Admin",
        &format!("Rp {}", format_rupiah(data.admin_fee)),
        cpl,
    )));
    lines.push(ReceiptTextLine::plain("-".repeat(cpl)));
    // What the customer paid, our own markup folded in — the Mitra app has
    // no separate "Biaya Layanan"/"Grand Total" block on this screen, unlike
    // the other services' provider slip.
    lines.push(ReceiptTextLine::plain(two_col_text(
        "Total",
        &format!("Rp {}", format_rupiah(data.grand_total)),
        cpl,
    )));

    // "RINCIAN" and everything under it is only worth printing if there is
    // at least one of the two fields it exists to show.
    let mut rincian = Vec::new();
    if let Some(reference) = non_empty(data.reference_number.as_deref()) {
        rincian.extend(wrap_words(&format!("No. Ref: {reference}"), cpl));
    }
    if let Some(code) = non_empty(data.payment_code.as_deref()) {
        rincian.push("Kode Transaksi:".to_string());
        rincian.extend(wrap_words(code, cpl));
    }
    if !rincian.is_empty() {
        lines.push(ReceiptTextLine::plain(String::new()));
        lines.push(ReceiptTextLine::plain("RINCIAN".to_string()));
        lines.extend(rincian.into_iter().map(ReceiptTextLine::plain));
    }

    lines
}

/// Split a pulsa/data `product_name` back into the provider's own two-line
/// description, undoing the flattening checkout does to it.
///
/// The frontend composes `product_name` at checkout as `"Pulsa <provider> -
/// <description with its \n replaced by a space>"` (see
/// `src/features/ppob/components/quick-access/pulsa-input.tsx`), because the
/// cart line is one string and the provider's description is two. Nothing
/// stores the original two lines separately — that would be a new column and
/// a migration for a field only this struk reads — so they are recovered
/// here instead, from the one shape the frontend is known to produce: strip
/// the `"Pulsa "`/`"Data "` prefix and the provider name in front of the
/// first `" - "`, then break what is left before `"Masa Aktif"` if it is
/// there.
///
/// A `product_name` that does not match — a history row Mitra sent us, which
/// never went through our checkout — prints as one line, exactly as given.
fn pulsa_description(
    provider_description: Option<&str>,
    product_name: Option<&str>,
) -> (String, Option<String>) {
    // Mitra's `igr_desc` for a top-up is the product description itself, with
    // its real line break ("TELKOMSEL 50.000,-\nMasa Aktif 45 Hari") — the
    // history path has it, and it beats reconstructing the break from a
    // flattened product name. `meaningful`: history answers "-" for a name it
    // does not have.
    if let Some(description) = meaningful(provider_description) {
        let (first, second) = match description.split_once('\n') {
            Some((first, second)) => (first.trim(), Some(second.trim().to_string())),
            None => (description, None),
        };
        return (first.to_string(), second.filter(|text| !text.is_empty()));
    }

    let Some(name) = meaningful(product_name) else {
        return (String::new(), None);
    };

    match strip_pulsa_prefix(name) {
        Some(description) => match split_before_masa_aktif(description) {
            Some((first, second)) => (first, Some(second)),
            None => (description.to_string(), None),
        },
        None => (name.to_string(), None),
    }
}

/// Strips a leading `"Pulsa <provider> - "` or `"Data <provider> - "`,
/// returning what follows. `None` when `name` does not start with either
/// literal prefix the frontend uses, or has nothing after it.
fn strip_pulsa_prefix(name: &str) -> Option<&str> {
    ["Pulsa ", "Data "].iter().find_map(|prefix| {
        name.strip_prefix(prefix)
            .and_then(|rest| rest.split_once(" - "))
            .map(|(_provider, description)| description)
    })
}

/// Breaks `text` into what comes before `"Masa Aktif"` and `"Masa Aktif"`
/// onward, matched case-insensitively (Mitra's own capitalisation is not
/// perfectly consistent) and only on a word boundary, so `"SMS Masa Aktif 30
/// Hari"` splits and `"Bonus Masaaktif"` does not. `None` when the text has
/// no such break.
///
/// Matched byte-by-byte with `eq_ignore_ascii_case` rather than
/// `str::to_lowercase`, which is not the identity on every character it
/// touches (Turkish İ, German ß) and could shift a byte offset computed on
/// the lowercased copy off a char boundary in `text` itself. The needle is
/// plain ASCII, so a match can only land on plain ASCII bytes in `text` too,
/// and slicing on it is always safe.
fn split_before_masa_aktif(text: &str) -> Option<(String, String)> {
    const NEEDLE: &[u8] = b"masa aktif";
    let bytes = text.as_bytes();
    let at = bytes
        .windows(NEEDLE.len())
        .position(|window| window.eq_ignore_ascii_case(NEEDLE))?;
    if !(at == 0 || bytes[at - 1] == b' ') {
        return None;
    }

    let first = text[..at].trim_end().to_string();
    let second = text[at..].trim_start().to_string();
    Some((first, second))
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

/// One field of the provider's slip, once its own continuation lines (if it
/// had any) are joined back onto it.
///
/// `column` is the char position of the colon in the line the provider
/// actually sent — the width it padded every label in this block to, not the
/// length of this particular label — so a block whose widest key is `RP
/// STROOM/TOKEN` still lines up `JML KWH` under the same colon. Only a label
/// of upper-case letters, digits, spaces, `/`, `-` and `.` earns this
/// treatment (see [`match_label_line`]); everything else — PDAM's `Nama
/// PDAM`, BPJS's `Nomor Peserta`, the provider's own heading and closing
/// prose — is [`Text`](LogicalLine::Text), laid out with no column of its
/// own.
enum LogicalLine {
    /// A blank line the provider used to separate sections of its own table.
    Blank,
    Labelled {
        label: String,
        value: String,
        column: usize,
    },
    Text(String),
}

/// A line that continues the one above it: the provider's own wrap, not a
/// new field. Loose on purpose — the indent wobbles between eighteen and
/// nineteen spaces depending on the service — but never so loose that a
/// label line (which always starts at column zero) could be mistaken for one.
fn is_continuation_line(line: &str) -> bool {
    let indent = line.chars().take_while(|c| c.is_whitespace()).count();
    indent >= 2 && !line.trim().is_empty()
}

/// A line shaped like `LABEL : value` — a label of upper-case letters,
/// digits, spaces, `/`, `-` and `.`, starting with a letter, then a colon,
/// then at most one space before the value. Deliberately hand-rolled rather
/// than pulled in via a regex crate: the grammar is small enough that a
/// linear scan over one `find(':')` reads as plainly as a pattern would, for
/// one dependency fewer.
///
/// The upper-case-only rule is what keeps this from firing on PDAM's `Nama
/// PDAM          : Kota Samarinda` or BPJS's `Nama Peserta      : AHMAD
/// FAUZI NUGROHO` — those providers' own key/value shape is real, but it is
/// not the Mitra app's `LABEL : value` convention this module re-derives a
/// column width from, so those lines are laid out as plain prose instead
/// (see [`wrap_text_line`]) rather than under a label column of their own.
fn match_label_line(line: &str) -> Option<(&str, &str, usize)> {
    let colon = line.find(':')?;
    let label = line[..colon].trim_end();
    let is_label_char = |c: char| {
        c.is_ascii_uppercase() || c.is_ascii_digit() || matches!(c, ' ' | '/' | '-' | '.')
    };
    if label.is_empty()
        || !label.starts_with(|c: char| c.is_ascii_uppercase())
        || !label.chars().all(is_label_char)
    {
        return None;
    }

    let after = &line[colon + 1..];
    let value = after.strip_prefix(' ').unwrap_or(after);
    let column = line[..colon].chars().count();
    Some((label, value, column))
}

/// Parse the provider's own lines into one entry per logical field, rejoining
/// every continuation onto the line it continues.
///
/// The join is a plain concatenation, no separator inserted: the provider
/// only ever continues a line by cutting the one before it at its own column
/// limit, mid-token — `HU` + `DARI` is `HUDARI`, and `Call Center 12` + `3
/// Atou hubungi…` is `123 Atou hubungi…`, the same cut, just one that happens
/// to fall between two digits instead of inside a word. There is no fixture
/// where the provider's own wrap needed a space reinserted at the seam; see
/// this module's tests for the ones it was checked against.
fn parse_logical_lines(lines: &[String]) -> Vec<LogicalLine> {
    let mut out: Vec<LogicalLine> = Vec::with_capacity(lines.len());

    for line in lines {
        if line.trim().is_empty() {
            out.push(LogicalLine::Blank);
            continue;
        }

        let is_continuation = is_continuation_line(line);
        if is_continuation {
            let fragment = line.trim();
            match out.last_mut() {
                Some(LogicalLine::Labelled { value, .. }) => {
                    value.push_str(fragment);
                    continue;
                }
                Some(LogicalLine::Text(text)) => {
                    text.push_str(fragment);
                    continue;
                }
                // A continuation with nothing above it to continue — the
                // block opened mid-wrap, or the line above was blank — has
                // no logical line to join onto, so it starts one of its own
                // instead of being dropped — its own indent trimmed off, the
                // same as it would be if it had something to join.
                Some(LogicalLine::Blank) | None => {}
            }
        }

        // A line that fell through the continuation check above starts a
        // fresh logical line from its trimmed self, not its raw indent.
        let content = if is_continuation {
            line.trim()
        } else {
            line.as_str()
        };
        out.push(match match_label_line(content) {
            Some((label, value, column)) => LogicalLine::Labelled {
                label: label.to_string(),
                value: value.to_string(),
                column,
            },
            None => LogicalLine::Text(content.to_string()),
        });
    }

    out
}

/// The label column every [`LogicalLine::Labelled`] in this block pads to:
/// the widest one the provider actually sent, detected from where its colon
/// landed rather than assumed from label text length (a block's shortest
/// label is not necessarily unpadded). `0` when the block has none — PDAM,
/// BPJS and payment point never do, their keys being title case rather than
/// the Mitra app's own shouted `LABEL :` convention.
fn detect_label_width(logical: &[LogicalLine]) -> usize {
    logical
        .iter()
        .filter_map(|line| match line {
            LogicalLine::Labelled { column, .. } => Some(*column),
            _ => None,
        })
        .max()
        .unwrap_or(0)
}

/// One logical line, written out in full — not yet wrapped to any paper
/// width, so a long value still makes for a long string here. That is
/// deliberate: [`split_body_footer`] and [`without_token_lines`] both look
/// for a label at the *start* of a line, and a value re-flow had already cut
/// into several rows could plant one of its own mid-string — the digits
/// after a trace stamp's first colon, say — somewhere `split_pair` would read
/// as a second, spurious label. One line in, one line out keeps every label
/// this block has at column zero, where those two functions expect it.
fn join_logical_line(line: &LogicalLine, label_width: usize) -> String {
    match line {
        LogicalLine::Blank => String::new(),
        LogicalLine::Labelled { label, value, .. } => {
            format!("{label:<label_width$}: {value}")
        }
        LogicalLine::Text(text) => text.clone(),
    }
}

/// Parse the provider's block and join every field back to one line —
/// [`split_body_footer`] and [`without_token_lines`] run on the result
/// exactly as they always have, seeing one line per field regardless of how
/// many lines the provider (or later, [`wrap_joined_line`]) cut it into.
fn reflow_provider_lines(lines: &[String]) -> Vec<String> {
    let logical = parse_logical_lines(lines);
    let label_width = detect_label_width(&logical);
    logical
        .iter()
        .map(|line| join_logical_line(line, label_width))
        .collect()
}

/// Lay one already-rejoined logical line out for the paper, wrapping it if it
/// does not fit. Re-parses the line rather than carrying `LogicalLine`
/// through `split_body_footer`/`without_token_lines`: both only ever drop or
/// reorder whole lines, never edit one, so whatever shape a line had going in
/// — `LABEL : value` or plain prose — it still has coming out.
fn wrap_joined_line(line: &str, cpl: usize) -> Vec<String> {
    match match_label_line(line) {
        Some((label, value, column)) => wrap_labelled_line(label, value, column, cpl),
        None => wrap_text_line(line, cpl),
    }
}

/// `LABEL : value`, wrapped if it has to be: continuation lines indented to
/// the value column (label width plus the `: ` after it), so a value that
/// took the provider three lines to say still reads as one field on ours.
///
/// [`wrap_words`] already does the right thing for both kinds of value this
/// module ever wraps here — greedy word wrap for one with spaces in it
/// (`BUDI SANTOSA WIJAYA`), and, for a value that is one unbroken run with no
/// spaces at all (a reference number, a trace stamp), the same function
/// degrades to cutting it every `avail` characters, because `split_whitespace`
/// hands it back as a single "word" that does not fit and its own char loop
/// chops that one word instead. One function, no separate token-vs-prose
/// branch needed.
fn wrap_labelled_line(label: &str, value: &str, width: usize, cpl: usize) -> Vec<String> {
    let head = format!("{label:<width$}: ");
    let head_len = head.chars().count();

    if head_len + value.chars().count() <= cpl {
        return vec![format!("{head}{value}")];
    }

    let avail = cpl.saturating_sub(head_len).max(1);
    wrap_words(value, avail)
        .into_iter()
        .enumerate()
        .map(|(i, chunk)| {
            if i == 0 {
                format!("{head}{chunk}")
            } else {
                format!("{}{chunk}", " ".repeat(head_len))
            }
        })
        .collect()
}

/// A line with no label column of its own: the provider's heading, its
/// closing prose, PDAM/BPJS/payment point's title-case `key : value` lines
/// (see [`match_label_line`]'s doc for why those do not get one either).
///
/// Printed unchanged when it already fits — this is the branch that keeps
/// PDAM's `Total Tagihan      : 69,163` on the paper with its own padding
/// intact rather than every line here being run through a word wrap that
/// would collapse it to one space. Word-wrapped, with no indent, only when it
/// does not.
///
/// One line is not really prose, though: a footer line of the shape
/// `MKM|"…"|…` is the provider's own pipe-delimited list, not a sentence —
/// each `|`-separated part (quotes stripped) is its own paragraph, and is
/// word-wrapped as one.
fn wrap_text_line(text: &str, cpl: usize) -> Vec<String> {
    if let Some(rest) = text.strip_prefix("MKM|") {
        return rest
            .split('|')
            .map(strip_quotes)
            .filter(|part| !part.is_empty())
            .flat_map(|part| wrap_words(&part, cpl))
            .collect();
    }

    if text.chars().count() <= cpl {
        return vec![text.to_string()];
    }
    wrap_words(text, cpl)
}

/// One `MKM|"…"|…` part, its surrounding quotes (if it has them — only the
/// first part, wrapped in the provider's own `"…"`, ever does) trimmed off.
fn strip_quotes(part: &str) -> String {
    let trimmed = part.trim();
    match trimmed
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
    {
        Some(inner) => inner.to_string(),
        None => trimmed.to_string(),
    }
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
