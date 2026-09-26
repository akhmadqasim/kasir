//! Client log entries.

use axum::http::{header, Method, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use super::{
    cookie, insert_user_with_pin, json_body, login_token, router, same_origin, scratch_data_dir,
    state,
};
use crate::test_support::setup_test_db;

/// An unauthenticated endpoint that appends caller-supplied text to a file on
/// the till is a way to fill a disk, so this one needs a session like the rest.
#[tokio::test]
async fn the_log_route_needs_a_session_and_then_accepts_an_entry() {
    scratch_data_dir();
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    let anonymous = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/logs")
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "level": "error", "message": "boom" })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let accepted = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/logs")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "level": "error",
                    "message": "gagal render struk",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(accepted.status(), StatusCode::NO_CONTENT);
}
