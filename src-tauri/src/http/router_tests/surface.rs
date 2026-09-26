//! Routes anyone can reach, and the shape every failure takes.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, body_text, cookie, insert_user_with_pin, json_body, login_token, router,
    same_origin, state,
};
use crate::test_support::setup_test_db;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_public_route_answers_without_a_session() {
    let db = setup_test_db().await;
    let app = router(&state(db));

    let response = app
        .oneshot(
            same_origin(Method::GET, "/api/onboarding/status")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await, json!(true));
}

#[tokio::test]
async fn an_unknown_api_endpoint_is_a_json_404() {
    let db = setup_test_db().await;
    let app = router(&state(db));

    let response = app
        .oneshot(
            same_origin(Method::GET, "/api/tidak-ada")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body = body_json(response).await;
    assert_eq!(body["code"], json!("not_found"));
}

/// A deep link into the SPA must reach the SPA. An unknown `/api` path must not.
#[tokio::test]
async fn the_spa_fallback_covers_pages_but_never_the_api() {
    let db = setup_test_db().await;
    let app = router(&state(db.clone()));

    let page = app
        .oneshot(
            same_origin(Method::GET, "/laporan/harian")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(page.status(), StatusCode::OK);
    assert_eq!(
        page.headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("text/html")
    );
    assert!(
        body_text(page).await.contains("<div id=\"root\">"),
        "the SPA shell should be what a deep link receives"
    );

    let api = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/produk-yang-salah-tulis")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(api.status(), StatusCode::NOT_FOUND);
    assert_ne!(
        api.headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("text/html"),
        "a mistyped endpoint must fail as an API call, not succeed as a page"
    );
}

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_validation_failure_is_a_422_with_the_users_own_message() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/categories")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "name": "   " })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = body_json(response).await;
    assert_eq!(body["code"], json!("validation"));
    assert_eq!(body["message"], json!("Nama kategori tidak boleh kosong"));
}

#[tokio::test]
async fn a_malformed_body_is_a_400_in_the_same_shape_as_every_other_error() {
    let db = setup_test_db().await;
    let app = router(&state(db));

    let response = app
        .oneshot(
            same_origin(Method::POST, "/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{ not json"))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(body_json(response).await["code"], json!("bad_request"));
}

/// A JSON body past the global limit is a size problem, not a format one.
#[tokio::test]
async fn an_oversized_json_body_is_a_413_not_a_format_error() {
    let db = setup_test_db().await;
    let app = router(&state(db));

    let response = app
        .oneshot(
            same_origin(Method::POST, "/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(vec![b' '; 32 * 1024 * 1024 + 1]))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(body_json(response).await["code"], json!("validation"));
}
