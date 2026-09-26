//! Checkout and the idempotency key that guards it.

use axum::http::{header, Method, StatusCode};
use sea_orm::EntityTrait;
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cart_of, cookie, insert_user_with_pin, json_body, login_token, router, same_origin,
    state,
};
use crate::http::AppState;
use crate::test_support::setup_test_db;
use crate::utils::time::now_ts;

/// The failure mode HTTP introduced and IPC did not: the sale commits, the
/// answer is lost, the client retries. Without a key that is two sales; with one
/// it is the same sale, twice reported.
#[tokio::test]
async fn a_retried_checkout_returns_the_first_sale_and_does_not_ring_up_a_second() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let key = "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55";
    let send = |state: AppState, token: String| {
        let cart = cart_of(product.id, 65_000.0);
        async move {
            router(&state)
                .oneshot(
                    same_origin(Method::POST, "/api/transactions")
                        .header(header::COOKIE, cookie(&token))
                        .header(header::CONTENT_TYPE, "application/json")
                        .header("idempotency-key", key)
                        .body(json_body(cart))
                        .expect("request"),
                )
                .await
                .expect("response")
        }
    };

    let first = send(state.clone(), token.clone()).await;
    assert_eq!(first.status(), StatusCode::CREATED);
    assert!(first.headers().get("idempotency-replayed").is_none());
    let first_body = body_json(first).await;
    let receipt = first_body["transaction"]["receipt_number"].clone();
    assert!(receipt.is_string());

    let second = send(state, token).await;
    assert_eq!(second.status(), StatusCode::CREATED);
    assert_eq!(
        second
            .headers()
            .get("idempotency-replayed")
            .and_then(|v| v.to_str().ok()),
        Some("true"),
        "the second answer must be the stored one"
    );
    let second_body = body_json(second).await;
    assert_eq!(second_body, first_body, "a retry must replay, not re-run");

    // The two things a double charge would show up in.
    assert_eq!(
        crate::entity::transactions::Entity::find()
            .all(&db)
            .await
            .expect("query")
            .len(),
        1,
        "the retry must not have created a second transaction"
    );
    assert_eq!(
        crate::entity::products::Entity::find_by_id(product.id)
            .one(&db)
            .await
            .expect("query")
            .expect("product")
            .stock,
        9,
        "stock must have been deducted exactly once"
    );
}

/// The guard is not optional. A client that forgets the header is told so
/// rather than quietly given the unprotected behaviour.
#[tokio::test]
async fn a_checkout_without_an_idempotency_key_is_refused() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(cart_of(product.id, 65_000.0)))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(body_json(response).await["code"], json!("bad_request"));
    assert_eq!(
        crate::entity::transactions::Entity::find()
            .all(&db)
            .await
            .expect("query")
            .len(),
        0
    );
}

/// Reusing a key for a genuinely different cart is a client bug. Replaying the
/// first answer would swallow a real sale, so it is refused instead.
#[tokio::test]
async fn a_reused_key_with_a_different_cart_is_refused() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());
    let key = "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55";

    let first = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", key)
                .body(json_body(cart_of(product.id, 65_000.0)))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(first.status(), StatusCode::CREATED);

    let different = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", key)
                .body(json_body(json!({
                    "items": [{ "product_id": product.id, "quantity": 3 }],
                    "payment_method": "cash",
                    "payment_amount": 195_000.0,
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(different.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        crate::entity::transactions::Entity::find()
            .all(&db)
            .await
            .expect("query")
            .len(),
        1
    );
}

/// A refused sale must give the key back, or the cashier who fixes the cart is
/// told the sale already happened.
#[tokio::test]
async fn a_failed_checkout_frees_its_key_for_the_corrected_retry() {
    let db = setup_test_db().await;
    // Negative stock disallowed, so a cart bigger than stock is refused.
    crate::test_support::insert_store_info(&db, false).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 1).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());
    let key = "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55";

    let refused = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", key)
                .body(json_body(json!({
                    "items": [{ "product_id": product.id, "quantity": 5 }],
                    "payment_method": "cash",
                    "payment_amount": 325_000.0,
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let corrected = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", key)
                .body(json_body(cart_of(product.id, 65_000.0)))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(
        corrected.status(),
        StatusCode::CREATED,
        "the same key must work once the cart is fixed"
    );
}

/// The PPOB page rings its own sales up through the same route, tagged so the
/// goods reports can leave them out. The body field travels through serde; the
/// route itself needs no say in it.
#[tokio::test]
async fn a_checkout_may_name_the_ppob_channel() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55")
                .body(json_body(json!({
                    "items": [{
                        "product_id": null,
                        "quantity": 1,
                        "product_name": "Pulsa Telkomsel 10K",
                        "product_price": 12_000.0,
                        "buy_price": 10_000.0,
                        "service_type": "pulsa",
                        "service_ref": "08123456789",
                        "ppob_product_id": 101,
                        "ppob_product_code": "TS10",
                    }],
                    "payment_method": "cash",
                    "payment_amount": 12_000.0,
                    "ppob_pin": "123456",
                    "channel": "ppob",
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::CREATED);

    let stored = crate::entity::transactions::Entity::find()
        .all(&db)
        .await
        .expect("query");
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].channel, "ppob");
}

/// The sale is recorded against the session, not against anything the payload
/// says. This is the `checkout_transaction` hole the phase exists to close.
#[tokio::test]
async fn a_checkout_is_recorded_against_the_logged_in_cashier() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let mut cart = cart_of(product.id, 65_000.0);
    cart["user_id"] = json!(admin.id);
    cart["userId"] = json!(admin.id);

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55")
                .body(json_body(cart))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        body_json(response).await["transaction"]["user_id"],
        json!(kasir.id),
        "a cashier must not be able to sell under the admin's name"
    );
}

/// Voiding is admin-only even though the route sits in the session group: the
/// service is what decides, and it decides the same way for both transports.
#[tokio::test]
async fn a_cashier_cannot_void_a_sale() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let sale =
        crate::test_support::insert_transaction(&db, kasir.id, 65_000.0, "completed", &now_ts())
            .await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::DELETE, &format!("/api/transactions/{}", sale.id))
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "reason": "salah input" })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
