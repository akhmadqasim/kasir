//! The printed struk must agree with the stored sale: the TOTAL, what was
//! paid, and the change. Each case rings a sale up through the real checkout
//! route and reads it back through the preview route, which is built by the
//! same formatter the printer gets.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use sea_orm::EntityTrait;
use serde_json::{json, Value};
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::entity::transactions;
use crate::http::AppState;
use crate::test_support::setup_test_db;

struct Shop {
    state: AppState,
    db: sea_orm::DatabaseConnection,
    token: String,
    admin_token: String,
    beras: i64,
    minyak: i64,
}

async fn shop(cashier_name: &str) -> Shop {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let beras =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 100).await;
    let minyak = crate::test_support::insert_product(
        &db,
        "Minyak Goreng Sawit Kemasan Pouch Isi Ulang 2 Liter Promo",
        10_000.0,
        12_500.0,
        100,
    )
    .await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    // The fixture names a user after their username; give the cashier a real
    // full name, since that is what the struk prints.
    {
        use sea_orm::{ActiveModelTrait, Set};
        let mut row: crate::entity::users::ActiveModel = kasir.clone().into();
        row.full_name = Set(cashier_name.to_string());
        row.update(&db).await.expect("rename cashier");
    }
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let token = login_token(&db, kasir.id).await;
    let admin_token = login_token(&db, admin.id).await;
    Shop {
        state: state(db.clone()),
        db,
        token,
        admin_token,
        beras: beras.id,
        minyak: minyak.id,
    }
}

async fn checkout(shop: &Shop, cart: Value) -> transactions::Model {
    let response = router(&shop.state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&shop.token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", uuid::Uuid::new_v4().to_string())
                .body(json_body(cart))
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let body = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED, "checkout refused: {body}");
    let id = body["transaction"]["id"].as_i64().expect("sale id");
    transactions::Entity::find_by_id(id)
        .one(&shop.db)
        .await
        .expect("query")
        .expect("stored sale")
}

async fn receipt_lines(shop: &Shop, sale_id: i64, paper: u8) -> Vec<String> {
    let response = router(&shop.state)
        .oneshot(
            same_origin(
                Method::GET,
                &format!("/api/transactions/{sale_id}/receipt/lines?paper={paper}"),
            )
            .header(header::COOKIE, cookie(&shop.token))
            .body(Body::empty())
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK);
    body_json(response)
        .await
        .as_array()
        .expect("lines")
        .iter()
        .map(|line| line["text"].as_str().expect("text").to_string())
        .collect()
}

/// The rupiah amount at the right edge of the first line starting with
/// `label`, as whole rupiah. `"Diskon   -7.500"` reads as `-7500`.
fn amount(lines: &[String], label: &str) -> Option<i64> {
    let line = lines.iter().find(|line| line.starts_with(label))?;
    let last = line.split_whitespace().last()?;
    let digits: String = last
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '-')
        .collect();
    digits.parse().ok()
}

fn rupiah(value: f64) -> i64 {
    value.round() as i64
}

fn assert_fits(lines: &[String], cpl: usize) {
    let too_wide: Vec<&String> = lines.iter().filter(|l| l.chars().count() > cpl).collect();
    assert!(
        too_wide.is_empty(),
        "lines wider than {cpl} columns: {too_wide:#?}"
    );
}

