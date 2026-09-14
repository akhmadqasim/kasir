//! Fixtures and tests for the PPOB struk formatter.

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

/// A real captured PLN postpaid payload — the one that exposed the bug.
/// `NO REF`'s own second continuation line, `                  86AA65FBE282718`,
/// is 33 characters: eighteen of the provider's own continuation indent
/// (one more than this block's 17-wide head needs) plus fifteen reference
/// digits, one column over the 32-column paper. The old verbatim printer
/// hard-wrapped every provider line at 32 regardless of what it was, so this
/// one line split into a 32-character row and a lone trailing `8` — see
/// `a_pln_postpaid_struk_has_no_stray_single_character_lines` below, which
/// is the fixture [`PLN_POSTPAID_TEXT`] above never triggered.
const PLN_POSTPAID_REAL_TEXT: &str = "\r\n\r\nSTRUK PEMBAYARAN TAGIHAN LISTRIK\r\n\r\nIDPEL          : 231001286317\r\nNAMA           : RIZAL GAZULI HU\r\n                  DARI\r\nTARIF/DAYA     : R1/000001300VA\r\nSTAND METER    : 41298-41492\r\nBL/TH          : SEP26\r\nRP TAG PLN     : Rp 308.299,00\r\nNO REF         : 22002500CLH2HC4\r\n                  86AA65FBE282718\r\n                  A6\r\n\r\nADMIN BANK     : Rp 3.500,00\r\nTOTAL BAYAR    : Rp 311.799,00\r\n\r\nMKM|\"Informasi Hubungi Call Center 123 Atau Hub PLN Terdekat :\"|Download PLN Mobile\r\n[I001IGR1-(13/09/2026 15:33:08)-\r\n                  CA]";

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
        date: None,
        time: None,
        mitra_invoice_number: None,
        our_receipt_number: None,
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

