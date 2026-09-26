//! Reports and dashboard panels: session-only reads.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use tower::ServiceExt;

use super::{cookie, insert_user_with_pin, login_token, router, same_origin, state};
use crate::test_support::setup_test_db;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/// Reports are reads over a date range, so the interesting cases are that the
/// range survives the query string and that an omitted optional parameter is a
/// default rather than a 400.
#[tokio::test]
async fn a_report_reads_its_window_from_the_query_string() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    for uri in [
        "/api/reports/sales/daily?start_date=2026-09-01&end_date=2026-09-05",
        "/api/reports/sales/monthly?year=2026",
        "/api/reports/sales/period?start_date=2026-09-01&end_date=2026-09-05",
        "/api/reports/sales/receipts?start_date=2026-09-01&end_date=2026-09-05",
        "/api/reports/payment-methods?start_date=2026-09-01&end_date=2026-09-05",
        "/api/reports/products/sales?start_date=2026-09-01&end_date=2026-09-05",
        // No `limit`, so the default applies.
        "/api/reports/products/popular?start_date=2026-09-01&end_date=2026-09-05",
        "/api/reports/returns?start_date=2026-09-01&end_date=2026-09-05",
        // No `search` and no `filter`.
        "/api/reports/stock/current",
        "/api/reports/losses?start_date=2026-09-01&end_date=2026-09-05",
        "/api/reports/cash-flows?start_date=2026-09-01&end_date=2026-09-05",
    ] {
        let response = router(&state)
            .oneshot(
                same_origin(Method::GET, uri)
                    .header(header::COOKIE, cookie(&token))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
    }
}

#[tokio::test]
async fn a_report_needs_a_session() {
    let db = setup_test_db().await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/reports/losses")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

#[tokio::test]
async fn every_dashboard_panel_answers_a_session() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    for uri in [
        "/api/dashboard/summary",
        "/api/dashboard/revenue/daily?days=7",
        "/api/dashboard/payment-methods",
        "/api/dashboard/payment-methods/daily?days=7",
        "/api/dashboard/products/top?limit=5",
        "/api/dashboard/products/low-stock",
        "/api/dashboard/transactions/recent",
    ] {
        let response = router(&state)
            .oneshot(
                same_origin(Method::GET, uri)
                    .header(header::COOKIE, cookie(&token))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
    }
}
