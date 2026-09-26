//! Refunds are booked against the session.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cart_of, cookie, insert_user_with_pin, json_body, login_token, router, same_origin,
    state,
};
use crate::test_support::setup_test_db;

/// `create_refund` believed the `user_id` in its payload and checked nothing, so
/// a return could be booked under anyone's name. The author is now the session.
#[tokio::test]
async fn a_refund_is_recorded_against_the_session_not_the_payload() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let sale = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55")
                .body(json_body(cart_of(product.id, 65_000.0)))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(sale.status(), StatusCode::CREATED);
    let sale = body_json(sale).await;
    let transaction_id = sale["transaction"]["id"].as_i64().expect("id");
    let item_id = sale["items"][0]["id"].as_i64().expect("item id");

    let response = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/refunds")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "transaction_id": transaction_id,
                    "user_id": admin.id,
                    "reason": "rusak",
                    "items": [{
                        "transaction_item_id": item_id,
                        "quantity": 1,
                        "condition": "good",
                    }],
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        body_json(response).await["refund"]["user_id"],
        json!(kasir.id),
        "the refund belongs to whoever's session took it"
    );
}

#[tokio::test]
async fn the_refund_routes_need_a_session() {
    let db = setup_test_db().await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/refunds")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
