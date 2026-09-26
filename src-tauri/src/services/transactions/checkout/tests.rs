//! End-to-end checkout tests, through [`checkout_with_executor`].

use super::*;
use crate::domain::transactions::TransactionItemInput;
use crate::entity::{ppob_receipts, products, transactions};
use crate::services::transactions::fixtures::{
    admin, cash_checkout, insert_product, no_provider, product_line, pulsa_line, setup_test_db,
};
use crate::services::transactions::{
    CHANNEL_PPOB, CHANNEL_SALES, PPOB_STATUS_SUCCESS, STATUS_COMPLETED,
};
use sea_orm::{EntityTrait, PaginatorTrait};

/// A successful provider answer for `request`, with `serial_number`.
fn paid(
    request: &PpobFulfillmentRequest,
    receipt_data: serde_json::Value,
    serial_number: Option<&str>,
) -> PaymentResult {
    PaymentResult {
        success: true,
        receipt_data,
        service_type: request.service_type.clone(),
        customer_id: request.customer_id.clone().unwrap_or_default(),
        amount: 10_000.0,
        admin_fee: 0.0,
        total: 10_000.0,
        product_name: None,
        customer_name: None,
        serial_number: serial_number.map(str::to_string),
    }
}

/// A PLN token line; its inquiry has already been made.
fn pln_line(product_name: &str, service_ref: &str, inquiry_id: &str) -> TransactionItemInput {
    TransactionItemInput {
        product_id: None,
        quantity: 1,
        product_name: Some(product_name.to_string()),
        product_price: Some(21_000.0),
        buy_price: Some(20_000.0),
        service_type: Some("pln".to_string()),
        service_ref: Some(service_ref.to_string()),
        ppob_product_id: None,
        ppob_product_code: None,
        ppob_inquiry_id: Some(inquiry_id.to_string()),
        ppob_payment_code: Some("20000".to_string()),
        ppob_flag_id: Some("0".to_string()),
        item_discount: None,
    }
}

/// `cash_checkout` with a PPOB PIN.
fn with_pin(input: CheckoutTransactionInput, pin: &str) -> CheckoutTransactionInput {
    CheckoutTransactionInput {
        ppob_pin: Some(pin.to_string()),
        ..input
    }
}

/// `cash_checkout` rung up from a given screen.
fn on_channel(input: CheckoutTransactionInput, channel: &str) -> CheckoutTransactionInput {
    CheckoutTransactionInput {
        channel: Some(channel.to_string()),
        ..input
    }
}

#[tokio::test]
async fn standard_checkout_completes_and_deducts_stock() {
    let conn = setup_test_db().await;
    let product = insert_product(&conn, "Beras", 15_000.0, 10).await;
    // The sale lands in the cashier's own open shift; the request has no
    // say in which drawer it is booked to.
    let shift = crate::services::shifts::open(
        &conn,
        &admin(),
        crate::domain::shifts::OpenShiftInput { opening_cash: None },
    )
    .await
    .expect("shift opens");

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(product.id, 2)], 30_000.0),
        no_provider,
    )
    .await
    .expect("checkout success");

    assert_eq!(result.transaction.status, STATUS_COMPLETED);
    assert_eq!(result.transaction.shift_id, Some(shift.id));
    assert!(result.items[0].ppob_status.is_none());

    let updated_product = products::Entity::find_by_id(product.id)
        .one(&conn)
        .await
        .expect("product query")
        .expect("product exists");
    assert_eq!(updated_product.stock, 8);
}

#[tokio::test]
async fn ppob_checkout_success_updates_item_and_transaction() {
    let conn = setup_test_db().await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        with_pin(cash_checkout(vec![pulsa_line()], 12_000.0), "123456"),
        |request| async move {
            assert_eq!(request.service_type, "pulsa");
            // The PIN travels with the request the executor is handed —
            // never read back from settings.
            assert_eq!(request.pin, "123456");
            Ok(PaymentResult {
                product_name: Some("Pulsa Telkomsel 10K".to_string()),
                ..paid(
                    &request,
                    serde_json::json!({ "receipt_text": "STRUK", "no_ref": "R-9" }),
                    Some("SN-123"),
                )
            })
        },
    )
    .await
    .expect("ppob checkout success");

    assert_eq!(result.transaction.status, STATUS_COMPLETED);
    assert_eq!(result.items[0].ppob_status.as_deref(), Some("success"));
    assert_eq!(
        result.items[0].ppob_serial_number.as_deref(),
        Some("SN-123")
    );

    // The provider's whole answer is kept, in its own table, so the struk
    // can be printed again next week.
    let stored = ppob_receipts::Entity::find_by_id(result.items[0].id)
        .one(&conn)
        .await
        .expect("query")
        .expect("provider response stored");
    assert!(stored.data.contains("STRUK"));
    assert!(stored.data.contains("R-9"));
}

