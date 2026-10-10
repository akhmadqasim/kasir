//! Who may call what, checked route by route across the whole router.
//!
//! The per-feature files each check one or two routes. This file walks the
//! full table, so a route added to the wrong group (or dropped from the admin
//! group by a refactor) fails here even if nobody wrote a test for it.
//!
//! A `403` from a cashier proves two things at once: the route exists (an
//! unknown path is a `404`), and the admin layer — or the service's own
//! admin check — stood in front of it.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use sea_orm::EntityTrait;
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::entity::{transactions, users};
use crate::test_support::setup_test_db;
use crate::utils::time::now_ts;

/// Every route in the `admin` group of `routes::api_router`, one entry per
/// method. Path parameters are placeholders: the layer refuses before the
/// handler ever looks them up.
const ADMIN_ROUTES: &[(&str, &str)] = &[
    // products
    ("POST", "/api/products"),
    ("POST", "/api/products/bulk"),
    ("PUT", "/api/products/1"),
    ("DELETE", "/api/products/1"),
    // categories
    ("POST", "/api/categories"),
    ("PUT", "/api/categories/1"),
    ("DELETE", "/api/categories/1"),
    // users
    ("GET", "/api/users"),
    ("POST", "/api/users"),
    ("PATCH", "/api/users/1"),
    ("PATCH", "/api/users/1/active"),
    // store and settings
    ("PUT", "/api/store"),
    ("POST", "/api/settings/store/logo"),
    ("DELETE", "/api/settings/store/logo"),
    ("GET", "/api/settings"),
    ("PUT", "/api/settings"),
    ("PUT", "/api/settings/ppob/credentials"),
    ("GET", "/api/settings/database"),
    // stock write-offs
    ("DELETE", "/api/stock/writeoffs/1"),
    ("POST", "/api/stock/writeoffs/1/approve"),
    ("POST", "/api/stock/writeoffs/1/reject"),
    // backups
    ("GET", "/api/backups"),
    ("POST", "/api/backups"),
    ("GET", "/api/backups/status"),
    ("GET", "/api/backups/export"),
    ("POST", "/api/backups/import"),
    ("DELETE", "/api/backups/kasir_backup_2026-01-01.db.gz"),
    ("POST", "/api/backups/kasir_backup_2026-01-01.db.gz/restore"),
    // printers
    ("PUT", "/api/printers/settings"),
    // ppob
    ("POST", "/api/ppob/session"),
    // updates
    ("POST", "/api/updates/download"),
    ("POST", "/api/updates/install"),
];

/// Every route in the `session` group. Anonymous callers must get a `401`
/// from all of them.
const SESSION_ROUTES: &[(&str, &str)] = &[
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/me"),
    ("PUT", "/api/auth/me/pin"),
    ("GET", "/api/products"),
    ("GET", "/api/products/popular"),
    ("GET", "/api/products/lookup"),
    ("GET", "/api/products/import-template"),
    ("GET", "/api/products/barcode/8991234567890"),
    ("POST", "/api/products/1/select"),
    ("POST", "/api/products/1/pin"),
    ("GET", "/api/categories"),
    ("GET", "/api/store"),
    ("GET", "/api/settings/ppob/markup"),
    ("GET", "/api/settings/sales"),
    ("GET", "/api/transactions"),
    ("POST", "/api/transactions"),
    ("GET", "/api/transactions/next-receipt-number"),
    ("GET", "/api/transactions/1"),
    ("DELETE", "/api/transactions/1"),
    ("PATCH", "/api/transactions/1/payment-method"),
    ("GET", "/api/transactions/1/receipt"),
    ("GET", "/api/transactions/1/receipt/lines"),
    ("POST", "/api/transactions/1/print"),
    ("POST", "/api/transaction-items/1/ppob/retry"),
    ("POST", "/api/transaction-items/1/ppob/resolve"),
    ("POST", "/api/transaction-items/1/ppob/check"),
    ("POST", "/api/transaction-items/1/ppob/print"),
    ("GET", "/api/refunds"),
    ("POST", "/api/refunds"),
    ("GET", "/api/refunds/1"),
    ("GET", "/api/stock/writeoffs"),
    ("POST", "/api/stock/writeoffs"),
    ("GET", "/api/stock/writeoffs/1"),
    ("POST", "/api/shifts"),
    ("GET", "/api/shifts/active"),
    ("POST", "/api/shifts/1/close"),
    ("GET", "/api/shifts/1/summary"),
    ("GET", "/api/shifts/1/cash-flows"),
    ("POST", "/api/shifts/1/cash-flows"),
    ("DELETE", "/api/cash-flows/1"),
    ("GET", "/api/reports/sales/daily"),
    ("GET", "/api/reports/sales/monthly"),
    ("GET", "/api/reports/sales/period"),
    ("GET", "/api/reports/sales/receipts"),
    ("GET", "/api/reports/payment-methods"),
    ("GET", "/api/reports/products/sales"),
    ("GET", "/api/reports/products/popular"),
    ("GET", "/api/reports/returns"),
    ("GET", "/api/reports/stock/current"),
    ("GET", "/api/reports/losses"),
    ("GET", "/api/reports/cash-flows"),
    ("GET", "/api/dashboard/summary"),
    ("GET", "/api/dashboard/revenue/daily"),
    ("GET", "/api/dashboard/payment-methods"),
    ("GET", "/api/dashboard/payment-methods/daily"),
    ("GET", "/api/dashboard/products/top"),
    ("GET", "/api/dashboard/products/low-stock"),
    ("GET", "/api/dashboard/transactions/recent"),
    ("GET", "/api/printers"),
    ("GET", "/api/printers/settings"),
    ("POST", "/api/printers/test"),
    ("GET", "/api/ppob/balance"),
    ("GET", "/api/ppob/menu"),
    ("GET", "/api/ppob/catalog/providers"),
    ("POST", "/api/ppob/inquiries/pln"),
    ("POST", "/api/ppob/inquiries/pdam"),
    ("POST", "/api/ppob/inquiries/bpjs"),
    ("GET", "/api/ppob/history"),
    ("GET", "/api/ppob/history/1"),
    ("POST", "/api/ppob/history/1/print"),
    ("GET", "/api/ppob/mutasi"),
    ("GET", "/api/ppob/notifications"),
    ("POST", "/api/ppob/notifications/read-all"),
    ("POST", "/api/ppob/notifications/1/read"),
    ("POST", "/api/logs"),
    ("GET", "/api/updates"),
    ("POST", "/api/updates/check"),
    ("GET", "/api/window/zoom"),
    ("PUT", "/api/window/zoom"),
    ("POST", "/api/window/icon"),
    ("DELETE", "/api/window/icon"),
];

