//! Refunds and exchanges end to end: a real checkout, a real return, and what
//! the drawer, the shelf and the refund detail say afterwards.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::http::AppState;
use crate::services::refunds::fixtures::stock_of;
use crate::test_support::{insert_product, insert_store_info, setup_test_db};

async fn call(
    state: &AppState,
    method: Method,
    uri: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = same_origin(method.clone(), uri).header(header::COOKIE, cookie(token));
    if method == Method::POST && uri == "/api/transactions" {
        request = request.header("idempotency-key", uuid::Uuid::new_v4().to_string());
    }
    let request = match body {
        Some(value) => request
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(value)),
        None => request.body(Body::empty()),
    }
    .expect("request");

    let response = router(state).oneshot(request).await.expect("response");
    let status = response.status();
    (status, body_json(response).await)
}

/// Ring up a cash sale of `lines` (`(product_id, quantity, item_discount)`)
/// and return `(transaction_id, [transaction_item_id])`.
async fn cash_sale(
    state: &AppState,
    token: &str,
    lines: &[(i64, i64, f64)],
    pay: f64,
) -> (i64, Vec<i64>) {
    let items: Vec<Value> = lines
        .iter()
        .map(|(product_id, quantity, discount)| {
            json!({ "product_id": product_id, "quantity": quantity, "item_discount": discount })
        })
        .collect();
    let (status, body) = call(
        state,
        Method::POST,
        "/api/transactions",
        token,
        Some(json!({ "items": items, "payment_method": "cash", "payment_amount": pay })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "checkout failed: {body}");
    let id = body["transaction"]["id"].as_i64().expect("transaction id");
    let item_ids = body["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| item["id"].as_i64().expect("item id"))
        .collect();
    (id, item_ids)
}

/// The drawer of the cashier's open shift gives back a cash refund in full,
/// and moves only the signed difference of an exchange — a customer who tops
/// up for a dearer replacement puts money in.
#[tokio::test]
async fn returns_and_exchanges_move_the_open_shifts_drawer() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let rice = insert_product(&db, "Beras 1kg", 8_000.0, 10_000.0, 10).await;
    let shirt = insert_product(&db, "Kaos S", 7_000.0, 10_000.0, 5).await;
    let jacket = insert_product(&db, "Jaket", 18_000.0, 25_000.0, 5).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let (status, shift) = call(
        &state,
        Method::POST,
        "/api/shifts",
        &token,
        Some(json!({ "openingCash": 100_000.0 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{shift}");
    let shift_id = shift["id"].as_i64().expect("shift id");

    let (rice_sale, rice_items) = cash_sale(&state, &token, &[(rice.id, 2, 0.0)], 20_000.0).await;
    let (status, refund) = call(
        &state,
        Method::POST,
        "/api/refunds",
        &token,
        Some(json!({
            "transaction_id": rice_sale,
            "items": [{ "transaction_item_id": rice_items[0], "quantity": 1, "condition": "good" }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{refund}");
    assert_eq!(refund["refund"]["shift_id"], json!(shift_id));
    assert_eq!(refund["refund"]["payment_method"], json!("cash"));

    let (_, summary) = call(
        &state,
        Method::GET,
        &format!("/api/shifts/{shift_id}/summary"),
        &token,
        None,
    )
    .await;
    assert_eq!(summary["cashRefunds"], json!(10_000.0));
    assert_eq!(summary["expectedCash"], json!(110_000.0));

    let (shirt_sale, shirt_items) =
        cash_sale(&state, &token, &[(shirt.id, 1, 0.0)], 10_000.0).await;
    let (status, swap) = call(
        &state,
        Method::POST,
        "/api/refunds",
        &token,
        Some(json!({
            "transaction_id": shirt_sale,
            "items": [{ "transaction_item_id": shirt_items[0], "quantity": 1, "condition": "good" }],
            "exchange_items": [{ "product_id": jacket.id, "quantity": 1 }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{swap}");
    assert_eq!(swap["refund"]["difference_amount"], json!(-15_000.0));

    let (_, summary) = call(
        &state,
        Method::GET,
        &format!("/api/shifts/{shift_id}/summary"),
        &token,
        None,
    )
    .await;
    // 100.000 float + 30.000 sales - 10.000 refund + 15.000 top-up.
    assert_eq!(summary["cashRefunds"], json!(-5_000.0));
    assert_eq!(summary["expectedCash"], json!(135_000.0));

    assert_eq!(stock_of(&db, rice.id).await, 9);
    assert_eq!(stock_of(&db, shirt.id).await, 5);
    assert_eq!(stock_of(&db, jacket.id).await, 4);
}

/// A checkout line discount carries through: the refund pays back what was
/// paid, and the detail shows the paid unit price so the line reconciles.
#[tokio::test]
async fn a_discounted_checkout_line_is_refunded_and_shown_at_the_price_paid() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let oil = insert_product(&db, "Minyak 2L", 30_000.0, 40_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    // 2 x 40.000 - 10.000 line discount = 70.000, i.e. 35.000 a unit.
    let (sale, items) = cash_sale(&state, &token, &[(oil.id, 2, 10_000.0)], 70_000.0).await;

    let (status, refund) = call(
        &state,
        Method::POST,
        "/api/refunds",
        &token,
        Some(json!({
            "transaction_id": sale,
            "reason": "Salah beli",
            "items": [{ "transaction_item_id": items[0], "quantity": 1, "condition": "good" }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{refund}");
    assert_eq!(refund["refund"]["total_refund_amount"], json!(35_000.0));
    let refund_id = refund["refund"]["id"].as_i64().expect("refund id");

    let (status, detail) = call(
        &state,
        Method::GET,
        &format!("/api/refunds/{refund_id}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["items"][0]["product_price"], json!(35_000.0));
    assert_eq!(detail["items"][0]["subtotal"], json!(35_000.0));
    assert_eq!(detail["cashier_name"], json!(kasir.full_name));
    assert!(detail["transaction_receipt"]
        .as_str()
        .unwrap_or_default()
        .starts_with("TRX-"));

    // The transaction detail caps the next refund at what is left.
    let (_, txn) = call(
        &state,
        Method::GET,
        &format!("/api/transactions/{sale}"),
        &token,
        None,
    )
    .await;
    assert_eq!(txn["transaction"]["status"], json!("partial_refund"));
}

/// Over-returning is a 422 the form can show, and it writes nothing.
#[tokio::test]
async fn returning_more_than_was_bought_is_a_422() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let soap = insert_product(&db, "Sabun", 3_000.0, 5_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let (sale, items) = cash_sale(&state, &token, &[(soap.id, 1, 0.0)], 5_000.0).await;
    let (status, body) = call(
        &state,
        Method::POST,
        "/api/refunds",
        &token,
        Some(json!({
            "transaction_id": sale,
            "items": [{ "transaction_item_id": items[0], "quantity": 2, "condition": "good" }],
        })),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], json!("validation"));
    assert_eq!(stock_of(&db, soap.id).await, 9);
}

/// A sale voided through the API cannot then be refunded: the void already
/// put the stock back.
#[tokio::test]
async fn a_voided_sale_cannot_be_refunded() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let sugar = insert_product(&db, "Gula", 13_000.0, 16_000.0, 10).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let (sale, items) = cash_sale(&state, &token, &[(sugar.id, 2, 0.0)], 32_000.0).await;
    let (status, body) = call(
        &state,
        Method::DELETE,
        &format!("/api/transactions/{sale}"),
        &token,
        Some(json!({ "reason": "Salah input" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    assert_eq!(stock_of(&db, sugar.id).await, 10);

    let (status, body) = call(
        &state,
        Method::POST,
        "/api/refunds",
        &token,
        Some(json!({
            "transaction_id": sale,
            "items": [{ "transaction_item_id": items[0], "quantity": 2, "condition": "good" }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(stock_of(&db, sugar.id).await, 10);
}

/// Once a sale has a refund it can no longer be voided — that would put the
/// returned units back on the shelf a second time.
#[tokio::test]
async fn a_refunded_sale_cannot_be_voided() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let tea = insert_product(&db, "Teh", 2_000.0, 3_000.0, 10).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let (sale, items) = cash_sale(&state, &token, &[(tea.id, 2, 0.0)], 6_000.0).await;
    let (status, _) = call(
        &state,
        Method::POST,
        "/api/refunds",
        &token,
        Some(json!({
            "transaction_id": sale,
            "items": [{ "transaction_item_id": items[0], "quantity": 1, "condition": "good" }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = call(
        &state,
        Method::DELETE,
        &format!("/api/transactions/{sale}"),
        &token,
        Some(json!({ "reason": "Salah input" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(stock_of(&db, tea.id).await, 9);
}

/// The list filters by type, and an exchange reports its signed difference.
#[tokio::test]
async fn the_refund_list_filters_by_type() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let a = insert_product(&db, "Pensil", 1_000.0, 2_000.0, 10).await;
    let b = insert_product(&db, "Spidol", 4_000.0, 6_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let (sale, items) = cash_sale(&state, &token, &[(a.id, 2, 0.0)], 4_000.0).await;
    for exchange in [None, Some(json!([{ "product_id": b.id, "quantity": 1 }]))] {
        let (status, body) = call(
            &state,
            Method::POST,
            "/api/refunds",
            &token,
            Some(json!({
                "transaction_id": sale,
                "items": [{ "transaction_item_id": items[0], "quantity": 1, "condition": "good" }],
                "exchange_items": exchange,
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }

    let (status, list) = call(
        &state,
        Method::GET,
        "/api/refunds?refund_type=exchange",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["total"], json!(1));
    assert_eq!(list["items"][0]["refund_type"], json!("exchange"));
    assert_eq!(list["items"][0]["difference_amount"], json!(-4_000.0));

    let (_, all) = call(&state, Method::GET, "/api/refunds", &token, None).await;
    assert_eq!(all["total"], json!(2));
}