fn pln_postpaid_real() -> PpobReceiptData {
    PpobReceiptData {
        flag_id: Some("1".to_string()),
        customer_id: Some("231001286317".to_string()),
        serial_number: Some(String::new()),
        reference_number: Some("13516346".to_string()),
        payment_code: Some("L231001286317-2-260913153308".to_string()),
        provider_description: Some("Post paid".to_string()),
        provider_receipt_text: Some(PLN_POSTPAID_REAL_TEXT.to_string()),
        amount: 308_299.0,
        admin_fee: 3_500.0,
        total: 311_799.0,
        grand_total: 313_000.0,
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

/// The fixture behind the dedicated pulsa test below: the numbers from a
/// screenshot of Mitra's own "Cetak Struk" screen for a Telkomsel top-up, with
/// `product_name` in the shape checkout actually produces (see
/// `pulsa_description` in the parent module).
fn pulsa() -> PpobReceiptData {
    PpobReceiptData {
        service_type: "pulsa".to_string(),
        product_name: Some("Pulsa TELKOMSEL - TELKOMSEL 20.000,- Masa Aktif 30 Hari".to_string()),
        customer_id: Some("081348172197".to_string()),
        // Mitra's own placeholder for "no token" on pulsa/data.
        serial_number: Some("-".to_string()),
        reference_number: Some("04103400001446365784".to_string()),
        payment_code: Some("P081348172197-861-260327091340".to_string()),
        amount: 20000.0,
        admin_fee: 0.0,
        total: 20000.0,
        // What the customer paid — Mitra folds the outlet's markup in here,
        // with no separate service-fee line the way other services get one.
        grand_total: 20070.0,
        date: Some("27-03-2026".to_string()),
        time: Some("09:13 WIB".to_string()),
        mitra_invoice_number: Some("50151852".to_string()),
        our_receipt_number: None,
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
        pln_postpaid_real(),
        pdam(),
        bpjs(),
        payment_point(),
        pulsa(),
    ]
}

#[test]
fn every_line_of_every_service_fits_the_paper() {
    for data in all_fixtures() {
        for paper in [58_u8, 80] {
            let cpl = columns(paper);
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

/// The provider's own words go on the paper unchanged — the name, the
/// reference, the closing prose are exactly the text they sent — but their
/// own line breaks are not: `BUDI SANTOSA W` / `IJAYA` is one field cut
/// mid-word to fit *their* column count, and re-joined it wraps at the word
/// boundary on ours instead (`BUDI SANTOSA` / `WIJAYA`), the same fix that
/// stops PLN postpaid dropping a stray one-character line (see
/// `a_pln_postpaid_struk_has_no_stray_single_character_lines`).
///
/// `NO REF`'s value has no spaces in it at all — it is one long reference
/// code, not a name — so there is no word boundary to prefer and it still
/// gets cut every fourteen columns (`32` of paper less `18` for the label),
/// which for this fixture happens to land on the exact same characters the
/// provider's own (18-space-indented) wrap already used.
#[test]
fn the_providers_slip_is_reflowed_at_word_boundaries() {
    let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58));

    assert!(text.contains("NAMA            : BUDI SANTOSA\n                  WIJAYA"));
    assert!(text.contains("NO REF          : 11002500AAA1A1\n                  111AA111AA1111\n                  AA11"));
    // The provider's own hard mid-word cut, `3 Atau hubungi PLN TerdekatDownl`
    // / `oad PLN Mobile`, is gone; re-joined and word-wrapped for our 32
    // columns it reads as prose instead, `TerdekatDownload` kept as the one
    // token the provider actually sent (no space invented inside it).
    assert!(text.contains(
        "Informasi Hubungi Call Center\n123 Atau hubungi PLN\nTerdekatDownload PLN Mobile"
    ));
    assert!(
        !text.contains("TerdekatDownl\n"),
        "no more mid-word hard cut"
    );
    assert!(text.contains("STRUK PEMBELIAN LISTRIK PRABAYAR"));
}

/// Numbers inside the provider's block are theirs: they mix `69,163` and
/// `Rp 69.729,00` between services and we are not the ones to correct it.
/// Nor is their label column where the paper has room for it: PDAM's
/// nineteen stays nineteen on 80 mm; on 58 mm it is pulled in to the widest
/// label (see `detect_label_width`), the colons still in one column.
#[test]
fn provider_numbers_and_columns_are_printed_exactly_as_sent() {
    assert!(text_of(&format_ppob_receipt(&pdam(), 80)).contains("Total Tagihan      : 69,163"));
    assert!(text_of(&format_ppob_receipt(&pdam(), 58)).contains("Total Tagihan : 69,163"));
    assert!(text_of(&format_ppob_receipt(&pln_postpaid(), 58))
        .contains("RP TAG PLN     : Rp 69.729,00"));
}

/// The whole struk, in order, for the transaction the customer is most
/// likely to bring back to a counter — the order of the Mitra app's own
/// print job, as captured off the phone.
#[test]
fn a_pln_prepaid_struk_reads_in_the_mitra_order() {
    let lines = format_ppob_receipt(&pln_prepaid(), 58);
    let rows: Vec<&str> = lines.iter().map(|line| line.text.trim_end()).collect();

    assert_eq!(rows[0], center_text("Cahaya513 Mini Mart", 32).trim_end());
    assert_eq!(rows[1], "");
    assert_eq!(rows[2], center_text("Stroom/Token", 32).trim_end());
    assert_eq!(rows[3], "");
    assert_eq!(rows[4].trim(), "1111-2222-3333");
    assert_eq!(rows[5].trim(), "4444-5555");
    assert_eq!(rows[6], "");
    assert_eq!(rows[7], "STRUK PEMBELIAN LISTRIK PRABAYAR");
    assert_eq!(rows[8], "");
    assert_eq!(rows[9], "NO METER        : 14300000001");

    let rule = rows
        .iter()
        .position(|row| *row == "-".repeat(32))
        .expect("totals rule");
    assert_eq!(rows[rule - 2], "JML KWH         : 12,6");
    assert_eq!(rows[rule - 1], "ADMIN BANK      : Rp 3.500");
    assert_eq!(rows[rule + 1], "Total             Rp 23.500");
    assert_eq!(rows[rule + 2], "Biaya Layanan     Rp 1.500");
    assert_eq!(rows[rule + 3], "Grand Total       Rp 25.000");
    assert_eq!(rows[rule + 4], "", "one line of air before the prose");
    // Re-joined and word-wrapped for our own 32 columns, not the provider's
    // mid-word `Informasi Hubungi Call Center 12` / `3 Atau hubungi PLN
    // TerdekatDownl` / `oad PLN Mobile` cut.
    assert_eq!(rows[rule + 5], "Informasi Hubungi Call Center");
    assert_eq!(rows[rule + 6], "123 Atau hubungi PLN");
    assert_eq!(rows[rule + 7], "TerdekatDownload PLN Mobile");
    assert!(rows.iter().any(|row| row.contains("[I001IGR1-")));
    assert!(rows.last().expect("last row").ends_with("CA]"));
}

/// The token is on the paper once, in double-size characters. The
/// provider's own `STROOM/TOKEN : …` line and its continuation come out of
/// the body, as they do on the Mitra print; `RP STROOM/TOKEN`, a different
/// label, stays.
#[test]
fn the_providers_token_lines_make_way_for_the_double_size_block() {
    let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58));

    assert!(!text.contains("STROOM/TOKEN    :"));
    assert!(!text.contains("4444 5555"));
    assert!(text.contains("RP STROOM/TOKEN : Rp 18.181,00"));
    assert_eq!(text.matches("4444-5555").count(), 1);
}

/// PLN's own text opens with its heading, and it prints as the provider
/// wrote it — once, in the body, at body weight.
#[test]
fn the_providers_own_heading_prints_once_and_unchanged() {
    let lines = format_ppob_receipt(&pln_prepaid(), 58);

    assert_eq!(
        text_of(&lines)
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
        let text = text_of(&format_ppob_receipt(&data, 58));
        assert!(
            !text.contains("STRUK"),
            "{} got a heading we wrote: {}",
            data.service_type,
            text
        );
    }
}

/// Blank lines go only where the Mitra layout puts them: under the store
/// name, either side of the token label, under the token, before the
/// prose. The provider's own spacing inside its table survives; nothing
/// ever prints two blanks in a row.
#[test]
fn blank_lines_are_spent_only_where_the_layout_asks_for_them() {
    let lines = format_ppob_receipt(&pln_prepaid(), 58);
    let rows: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();

    assert!(rows[1].trim().is_empty(), "blank under the store name");
    assert!(
        !rows
            .windows(2)
            .any(|pair| pair[0].trim().is_empty() && pair[1].trim().is_empty()),
        "no two blanks in a row"
    );

    // A service with no token spends no blank on one: PDAM's body starts
    // immediately under the store name.
    let water = format_ppob_receipt(&pdam(), 58);
    assert!(
        !water[2].text.trim().is_empty(),
        "no token, no blank for it"
    );
    // Its three blanks are the one under the store name and the two the
    // provider left between the sections of its own table.
    assert_eq!(water.iter().filter(|line| line.text.is_empty()).count(), 3);
}

#[test]
fn the_token_is_normalised_from_space_groups_and_printed_double_size() {
    let lines = format_ppob_receipt(&pln_prepaid(), 58);
    let token_rows: Vec<&str> = lines
        .iter()
        .filter(|line| line.size == LineSize::Double)
        .map(|line| line.text.trim())
        .collect();

    assert_eq!(token_rows, vec!["1111-2222-3333", "4444-5555"]);
    assert!(text_of(&lines).contains("Stroom/Token"));
}

/// Postpaid PLN sends `""`, PDAM `"-"` and payment point `"0"`. All three
/// mean the same thing and none of them belongs on paper.
#[test]
fn the_placeholders_mitra_uses_for_no_token_print_nothing() {
    // Pulsa is here for the other half of it: a real serial, but not PLN, so
    // still no token block.
    for data in [pln_postpaid(), pdam(), payment_point(), pulsa()] {
        let lines = format_ppob_receipt(&data, 58);
        assert!(
            !text_of(&lines).contains("Stroom/Token"),
            "{}",
            data.service_type
        );
        assert!(lines.iter().all(|line| line.size == LineSize::Normal));
    }
}

/// What BPJS returns as a serial is the payer's own mobile number, and the
/// struk has no serial block for it to go in. Nothing of the sort reaches
/// the paper.
#[test]
fn the_payers_phone_number_never_reaches_the_paper() {
    assert!(!text_of(&format_ppob_receipt(&bpjs(), 58)).contains("08120000001"));
}

/// PLN's postpaid footer is one 84-character line, but the `MKM|"…"|…`
/// shape is not prose to word-wrap as one run — it is the provider's own
/// pipe-delimited list. `MKM` and the pipes are dropped, the quotes around
/// the first part come off, and what is left is word-wrapped as two
/// separate paragraphs, not cut wherever column 32 happens to fall (which
/// used to split `Call Cent` / `er 123` mid-word).
#[test]
fn a_pipe_delimited_footer_line_is_split_into_its_own_parts() {
    let lines = format_ppob_receipt(&pln_postpaid(), 58);
    let rows: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();

    assert!(
        !rows.iter().any(|row| row.starts_with("MKM|")),
        "the MKM| delimiter is not itself printed"
    );
    let start = rows
        .iter()
        .position(|row| *row == "Informasi Hubungi Call Center")
        .expect("first MKM part printed, quotes stripped");
    assert_eq!(rows[start + 1], "123 Atau Hub PLN Terdekat :");
    assert_eq!(rows[start + 2], "Download PLN Mobile");
}

/// A doubtful one, pinned down rather than left to accident: `PLN_POSTPAID_TEXT`
/// (an anonymised fixture, not a captured payload — see this file's own top
/// comment) cuts `NAMA` as `PT.CONTOH SEJA H` / `TERA`. Joined with no
/// separator, per the rule this module follows unconditionally, that reads
/// `PT.CONTOH SEJA HTERA` — a stray space before `HTERA` that a real name
/// (`…SEJAHTERA`, one word) would not have. The space was already in the
/// fixture's own first line before this change (`fit_verbatim` printed it as
/// `SEJA H` / `TERA` too, just on the provider's own line break rather than
/// ours), so this is the fixture's own anonymisation being slightly
/// inconsistent, not a join this module should special-case — the rule has
/// no way to tell "a stray space to close up" apart from "a real space to
/// keep" without guessing at what the provider's original text was.
#[test]
fn a_stray_space_already_in_the_fixture_survives_the_join_unchanged() {
    let text = text_of(&format_ppob_receipt(&pln_postpaid(), 58));
    assert!(text.contains("NAMA           : PT.CONTOH SEJA\n                 HTERA"));
}

/// The bug this whole re-flow exists to fix: PLN postpaid pads its label
/// column to 15, its continuation lines are indented 18 — three columns more
/// than the label column plus `": "` needs (17) — so hard-wrapping the
/// provider's own already-wrapped text at 32 columns left a lone `8` on its
/// own line for `NO REF`. Re-joining the field and re-wrapping it for our
/// own label column removes the seam entirely; there is no longer a
/// "provider's column" for our column count to disagree with.
#[test]
fn a_pln_postpaid_struk_has_no_stray_single_character_lines() {
    let lines = format_ppob_receipt(&pln_postpaid_real(), 58);
    let rows: Vec<String> = lines.iter().map(|line| line.text.clone()).collect();

    for row in &rows {
        assert_ne!(
            row.trim().chars().count(),
            1,
            "stray single-character line: {row:?}"
        );
    }

    assert_eq!(
        rows,
        vec![
            center_text("Cahaya513 Mini Mart", 32),
            String::new(),
            "STRUK PEMBAYARAN TAGIHAN LISTRIK".to_string(),
            String::new(),
            "IDPEL          : 231001286317".to_string(),
            "NAMA           : RIZAL GAZULI".to_string(),
            "                 HUDARI".to_string(),
            "TARIF/DAYA     : R1/000001300VA".to_string(),
            "STAND METER    : 41298-41492".to_string(),
            "BL/TH          : SEP26".to_string(),
            "RP TAG PLN     : Rp 308.299,00".to_string(),
            "NO REF         : 22002500CLH2HC4".to_string(),
            "                 86AA65FBE282718".to_string(),
            "                 A6".to_string(),
            String::new(),
            "ADMIN BANK     : Rp 3.500,00".to_string(),
            "TOTAL BAYAR    : Rp 311.799,00".to_string(),
            "-".repeat(32),
            "Total             Rp 311.799".to_string(),
            "Biaya Layanan     Rp 1.201".to_string(),
            "Grand Total       Rp 313.000".to_string(),
            String::new(),
            "Informasi Hubungi Call Center".to_string(),
            "123 Atau Hub PLN Terdekat :".to_string(),
            "Download PLN Mobile".to_string(),
            "[I001IGR1-(13/09/2026".to_string(),
            "15:33:08)-CA]".to_string(),
        ]
    );
}

/// 80mm has room for `NAMA`'s value and the trailing trace stamp to fit on
/// one line each — only `NO REF`, 32 characters of reference code against
/// 25 columns of room after a 17-wide head, does not fit beside its label;
/// being one unbroken number it drops under the label whole.
#[test]
fn a_pln_postpaid_struk_at_eighty_millimetres_needs_less_wrapping() {
    let cpl = columns(80);
    let text = text_of(&format_ppob_receipt(&pln_postpaid_real(), 80));

    assert!(text.contains("NAMA           : RIZAL GAZULI HUDARI"));
    assert!(text.contains("[I001IGR1-(13/09/2026 15:33:08)-CA]"));
    assert!(
        text.contains("NO REF         :\n  22002500CLH2HC486AA65FBE282718A6\n"),
        "{text}"
    );
    assert!(text.contains(
        "Informasi Hubungi Call Center 123 Atau Hub\nPLN Terdekat :\nDownload PLN Mobile"
    ));

    for line in format_ppob_receipt(&pln_postpaid_real(), 80) {
        assert!(line.text.chars().count() <= cpl);
    }
}

/// `amount` from the provider already includes the admin fee — 23.500 is
/// 20.000 of electricity plus a 3.500 bank charge — so the struk's Total is
/// that figure, not that figure plus the fee a second time. The figures sit
/// after an eighteen-column label, where the Mitra print puts them.
#[test]
fn the_totals_block_matches_what_the_provider_billed() {
    let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58));

    assert!(text.contains("Total             Rp 23.500\n"));
    assert!(text.contains("Biaya Layanan     Rp 1.500\n"));
    assert!(text.contains("Grand Total       Rp 25.000\n"));
}

