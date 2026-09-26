//! Sessions, roles, and identity that comes from the cookie rather than the payload.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use chrono::{Duration, Utc};
use sea_orm::{ActiveModelTrait, EntityTrait, Set};
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::entity::users;
use crate::http::session;
use crate::test_support::setup_test_db;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

#[tokio::test]
async fn logging_in_sets_an_httponly_cookie_that_me_accepts() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let state = state(db.clone());

    let response = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "username": "kasir1", "pin": "1234" })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);

    let set_cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .expect("a session cookie")
        .to_string();
    assert!(set_cookie.starts_with(session::COOKIE_NAME));
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("SameSite=Lax"));
    assert!(
        !set_cookie.contains("Secure"),
        "a plain-HTTP LAN request must not be sent a cookie the browser will withhold"
    );

    let body = body_json(response).await;
    assert_eq!(body["username"], json!("kasir1"));
    assert!(
        body.get("pin_hash").is_none(),
        "the PIN hash must never be serialised to a client"
    );

    // The token in that cookie is what `me` answers to.
    let token = set_cookie
        .split(';')
        .next()
        .and_then(|pair| pair.split_once('='))
        .map(|(_, value)| value.to_string())
        .expect("cookie value");

    let me = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/auth/me")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(me.status(), StatusCode::OK);
    assert_eq!(body_json(me).await["id"], json!(kasir.id));
}

#[tokio::test]
async fn a_guarded_route_refuses_a_request_with_no_cookie() {
    let db = setup_test_db().await;
    let app = router(&state(db));

    let response = app
        .oneshot(
            same_origin(Method::GET, "/api/categories")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body_json(response).await["code"], json!("auth"));
}

#[tokio::test]
async fn a_forged_cookie_is_refused() {
    let db = setup_test_db().await;
    let app = router(&state(db));

    let response = app
        .oneshot(
            same_origin(Method::GET, "/api/categories")
                .header(header::COOKIE, cookie(&"a".repeat(64)))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_expired_session_is_refused() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;

    // Issued far enough in the past that its one-minute lifetime is long gone.
    let token = session::issue(
        &db,
        kasir.id,
        1,
        None,
        None,
        Utc::now() - Duration::hours(2),
    )
    .await
    .expect("issue")
    .token;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/categories")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_revoked_session_is_refused_immediately() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    // Log out through the API, which is what a client actually does.
    let logout = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/auth/logout")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    assert!(
        logout
            .headers()
            .get(header::SET_COOKIE)
            .and_then(|v| v.to_str().ok())
            .expect("cookie is cleared")
            .contains("Max-Age=0"),
        "the browser is told to drop the cookie as well"
    );

    let after = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/categories")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(after.status(), StatusCode::UNAUTHORIZED);
}

/// Deactivating an account has to end its open sessions, not merely stop the
/// next login.
#[tokio::test]
async fn a_session_belonging_to_a_deactivated_user_is_refused() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let mut deactivated: users::ActiveModel = kasir.into();
    deactivated.is_active = Set(false);
    deactivated.update(&db).await.expect("deactivate");

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/categories")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_admin_layer_refuses_a_cashier() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::POST, "/api/categories")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "name": "Sembako" })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(response).await["code"], json!("forbidden"));

    // ...and nothing was written.
    assert_eq!(
        crate::entity::categories::Entity::find()
            .all(&db)
            .await
            .expect("query")
            .len(),
        0
    );
}

#[tokio::test]
async fn an_admin_passes_the_same_route() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/categories")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "name": "Sembako" })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(body_json(response).await["name"], json!("Sembako"));
}

/// A cashier may read the same resource they may not write.
#[tokio::test]
async fn a_cashier_can_read_what_only_an_admin_may_write() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/categories")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await, json!([]));
}

// ---------------------------------------------------------------------------
// Identity comes from the session, never the payload
// ---------------------------------------------------------------------------

/// The whole point of the phase, stated as a test: a cashier who names an admin
/// in the body is still a cashier.
#[tokio::test]
async fn a_caller_id_in_the_body_does_not_grant_anything() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/categories")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "name": "Sembako",
                    "caller_id": admin.id,
                    "callerId": admin.id,
                    "user_id": admin.id,
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
