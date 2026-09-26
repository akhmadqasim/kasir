//! Column arithmetic shared by every receipt formatter: how many characters a
//! paper width holds, and how text is padded, centred and wrapped to fit it.
//!
//! Everything here counts characters, not bytes, and assumes a monospace face —
//! which both the printer's Font A and the raster renderer are.

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

/// `text` as it is when it fits in `width`, word-wrapped when it does not.
///
/// A line that fits keeps its own spacing — a provider's padded `Total      :`
/// or an admin's footer — where running it through [`wrap_words`] would
/// collapse every run of spaces to one.
pub(super) fn fit_or_wrap(text: &str, width: usize) -> Vec<String> {
    if text.chars().count() <= width {
        return vec![text.to_string()];
    }
    wrap_words(text, width)
}

/// `text` centred, over as many rows as it needs.
///
/// [`center_text`] alone hands a line longer than the paper back unpadded and
/// too wide, which the printer's text engine then cuts mid-word and the raster
/// renderer draws off the edge of the paper. A long store address or footer
/// line is wrapped first here, and each row centred.
pub(super) fn center_wrapped(text: &str, width: usize) -> Vec<String> {
    fit_or_wrap(text, width)
        .iter()
        .map(|row| center_text(row, width))
        .collect()
}

/// Greedy word wrap. A word longer than `width` is chopped — there is nothing
/// cleverer to do on 32 columns, and dropping characters would be worse.
pub(super) fn wrap_words(text: &str, width: usize) -> Vec<String> {
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

    /// A line that fits is centred exactly as `center_text` would; one that
    /// does not is wrapped by word and every row is centred on its own.
    #[test]
    fn center_wrapped_wraps_only_what_does_not_fit() {
        assert_eq!(
            center_wrapped("Toko Sembako", 32),
            vec![center_text("Toko Sembako", 32)]
        );

        let rows = center_wrapped(
            "Jl. Pangeran Suryanata No. 12 RT 05 Kel. Air Putih Samarinda",
            32,
        );
        assert!(rows.len() > 1, "{rows:?}");
        assert!(rows.iter().all(|row| row.chars().count() <= 32), "{rows:?}");
        assert_eq!(rows[0].trim(), "Jl. Pangeran Suryanata No. 12 RT");
    }

    #[test]
    fn fit_or_wrap_keeps_the_spacing_of_a_line_that_fits() {
        assert_eq!(fit_or_wrap("Nilai   316350", 32), vec!["Nilai   316350"]);
        assert_eq!(fit_or_wrap("satu dua tiga", 8), vec!["satu dua", "tiga"]);
    }
}