/// A cart-wide discount is shared out over every line, PPOB included, so the
/// shop can end up having sold the line below what the provider charged.
/// That is a discount, and the slip has to read like one.
#[test]
fn a_line_sold_below_the_provider_total_prints_a_discount_not_a_negative_fee() {
    let mut data = pln_prepaid();
    data.grand_total = 23_000.0;
    let text = text_of(&format_ppob_receipt(&data, 58));

    assert!(text.contains("Diskon            -Rp 500\n"));
    assert!(!text.contains("Biaya Layanan"));
    assert!(text.contains("Grand Total       Rp 23.000\n"));
}

/// The store's name is the only thing on the struk that came from us, just
/// as Mitra's own slip carries nothing but `CAHAYA513 MM`: centred, plain,
/// single size.
#[test]
fn the_store_name_is_all_that_identifies_us() {
    let lines = format_ppob_receipt(&pln_prepaid(), 58);

    assert_eq!(lines[0].text, center_text("Cahaya513 Mini Mart", 32));
    assert!(!lines[0].bold);
    assert_eq!(lines[0].size, LineSize::Normal);

    // None of the furniture a sales receipt carries — the '=' rules are the
    // one exception, and only for pulsa/data: they are part of Mitra's own
    // layout for those two services, not ours, so pulsa/data is left out of
    // this check on purpose (see `a_pulsa_struk_matches_the_mitra_app_line_by_line`
    // for what it prints instead).
    for data in [
        pln_prepaid(),
        pln_postpaid(),
        pdam(),
        bpjs(),
        payment_point(),
    ] {
        let text = text_of(&format_ppob_receipt(&data, 58));
        for absent in [
            "Telp:",
            "=",
            "Cahaya513 Mini Mart
Cahaya",
        ] {
            assert!(
                !text.contains(absent),
                "{} is on the {} struk",
                absent,
                data.service_type
            );
        }
    }
}