/// Cash paid over the total, with an item discount and a transaction
/// discount: the struk's Subtotal, Diskon, TOTAL, Tunai and Kembali are the
/// stored columns, and Tunai minus Kembali is the TOTAL.
#[tokio::test]
async fn a_discounted_cash_sale_prints_the_stored_totals_and_change() {
    let shop = shop("Siti Aminah").await;
    let sale = checkout(
        &shop,
        json!({
            "items": [
                { "product_id": shop.beras, "quantity": 2, "item_discount": 5000 },
                { "product_id": shop.minyak, "quantity": 1 },
            ],
            "payment_method": "cash",
            "payment_amount": 200000,
            "transaction_discount": 2500,
        }),
    )
    .await;

    // 2 x 65.000 + 12.500 = 142.500; 5.000 + 2.500 off; 135.000 due.
    assert_eq!(rupiah(sale.subtotal_amount), 142_500);
    assert_eq!(rupiah(sale.discount_amount), 7_500);
    assert_eq!(rupiah(sale.total_amount), 135_000);
    assert_eq!(rupiah(sale.change_amount.unwrap_or(0.0)), 65_000);

    for (paper, cpl) in [(58, 32), (80, 42)] {
        let lines = receipt_lines(&shop, sale.id, paper).await;
        assert_eq!(
            amount(&lines, "Subtotal"),
            Some(rupiah(sale.subtotal_amount))
        );
        assert_eq!(
            amount(&lines, "Diskon"),
            Some(-rupiah(sale.discount_amount))
        );
        assert_eq!(amount(&lines, "TOTAL"), Some(rupiah(sale.total_amount)));
        assert_eq!(amount(&lines, "Tunai"), Some(rupiah(sale.payment_amount)));
        assert_eq!(
            amount(&lines, "Kembali"),
            Some(rupiah(sale.change_amount.unwrap_or(0.0)))
        );
        assert_eq!(
            amount(&lines, "Tunai").unwrap() - amount(&lines, "Kembali").unwrap(),
            amount(&lines, "TOTAL").unwrap()
        );
        // The long product name wraps instead of running off the paper.
        assert_fits(&lines, cpl);
        assert!(lines.iter().any(|l| l.starts_with("Minyak Goreng")));
    }
}

/// Exact payment with a non-cash method prints no change line at all.
#[tokio::test]
async fn an_exact_qris_sale_prints_no_change() {
    let shop = shop("Siti Aminah").await;
    let sale = checkout(
        &shop,
        json!({
            "items": [{ "product_id": shop.beras, "quantity": 1 }],
            "payment_method": "qris",
            "payment_amount": 65000,
        }),
    )
    .await;

    let lines = receipt_lines(&shop, sale.id, 58).await;
    assert_eq!(amount(&lines, "TOTAL"), Some(65_000));
    assert_eq!(amount(&lines, "QRIS"), Some(65_000));
    assert_eq!(amount(&lines, "Kembali"), None);
    assert!(
        !lines.iter().any(|l| l.starts_with("Subtotal")),
        "no discount, no Subtotal/Diskon block: {lines:#?}"
    );
}

/// Transfer plus cash with change: every leg is printed, the legs add up to
/// the TOTAL, and Dibayar minus Kembali is the TOTAL too.
#[tokio::test]
async fn a_split_payment_prints_legs_that_add_up_to_the_total() {
    let shop = shop("Siti Aminah").await;
    let sale = checkout(
        &shop,
        json!({
            "items": [{ "product_id": shop.beras, "quantity": 2 }],
            "payment_method": "cash",
            "payment_amount": 150000,
            "payment_breakdown": [
                { "payment_method": "transfer", "bank_name": "BCA", "amount": 100000 },
                { "payment_method": "cash", "amount": 50000 },
            ],
        }),
    )
    .await;
    assert_eq!(rupiah(sale.total_amount), 130_000);

    let lines = receipt_lines(&shop, sale.id, 58).await;
    let total = amount(&lines, "TOTAL").expect("TOTAL");
    let transfer = amount(&lines, "Transfer (BCA)").expect("transfer leg");
    let cash = amount(&lines, "Tunai").expect("cash leg");
    assert_eq!(total, 130_000);
    assert_eq!(transfer + cash, total, "{lines:#?}");
    assert_eq!(amount(&lines, "Dibayar"), Some(rupiah(sale.payment_amount)));
    assert_eq!(
        amount(&lines, "Kembali"),
        Some(rupiah(sale.change_amount.unwrap_or(0.0)))
    );
    assert_eq!(
        amount(&lines, "Dibayar").unwrap() - amount(&lines, "Kembali").unwrap(),
        total
    );
}

