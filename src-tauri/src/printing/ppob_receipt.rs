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
//! So the struk is the provider's slip with the store's name over it and three
//! total lines cut into it, and nothing else of ours: no receipt number, no
//! cashier, no heading we wrote. This module re-lays out any provider line too
//! long for the paper, splits their table from their closing prose so our totals
//! can sit between the two, and synthesises a minimal block from the fields we
//! did capture when the provider sent no slip at all.
//!
//! It also carries a handful of judgements about what the provider *meant* —
//! that a twenty-digit run of digits is a PLN token and a reference number is
//! not, that a fused `TerdekatDownload` was two words before their own wrapper
//! got to it, that a table ends at its last labelled line only when the
//! provider left a blank line under it. They live
//! here rather than in the service layer because each one is a decision about
//! what belongs on the paper, and because the fixtures that justify them are the
//! ones in this file's tests.
//!
//! Pure and side-effect free: it takes a [`PpobReceiptData`] and returns lines.
//! Loading that struct out of the database is `services::receipt`'s job.

use super::receipt::{
    center_text, columns, format_rupiah, two_col_text, PrintMode, ReceiptTextLine,
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
/// the same document — so nothing of ours goes on it beyond the store name and
/// the three total lines. No receipt number, no cashier, no heading we wrote, no
/// rules boxing it in. `paper_width_mm` picks the column count through
/// [`super::receipt::columns`].
pub fn format_ppob_receipt(
    data: &PpobReceiptData,
    paper_width_mm: u8,
    mode: PrintMode,
) -> Vec<ReceiptTextLine> {
    let cpl = columns(paper_width_mm, mode);
    let mut lines = Vec::new();

    // Bold is double height on this printer, which is what the app's own
    // letterhead looks like.
    lines.push(ReceiptTextLine::bold(center_text(&data.store_name, cpl)));
    lines.push(ReceiptTextLine::plain(String::new()));

    push_token_block(&mut lines, data, cpl);

    let block = non_empty(data.provider_receipt_text.as_deref()).map(|text| match mode {
        // A raster is as wide as the provider's own wrap, so their slip goes on
        // the paper the way they wrote it — the broken name, the fused word, the
        // pipes and all. That is what the Mitra app prints, and the whole point
        // of the exercise is that a customer cannot tell the two apart.
        PrintMode::Raster => provider_lines(text),
        // Text mode is a column narrower and cannot fit their wrap, so there it
        // is folded back and re-laid out.
        PrintMode::Text => unfold_provider_text(text),
    });
    let (body, footer) = match block {
        Some(block) => split_body_footer(block, cpl),
        None => (Vec::new(), Vec::new()),
    };

    if body.is_empty() {
        push_fallback_body(&mut lines, data, cpl);
    } else if mode == PrintMode::Raster {
        lines.extend(
            body.iter()
                .flat_map(|line| fit_verbatim(line, cpl))
                .map(ReceiptTextLine::plain),
        );
    } else {
        lines.extend(layout_block(&body, repad_width(&body, cpl), cpl));
    }

    push_totals(&mut lines, data, cpl);
    push_footer(&mut lines, footer, mode, cpl);

    lines
}

/// The provider's slip, as they sent it.
///
/// The only tidying a raster needs: drop the carriage returns, the blank lines
/// they open with, and any run of blanks in the middle. Their wrapping stays
/// theirs — it is already the width of the paper, and re-flowing it would be us
/// deciding we know their document better than they do.
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

/// Get one of the provider's lines onto the paper without rewriting it.
///
/// Most of them already fit — they wrapped to the same 32 columns we print in.
/// The ones that do not are their continuation lines, which carry eighteen
/// columns of padding on top of a full-width run of text: the footer arrives as
/// eighteen spaces then `3 Atau hubungi PLN TerdekatDownl`, fifty characters for
/// thirty-two columns of paper. The padding is the provider's own alignment and
/// the characters are the customer's, so the padding goes first. Only if that is
/// still not enough does the line get cut, and then at the column, mid-word,
/// exactly as this printer would have done it.
fn fit_verbatim(line: &str, cpl: usize) -> Vec<String> {
    if line.chars().count() <= cpl {
        return vec![line.to_string()];
    }

    let unpadded = line.trim_start();
    if unpadded.chars().count() <= cpl {
        return vec![unpadded.to_string()];
    }

    unpadded
        .chars()
        .collect::<Vec<_>>()
        .chunks(cpl)
        .map(|chunk| chunk.iter().collect())
        .collect()
}

/// The provider's closing prose, under our totals.
fn push_footer(lines: &mut Vec<ReceiptTextLine>, footer: Vec<String>, mode: PrintMode, cpl: usize) {
    for line in footer {
        if mode == PrintMode::Raster {
            lines.extend(
                fit_verbatim(&line, cpl)
                    .into_iter()
                    .map(ReceiptTextLine::plain),
            );
            continue;
        }

        // Text mode has a column less than the provider wrapped to, so its
        // prose is flattened out of the pipes, unglued and re-wrapped.
        for segment in expand_pipe_segments(&line) {
            for row in wrap_words(&unglue_prose(&segment), cpl) {
                lines.push(ReceiptTextLine::plain(row));
            }
        }
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
    // The same test the layout uses, so a line the table prints as a labelled
    // one is a line the split counts. PLN's pipe-delimited footer has a colon
    // fifty-five columns in and is prose, not a label, by both.
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

    // Blank lines inside the table separate its sections and are kept; blank
    // lines under it are just the provider's own spacing, and paper costs money.
    let footer = footer
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect();

    (body, footer)
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

/// The PLN token, and only for PLN prepaid.
///
/// It is the whole reason the customer keeps the paper — twenty digits to type
/// into a meter on a wall — so it prints double width, grouped in fours, under
/// the label the Mitra app uses. No other service gets a block here: what they
/// return as a serial is a reference nobody retypes, or the payer's own phone
/// number, and Mitra prints neither.
fn push_token_block(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    let Some(token) = data.token().filter(|_| data.is_pln_prepaid()) else {
        return;
    };

    lines.push(ReceiptTextLine::plain(center_text("Stroom / Token", cpl)));
    // Double-width characters take two columns each, so they fit half of them.
    for row in group_token(&token, cpl / 2) {
        lines.push(ReceiptTextLine::double(center_text(&row, cpl / 2)));
    }
    lines.push(ReceiptTextLine::plain(String::new()));
}

/// What we can print when the provider sent no slip of its own.
fn push_fallback_body(lines: &mut Vec<ReceiptTextLine>, data: &PpobReceiptData, cpl: usize) {
    for (key, value) in fallback_fields(data) {
        for line in label_value_lines(key, &value, KEY_WIDTH, cpl) {
            lines.push(ReceiptTextLine::plain(line));
        }
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

    collapse_blanks(folded.into_iter())
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
fn layout_block(block: &[String], repad: Option<usize>, cpl: usize) -> Vec<ReceiptTextLine> {
    let mut out = Vec::with_capacity(block.len());
    for line in block {
        // A key the provider had no value for is a colon and nothing else. On a
        // screen it is a gap; on paper it is a line of ink saying nothing.
        if is_empty_pair(line) {
            continue;
        }

        // The provider's slip is printed as the provider wrote it, its own
        // heading included and in the same weight as the rest of it.
        let rows = match (repad, split_pair(line, cpl)) {
            (Some(width), Some((label, _, value))) => label_value_lines(label, value, width, cpl),
            _ => wrap_line(line, cpl),
        };

        out.extend(rows.into_iter().map(ReceiptTextLine::plain));
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

/// The label column to re-pad a block to, or `None` to leave it as it came.
///
/// Mitra pads its labels to a column of its own choosing — 19 for PDAM, 18 for
/// BPJS — which on 58mm paper leaves eleven or twelve columns for the value and
/// breaks `Kota Samarinda` across two lines. Where it padded wider than its own
/// longest label ever needed, and wider than we would have chosen, the column
/// comes back in to the longest label — never narrower than that, since a label
/// that did not fit would push its own colon out and take the alignment with it.
/// PLN prepaid pads to 16 for a longest label of 15, so it is left alone.
fn repad_width(block: &[String], cpl: usize) -> Option<usize> {
    let target = if cpl >= 41 { 18 } else { 14 };
    let pairs: Vec<(&str, usize, &str)> = block
        .iter()
        .filter_map(|line| split_pair(line, cpl))
        .collect();

    let column = pairs.iter().map(|(_, column, _)| *column).max()?;
    let widest = pairs
        .iter()
        .map(|(label, ..)| label.chars().count())
        .max()
        .unwrap_or(0);

    (column > widest + 1 && column > target).then_some(widest)
}

/// `Periode         : ` — a key, a colon, and nothing after it. A separator such
/// as `----- Peserta 1 -----` has no colon and is not one of these.
fn is_empty_pair(line: &str) -> bool {
    match line.split_once(':') {
        Some((key, value)) => !key.trim().is_empty() && value.trim().is_empty(),
        None => false,
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
            service_type: "pln".to_string(),
            flag_id: None,
            product_name: None,
            customer_id: None,
            customer_name: None,
            serial_number: None,
            reference_number: None,
            payment_code: None,
            provider_description: None,
            provider_receipt_text: None,
            amount: 0.0,
            admin_fee: 0.0,
            total: 0.0,
            grand_total: 0.0,
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

    /// The receipt as one line of single-spaced words, for asserting on text
    /// that the formatter may legitimately wrap: the 32-character PLN title no
    /// longer fits a 31-column line in one piece.
    pub(super) fn flat(lines: &[ReceiptTextLine]) -> String {
        text_of(lines)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
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
            for (paper, mode) in [
                (58_u8, PrintMode::Text),
                (80, PrintMode::Text),
                (58, PrintMode::Raster),
                (80, PrintMode::Raster),
            ] {
                let cpl = columns(paper, mode);
                for line in format_ppob_receipt(&data, paper, mode) {
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
        let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Text));

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

    /// A raster is as wide as the provider's own wrap, so their slip goes on the
    /// paper exactly as it arrived: the name broken where they broke it, the
    /// reference in their three pieces, the fused word left fused. That is the
    /// document the Mitra app prints, and matching it is the point.
    #[test]
    fn a_raster_prints_the_providers_slip_verbatim() {
        let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Raster));

        assert!(text.contains("NAMA            : BUDI SANTOSA W\n                  IJAYA"));
        assert!(text.contains("NO REF          : 11002500AAA1A1\n                  111AA111AA1111"));
        // Fifty characters of provider line for thirty-two of paper: their
        // padding goes, their words stay.
        assert!(text.contains(
            "
3 Atau hubungi PLN TerdekatDownl
"
        ));
        assert!(text.contains("oad PLN Mobile"));
        assert!(text.contains("STRUK PEMBELIAN LISTRIK PRABAYAR"));
    }

    /// And it gets the whole width to do it in: thirty-two columns on 58mm
    /// paper, where text mode has to stop at thirty-one.
    #[test]
    fn a_raster_uses_the_column_text_mode_has_to_leave_empty() {
        let raster = format_ppob_receipt(&pdam(), 58, PrintMode::Raster);
        let text = format_ppob_receipt(&pdam(), 58, PrintMode::Text);

        assert!(raster.iter().any(|line| line.text == "-".repeat(32)));
        assert!(text.iter().any(|line| line.text == "-".repeat(31)));
    }

    /// The order is the same whichever way it is printed; only the provider's
    /// own lines are handled differently.
    #[test]
    fn a_raster_struk_reads_in_the_same_order() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Raster);
        let rows: Vec<&str> = lines.iter().map(|line| line.text.trim_end()).collect();

        assert_eq!(rows[0].trim(), "Cahaya513 Mini Mart");
        assert_eq!(rows[1], "");
        assert_eq!(rows[2].trim(), "Stroom / Token");
        assert_eq!(rows[5], "");
        assert_eq!(rows[6], "STRUK PEMBELIAN LISTRIK PRABAYAR");

        let rule = rows
            .iter()
            .position(|row| *row == "-".repeat(32))
            .expect("totals rule");
        assert_eq!(rows[rule + 1], two_col_text("Total", "Rp 23.500", 32));
        assert_eq!(rows[rule + 3], two_col_text("Grand Total", "Rp 25.000", 32));
        assert!(rows[rule + 4].starts_with("Informasi Hubungi"));
    }

    /// PLN's own text opens with its heading, and it prints as the provider
    /// wrote it — once, in the body, at body weight.
    #[test]
    fn the_providers_own_heading_prints_once_and_unchanged() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Text);

        assert_eq!(
            flat(&lines)
                .matches("STRUK PEMBELIAN LISTRIK PRABAYAR")
                .count(),
            1
        );
        let title = lines
            .iter()
            .find(|line| line.text.contains("STRUK PEMBELIAN"))
            .expect("title printed");
        assert!(
            !title.bold,
            "the provider's heading is not ours to embolden"
        );
    }

    /// PDAM, BPJS and payment point send no heading, and we do not invent one:
    /// the struk is the provider's document, and a heading we wrote would be a
    /// claim about it that the provider never made.
    #[test]
    fn no_heading_of_ours_is_added_to_a_service_that_sent_none() {
        for data in [pdam(), bpjs(), payment_point()] {
            let text = text_of(&format_ppob_receipt(&data, 58, PrintMode::Text));
            assert!(
                !text.contains("STRUK"),
                "{} got a heading we wrote: {}",
                data.service_type,
                text
            );
        }
    }

    /// Two blank lines on the whole struk: one under the store name, one under
    /// the token. The provider's own spacing inside its table survives; its
    /// spacing around the closing prose does not, and paper costs money.
    #[test]
    fn blank_lines_are_spent_only_where_the_layout_asks_for_them() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Text);
        let rows: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();

        assert!(rows[1].trim().is_empty(), "blank under the store name");
        assert!(
            !rows
                .windows(2)
                .any(|pair| pair[0].trim().is_empty() && pair[1].trim().is_empty()),
            "no two blanks in a row"
        );

        // A service with no token spends no blank on one: PDAM's body starts
        // immediately, and the blanks it does have are the provider's own,
        // inside its table.
        let water = format_ppob_receipt(&pdam(), 58, PrintMode::Text);
        assert!(
            !water[2].text.trim().is_empty(),
            "no token, no blank for it"
        );
        // The three it does have are the provider's own, between the sections
        // of its table, and every one of them separates two printed lines.
        assert_eq!(water.iter().filter(|line| line.text.is_empty()).count(), 3);
    }

    #[test]
    fn the_token_is_normalised_from_space_groups_and_printed_double_size() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Text);
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
        // Pulsa is here for the other half of it: a real serial, but not PLN, so
        // still no token block.
        for data in [pln_postpaid(), pdam(), payment_point(), pulsa()] {
            let text = text_of(&format_ppob_receipt(&data, 58, PrintMode::Text));
            assert!(!text.contains("Stroom / Token"), "{}", data.service_type);
        }
    }

    /// What BPJS returns as a serial is the payer's own mobile number, and the
    /// struk has no serial block for it to go in. Nothing of the sort reaches
    /// the paper.
    #[test]
    fn the_payers_phone_number_never_reaches_the_paper() {
        assert!(
            !text_of(&format_ppob_receipt(&bpjs(), 58, PrintMode::Text)).contains("08120000001")
        );
    }

    fn pulsa() -> PpobReceiptData {
        PpobReceiptData {
            service_type: "pulsa".to_string(),
            product_name: Some("Telkomsel 25.000".to_string()),
            customer_id: Some("081200000002".to_string()),
            serial_number: Some("SN0001234567890123".to_string()),
            reference_number: Some("4323384".to_string()),
            payment_code: Some("TS25-1-260911094954".to_string()),
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
        let text = text_of(&format_ppob_receipt(&pln_postpaid(), 58, PrintMode::Text));

        assert!(!text.contains("MKM"));
        assert!(!text.contains('|'));
        assert!(!text.contains('"'));
        assert!(text.contains("Informasi Hubungi Call Center"));
        assert!(text.contains("Download PLN Mobile"));
    }

    /// `amount` from the provider already includes the admin fee — 23.500 is
    /// 20.000 of electricity plus a 3.500 bank charge — so the struk's Total is
    /// that figure, not that figure plus the fee a second time.
    #[test]
    fn the_totals_block_matches_what_the_provider_billed() {
        let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Text));

        assert!(text.contains(&two_col_text(
            "Total",
            "Rp 23.500",
            columns(58, PrintMode::Text)
        )));
        assert!(text.contains(&two_col_text(
            "Biaya Layanan",
            "Rp 1.500",
            columns(58, PrintMode::Text)
        )));
        assert!(text.contains(&two_col_text(
            "Grand Total",
            "Rp 25.000",
            columns(58, PrintMode::Text)
        )));
    }

    /// A cart-wide discount is shared out over every line, PPOB included, so the
    /// shop can end up having sold the line below what the provider charged.
    /// That is a discount, and the slip has to read like one.
    #[test]
    fn a_line_sold_below_the_provider_total_prints_a_discount_not_a_negative_fee() {
        let mut data = pln_prepaid();
        data.grand_total = 23_000.0;
        let text = text_of(&format_ppob_receipt(&data, 58, PrintMode::Text));

        assert!(text.contains(&two_col_text(
            "Diskon",
            "-Rp 500",
            columns(58, PrintMode::Text)
        )));
        assert!(!text.contains("Biaya Layanan"));
        assert!(text.contains(&two_col_text(
            "Grand Total",
            "Rp 23.000",
            columns(58, PrintMode::Text)
        )));
    }

    /// Numbers inside the provider's block are theirs: they mix `69,163` and
    /// `Rp 69.729,00` between services and we are not the ones to correct it.
    #[test]
    fn provider_numbers_are_printed_exactly_as_sent() {
        assert!(text_of(&format_ppob_receipt(&pdam(), 58, PrintMode::Text))
            .contains("Total Tagihan: 69,163"));
        assert!(
            text_of(&format_ppob_receipt(&pln_postpaid(), 58, PrintMode::Text))
                .contains("RP TAG PLN : Rp 69.729,00")
        );
    }

    /// PDAM pads its labels to nineteen columns for a longest label of thirteen,
    /// which on 58mm paper leaves eleven for the value and splits `Kota
    /// Samarinda` in half. Pulling the column in fixes most lines outright.
    #[test]
    fn a_provider_column_wider_than_its_labels_need_is_pulled_in() {
        let text = text_of(&format_ppob_receipt(&pdam(), 58, PrintMode::Text));

        assert!(text.contains("Nama PDAM    : Kota Samarinda"));
        assert!(text.contains("No. Pelanggan: 1100001"));
        assert!(text.contains("Total Tagihan: 69,163"));
    }

    /// A value that still does not fit goes on its own lines, indented two, not
    /// into a ravine down the right-hand edge of the paper.
    #[test]
    fn a_value_too_long_even_then_moves_to_its_own_lines() {
        let lines = format_ppob_receipt(&pdam(), 58, PrintMode::Text);
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
        let lines = format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Text);
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

    /// The store's name is the only thing on the struk that came from us, just
    /// as Mitra's own slip carries nothing but `CAHAYA513 MM`. It is centred and
    /// bold, which this printer renders double height.
    #[test]
    fn the_store_name_is_all_that_identifies_us() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Text);

        assert_eq!(lines[0].text, center_text("Cahaya513 Mini Mart", 31));
        assert!(lines[0].bold);
        assert_eq!(lines[0].size, LineSize::Normal);

        // None of the furniture a sales receipt carries.
        let text = text_of(&lines);
        for absent in [
            "Telp:",
            "=",
            "Cahaya513 Mini Mart
Cahaya",
        ] {
            assert!(!text.contains(absent), "{} is on the struk", absent);
        }
    }

    /// The provider's table ends at its last `label : value` line; everything
    /// after it is closing prose and belongs under our totals, where Mitra puts
    /// it. The trace stamp is part of that prose.
    #[test]
    fn the_provider_slip_is_split_at_its_last_labelled_line() {
        let (body, footer) = split_body_footer(unfold_provider_text(PLN_PREPAID_TEXT), 31);

        assert_eq!(
            body.last().map(String::as_str),
            Some("ADMIN BANK      : Rp 3.500")
        );
        assert!(body.iter().any(|line| line.contains("STRUK PEMBELIAN")));
        assert!(body.iter().all(|line| !line.contains("Informasi Hubungi")));

        assert!(footer[0].starts_with("Informasi Hubungi"));
        assert!(footer.iter().any(|line| line.contains("[I001IGR1-")));
        assert!(footer.iter().all(|line| !line.trim().is_empty()));
    }

    /// Telkom Indihome closes its slip with three unlabelled lines of bill
    /// detail, straight after `Nama Pelanggan` with no blank line between. They
    /// are figures, not a sign-off, and they belong above the totals with the
    /// rest of the table.
    #[test]
    fn bill_detail_that_follows_no_blank_line_stays_above_the_totals() {
        let rows: Vec<String> = format_ppob_receipt(&payment_point(), 58, PrintMode::Text)
            .iter()
            .map(|line| line.text.clone())
            .collect();

        let rule = rows
            .iter()
            .position(|row| *row == "-".repeat(31))
            .expect("totals rule");

        for detail in ["--Detail Tagihan 1--", "Periode 09-2026", "Nilai   316350"] {
            let at = rows
                .iter()
                .position(|row| row == detail)
                .unwrap_or_else(|| panic!("{} printed", detail));
            assert!(at < rule, "{} fell below the totals", detail);
        }

        // And nothing was left over to print under them.
        assert_eq!(rows.len(), rule + 4);
    }

    /// A slip with no key/value line at all — payment point writes `Nilai
    /// 316350` — is all table and has no closing prose to move.
    #[test]
    fn a_slip_with_no_labelled_line_is_all_body() {
        let (body, footer) = split_body_footer(
            vec![
                "--Detail Tagihan 1--".to_string(),
                "Nilai   316350".to_string(),
            ],
            31,
        );

        assert_eq!(body.len(), 2);
        assert!(footer.is_empty());
    }

    /// The whole struk, in order, for the transaction the customer is most
    /// likely to bring back to a counter.
    #[test]
    fn a_pln_prepaid_struk_reads_in_the_mitra_order() {
        let lines = format_ppob_receipt(&pln_prepaid(), 58, PrintMode::Text);
        let rows: Vec<&str> = lines.iter().map(|line| line.text.trim_end()).collect();

        assert_eq!(rows[0].trim(), "Cahaya513 Mini Mart");
        assert_eq!(rows[1], "");
        assert_eq!(rows[2].trim(), "Stroom / Token");
        assert_eq!(rows[3].trim(), "1111-2222-3333-");
        assert_eq!(rows[4].trim(), "4444-5555");
        assert_eq!(rows[5], "");
        // The provider's own heading, 32 characters against 31 of paper, so it
        // wraps on its own word boundary rather than off the edge.
        assert_eq!(rows[6], "STRUK PEMBELIAN LISTRIK");
        assert_eq!(rows[7], "PRABAYAR");

        let rule = rows
            .iter()
            .position(|row| *row == "-".repeat(31))
            .expect("totals rule");
        assert_eq!(rows[rule - 1], "ADMIN BANK      : Rp 3.500");
        assert_eq!(rows[rule + 1], two_col_text("Total", "Rp 23.500", 31));
        assert_eq!(
            rows[rule + 2],
            two_col_text("Biaya Layanan", "Rp 1.500", 31)
        );
        assert_eq!(rows[rule + 3], two_col_text("Grand Total", "Rp 25.000", 31));
        assert!(rows[rule + 4].starts_with("Informasi Hubungi"));
        assert!(rows.iter().any(|row| row.contains("[I001IGR1-")));
        assert!(rows.last().expect("last row").ends_with("CA]"));
    }

    /// An item stored before migration 023 has no provider text at all.
    #[test]
    fn without_provider_text_the_captured_fields_are_printed_instead() {
        let mut data = pln_prepaid();
        data.provider_receipt_text = None;
        data.customer_name = Some("BUDI SANTOSA".to_string());
        let text = text_of(&format_ppob_receipt(&data, 58, PrintMode::Text));

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

        // Each field appears once; there is no second block to supplement it.
        assert_eq!(text.matches("NO REF").count(), 1);
        assert_eq!(text.matches("ADMIN BANK").count(), 1);
    }

    #[test]
    fn eighty_millimetre_paper_uses_the_wider_column_count() {
        let lines = format_ppob_receipt(&pln_prepaid(), 80, PrintMode::Text);

        assert!(lines
            .iter()
            .any(|line| line.text == "-".repeat(columns(80, PrintMode::Text))));
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
#[cfg(all(test, windows))]
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
        use crate::printing::escpos::encode_raster;
        use crate::printing::raster::{render_lines, DOTS_58MM};

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
            let lines = format_ppob_receipt(&data, 58, PrintMode::Raster);
            let bitmap = render_lines(&lines, 32, DOTS_58MM).expect("rendered");
            let bytes = encode_raster(&bitmap);

            // `.bin` goes to the printer, `.pbm` is the same dots as a picture
            // for a human, and `.txt` is what was drawn.
            std::fs::write(out.join(format!("{name}.bin")), &bytes).expect("write bytes");
            std::fs::write(out.join(format!("{name}.pbm")), bitmap.to_pbm()).expect("write image");
            std::fs::write(out.join(format!("{name}.txt")), text_of(&lines))
                .expect("write preview");

            println!(
                "{name}: {} lines, {}x{} dots, {} bytes",
                lines.len(),
                bitmap.width,
                bitmap.height,
                bytes.len()
            );
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
            service_type: service_type.to_string(),
            flag_id: None,
            product_name: text("productName"),
            customer_id: text("customerNo"),
            customer_name: None,
            serial_number: text("tokenNumber").or_else(|| text("serialNumber")),
            reference_number: text("noRef"),
            payment_code: text("paymentCode"),
            provider_description: text("igrDesc"),
            provider_receipt_text: text("receiptText"),
            amount: number("basePrice"),
            admin_fee: number("adminFee"),
            total,
            grand_total: total,
        }
    }
}
