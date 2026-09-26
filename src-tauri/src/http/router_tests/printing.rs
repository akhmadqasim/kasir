//! The struk preview and the printer settings.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use sea_orm::{ActiveModelTrait, Set};
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::entity::store_info;
use crate::test_support::setup_test_db;
use crate::utils::time::now_ts;

// ---------------------------------------------------------------------------
// Receipt lines (struk preview)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_receipt_lines_route_requires_a_session() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let sale =
        crate::test_support::insert_transaction(&db, kasir.id, 65_000.0, "completed", &now_ts())
            .await;

    let response = router(&state(db))
        .oneshot(
            same_origin(
                Method::GET,
                &format!("/api/transactions/{}/receipt/lines", sale.id),
            )
            .body(Body::empty())
            .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// The preview is drawn by the exact same formatter the printer uses, so a
/// dashed separator line — full width, nothing else on it — is a reliable
/// sign of which column count (32 vs. 42) a given paper width produced.
#[tokio::test]
async fn the_receipt_lines_route_follows_the_requested_paper_width() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let sale =
        crate::test_support::insert_transaction(&db, kasir.id, 65_000.0, "completed", &now_ts())
            .await;
    crate::test_support::insert_transaction_item(
        &db,
        sale.id,
        Some(product.id),
        "Beras 5kg",
        65_000.0,
        50_000.0,
        1,
    )
    .await;
    let state = state(db);

    let lines_for = |paper: u8| {
        let state = state.clone();
        let token = token.clone();
        async move {
            let response = router(&state)
                .oneshot(
                    same_origin(
                        Method::GET,
                        &format!("/api/transactions/{}/receipt/lines?paper={paper}", sale.id),
                    )
                    .header(header::COOKIE, cookie(&token))
                    .body(Body::empty())
                    .expect("request"),
                )
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::OK);
            body_json(response)
                .await
                .as_array()
                .expect("a list of lines")
                .iter()
                .map(|line| line["text"].as_str().expect("text").to_string())
                .collect::<Vec<_>>()
        }
    };

    let narrow = lines_for(58).await;
    let wide = lines_for(80).await;

    assert!(
        narrow.contains(&"-".repeat(32)),
        "58mm must render at 32 columns: {narrow:?}"
    );
    assert!(
        wide.contains(&"-".repeat(42)),
        "80mm must render at 42 columns: {wide:?}"
    );
}

/// No `?paper=` at all falls back to the store's own printer settings, the
/// same width `print` would have used.
#[tokio::test]
async fn the_receipt_lines_route_defaults_to_the_configured_paper_width() {
    let db = setup_test_db().await;
    store_info::ActiveModel {
        id: Set(1),
        name: Set("Toko Test".to_string()),
        address: Set(None),
        phone: Set(None),
        email: Set(None),
        logo_path: Set(None),
        additional_info: Set(Some(
            json!({
                "sales": { "allow_negative_stock": true, "default_payment_method": "cash" },
                "paper_width": 80,
            })
            .to_string(),
        )),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(&db)
    .await
    .expect("store info insert");
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let sale =
        crate::test_support::insert_transaction(&db, kasir.id, 65_000.0, "completed", &now_ts())
            .await;

    let response = router(&state(db))
        .oneshot(
            same_origin(
                Method::GET,
                &format!("/api/transactions/{}/receipt/lines", sale.id),
            )
            .header(header::COOKIE, cookie(&token))
            .body(Body::empty())
            .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let lines: Vec<String> = body_json(response)
        .await
        .as_array()
        .expect("a list of lines")
        .iter()
        .map(|line| line["text"].as_str().expect("text").to_string())
        .collect();
    assert!(
        lines.contains(&"-".repeat(42)),
        "no ?paper= must fall back to the store's own 80mm setting: {lines:?}"
    );
}

// ---------------------------------------------------------------------------
// Printers
// ---------------------------------------------------------------------------

/// `update_printer_settings` had no role check of any kind. The admin group is
/// where it gets one, so a cashier changing the paper width is now a 403 rather
/// than a silent write.
#[tokio::test]
async fn a_cashier_may_read_the_printer_settings_but_not_change_them() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    let read = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/printers/settings")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(read.status(), StatusCode::OK);

    let write = router(&state)
        .oneshot(
            same_origin(Method::PUT, "/api/printers/settings")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "paper_width": 58 })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(write.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn the_printer_routes_need_a_session() {
    let db = setup_test_db().await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/printers")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