/// A Payment Point line reaches the executor the same way PDAM and PLN do —
/// an inquiry made beforehand, `customer_id`/`product_code` carried on the
/// item, and nothing PP-specific (no `flag_id`, `phone_number`, or `amount`
/// forwarded at pay time; those are only for PLN and BPJS).
#[tokio::test]
async fn ppob_checkout_success_fulfills_a_payment_point_line() {
    let conn = setup_test_db().await;
    let payment_point = TransactionItemInput {
        product_id: None,
        quantity: 1,
        product_name: Some("Indihome - 1234567890".to_string()),
        product_price: Some(302_500.0),
        buy_price: Some(302_500.0),
        service_type: Some("pp".to_string()),
        service_ref: Some("1234567890".to_string()),
        ppob_product_id: None,
        ppob_product_code: Some("121900061".to_string()),
        ppob_inquiry_id: Some("INQ-1".to_string()),
        ppob_payment_code: None,
        ppob_flag_id: None,
        item_discount: None,
    };

    let result = checkout_with_executor(
        &conn,
        &admin(),
        with_pin(cash_checkout(vec![payment_point], 302_500.0), "654321"),
        |request| async move {
            assert_eq!(request.service_type, "pp");
            assert_eq!(request.customer_id.as_deref(), Some("1234567890"));
            assert_eq!(request.inquiry_id.as_deref(), Some("INQ-1"));
            assert_eq!(request.product_code.as_deref(), Some("121900061"));
            assert_eq!(request.payment_code, None);
            assert_eq!(request.flag_id, None);
            assert_eq!(request.phone_number, None);
            assert_eq!(request.amount, None);
            assert_eq!(request.pin, "654321");
            Ok(PaymentResult {
                amount: 300_000.0,
                admin_fee: 2_500.0,
                total: 302_500.0,
                product_name: Some("Indihome".to_string()),
                customer_name: Some("BUDI SANTOSO".to_string()),
                ..paid(
                    &request,
                    serde_json::json!({ "receipt_text": "STRUK PP" }),
                    None,
                )
            })
        },
    )
    .await
    .expect("payment point checkout success");

    assert_eq!(result.transaction.status, STATUS_COMPLETED);
    assert_eq!(result.items[0].ppob_status.as_deref(), Some("success"));
}

#[tokio::test]
async fn ppob_checkout_failure_keeps_transaction_completed_marks_item_failed() {
    let conn = setup_test_db().await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        with_pin(
            cash_checkout(
                vec![pln_line("Token PLN 20K", "1234567890", "INQ-1")],
                21_000.0,
            ),
            "111111",
        ),
        |_request| async { Err(AppError::Internal("Provider timeout".into())) },
    )
    .await
    .expect("ppob checkout should return transaction result even on PPOB failure");

    // Transaction stays completed (payment received)
    assert_eq!(result.transaction.status, STATUS_COMPLETED);
    // But item is marked as failed
    assert_eq!(result.items[0].ppob_status.as_deref(), Some("failed"));
    assert!(result.items[0]
        .ppob_message
        .as_deref()
        .is_some_and(|message| message.contains("Provider timeout")));
}

