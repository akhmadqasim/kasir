/// Receipt formatter: takes store info + transaction data and produces ESC/POS bytes
use super::escpos::EscPosBuilder;

/// All data needed to generate a receipt
pub struct ReceiptData {
    pub store_name: String,
    pub store_address: Option<String>,
    pub store_phone: Option<String>,
    pub receipt_number: String,
    pub date_time: String,
    pub cashier_name: String,
    pub items: Vec<ReceiptItem>,
    pub total_amount: f64,
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: f64,
    pub footer_text: Option<String>,
}

pub struct ReceiptItem {
    pub name: String,
    pub quantity: i32,
    pub price: f64,
    pub subtotal: f64,
}

/// Format currency in Indonesian style: 100.000
fn format_rupiah(amount: f64) -> String {
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

/// Translate payment method to Indonesian
fn payment_method_label(method: &str) -> &str {
    match method {
        "cash" => "Tunai",
        "qris" => "QRIS",
        "ewallet" => "E-Wallet",
        "transfer" => "Transfer",
        _ => method,
    }
}

/// Generate ESC/POS bytes for a receipt
pub fn format_receipt(data: &ReceiptData, paper_width_mm: u8) -> Vec<u8> {
    let mut p = EscPosBuilder::new(paper_width_mm);

    // === Header ===
    p.align_center();
    p.bold_on();
    p.double_size_on();
    p.line(&data.store_name);
    p.double_size_off();
    p.bold_off();

    if let Some(ref addr) = data.store_address {
        if !addr.is_empty() {
            p.line(addr);
        }
    }
    if let Some(ref phone) = data.store_phone {
        if !phone.is_empty() {
            p.line(&format!("Telp: {}", phone));
        }
    }

    p.separator('=');

    // === Transaction info ===
    p.align_left();
    p.two_columns("No:", &data.receipt_number);
    p.two_columns("Tanggal:", &data.date_time);
    p.two_columns("Kasir:", &data.cashier_name);
    p.separator('-');

    // === Items ===
    for item in &data.items {
        let price_str = format_rupiah(item.price);
        let qty_price = format!("{} x {}", item.quantity, price_str);
        p.left_text(&item.name);
        p.two_columns(&qty_price, &format_rupiah(item.subtotal));
    }

    p.separator('-');

    // === Totals ===
    p.bold_on();
    p.two_columns("TOTAL", &format_rupiah(data.total_amount));
    p.bold_off();

    let method_label = payment_method_label(&data.payment_method);
    p.two_columns(
        &format!("Bayar ({})", method_label),
        &format_rupiah(data.payment_amount),
    );

    if data.payment_method == "cash" && data.change_amount > 0.0 {
        p.two_columns("Kembalian", &format_rupiah(data.change_amount));
    }

    p.separator('=');

    // === Footer ===
    p.align_center();
    if let Some(ref footer) = data.footer_text {
        p.line(footer);
    } else {
        p.line("Terima kasih!");
        p.line("Barang yang sudah dibeli");
        p.line("tidak dapat dikembalikan");
    }

    p.feed(3);
    p.cut();

    p.build()
}

/// Generate a test print page
pub fn format_test_page(store_name: &str, paper_width_mm: u8) -> Vec<u8> {
    let mut p = EscPosBuilder::new(paper_width_mm);

    p.align_center();
    p.bold_on();
    p.double_size_on();
    p.line("TEST PRINT");
    p.double_size_off();
    p.bold_off();
    p.separator('=');
    p.line(store_name);
    p.line(&format!("Lebar: {}mm", paper_width_mm));
    p.line(&format!("{} karakter/baris", p.chars_per_line()));
    p.separator('-');

    p.align_left();
    p.line("Normal text");
    p.bold_on();
    p.line("Bold text");
    p.bold_off();

    p.align_left();
    p.two_columns("Kiri", "Kanan");
    p.two_columns("Item panjang sekali", "100.000");

    p.separator('=');
    p.align_center();
    p.line("Printer OK!");
    p.feed(3);
    p.cut();

    p.build()
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
    fn test_format_receipt() {
        let data = ReceiptData {
            store_name: "Toko Makmur".to_string(),
            store_address: Some("Jl. Raya No. 1".to_string()),
            store_phone: Some("08123456789".to_string()),
            receipt_number: "TRX-20250118-0001".to_string(),
            date_time: "18/01/2025 14:30".to_string(),
            cashier_name: "Ahmad".to_string(),
            items: vec![
                ReceiptItem {
                    name: "Beras 5kg".to_string(),
                    quantity: 1,
                    price: 65000.0,
                    subtotal: 65000.0,
                },
                ReceiptItem {
                    name: "Minyak Goreng 1L".to_string(),
                    quantity: 2,
                    price: 18000.0,
                    subtotal: 36000.0,
                },
            ],
            total_amount: 101000.0,
            payment_method: "cash".to_string(),
            payment_amount: 110000.0,
            change_amount: 9000.0,
            footer_text: None,
        };

        let bytes = format_receipt(&data, 58);
        assert!(!bytes.is_empty());
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("Toko Makmur"));
        assert!(text.contains("TRX-20250118-0001"));
        assert!(text.contains("Beras 5kg"));
    }
}
