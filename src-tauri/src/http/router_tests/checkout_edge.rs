//! Checkout, idempotency, the admin corrections and the shift drawer, driven
//! through the real router: the cases the first checkout tests leave open.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use chrono::{Duration, Utc};
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, PaginatorTrait, Set};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tower::ServiceExt;

use super::{
    body_json, cart_of, cookie, insert_user_with_pin, json_body, login_token, router, same_origin,
    state,
};
use crate::entity::{cash_flows, idempotency_keys, products, transactions};
use crate::http::AppState;
use crate::test_support::{insert_product, insert_store_info, setup_test_db};
use crate::utils::time::format_ts;

const KEY: &str = "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55";

async fn post_checkout(
    state: &AppState,
    token: &str,
    key: &str,
    body: Body,
) -> axum::response::Response {
    router(state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", key)
                .body(body)
                .expect("request"),
        )
        .await
        .expect("response")
}

async fn send(
    state: &AppState,
    token: &str,
    method: Method,
    uri: &str,
    body: Option<Value>,
) -> axum::response::Response {
    let builder = same_origin(method, uri).header(header::COOKIE, cookie(token));
    let request = match body {
        Some(value) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(value)),
        None => builder.body(Body::empty()),
    };
    router(state)
        .oneshot(request.expect("request"))
        .await
        .expect("response")
}

async fn sale_count(db: &DatabaseConnection) -> u64 {
    transactions::Entity::find().count(db).await.expect("count")
}

async fn stock_of(db: &DatabaseConnection, product_id: i64) -> i64 {
    products::Entity::find_by_id(product_id)
        .one(db)
        .await
        .expect("query")
        .expect("product")
        .stock
}

/// `sha256` over the parts, each followed by the 0x1f separator — the shape
/// `http::idempotency` stores its row ids and request digests in.
fn digest(parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
        hasher.update([0x1f]);
    }
    hex::encode(hasher.finalize())
}

// --- Idempotency ---

/// A body that does not even parse is refused before the key is claimed, so
/// the fixed cart goes through on the same key as a fresh sale.
#[tokio::test]
async fn a_malformed_body_does_not_use_up_the_key() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let rice = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let broken = post_checkout(
        &state,
        &token,
        KEY,
        json_body(json!({ "items": "not a list", "payment_method": "cash" })),
    )
    .await;
    assert!(broken.status().is_client_error(), "got {}", broken.status());

    let fixed = post_checkout(&state, &token, KEY, json_body(cart_of(rice.id, 65_000.0))).await;
    assert_eq!(fixed.status(), StatusCode::CREATED);
    assert!(fixed.headers().get("idempotency-replayed").is_none());
    assert_eq!(sale_count(&db).await, 1);
}

/// Keys are per cashier. Two tills that happen to send the same key are two
/// sales, and neither is shown the other's receipt.
#[tokio::test]
async fn the_same_key_from_two_cashiers_is_two_sales() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let rice = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    let first = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let second = insert_user_with_pin(&db, "kasir2", "1234", "kasir").await;
    let state = state(db.clone());

    let a = post_checkout(
        &state,
        &login_token(&db, first.id).await,
        KEY,
        json_body(cart_of(rice.id, 65_000.0)),
    )
    .await;
    let b = post_checkout(
        &state,
        &login_token(&db, second.id).await,
        KEY,
        json_body(cart_of(rice.id, 65_000.0)),
    )
    .await;

    assert_eq!(a.status(), StatusCode::CREATED);
    assert_eq!(b.status(), StatusCode::CREATED);
    assert!(b.headers().get("idempotency-replayed").is_none());
    let (a, b) = (body_json(a).await, body_json(b).await);
    assert_ne!(
        a["transaction"]["receipt_number"],
        b["transaction"]["receipt_number"]
    );
    assert_eq!(b["transaction"]["user_id"], json!(second.id));
    assert_eq!(sale_count(&db).await, 2);
    assert_eq!(stock_of(&db, rice.id).await, 8);
}

