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

/// The provider's slip goes on the paper exactly as it arrived: the name
/// broken where they broke it, the reference in their three pieces, the
/// fused word left fused. That is the document the Mitra app prints, and
/// matching it is the point.
#[test]
fn the_providers_slip_is_printed_verbatim() {
    let text = text_of(&format_ppob_receipt(&pln_prepaid(), 58));

    assert!(text.contains("NAMA            : BUDI SANTOSA W\n                  IJAYA"));
    assert!(text.contains("NO REF          : 11002500AAA1A1\n                  111AA111AA1111"));
    // Fifty characters of provider line for thirty-two of paper: cut at the
    // column, padding and all, as the printer would and the Mitra print shows.
    assert!(text.contains(
        "
                  3 Atau hubungi
 PLN TerdekatDownl
                  oad PLN Mobile
"
    ));
    assert!(text.contains("STRUK PEMBELIAN LISTRIK PRABAYAR"));
}

/// Numbers inside the provider's block are theirs: they mix `69,163` and
/// `Rp 69.729,00` between services and we are not the ones to correct it.
/// Nor is their label column: PDAM's nineteen stays nineteen.
#[test]
fn provider_numbers_and_columns_are_printed_exactly_as_sent() {
    assert!(text_of(&format_ppob_receipt(&pdam(), 58)).contains("Total Tagihan      : 69,163"));
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
    assert_eq!(rows[rule + 5], "Informasi Hubungi Call Center 12");
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

/// PLN's postpaid footer is one 84-character line. It is printed as sent
/// and cut at the column, which is what the printer would have done with it
/// — and what the Mitra print shows.
#[test]
fn a_footer_line_wider_than_the_paper_is_cut_at_the_column() {
    let lines = format_ppob_receipt(&pln_postpaid(), 58);
    let rows: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();

    let start = rows
        .iter()
        .position(|row| row.starts_with("MKM|"))
        .expect("footer printed as sent");
    assert_eq!(rows[start], "MKM|\"Informasi Hubungi Call Cent");
    assert_eq!(rows[start + 1], "er 123 Atau Hub PLN Terdekat :\"|");
    assert_eq!(rows[start + 2], "Download PLN Mobile");
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