fn method(name: &str) -> Method {
    Method::from_bytes(name.as_bytes()).expect("method")
}

async fn call(
    state: &crate::http::AppState,
    verb: &str,
    path: &str,
    token: Option<&str>,
) -> axum::response::Response {
    let mut request =
        same_origin(method(verb), path).header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        request = request.header(header::COOKIE, cookie(token));
    }
    router(state)
        .oneshot(request.body(json_body(json!({}))).expect("request"))
        .await
        .expect("response")
}

#[tokio::test]
async fn every_admin_route_refuses_a_cashier_with_a_valid_session() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    let mut leaks = Vec::new();
    for (verb, path) in ADMIN_ROUTES {
        let response = call(&state, verb, path, Some(&token)).await;
        let status = response.status();
        let code = body_json(response).await["code"].clone();
        if status != StatusCode::FORBIDDEN || code != json!("forbidden") {
            leaks.push(format!("{verb} {path} -> {status} {code}"));
        }
    }

    assert!(
        leaks.is_empty(),
        "admin routes a cashier was not refused by:\n{}",
        leaks.join("\n")
    );
}

#[tokio::test]
async fn every_admin_route_refuses_an_anonymous_caller() {
    let db = setup_test_db().await;
    let state = state(db);

    let mut leaks = Vec::new();
    for (verb, path) in ADMIN_ROUTES {
        let response = call(&state, verb, path, None).await;
        if response.status() != StatusCode::UNAUTHORIZED {
            leaks.push(format!("{verb} {path} -> {}", response.status()));
        }
    }

    assert!(
        leaks.is_empty(),
        "admin routes open without a session:\n{}",
        leaks.join("\n")
    );
}

#[tokio::test]
async fn every_session_route_refuses_an_anonymous_caller() {
    let db = setup_test_db().await;
    let state = state(db);

    let mut leaks = Vec::new();
    for (verb, path) in SESSION_ROUTES {
        let response = call(&state, verb, path, None).await;
        let status = response.status();
        let code = body_json(response).await["code"].clone();
        if status != StatusCode::UNAUTHORIZED || code != json!("auth") {
            leaks.push(format!("{verb} {path} -> {status} {code}"));
        }
    }

    assert!(
        leaks.is_empty(),
        "session routes reachable without a session:\n{}",
        leaks.join("\n")
    );
}

/// The admin layer refuses a cashier before the body is read, so a broken
/// body cannot turn the answer into a `400`/`422` that tells the caller
/// something about the route's input shape.
#[tokio::test]
async fn a_cashier_is_refused_before_the_body_is_parsed() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/users")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{ not json"))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

/// Correcting a sale's payment method sits in the session group; the service
/// is what keeps a cashier out. The row must be left as it was.
#[tokio::test]
async fn a_cashier_cannot_change_the_payment_method_of_a_sale() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let sale =
        crate::test_support::insert_transaction(&db, kasir.id, 65_000.0, "completed", &now_ts())
            .await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(
                Method::PATCH,
                &format!("/api/transactions/{}/payment-method", sale.id),
            )
            .header(header::COOKIE, cookie(&token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(json!({
                "payment_method": "qris",
                "reason": "salah pilih",
            })))
            .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let row = transactions::Entity::find_by_id(sale.id)
        .one(&db)
        .await
        .expect("query")
        .expect("sale");
    assert_eq!(row.payment_method, "cash");
}

/// The role is read from the account on every request, not frozen into the
/// session at login: an admin demoted to kasir loses the admin routes on the
/// very next call, without logging out.
#[tokio::test]
async fn a_demoted_admin_loses_the_admin_routes_on_the_next_request() {
    let db = setup_test_db().await;
    let boss = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let other = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let boss_token = login_token(&db, boss.id).await;
    let other_token = login_token(&db, other.id).await;
    let state = state(db.clone());

    let before = call(&state, "GET", "/api/users", Some(&other_token)).await;
    assert_eq!(before.status(), StatusCode::OK);

    let demoted = router(&state)
        .oneshot(
            same_origin(Method::PATCH, &format!("/api/users/{}", other.id))
                .header(header::COOKIE, cookie(&boss_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "role": "kasir" })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(demoted.status(), StatusCode::OK);

    let after = call(&state, "GET", "/api/users", Some(&other_token)).await;
    assert_eq!(after.status(), StatusCode::FORBIDDEN);

    let row = users::Entity::find_by_id(other.id)
        .one(&db)
        .await
        .expect("query")
        .expect("user");
    assert_eq!(row.role, "kasir");
}