/// The provider's table ends at its last `label : value` line; everything
/// after it is closing prose and belongs under our totals, where Mitra puts
/// it. The trace stamp is part of that prose.
#[test]
fn the_provider_slip_is_split_at_its_last_labelled_line() {
    let (body, footer) = split_body_footer(provider_lines(PLN_PREPAID_TEXT), 32);

    assert_eq!(
        body.last().map(String::as_str),
        Some("ADMIN BANK      : Rp 3.500")
    );
    assert!(body.iter().any(|line| line.contains("STRUK PEMBELIAN")));
    assert!(body.iter().all(|line| !line.contains("Informasi Hubungi")));

    assert!(footer[0].starts_with("Informasi Hubungi"));
    assert!(footer.iter().any(|line| line.contains("[I001IGR1-")));
    // Paragraph breaks survive; the edges do not.
    assert!(footer.iter().any(|line| line.trim().is_empty()));
    assert!(!footer.first().unwrap().trim().is_empty());
    assert!(!footer.last().unwrap().trim().is_empty());
}

/// Telkom Indihome closes its slip with three unlabelled lines of bill
/// detail, straight after `Nama Pelanggan` with no blank line between. They
/// are figures, not a sign-off, and they belong above the totals with the
/// rest of the table.
#[test]
fn bill_detail_that_follows_no_blank_line_stays_above_the_totals() {
    let rows: Vec<String> = format_ppob_receipt(&payment_point(), 58)
        .iter()
        .map(|line| line.text.clone())
        .collect();

    let rule = rows
        .iter()
        .position(|row| *row == "-".repeat(32))
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
        32,
    );

    assert_eq!(body.len(), 2);
    assert!(footer.is_empty());
}

