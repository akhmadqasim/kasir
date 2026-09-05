/// Receipt formatter: takes store info + transaction data and produces text lines for GDI printing

/// All data needed to generate a receipt
pub struct ReceiptData {
    pub store_name: String,
    pub store_address: Option<String>,
    pub store_phone: Option<String>,
    pub receipt_number: String,
    pub date_time: String,
    pub cashier_name: String,
    pub items: Vec<ReceiptItem>,
    pub subtotal_amount: f64,
    pub discount_amount: f64,
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: f64,
    pub payment_breakdown: Vec<ReceiptPaymentSplit>,
    pub footer_text: Option<String>,
    pub is_deleted: bool,
    pub deleted_reason: Option<String>,
    pub deleted_by_name: Option<String>,
    pub original_total_amount: f64,
}

pub struct ReceiptPaymentSplit {
    pub payment_method: String,
    pub bank_name: Option<String>,
    pub amount: f64,
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
        "debit" => "Debit",
        "ewallet" => "E-Wallet",
        "transfer" => "Transfer",
        "mixed" => "Campuran",
        _ => method,
    }
}

fn payment_method_label_with_bank(method: &str, bank_name: Option<&str>) -> String {
    let label = payment_method_label(method);
    match bank_name.map(str::trim).filter(|name| !name.is_empty()) {
        Some(bank_name) => format!("{} ({})", label, bank_name),
        None => label.to_string(),
    }
}

/// A single line of receipt text for GDI printing
pub struct ReceiptTextLine {
    pub text: String,
    pub bold: bool,
}

/// Center text within given width using space padding (monospace)
fn center_text(text: &str, width: usize) -> String {
    let text_len = text.chars().count();
    let pad = width.saturating_sub(text_len) / 2;
    format!("{}{}", " ".repeat(pad), text)
}

/// Two-column text padded to given width (left-aligned left, right-aligned right)
fn two_col_text(left: &str, right: &str, width: usize) -> String {
    let left_len = left.chars().count();
    let right_len = right.chars().count();
    let spaces = width.saturating_sub(left_len + right_len).max(1);
    format!("{}{}{}", left, " ".repeat(spaces), right)
}