#[tokio::test]
async fn mixed_cart_succeeds_with_stock_deduction_and_ppob_fulfillment() {
    let conn = setup_test_db().await;
    let product = insert_product(&conn, "Gula", 18_000.0, 5).await;
    let pulsa = TransactionItemInput {
        product_name: Some("Pulsa".to_string()),
        product_price: Some(10_000.0),
        buy_price: Some(9_000.0),
        service_ref: Some("08123".to_string()),
        ppob_product_id: Some(1),
        ppob_product_code: Some("P1".to_string()),
        ..pulsa_line()
    };

    let result = checkout_with_executor(
        &conn,
        &admin(),
        with_pin(
            cash_checkout(vec![product_line(product.id, 1), pulsa], 28_000.0),
            "222222",
        ),
        |request| async move {
            assert_eq!(request.service_type, "pulsa");
            assert_eq!(request.pin, "222222");
            Ok(PaymentResult {
                product_name: Some("Pulsa".to_string()),
                ..paid(&request, serde_json::json!({}), Some("SN-MIX-1"))
            })
        },
    )
    .await
    .expect("mixed cart checkout success");

    assert_eq!(result.transaction.status, STATUS_COMPLETED);
    assert_eq!(result.items.len(), 2);

    // Physical item: no ppob_status, stock deducted
    let physical_item = result
        .items
        .iter()
        .find(|i| i.service_type.is_none())
        .unwrap();
    assert!(physical_item.ppob_status.is_none());
    let updated_product = products::Entity::find_by_id(product.id)
        .one(&conn)
        .await
        .expect("query")
        .expect("exists");
    assert_eq!(updated_product.stock, 4);

    // PPOB item: ppob_status = success
    let ppob_item = result
        .items
        .iter()
        .find(|i| i.service_type.is_some())
        .unwrap();
    assert_eq!(ppob_item.ppob_status.as_deref(), Some("success"));
    assert_eq!(ppob_item.ppob_serial_number.as_deref(), Some("SN-MIX-1"));
}

#[tokio::test]
async fn multi_ppob_cart_succeeds_with_all_items_fulfilled() {
    let conn = setup_test_db().await;
    let pulsa = TransactionItemInput {
        product_name: Some("Pulsa 10K".to_string()),
        service_ref: Some("08123".to_string()),
        ppob_product_id: Some(1),
        ppob_product_code: Some("P1".to_string()),
        ..pulsa_line()
    };

    let result = checkout_with_executor(
        &conn,
        &admin(),
        with_pin(
            cash_checkout(
                vec![pulsa, pln_line("Token PLN", "123456", "INQ-2")],
                33_000.0,
            ),
            "333333",
        ),
        |request| async move {
            // One PIN on the cart, and both lines' fulfilment requests
            // must carry it.
            assert_eq!(request.pin, "333333");
            let sn = if request.service_type == "pulsa" {
                "SN-PULSA"
            } else {
                "SN-PLN"
            };
            Ok(paid(&request, serde_json::json!({}), Some(sn)))
        },
    )
    .await
    .expect("multi PPOB checkout should succeed");

    assert_eq!(result.transaction.status, STATUS_COMPLETED);
    assert_eq!(result.items.len(), 2);

    let pulsa_item = result
        .items
        .iter()
        .find(|i| i.service_type.as_deref() == Some("pulsa"))
        .unwrap();
    assert_eq!(pulsa_item.ppob_status.as_deref(), Some("success"));
    assert_eq!(pulsa_item.ppob_serial_number.as_deref(), Some("SN-PULSA"));

    let pln_item = result
        .items
        .iter()
        .find(|i| i.service_type.as_deref() == Some("pln"))
        .unwrap();
    assert_eq!(pln_item.ppob_status.as_deref(), Some("success"));
    assert_eq!(pln_item.ppob_serial_number.as_deref(), Some("SN-PLN"));
}

/// A checkout with a PPOB line and no PIN never reaches the executor or
/// persists anything — validation runs before the transaction is written.
#[tokio::test]
async fn ppob_checkout_without_a_pin_is_rejected() {
    let conn = setup_test_db().await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![pulsa_line()], 12_000.0),
        no_provider,
    )
    .await;

    match result {
        Err(AppError::Validation(msg)) => {
            assert_eq!(msg, "PIN Mitra wajib diisi untuk transaksi PPOB")
        }
        other => panic!("Expected Validation error, got: {:?}", other),
    }
}

/// Same cart, but the PIN is the wrong shape rather than missing.
#[tokio::test]
async fn ppob_checkout_with_a_malformed_pin_is_rejected() {
    let conn = setup_test_db().await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        with_pin(cash_checkout(vec![pulsa_line()], 12_000.0), "12"),
        no_provider,
    )
    .await;

    match result {
        Err(AppError::Validation(msg)) => {
            assert_eq!(msg, "PIN Mitra harus terdiri dari 4-6 digit angka")
        }
        other => panic!("Expected Validation error, got: {:?}", other),
    }
}