/// An item stored before migration 023 has no provider text at all.
#[test]
fn without_provider_text_the_captured_fields_are_printed_instead() {
    let mut data = pln_prepaid();
    data.provider_receipt_text = None;
    data.customer_name = Some("BUDI SANTOSA".to_string());
    let text = text_of(&format_ppob_receipt(&data, 58));

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
    assert!(text.contains("1111-2222-3333"));

    // Each field appears once; there is no second block to supplement it.
    assert_eq!(text.matches("NO REF").count(), 1);
    assert_eq!(text.matches("ADMIN BANK").count(), 1);
}

#[test]
fn eighty_millimetre_paper_uses_the_wider_column_count() {
    let lines = format_ppob_receipt(&pln_prepaid(), 80);

    assert!(lines
        .iter()
        .any(|line| line.text == "-".repeat(columns(80))));
    let token_rows: Vec<&str> = lines
        .iter()
        .filter(|line| line.size == LineSize::Double)
        .map(|line| line.text.trim())
        .collect();
    assert_eq!(token_rows, vec!["1111-2222-3333-4444", "5555"]);
    // The provider's own wrap is theirs on wide paper too.
    assert!(text_of(&lines).contains("NAMA            : BUDI SANTOSA W"));
}

#[test]
fn group_token_leaves_a_non_numeric_serial_alone() {
    assert_eq!(group_token("ABC-123", 16), vec!["ABC-123"]);
    assert_eq!(group_token("12345678", 16), vec!["1234-5678"]);
}