/// Generate receipt as text lines for GDI printing
pub fn format_receipt_text(data: &ReceiptData, paper_width_mm: u8) -> Vec<ReceiptTextLine> {
    let cpl: usize = if paper_width_mm >= 80 { 42 } else { 32 };
    let mut lines = Vec::new();

    // Header
    lines.push(ReceiptTextLine {
        text: "=".repeat(cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: center_text(&data.store_name, cpl),
        bold: true,
    });

    if let Some(ref addr) = data.store_address {
        if !addr.is_empty() {
            lines.push(ReceiptTextLine {
                text: center_text(addr, cpl),
                bold: false,
            });
        }
    }
    if let Some(ref phone) = data.store_phone {
        if !phone.is_empty() {
            lines.push(ReceiptTextLine {
                text: center_text(&format!("Telp: {}", phone), cpl),
                bold: false,
            });
        }
    }

    lines.push(ReceiptTextLine {
        text: "=".repeat(cpl),
        bold: false,
    });
    if data.is_deleted {
        lines.push(ReceiptTextLine {
            text: center_text("RECEIPT SALINAN (VOID)", cpl),
            bold: true,
        });
        lines.push(ReceiptTextLine {
            text: "=".repeat(cpl),
            bold: false,
        });
    }

    // Transaction info
    lines.push(ReceiptTextLine {
        text: two_col_text("No:", &data.receipt_number, cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: two_col_text("Tanggal:", &data.date_time, cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: two_col_text("Kasir:", &data.cashier_name, cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: "-".repeat(cpl),
        bold: false,
    });

    // Items
    for item in &data.items {
        let price_str = format_rupiah(item.price);
        let subtotal_str = format_rupiah(item.subtotal);
        let qty_price = format!("  {} x {}", item.quantity, price_str);
        lines.push(ReceiptTextLine {
            text: item.name.clone(),
            bold: false,
        });
        lines.push(ReceiptTextLine {
            text: two_col_text(&qty_price, &subtotal_str, cpl),
            bold: false,
        });
    }

    lines.push(ReceiptTextLine {
        text: "-".repeat(cpl),
        bold: false,
    });

    // Totals
    if data.discount_amount > 0.0 {
        lines.push(ReceiptTextLine {
            text: two_col_text("Subtotal", &format_rupiah(data.subtotal_amount), cpl),
            bold: false,
        });
        lines.push(ReceiptTextLine {
            text: two_col_text(
                "Diskon",
                &format!("-{}", format_rupiah(data.discount_amount)),
                cpl,
            ),
            bold: false,
        });
    }
    lines.push(ReceiptTextLine {
        text: two_col_text("TOTAL", &format_rupiah(data.original_total_amount), cpl),
        bold: true,
    });
    if data.payment_breakdown.len() > 1 {
        for split in &data.payment_breakdown {
            let method_label =
                payment_method_label_with_bank(&split.payment_method, split.bank_name.as_deref());
            lines.push(ReceiptTextLine {
                text: two_col_text(
                    &format!("Bayar ({})", method_label),
                    &format_rupiah(split.amount),
                    cpl,
                ),
                bold: false,
            });
        }
        if data.change_amount > 0.0 {
            lines.push(ReceiptTextLine {
                text: two_col_text("Dibayar", &format_rupiah(data.payment_amount), cpl),
                bold: false,
            });
            lines.push(ReceiptTextLine {
                text: two_col_text("Kembalian", &format_rupiah(data.change_amount), cpl),
                bold: false,
            });
        }
    } else {
        let method_label = payment_method_label_with_bank(
            &data.payment_method,
            data.payment_breakdown
                .first()
                .and_then(|split| split.bank_name.as_deref()),
        );
        lines.push(ReceiptTextLine {
            text: two_col_text(
                &format!("Bayar ({})", method_label),
                &format_rupiah(data.payment_amount),
                cpl,
            ),
            bold: false,
        });
        if data.payment_method == "cash" && data.change_amount > 0.0 {
            lines.push(ReceiptTextLine {
                text: two_col_text("Kembalian", &format_rupiah(data.change_amount), cpl),
                bold: false,
            });
        }
    }

    if data.is_deleted {
        lines.push(ReceiptTextLine {
            text: "-".repeat(cpl),
            bold: false,
        });
        if let Some(ref deleted_by_name) = data.deleted_by_name {
            lines.push(ReceiptTextLine {
                text: two_col_text("Void By:", deleted_by_name, cpl),
                bold: false,
            });
        }
        if let Some(ref deleted_reason) = data.deleted_reason {
            lines.push(ReceiptTextLine {
                text: "Alasan Void:".to_string(),
                bold: false,
            });
            lines.push(ReceiptTextLine {
                text: deleted_reason.clone(),
                bold: false,
            });
        }
    }

    lines.push(ReceiptTextLine {
        text: "=".repeat(cpl),
        bold: false,
    });

    // Footer
    if let Some(ref footer) = data.footer_text {
        for line in footer.lines() {
            lines.push(ReceiptTextLine {
                text: center_text(line, cpl),
                bold: false,
            });
        }
    } else {
        lines.push(ReceiptTextLine {
            text: center_text("Terima kasih!", cpl),
            bold: false,
        });
        lines.push(ReceiptTextLine {
            text: center_text("Barang yang sudah dibeli", cpl),
            bold: false,
        });
        lines.push(ReceiptTextLine {
            text: center_text("tidak dapat dikembalikan", cpl),
            bold: false,
        });
    }

    // Feed lines
    for _ in 0..6 {
        lines.push(ReceiptTextLine {
            text: String::new(),
            bold: false,
        });
    }

    lines
}

/// Generate test page as text lines for GDI printing
pub fn format_test_page_text(store_name: &str, paper_width_mm: u8) -> Vec<ReceiptTextLine> {
    let cpl: usize = if paper_width_mm >= 80 { 42 } else { 32 };
    let mut lines = Vec::new();

    lines.push(ReceiptTextLine {
        text: center_text("TEST PRINT", cpl),
        bold: true,
    });
    lines.push(ReceiptTextLine {
        text: "=".repeat(cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: center_text(store_name, cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: center_text(&format!("Lebar: {}mm", paper_width_mm), cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: center_text(&format!("{} karakter/baris", cpl), cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: "-".repeat(cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: "Normal text".to_string(),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: "Bold text".to_string(),
        bold: true,
    });
    lines.push(ReceiptTextLine {
        text: two_col_text("Kiri", "Kanan", cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: two_col_text("Item panjang sekali", "100.000", cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: "=".repeat(cpl),
        bold: false,
    });
    lines.push(ReceiptTextLine {
        text: center_text("Printer OK!", cpl),
        bold: false,
    });

    for _ in 0..6 {
        lines.push(ReceiptTextLine {
            text: String::new(),
            bold: false,
        });
    }

    lines
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

    #[test]
    fn test_format_receipt_text() {
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
            subtotal_amount: 101000.0,
            discount_amount: 0.0,
            payment_method: "cash".to_string(),
            payment_amount: 110000.0,
            change_amount: 9000.0,
            payment_breakdown: vec![ReceiptPaymentSplit {
                payment_method: "cash".to_string(),
                bank_name: None,
                amount: 101000.0,
            }],
            footer_text: None,
            is_deleted: false,
            deleted_reason: None,
            deleted_by_name: None,
            original_total_amount: 101000.0,
        };

        let lines = format_receipt_text(&data, 58);
        assert!(!lines.is_empty());

        let all_text: String = lines
            .iter()
            .map(|l| l.text.clone())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(all_text.contains("Toko Makmur"));
        assert!(all_text.contains("TRX-20250118-0001"));
        assert!(all_text.contains("Beras 5kg"));
        assert!(all_text.contains("Terima kasih!"));
    }
}