/// A retry after the sale was voided replays the original answer; it does not
/// sell the goods a second time.
#[tokio::test]
async fn a_retry_after_a_void_replays_and_sells_nothing_new() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let rice = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    let admin_token = login_token(&db, 1).await;
    let state = state(db.clone());

    let first = post_checkout(
        &state,
        &admin_token,
        KEY,
        json_body(cart_of(rice.id, 65_000.0)),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let id = body_json(first).await["transaction"]["id"]
        .as_i64()
        .expect("id");

    let voided = send(
        &state,
        &admin_token,
        Method::DELETE,
        &format!("/api/transactions/{id}"),
        Some(json!({ "reason": "Salah input" })),
    )
    .await;
    assert_eq!(voided.status(), StatusCode::NO_CONTENT);

    let retry = post_checkout(
        &state,
        &admin_token,
        KEY,
        json_body(cart_of(rice.id, 65_000.0)),
    )
    .await;
    assert_eq!(retry.status(), StatusCode::CREATED);
    assert!(retry.headers().get("idempotency-replayed").is_some());
    assert_eq!(sale_count(&db).await, 1);
    assert_eq!(stock_of(&db, rice.id).await, 10);
}

/// The app was killed mid-checkout (a power cut at the shop): the sale rolled
/// back with the process but its key stayed `in_progress`. The cart and its
/// key are kept in `localStorage`, so after the restart the cashier presses
/// pay again with the same key — and is told "still processing" for the next
/// 24 hours, with no way to ring that cart up.
#[tokio::test]
async fn a_key_stranded_in_progress_by_a_crash_does_not_block_the_cart_for_a_day() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let rice = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let body = serde_json::to_vec(&cart_of(rice.id, 65_000.0)).expect("serialise");
    let crashed_at = Utc::now() - Duration::hours(1);
    idempotency_keys::ActiveModel {
        id: Set(digest(&[
            b"checkout",
            kasir.id.to_string().as_bytes(),
            KEY.as_bytes(),
        ])),
        scope: Set("checkout".to_string()),
        user_id: Set(kasir.id),
        request_hash: Set(digest(&[&body])),
        status: Set("in_progress".to_string()),
        response_body: Set(None),
        created_at: Set(format_ts(crashed_at)),
        expires_at: Set(format_ts(crashed_at + Duration::hours(24))),
        transaction_id: Set(None),
        claim_nonce: Set("crashed-claim".to_string()),
    }
    .insert(&db)
    .await
    .expect("stranded key");
    assert_eq!(sale_count(&db).await, 0, "the crashed sale never committed");

    let retry = post_checkout(&state, &token, KEY, Body::from(body)).await;

    assert_eq!(
        retry.status(),
        StatusCode::CREATED,
        "an hour-old in_progress key with no sale behind it must not block the cart"
    );
    assert_eq!(sale_count(&db).await, 1);
}

// --- Receipt number preview ---

#[tokio::test]
async fn the_receipt_number_preview_is_the_number_the_next_sale_gets() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let rice = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    let token = login_token(&db, 1).await;
    let state = state(db.clone());

    let preview = send(
        &state,
        &token,
        Method::GET,
        "/api/transactions/next-receipt-number",
        None,
    )
    .await;
    assert_eq!(preview.status(), StatusCode::OK);
    let preview = body_json(preview).await;

    let sale = post_checkout(&state, &token, KEY, json_body(cart_of(rice.id, 65_000.0))).await;
    assert_eq!(
        body_json(sale).await["transaction"]["receipt_number"],
        preview
    );
    assert!(preview
        .as_str()
        .is_some_and(|n| n.starts_with("TRX-") && n.ends_with("-0001")));
}

// --- Admin corrections ---

