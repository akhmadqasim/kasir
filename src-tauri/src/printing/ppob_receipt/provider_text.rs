//! The provider's own slip — `receipt_text` — reflowed for our paper: its
//! continuation lines joined back onto the field they continue, its labels
//! lined up on one colon column, its table split from its closing prose, and
//! every field wrapped to the width we print at.

use crate::printing::layout::{fit_or_wrap, wrap_words};

/// The provider's slip, as they sent it.
///
/// The only tidying: drop the carriage returns, the blank lines they open
/// with, and any run of blanks in the middle. Their wrapping stays theirs — it
/// is already the width of the paper, and re-flowing it would be us deciding we
/// know their document better than they do.
pub(super) fn provider_lines(text: &str) -> Vec<String> {
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

/// The provider's block without its `STROOM/TOKEN : …` line. It runs on the
/// output of [`reflow_provider_lines`], where any continuation rows the token
/// had are already joined onto it, so dropping the one line drops them all.
///
/// `RP STROOM/TOKEN : Rp 18.181,00` is a different label — the rupiah value of
/// the electricity — and stays, as it does on the Mitra print.
pub(super) fn without_token_lines(body: Vec<String>, cpl: usize) -> Vec<String> {
    body.into_iter()
        .filter(|line| !split_pair(line, cpl).is_some_and(|(label, ..)| label == "STROOM/TOKEN"))
        .collect()
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
pub(super) enum LogicalLine {
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

/// A line shaped like `Label : value` — a label of letters, digits, spaces,
/// `/`, `-` and `.`, starting with a letter and no longer than
/// [`MAX_LABEL_CHARS`], then a colon, then at most one space before the
/// value. Deliberately hand-rolled rather than pulled in via a regex crate:
/// the grammar is small enough that a linear scan over one `find(':')` reads
/// as plainly as a pattern would, for one dependency fewer.
///
/// Any case, not just Mitra's upper-case `NO METER`: PDAM's `Nama PDAM :
/// Kota Samarinda` next to `No. Pelanggan      : 1120777`, BPJS's `Nomor VA
/// : …` next to `Periode           : 1 BULAN`, MyRepublic's `Deskripsi :`
/// next to `Merchant/Biller : ` — each provider pads *most* of its labels to
/// one column and leaves a few unpadded, and a struk whose colons wander is
/// the first thing the owner noticed. The length cap is what keeps prose
/// with a colon in it (`Informasi Hubungi Call Center 123 Atau Hub PLN
/// Terdekat :`) from being read as a label with an empty value.
const MAX_LABEL_CHARS: usize = 24;

fn match_label_line(line: &str) -> Option<(&str, &str, usize)> {
    let colon = line.find(':')?;
    let label = line[..colon].trim_end();
    let is_label_char = |c: char| c.is_ascii_alphanumeric() || matches!(c, ' ' | '/' | '-' | '.');
    if label.is_empty()
        || label.chars().count() > MAX_LABEL_CHARS
        || !label.starts_with(|c: char| c.is_ascii_alphabetic())
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
pub(super) fn parse_logical_lines(lines: &[String]) -> Vec<LogicalLine> {
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

/// The fewest columns a value may be left with beside its label before the
/// label column is pulled in. Twelve fits `Rp 308.299,00` and a fourteen-digit
/// reference chunk is what PLN's own column leaves — anything narrower turns
/// `Kota Samarinda` into two lines.
const MIN_VALUE_COLUMNS: usize = 13;

/// The label column every [`LogicalLine::Labelled`] in this block pads to:
/// the widest one the provider actually sent, detected from where its colon
/// landed rather than assumed from label text length (a block's shortest
/// label is not necessarily unpadded). PLN pads every label to that column
/// and this keeps its print byte-identical to Mitra's. PDAM and BPJS pad
/// theirs so wide (19, 18) that on 32-column paper the value would have
/// eleven characters left; there the column is instead the widest label
/// plus one, which is as far in as it can go and still line the colons up.
/// `0` when the block has no labelled line.
pub(super) fn detect_label_width(logical: &[LogicalLine], cpl: usize) -> usize {
    let labelled = logical.iter().filter_map(|line| match line {
        LogicalLine::Labelled { label, column, .. } => Some((label.chars().count(), *column)),
        _ => None,
    });
    let (widest_label, provider_column) = labelled.fold((0, 0), |(l, c), (label, column)| {
        (l.max(label), c.max(column))
    });
    if provider_column == 0 {
        return 0;
    }
    if cpl.saturating_sub(provider_column + 2) >= MIN_VALUE_COLUMNS {
        provider_column
    } else {
        (widest_label + 1).min(provider_column)
    }
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
pub(super) fn reflow_provider_lines(lines: &[String], cpl: usize) -> Vec<String> {
    let logical = parse_logical_lines(lines);
    let label_width = detect_label_width(&logical, cpl);
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
pub(super) fn wrap_joined_line(line: &str, cpl: usize) -> Vec<String> {
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

    // One unbroken number that misses the value column by a little — BPJS's
    // sixteen-digit VA beside a fifteen-wide column — is worth more whole
    // than aligned: it goes on its own line under the label, indented two,
    // rather than as `888880227041324` and a lone `7`. The colon stays in
    // its column; only the value moves down.
    let is_one_token = !value.contains(char::is_whitespace);
    if is_one_token && 2 + value.chars().count() <= cpl {
        return vec![format!("{label:<width$}:"), format!("  {value}")];
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

    fit_or_wrap(text, cpl)
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

/// Split the provider's slip where its table of figures ends.
///
/// Everything up to and including the last `label : value` line is the body,
/// which belongs above our totals; whatever follows is the closing prose — the
/// call-centre line, the app's own advertisement, the trace stamp — which
/// belongs below them, exactly where Mitra puts it. A slip with no key/value
/// line at all is all body and no footer.
pub(super) fn split_body_footer(block: Vec<String>, cpl: usize) -> (Vec<String>, Vec<String>) {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A slip with no key/value line at all — payment point writes `Nilai
    /// 316350` — is all table and has no closing prose to move.
    #[test]
    fn a_slip_with_no_labelled_line_is_all_body() {
        let (body, footer) = split_body_footer(
            vec![
                "--Detail Tagihan 1--".to_string(),
                "Nilai   316350".to_string(),
            ],
            32,
        );

        assert_eq!(body.len(), 2);
        assert!(footer.is_empty());
    }

    /// Only the `STROOM/TOKEN` pair and the rows continuing it leave the body:
    /// the re-flow joins the continuation onto the pair, which then goes as one.
    #[test]
    fn without_token_lines_drops_the_pair_and_its_continuation_only() {
        let block = vec![
            "RP STROOM/TOKEN : Rp 18.181,00".to_string(),
            "STROOM/TOKEN    : 1111 2222 3333".to_string(),
            "                   4444 5555".to_string(),
            "ADMIN BANK      : Rp 3.500".to_string(),
        ];

        assert_eq!(
            without_token_lines(reflow_provider_lines(&block, 32), 32),
            vec![
                "RP STROOM/TOKEN : Rp 18.181,00",
                "ADMIN BANK      : Rp 3.500"
            ]
        );
    }

    #[test]
    fn a_blank_or_empty_provider_text_yields_no_lines() {
        assert!(provider_lines("").is_empty());
        assert!(provider_lines("\r\n\r\n   \r\n").is_empty());
    }

    // -----------------------------------------------------------------------
    // The re-flow helpers, in isolation: parsing the provider's own line
    // breaks back into one logical field, and laying each one out again for
    // our own paper. See `reflow_provider_lines`'s doc for why the two steps
    // are split (join first, `split_body_footer`/`without_token_lines` run
    // unchanged, only then wrap for the paper).
    // -----------------------------------------------------------------------

    #[test]
    fn match_label_line_accepts_the_mitra_shapes() {
        assert_eq!(
            match_label_line("NO REF          : 11002500AAA1A1"),
            Some(("NO REF", "11002500AAA1A1", 16))
        );
        assert_eq!(
            match_label_line("RP STROOM/TOKEN : Rp 18.181,00"),
            Some(("RP STROOM/TOKEN", "Rp 18.181,00", 16))
        );
        assert_eq!(
            match_label_line("PBJT-TL         : Rp 1.819,00"),
            Some(("PBJT-TL", "Rp 1.819,00", 16))
        );
        assert_eq!(
            match_label_line("BL/TH          : SEP26"),
            Some(("BL/TH", "SEP26", 15))
        );
        // A label with no space before its colon at all - the label class
        // allows it even though none of this module's ALL-CAPS fixtures do it.
        assert_eq!(match_label_line("TOTAL:100"), Some(("TOTAL", "100", 5)));
    }

    #[test]
    fn match_label_line_only_eats_one_space_after_the_colon() {
        // The provider's own `\s?` -- at most one space consumed after the
        // colon, so a second one (never seen in a real fixture, but nothing
        // stops one) stays part of the value rather than being trimmed away.
        assert_eq!(match_label_line("NAMA :  BUDI"), Some(("NAMA", " BUDI", 5)));
    }

    #[test]
    fn match_label_line_accepts_any_case_but_rejects_prose_and_bracketed_lines() {
        // PDAM/BPJS/payment point's own Title-case keys join the column: each
        // provider pads most labels and leaves a few unpadded, and the owner's
        // first complaint was colons that wander -- see `match_label_line`'s doc.
        assert_eq!(
            match_label_line("Nama PDAM          : Kota Samarinda"),
            Some(("Nama PDAM", "Kota Samarinda", 19))
        );
        assert_eq!(
            match_label_line("Nama Peserta      : AHMAD FAUZI NUGROHO"),
            Some(("Nama Peserta", "AHMAD FAUZI NUGROHO", 18))
        );
        // A footer sentence that happens to end in a colon is far longer than any
        // label; the length cap keeps it prose.
        assert_eq!(
            match_label_line("Informasi Hubungi Call Center 123 Atau Hub PLN Terdekat :"),
            None
        );
        // The trace stamp's first colon sits inside a timestamp, not after a
        // label -- `[` as the first character rules it out before the colon
        // position is even considered.
        assert_eq!(
            match_label_line("[I001IGR1-(10/09/2026 12:45:39)-CA]"),
            None
        );
        // The pipe-delimited footer: upper-case `MKM` alone would pass, but the
        // `|` and the lower-case prose after it do not.
        let mkm_line =
            "MKM|\"Informasi Hubungi Call Center 123 Atau Hub PLN Terdekat :\"|Download PLN Mobile";
        assert_eq!(match_label_line(mkm_line), None);
        // No colon at all.
        assert_eq!(match_label_line("Nilai   316350"), None);
    }

    #[test]
    fn parse_logical_lines_joins_continuations_with_no_separator() {
        let lines = vec![
            "NAMA            : BUDI SANTOSA W".to_string(),
            "                  IJAYA".to_string(),
        ];
        let logical = parse_logical_lines(&lines);

        assert_eq!(logical.len(), 1);
        match &logical[0] {
            LogicalLine::Labelled {
                label,
                value,
                column,
            } => {
                assert_eq!(label, "NAMA");
                assert_eq!(value, "BUDI SANTOSA WIJAYA");
                assert_eq!(*column, 16);
            }
            _ => panic!("expected a labelled line"),
        }
    }

    #[test]
    fn parse_logical_lines_joins_three_continuations_in_a_row() {
        let lines = vec![
            "NO REF         : 11002500AAA1A11".to_string(),
            "                  11AA111111A1AA1".to_string(),
            "                  11".to_string(),
        ];
        let logical = parse_logical_lines(&lines);

        assert_eq!(logical.len(), 1);
        match &logical[0] {
            LogicalLine::Labelled { value, .. } => {
                assert_eq!(value, "11002500AAA1A1111AA111111A1AA111");
            }
            _ => panic!("expected a labelled line"),
        }
    }

    #[test]
    fn parse_logical_lines_joins_unlabelled_continuations_too() {
        let lines = vec![
            "Informasi Hubungi Call Center 12".to_string(),
            "                  3 Atau hubungi PLN TerdekatDownl".to_string(),
            "                  oad PLN Mobile".to_string(),
        ];
        let logical = parse_logical_lines(&lines);

        assert_eq!(logical.len(), 1);
        match &logical[0] {
            LogicalLine::Text(text) => assert_eq!(
                text,
                "Informasi Hubungi Call Center 123 Atau hubungi PLN TerdekatDownload PLN Mobile"
            ),
            _ => panic!("expected a text line"),
        }
    }

    /// A continuation-shaped line with nothing above it to continue -- the block
    /// opens mid-wrap, or the line above it was blank -- is not dropped; it
    /// starts a logical line of its own instead.
    #[test]
    fn parse_logical_lines_keeps_a_continuation_with_no_line_to_join() {
        let lines = vec!["                  orphaned".to_string()];
        let logical = parse_logical_lines(&lines);

        assert_eq!(logical.len(), 1);
        match &logical[0] {
            LogicalLine::Text(text) => assert_eq!(text, "orphaned"),
            _ => panic!("expected a text line"),
        }
    }

    #[test]
    fn parse_logical_lines_keeps_blanks_as_their_own_entries() {
        let lines = vec![
            "IDPEL          : 231000000002".to_string(),
            String::new(),
            "NAMA           : PT.CONTOH SEJA H".to_string(),
        ];
        let logical = parse_logical_lines(&lines);

        assert_eq!(logical.len(), 3);
        assert!(matches!(logical[1], LogicalLine::Blank));
    }

    #[test]
    fn detect_label_width_is_zero_with_no_labelled_lines() {
        let logical = parse_logical_lines(&provider_lines(
            "Periode 09-2026
Nilai   255300
",
        ));
        assert_eq!(detect_label_width(&logical, 32), 0);
    }

    #[test]
    fn wrap_text_line_leaves_a_fitting_line_untouched() {
        // Three internal spaces, preserved: word-wrapping this would collapse
        // them to one, and it already fits -- so it never goes near a wrap.
        assert_eq!(wrap_text_line("Nilai   316350", 32), vec!["Nilai   316350"]);
    }

    #[test]
    fn wrap_text_line_word_wraps_a_line_that_does_not_fit() {
        assert_eq!(
            wrap_text_line("Nama Peserta      : AHMAD FAUZI NUGROHO", 32),
            vec!["Nama Peserta : AHMAD FAUZI", "NUGROHO"]
        );
    }

    #[test]
    fn wrap_text_line_splits_the_mkm_shape_regardless_of_length() {
        // Short enough to fit on one line unsplit, but the pipe format is a
        // delimiter, not prose, so it still comes apart into its parts.
        assert_eq!(
            wrap_text_line("MKM|\"a\"|b", 32),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn wrap_labelled_line_fits_on_one_line_when_it_can() {
        assert_eq!(
            wrap_labelled_line("IDPEL", "231000000002", 15, 32),
            vec!["IDPEL          : 231000000002"]
        );
    }

    #[test]
    fn wrap_labelled_line_word_wraps_a_value_with_spaces() {
        assert_eq!(
            wrap_labelled_line("NAMA", "BUDI SANTOSA WIJAYA", 16, 32),
            vec!["NAMA            : BUDI SANTOSA", "                  WIJAYA"]
        );
    }

    #[test]
    fn wrap_labelled_line_character_chunks_a_spaceless_value() {
        assert_eq!(
            wrap_labelled_line("NO REF", "11002500AAA1A1111AA111AA1111AA11", 16, 32),
            vec![
                "NO REF          : 11002500AAA1A1",
                "                  111AA111AA1111",
                "                  AA11",
            ]
        );
    }
}
