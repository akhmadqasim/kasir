//! Rendering captured transactions to disk, so a human can print them and
//! compare against the Mitra app's own output. Nothing here asserts anything;
//! it is a tool that happens to be spelled as a test.

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
    use crate::printing::escpos::{encode_lines, encode_raster};
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
        let lines = format_ppob_receipt(&data, 58);
        let bitmap = render_lines(&lines, columns(58), DOTS_58MM).expect("rendered");
        let bytes = encode_raster(&bitmap);

        // `.bin` is the raster job, `-text.bin` the same struk set by the
        // printer's own font, `.pbm` the raster as a picture for a human,
        // and `.txt` what was drawn.
        std::fs::write(out.join(format!("{name}.bin")), &bytes).expect("write bytes");
        std::fs::write(out.join(format!("{name}-text.bin")), encode_lines(&lines))
            .expect("write text bytes");
        std::fs::write(out.join(format!("{name}.pbm")), bitmap.to_pbm()).expect("write image");
        std::fs::write(out.join(format!("{name}.txt")), text_of(&lines)).expect("write preview");

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
        // These captured fixtures are all PLN/PDAM/BPJS, which never read
        // any of the four.
        date: None,
        time: None,
        mitra_invoice_number: None,
        our_receipt_number: None,
    }
}
