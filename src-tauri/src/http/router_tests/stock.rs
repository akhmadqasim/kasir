//! Stock write-offs: the router's role check and the service's finer rule.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::test_support::setup_test_db;

/// Approval is an admin action, and it is the router that says so.
#[tokio::test]
async fn a_cashier_cannot_approve_a_writeoff() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/stock/writeoffs/1/approve")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(response).await["code"], json!("forbidden"));
}

/// Recording a write-off is a session route, but `lost` is admin-only — there is
/// no broken bottle to hold up as evidence. That rule is finer than the router
/// can express, so the service holds it, and it has to survive the trip through
/// HTTP intact.
#[tokio::test]
async fn a_cashier_may_write_off_breakage_but_not_a_loss() {
    let db = setup_test_db().await;
    let product =
        crate::test_support::insert_product(&db, "Telur 1kg", 25_000.0, 30_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let damaged = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/stock/writeoffs")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "productId": product.id,
                    "quantity": 1,
                    "reason": "damaged",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(damaged.status(), StatusCode::CREATED);
    let body = body_json(damaged).await;
    assert_eq!(body["userId"], json!(kasir.id));
    assert_eq!(
        body["status"],
        json!("approved"),
        "the broken goods are in the storeroom; a cashier does not need an admin \
         to write them off, and the stock came off either way"
    );
    assert_eq!(body["approvedBy"], json!(kasir.id));

    let lost = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/stock/writeoffs")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "productId": product.id,
                    "quantity": 1,
                    "reason": "lost",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(lost.status(), StatusCode::FORBIDDEN);
}
