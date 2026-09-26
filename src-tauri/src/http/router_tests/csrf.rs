//! The Origin/Referer check on state-changing requests.

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use sea_orm::EntityTrait;
use serde_json::json;
use tower::ServiceExt;

use super::{body_json, cookie, insert_user_with_pin, json_body, login_token, router, state, HOST};
use crate::test_support::setup_test_db;

#[tokio::test]
async fn a_write_from_a_foreign_origin_is_refused() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/categories")
                .header(header::HOST, HOST)
                .header(header::ORIGIN, "http://toko-jahat.example")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "name": "Diretas" })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(response).await["code"], json!("csrf"));

    assert_eq!(
        crate::entity::categories::Entity::find()
            .all(&db)
            .await
            .expect("query")
            .len(),
        0,
        "a rejected cross-origin write must not reach the database"
    );
}

/// The CSRF layer sits outside authentication, so a cross-origin request is
/// refused before its cookie is even looked up.
#[tokio::test]
async fn a_cross_origin_write_is_refused_before_authentication() {
    let db = setup_test_db().await;
    let app = router(&state(db));

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/login")
                .header(header::HOST, HOST)
                .header(header::ORIGIN, "http://toko-jahat.example")
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "username": "admin", "pin": "1234" })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(response).await["code"], json!("csrf"));
}

#[tokio::test]
async fn a_write_with_no_origin_header_at_all_is_refused() {
    let db = setup_test_db().await;
    let app = router(&state(db));

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/login")
                .header(header::HOST, HOST)
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "username": "admin", "pin": "1234" })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

/// Reads are exempt: a page navigation carries no `Origin`, and refusing them
/// would make the SPA unloadable.
#[tokio::test]
async fn a_read_without_an_origin_is_allowed() {
    let db = setup_test_db().await;
    let app = router(&state(db));

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/onboarding/status")
                .header(header::HOST, HOST)
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
}