/// A transfer that already covers the bill, plus cash the customer handed
/// over anyway: the cash leg is dropped and the whole cash amount is change.
/// The struk must still reconcile the way a split does — the Transfer line is
/// what the transfer actually took (the TOTAL, not transfer + cash), and
/// Dibayar less Kembali is the TOTAL.
#[tokio::test]
async fn a_transfer_that_covers_the_bill_plus_cash_still_reconciles() {
    let shop = shop("Siti Aminah").await;
    let sale = checkout(
        &shop,
        json!({
            "items": [{ "product_id": shop.beras, "quantity": 2 }],
            "payment_method": "cash",
            "payment_amount": 180000,
            "payment_breakdown": [
                { "payment_method": "transfer", "amount": 130000 },
                { "payment_method": "cash", "amount": 50000 },
            ],
        }),
    )
    .await;

    let lines = receipt_lines(&shop, sale.id, 58).await;
    let total = amount(&lines, "TOTAL").expect("TOTAL");
    let transfer = amount(&lines, "Transfer").expect("transfer line");
    let paid = amount(&lines, "Dibayar").expect("Dibayar line");
    let change = amount(&lines, "Kembali").expect("Kembali line");
    assert_eq!(transfer, total, "{lines:#?}");
    assert_eq!(paid, rupiah(sale.payment_amount), "{lines:#?}");
    assert_eq!(
        change,
        rupiah(sale.change_amount.unwrap_or(0.0)),
        "{lines:#?}"
    );
    assert_eq!(
        paid - change,
        total,
        "stored: method={} paid={} change={:?}; printed: {lines:#?}",
        sale.payment_method,
        sale.payment_amount,
        sale.change_amount
    );
}

/// A bank name the cashier typed in full must not push the payment line past
/// the paper edge; every other free-text field on the struk wraps.
#[tokio::test]
async fn a_long_bank_name_stays_inside_the_paper() {
    let shop = shop("Siti Aminah").await;
    let sale = checkout(
        &shop,
        json!({
            "items": [{ "product_id": shop.beras, "quantity": 2 }],
            "payment_method": "cash",
            "payment_amount": 150000,
            "payment_breakdown": [
                { "payment_method": "transfer", "bank_name": "Bank Syariah Indonesia", "amount": 100000 },
                { "payment_method": "cash", "amount": 50000 },
            ],
        }),
    )
    .await;

    assert_fits(&receipt_lines(&shop, sale.id, 58).await, 32);
}

/// A cashier's full name longer than the paper goes to its own line; that
/// line must still fit.
#[tokio::test]
async fn a_cashier_name_longer_than_the_paper_still_fits() {
    let shop = shop("Muhammad Rizky Ramadhan Saputra Pratama").await;
    let sale = checkout(
        &shop,
        json!({
            "items": [{ "product_id": shop.beras, "quantity": 1 }],
            "payment_method": "cash",
            "payment_amount": 65000,
        }),
    )
    .await;

    assert_fits(&receipt_lines(&shop, sale.id, 58).await, 32);
}

/// Voiding zeroes `total_amount`, but the copy printed afterwards is marked
/// VOID and still shows what the sale was for.
#[tokio::test]
async fn a_voided_sale_reprints_as_a_void_copy_with_its_original_total() {
    let shop = shop("Siti Aminah").await;
    let sale = checkout(
        &shop,
        json!({
            "items": [{ "product_id": shop.beras, "quantity": 2, "item_discount": 5000 }],
            "payment_method": "cash",
            "payment_amount": 130000,
        }),
    )
    .await;

    let voided = router(&shop.state)
        .oneshot(
            same_origin(Method::DELETE, &format!("/api/transactions/{}", sale.id))
                .header(header::COOKIE, cookie(&shop.admin_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "reason": "pelanggan batal" })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(voided.status(), StatusCode::NO_CONTENT);

    let lines = receipt_lines(&shop, sale.id, 58).await;
    assert!(lines.iter().any(|l| l.contains("VOID")), "{lines:#?}");
    assert_eq!(amount(&lines, "TOTAL"), Some(125_000));
    assert!(lines.iter().any(|l| l.contains("pelanggan batal")));
}
