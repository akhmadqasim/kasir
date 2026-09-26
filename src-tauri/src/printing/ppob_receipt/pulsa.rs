//! Pulsa and paket data: Mitra's own "Cetak Struk" layout, for the two
//! services whose provider never sends a slip of its own. See the module doc
//! of [`super`] for why they are the exception.

use super::{meaningful, non_empty, push_store_name, PpobReceiptData};
use crate::printing::layout::{format_rupiah, two_col_text, wrap_words};
use crate::printing::receipt::ReceiptTextLine;

impl PpobReceiptData {
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

/// Render a pulsa or data struk the way Mitra's own app prints it from its
/// "Cetak Struk" screen — the layout the parent module doc explains, minus the
/// "MITRA INDOGROSIR" line and the "Struk ini merupakan bukti pembayaran
/// yang sah" footer, which the shop asked to leave off.
///
/// Only reached when there is no `provider_receipt_text` to print verbatim
/// instead; see [`super::format_ppob_receipt`].
pub(super) fn format_pulsa_receipt(data: &PpobReceiptData, cpl: usize) -> Vec<ReceiptTextLine> {
    let mut lines = Vec::new();

    push_store_name(&mut lines, &data.store_name, cpl);
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
