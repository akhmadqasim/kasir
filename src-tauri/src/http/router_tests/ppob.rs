//! PPOB guards that must fire before anything reaches the vendor.
//!
//! Everything past these checks talks to a third party over the network, so what
//! is worth asserting in-process is that the guards fire *before* it does.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::test_support::setup_test_db;

/// The payment-point search is a catalogue route like every other `/ppob/*`
/// endpoint: any logged-in user, but not an anonymous one. It never reaches
/// the Mitra client here — `require_session` rejects the request first — so
/// this needs no PPOB credentials fixture at all.
#[tokio::test]
async fn the_ppob_payment_point_search_route_requires_a_session() {
    let db = setup_test_db().await;

    let response = router(&state(db))
        .oneshot(
            same_origin(
                Method::GET,
                "/api/ppob/catalog/payment-points/search?q=indihome",
            )
            .body(Body::empty())
            .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Opening the upstream session acts on the shop's own credentials, so it is a
/// configuration action rather than a selling one.
#[tokio::test]
async fn opening_the_ppob_session_is_closed_to_a_cashier() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/ppob/session")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

/// PPOB money is only ever spent inside a sales transaction. The old standalone
/// `/ppob/payments` and `/ppob/topups` routes, which charged the Mitra balance
/// with no receipt behind it, are gone.
#[tokio::test]
async fn there_is_no_standalone_ppob_spend_route() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    for path in ["/api/ppob/payments", "/api/ppob/topups"] {
        let response = router(&state)
            .oneshot(
                same_origin(Method::POST, path)
                    .header(header::COOKIE, cookie(&token))
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("idempotency-key", "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55")
                    .body(json_body(
                        json!({ "serviceType": "pln", "inquiryId": "INQ-1" }),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn the_ppob_routes_need_a_session() {
    let db = setup_test_db().await;
    let state = state(db);

    for (method, uri) in [
        (Method::GET, "/api/ppob/balance"),
        (Method::GET, "/api/ppob/catalog/providers"),
        (Method::GET, "/api/ppob/history"),
        (Method::GET, "/api/ppob/notifications"),
    ] {
        let response = router(&state)
            .oneshot(
                same_origin(method, uri)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{uri}");
    }
}

/// The history struk is printed at a sell price chosen on the spot. A negative
/// one is refused before anything is looked up — as a 400, because nothing
/// downstream could do anything with it.
#[tokio::test]
async fn a_history_struk_refuses_a_negative_sell_price() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    let print = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/ppob/history/111100000001/print")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "sellPrice": -1 })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(print.status(), StatusCode::BAD_REQUEST);
    assert_eq!(body_json(print).await["code"], json!("bad_request"));

    let preview = router(&state)
        .oneshot(
            same_origin(
                Method::GET,
                "/api/ppob/history/111100000001/receipt?sellPrice=-500",
            )
            .header(header::COOKIE, cookie(&token))
            .body(Body::empty())
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(preview.status(), StatusCode::BAD_REQUEST);

    // No price at all is the same malformed request.
    let missing = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/ppob/history/111100000001/receipt")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(missing.status(), StatusCode::BAD_REQUEST);
}

/// Printing from the PPOB history is a selling action, so a cashier passes the
/// role check like every other print route. With no printer set up the request
/// stops at the printer, not at the role — and never reaches the vendor.
#[tokio::test]
async fn a_cashier_may_print_a_history_struk() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    let response = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/ppob/history/111100000001/print")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "sellPrice": 25000 })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = body_json(response).await;
    assert_eq!(body["code"], json!("validation"));
    assert_eq!(body["message"], json!("Printer belum dikonfigurasi"));
}

#[tokio::test]
async fn the_history_struk_routes_need_a_session() {
    let db = setup_test_db().await;
    let state = state(db);

    for (method, uri) in [
        (
            Method::GET,
            "/api/ppob/history/111100000001/receipt?sellPrice=25000",
        ),
        (Method::POST, "/api/ppob/history/111100000001/print"),
    ] {
        let response = router(&state)
            .oneshot(
                same_origin(method, uri)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(json_body(json!({ "sellPrice": 25000 })))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{uri}");
    }
}