/// Only the `STROOM/TOKEN` pair and the rows continuing it leave the body.
#[test]
fn without_token_lines_drops_the_pair_and_its_continuation_only() {
    let body = vec![
        "RP STROOM/TOKEN : Rp 18.181,00".to_string(),
        "STROOM/TOKEN    : 1111 2222 3333".to_string(),
        "                   4444 5555".to_string(),
        "ADMIN BANK      : Rp 3.500".to_string(),
    ];

    assert_eq!(
        without_token_lines(body, 32),
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
// Pulsa/data: Mitra's own "Cetak Struk" layout, used whenever there is no
// `provider_receipt_text` to print instead. See `format_pulsa_receipt`.
// -----------------------------------------------------------------------

/// The whole struk, in the order Mitra's own screen shows it, reconstructed
/// from a screenshot of a Telkomsel top-up. The phone-and-description line is
/// one character over 32 columns — `081348172197 - TELKOMSEL 20.000,-` is 33
/// — and wraps at a word boundary like any other line this module cannot fit
/// (see `eighty_millimetre_paper_fits_the_pulsa_heading_on_one_line` for that
/// same wording fitting on 42 columns unwrapped).
#[test]
fn a_pulsa_struk_matches_the_mitra_app_line_by_line() {
    let rows: Vec<String> = format_ppob_receipt(&pulsa(), 58)
        .into_iter()
        .map(|line| line.text)
        .collect();

    assert_eq!(
        rows,
        vec![
            center_text("Cahaya513 Mini Mart", 32),
            "=".repeat(32),
            format!("27-03-2026{}09:13 WIB", " ".repeat(13)),
            "Nomor Invoice #50151852".to_string(),
            "=".repeat(32),
            "TRANSAKSI:".to_string(),
            "081348172197 - TELKOMSEL".to_string(),
            "20.000,-".to_string(),
            "Masa Aktif 30 Hari".to_string(),
            String::new(),
            "-".to_string(),
            String::new(),
            "-".repeat(32),
            format!("Biaya Admin{}Rp 0", " ".repeat(17)),
            "-".repeat(32),
            format!("Total{}Rp 20.070", " ".repeat(18)),
            String::new(),
            "RINCIAN".to_string(),
            "No. Ref: 04103400001446365784".to_string(),
            "Kode Transaksi:".to_string(),
            "P081348172197-861-260327091340".to_string(),
        ]
    );
    assert!(rows.iter().all(|row| row.chars().count() <= 32));
}

/// Nothing of Mitra's usual PPOB furniture is on this struk: no double-size
/// token block (that is PLN prepaid only), no `LABEL : VALUE` fallback body.
#[test]
fn a_pulsa_struk_has_none_of_the_other_services_furniture() {
    let text = text_of(&format_ppob_receipt(&pulsa(), 58));
    assert!(!text.contains("Stroom/Token"));
    assert!(!text.contains("PRODUK"));
    assert!(!text.contains("NO PELANGGAN"));
}

/// 42 columns is wide enough to hold the phone and its description on one
/// line, where 32 was not.
#[test]
fn eighty_millimetre_paper_fits_the_pulsa_heading_on_one_line() {
    let cpl = columns(80);
    let rows: Vec<String> = format_ppob_receipt(&pulsa(), 80)
        .into_iter()
        .map(|line| line.text)
        .collect();

    assert_eq!(rows[1], "=".repeat(cpl));
    assert_eq!(rows[4], "=".repeat(cpl));
    assert!(rows.contains(&"081348172197 - TELKOMSEL 20.000,-".to_string()));
    assert!(rows.iter().all(|row| row.chars().count() <= cpl));
}

/// A description with no `Masa Aktif` prints as one line — nothing invented,
/// nothing left dangling.
#[test]
fn a_pulsa_description_without_masa_aktif_prints_as_one_line() {
    let mut data = pulsa();
    data.product_name = Some("Pulsa TELKOMSEL - TELKOMSEL 20.000,-".to_string());

    let rows: Vec<String> = format_ppob_receipt(&data, 58)
        .into_iter()
        .map(|line| line.text)
        .collect();

    assert!(!rows.iter().any(|row| row.contains("Masa Aktif")));
    assert_eq!(rows[6], "081348172197 - TELKOMSEL");
    assert_eq!(rows[7], "20.000,-");
    // A blank line follows immediately — no second description line.
    assert_eq!(rows[8], "");
}

/// A `product_name` that never went through our checkout — a history row
/// Mitra sent us, in whatever shape its own description arrived in — has no
/// `"Pulsa "`/`"Data "` prefix to strip, and prints exactly as given.
#[test]
fn a_product_name_without_the_checkout_prefix_prints_as_is() {
    let mut data = pulsa();
    // No phone on this one, so the assertion below is not at the mercy of
    // the wrap a 33-column heading would need — see the exact-match test for
    // that.
    data.customer_id = None;
    data.product_name = Some("pulsa - 081347085447".to_string());

    let text = text_of(&format_ppob_receipt(&data, 58));
    assert!(text.contains("pulsa - 081347085447"));
}

/// No Mitra id at all: the invoice line falls back to our own sale's receipt
/// number rather than going blank.
#[test]
fn a_missing_mitra_invoice_id_falls_back_to_our_receipt_number() {
    let mut data = pulsa();
    data.mitra_invoice_number = None;
    data.our_receipt_number = Some("TRX-20260327-0004".to_string());

    let text = text_of(&format_ppob_receipt(&data, 58));
    assert!(text.contains("Nomor Invoice #TRX-20260327-0004"));
    assert!(!text.contains("#50151852"));
}

/// Neither Mitra nor our own side has an id: the invoice line is left off
/// entirely rather than printed with nothing after the `#`.
#[test]
fn no_invoice_number_at_all_omits_the_line_rather_than_printing_a_bare_hash() {
    let mut data = pulsa();
    data.mitra_invoice_number = None;
    data.our_receipt_number = None;

    let text = text_of(&format_ppob_receipt(&data, 58));
    assert!(!text.contains("Nomor Invoice"));
    assert!(!text.contains('#'));
}

/// No real token, printed as `-`, is the base fixture already
/// (`token_number` is always `-` for pulsa/data); this is the positive case,
/// checked against the same row the exact-match test above checked as `-`.
#[test]
fn a_real_pulsa_token_is_printed_when_there_is_one() {
    let mut data = pulsa();
    data.serial_number = Some("6991524380306764".to_string());

    let rows: Vec<String> = format_ppob_receipt(&data, 58)
        .into_iter()
        .map(|line| line.text)
        .collect();
    assert_eq!(rows[10], "6991524380306764");
}

/// Our stored `ppob_serial_number` sometimes holds a copy of the reference
/// number rather than an actual token; printing it on the token line would
/// show the same digits twice under two different labels, so it is treated
/// as no token at all.
#[test]
fn a_token_equal_to_the_reference_number_prints_as_no_token() {
    let mut data = pulsa();
    data.serial_number = data.reference_number.clone();

    let rows: Vec<String> = format_ppob_receipt(&data, 58)
        .into_iter()
        .map(|line| line.text)
        .collect();
    assert_eq!(rows[10], "-");
}

/// Paket data (`service_type == "data"`) uses the exact same layout as
/// pulsa — Mitra's history calls both `PULSA`/`DATA` under one screen.
#[test]
fn a_paket_data_struk_uses_the_same_layout_as_pulsa() {
    let mut data = pulsa();
    data.service_type = "data".to_string();
    data.product_name = Some("Data TELKOMSEL - Kuota 5GB 30 Hari".to_string());

    let text = text_of(&format_ppob_receipt(&data, 58));
    assert!(text.contains("TRANSAKSI:"));
    assert!(text.contains("RINCIAN"));
    assert!(text.contains("081348172197 - Kuota 5GB 30 Hari"));
}

/// A pulsa/data line that does carry a `provider_receipt_text` is handled
/// exactly like every other service: the slip prints verbatim and none of
/// the Mitra "Cetak Struk" layout above is used.
#[test]
fn a_pulsa_line_with_a_provider_receipt_text_still_prints_it_verbatim() {
    let mut data = pulsa();
    data.provider_receipt_text = Some("NO METER : 14300000001".to_string());

    let text = text_of(&format_ppob_receipt(&data, 58));
    assert!(text.contains("NO METER : 14300000001"));
    assert!(!text.contains("TRANSAKSI:"));
    assert!(!text.contains("RINCIAN"));
    assert!(!text.contains("Nomor Invoice"));
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

/// The colon column each provider *meant* is the widest one it padded to;
/// the unpadded stragglers are moved out to it, so every colon lines up.
#[test]
fn title_case_labels_are_padded_to_the_providers_own_widest_column() {
    let text = "Nama PDAM : Kota Samarinda
No. Pelanggan      : 1120777
Nama : Rizul Gajuli
";
    let mut data = pdam();
    data.provider_receipt_text = Some(text.to_string());
    let printed = text_of(&format_ppob_receipt(&data, 58));

    // PDAM's own 19-wide column would leave eleven characters for the value
    // on 58 mm paper, so the column is pulled in to the widest label + 1.
    assert!(
        printed.contains(
            "Nama PDAM     : Kota Samarinda
"
        ),
        "{printed}"
    );
    assert!(
        printed.contains(
            "No. Pelanggan : 1120777
"
        ),
        "{printed}"
    );
    assert!(
        printed.contains(
            "Nama          : Rizul Gajuli
"
        ),
        "{printed}"
    );

    // 80 mm has the room, so the provider's own column stands.
    let wide = text_of(&format_ppob_receipt(&data, 80));
    assert!(
        wide.contains(
            "Nama PDAM          : Kota Samarinda
"
        ),
        "{wide}"
    );
}

#[test]
fn detect_label_width_is_the_widest_column_in_the_block() {
    let logical = parse_logical_lines(&provider_lines(PLN_POSTPAID_REAL_TEXT));
    assert_eq!(detect_label_width(&logical, 32), 15);

    let logical = parse_logical_lines(&provider_lines(PLN_PREPAID_TEXT));
    assert_eq!(detect_label_width(&logical, 32), 16);
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

#[test]
fn a_dash_for_receipt_text_is_no_slip_at_all() {
    // Mitra's history endpoint answers `"-"` for a pulsa/data line's
    // `receipt_text`; that must select the pulsa layout, not print one dash.
    let mut data = pulsa();
    data.provider_receipt_text = Some("-".to_string());
    let text = text_of(&format_ppob_receipt(&data, 58));

    assert!(text.contains("TRANSAKSI:"), "{text}");
    assert!(text.contains("RINCIAN"), "{text}");
    assert!(
        !text.contains(
            "
-
--------------------------------"
        ),
        "{text}"
    );
}

/// A top-up printed from Mitra's history, exactly as the history endpoint
/// describes it: the product name is "-", `description`/`igr_desc` carry the
/// real two-line product text, and the phone number is copied into the
/// token field.
#[test]
fn a_top_up_from_history_prints_the_provider_description_once_and_no_phone_as_token() {
    let mut data = pulsa();
    data.service_type = "data".to_string();
    data.product_name = Some("-".to_string());
    data.customer_id = Some("081347085447".to_string());
    data.serial_number = Some("081347085447".to_string());
    data.provider_description = Some("TELKOMSEL 50.000,-\nMasa Aktif 45 Hari".to_string());
    data.provider_receipt_text = Some("-".to_string());
    let text = text_of(&format_ppob_receipt(&data, 58));

    assert!(
        text.contains("TRANSAKSI:\n081347085447 - TELKOMSEL\n50.000,-\nMasa Aktif 45 Hari\n"),
        "{text}"
    );
    assert_eq!(
        text.matches("081347085447").count(),
        1,
        "the phone appears in the heading only\n{text}"
    );
    assert!(text.contains("\n\n-\n\n"), "no token → a lone dash\n{text}");
}

#[test]
fn a_history_description_that_already_leads_with_the_phone_is_not_doubled() {
    let mut data = pulsa();
    data.product_name = Some("081347085447 - TELKOMSEL 50.000,-\nMasa Aktif 45 Hari".to_string());
    data.customer_id = Some("081347085447".to_string());
    data.provider_description = None;
    let text = text_of(&format_ppob_receipt(&data, 58));

    assert!(!text.contains("081347085447 - 081347085447"), "{text}");
}

/// BPJS pads its labels to eighteen but leaves `Nomor VA :` unpadded on
/// purpose — the sixteen-digit number would not fit beside the column. With
/// the colons lined up, that number drops to its own line rather than
/// losing a digit to the next one.
#[test]
fn a_number_that_misses_the_column_by_a_digit_moves_under_its_label_whole() {
    let text = "Nomor VA : 8888802270413247
Periode           : 1 BULAN
Jumlah Peserta    : 3
";
    let mut data = bpjs();
    data.provider_receipt_text = Some(text.to_string());
    let printed = text_of(&format_ppob_receipt(&data, 58));

    assert!(
        printed.contains(
            "Nomor VA       :
  8888802270413247
Periode        : 1 BULAN
"
        ),
        "{printed}"
    );
    assert!(
        !printed.contains(
            "
                 7
"
        ),
        "{printed}"
    );
}