#[tokio::test]
async fn checkout_persists_the_net_amount_paid_per_line() {
    let conn = setup_test_db().await;
    let soap = insert_product(&conn, "Sabun", 5_000.0, 10).await;
    let rice = insert_product(&conn, "Beras", 50_000.0, 10).await;

    // Soap 2 x 5.000 = 10.000, rice 1 x 50.000 with a 10.000 line discount
    // => line nets 10.000 + 40.000 = 50.000, minus a 5.000 transaction
    // discount split 20%/80% => 9.000 and 36.000, total 45.000.
    let result = checkout_with_executor(
        &conn,
        &admin(),
        CheckoutTransactionInput {
            transaction_discount: Some(5_000.0),
            ..cash_checkout(
                vec![
                    product_line(soap.id, 2),
                    TransactionItemInput {
                        item_discount: Some(10_000.0),
                        ..product_line(rice.id, 1)
                    },
                ],
                45_000.0,
            )
        },
        no_provider,
    )
    .await
    .expect("checkout success");

    assert_eq!(result.transaction.total_amount, 45_000.0);

    let soap_line = result
        .items
        .iter()
        .find(|item| item.product_id == Some(soap.id))
        .expect("soap line");
    let rice_line = result
        .items
        .iter()
        .find(|item| item.product_id == Some(rice.id))
        .expect("rice line");

    assert_eq!(soap_line.net_subtotal, 9_000.0);
    assert_eq!(rice_line.net_subtotal, 36_000.0);
    assert_eq!(
        soap_line.net_subtotal + rice_line.net_subtotal,
        result.transaction.total_amount
    );
}

// --- Channel: which screen rang the sale up ---

#[tokio::test]
async fn checkout_defaults_to_the_sales_channel() {
    let conn = setup_test_db().await;
    let product = insert_product(&conn, "Beras", 15_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(product.id, 1)], 15_000.0),
        no_provider,
    )
    .await
    .expect("checkout success");

    assert_eq!(result.transaction.channel, CHANNEL_SALES);
}

/// A pulsa line bought on the PPOB page is a real sale — fulfilled like any
/// other — it is only tagged so the goods reports can leave it out.
#[tokio::test]
async fn a_ppob_page_checkout_is_stored_in_the_ppob_channel() {
    let conn = setup_test_db().await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        on_channel(
            with_pin(cash_checkout(vec![pulsa_line()], 12_000.0), "123456"),
            "ppob",
        ),
        |request| async move {
            Ok(PaymentResult {
                product_name: Some("Pulsa Telkomsel 10K".to_string()),
                ..paid(
                    &request,
                    serde_json::json!({ "receipt_text": "STRUK" }),
                    Some("SN-123"),
                )
            })
        },
    )
    .await
    .expect("ppob page checkout success");

    assert_eq!(result.transaction.channel, CHANNEL_PPOB);
    assert_eq!(result.transaction.status, STATUS_COMPLETED);
    assert_eq!(
        result.items[0].ppob_status.as_deref(),
        Some(PPOB_STATUS_SUCCESS),
        "a PPOB-page sale is still fulfilled"
    );
}

/// The PPOB page cannot sell rice. Refusing before anything is written keeps
/// a mistyped cart from taking stock off the shelf.
#[tokio::test]
async fn the_ppob_channel_refuses_a_cart_with_a_product_line() {
    let conn = setup_test_db().await;
    let product = insert_product(&conn, "Beras", 15_000.0, 10).await;

    let error = checkout_with_executor(
        &conn,
        &admin(),
        on_channel(
            cash_checkout(vec![product_line(product.id, 1)], 15_000.0),
            "ppob",
        ),
        no_provider,
    )
    .await
    .expect_err("a product line must not pass as a PPOB-page sale");

    match error {
        AppError::Validation(message) => assert_eq!(
            message,
            "Transaksi di halaman PPOB hanya boleh berisi item PPOB"
        ),
        other => panic!("expected a validation error, got {other:?}"),
    }

    assert_eq!(
        transactions::Entity::find()
            .count(&conn)
            .await
            .expect("count"),
        0,
        "nothing may be written when the channel is refused"
    );
}

#[tokio::test]
async fn an_unknown_channel_is_rejected() {
    let conn = setup_test_db().await;
    let product = insert_product(&conn, "Beras", 15_000.0, 10).await;

    let error = checkout_with_executor(
        &conn,
        &admin(),
        on_channel(
            cash_checkout(vec![product_line(product.id, 1)], 15_000.0),
            "warung",
        ),
        no_provider,
    )
    .await
    .expect_err("an unknown channel must not be stored");

    match error {
        AppError::Validation(message) => {
            assert_eq!(message, "Channel transaksi tidak valid")
        }
        other => panic!("expected a validation error, got {other:?}"),
    }

    assert_eq!(
        transactions::Entity::find()
            .count(&conn)
            .await
            .expect("count"),
        0,
        "nothing may be written when the channel is refused"
    );
}