#[tokio::test]
async fn an_admin_voids_once_and_the_goods_go_back_once() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let rice = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    let token = login_token(&db, 1).await;
    let state = state(db.clone());

    let sale = post_checkout(&state, &token, KEY, json_body(cart_of(rice.id, 65_000.0))).await;
    let id = body_json(sale).await["transaction"]["id"]
        .as_i64()
        .expect("id");
    assert_eq!(stock_of(&db, rice.id).await, 9);

    let uri = format!("/api/transactions/{id}");
    let first = send(
        &state,
        &token,
        Method::DELETE,
        &uri,
        Some(json!({ "reason": "Salah" })),
    )
    .await;
    assert_eq!(first.status(), StatusCode::NO_CONTENT);
    let second = send(
        &state,
        &token,
        Method::DELETE,
        &uri,
        Some(json!({ "reason": "Salah" })),
    )
    .await;
    assert_eq!(second.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(stock_of(&db, rice.id).await, 10);

    let missing = send(
        &state,
        &token,
        Method::DELETE,
        "/api/transactions/9999",
        Some(json!({ "reason": "Salah" })),
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn only_an_admin_corrects_a_payment_method() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let rice = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let kasir_token = login_token(&db, kasir.id).await;
    let admin_token = login_token(&db, 1).await;
    let state = state(db.clone());

    let sale = post_checkout(
        &state,
        &kasir_token,
        KEY,
        json_body(cart_of(rice.id, 65_000.0)),
    )
    .await;
    let id = body_json(sale).await["transaction"]["id"]
        .as_i64()
        .expect("id");
    let uri = format!("/api/transactions/{id}/payment-method");
    let body = json!({ "payment_method": "qris", "reason": "Salah pilih" });

    let refused = send(
        &state,
        &kasir_token,
        Method::PATCH,
        &uri,
        Some(body.clone()),
    )
    .await;
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);

    let corrected = send(&state, &admin_token, Method::PATCH, &uri, Some(body)).await;
    assert_eq!(corrected.status(), StatusCode::OK);
    assert_eq!(body_json(corrected).await["payment_method"], json!("qris"));

    let detail = send(
        &state,
        &kasir_token,
        Method::GET,
        &format!("/api/transactions/{id}"),
        None,
    )
    .await;
    let detail = body_json(detail).await;
    assert_eq!(
        detail["payment_breakdown"],
        json!([{ "payment_method": "qris", "bank_name": null, "amount": 65_000.0 }])
    );
}

// --- Shift drawer ---

async fn open_shift(state: &AppState, token: &str) -> i64 {
    let opened = send(
        state,
        token,
        Method::POST,
        "/api/shifts",
        Some(json!({ "openingCash": 100_000.0 })),
    )
    .await;
    assert_eq!(opened.status(), StatusCode::CREATED);
    body_json(opened).await["id"].as_i64().expect("shift id")
}

/// A sale over HTTP lands in the cashier's shift and shows in its summary.
#[tokio::test]
async fn a_sale_over_http_shows_in_the_cashiers_shift_summary() {
    let db = setup_test_db().await;
    insert_store_info(&db, false).await;
    let rice = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());
    let shift_id = open_shift(&state, &token).await;

    let sale = post_checkout(
        &state,
        &token,
        KEY,
        json_body(json!({
            "items": [{ "product_id": rice.id, "quantity": 1 }],
            "payment_method": "cash",
            "payment_amount": 100_000.0,
        })),
    )
    .await;
    assert_eq!(sale.status(), StatusCode::CREATED);

    let summary = send(
        &state,
        &token,
        Method::GET,
        &format!("/api/shifts/{shift_id}/summary"),
        None,
    )
    .await;
    assert_eq!(summary.status(), StatusCode::OK);
    let summary = body_json(summary).await;
    assert_eq!(summary["totalTransactions"], json!(1));
    assert_eq!(summary["expectedCash"], json!(165_000.0));
}

/// JSON cannot say infinity, but `1e400` overflows into it in some parsers.
/// Whatever the parser does, the drawer must not end up holding infinity.
#[tokio::test]
async fn an_overflowing_cash_flow_amount_never_reaches_the_drawer() {
    let db = setup_test_db().await;
    let token = login_token(&db, 1).await;
    let state = state(db.clone());
    let shift_id = open_shift(&state, &token).await;

    let response = router(&state)
        .oneshot(
            same_origin(Method::POST, &format!("/api/shifts/{shift_id}/cash-flows"))
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"flowType":"in","amount":1e400,"description":"Kas"}"#,
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert!(
        response.status().is_client_error(),
        "got {}",
        response.status()
    );
    assert_eq!(
        cash_flows::Entity::find().count(&db).await.expect("count"),
        0
    );
}

#[tokio::test]
async fn a_shift_closes_once_over_http() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());
    let shift_id = open_shift(&state, &token).await;
    let uri = format!("/api/shifts/{shift_id}/close");

    let negative = send(
        &state,
        &token,
        Method::POST,
        &uri,
        Some(json!({ "closingCash": -1.0 })),
    )
    .await;
    assert_eq!(negative.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let first = send(
        &state,
        &token,
        Method::POST,
        &uri,
        Some(json!({ "closingCash": 100_000.0 })),
    )
    .await;
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(body_json(first).await["shift"]["status"], json!("closed"));

    let second = send(
        &state,
        &token,
        Method::POST,
        &uri,
        Some(json!({ "closingCash": 1.0 })),
    )
    .await;
    assert_eq!(second.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let active = send(&state, &token, Method::GET, "/api/shifts/active", None).await;
    assert_eq!(body_json(active).await, Value::Null);
}
