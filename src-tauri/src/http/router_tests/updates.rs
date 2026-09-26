//! The self-update routes.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use super::{body_json, cookie, insert_user_with_pin, login_token, router, same_origin, state};
use crate::test_support::setup_test_db;

/// Reading the status and asking for a check are for anyone logged in — a
/// cashier who sees "versi baru tersedia" can fetch the owner. Downloading and
/// installing replace the program on the till, so they are admin routes.
#[tokio::test]
async fn the_update_routes_split_between_session_and_admin() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir_token = login_token(&db, kasir.id).await;
    let admin_token = login_token(&db, admin.id).await;
    let state = state(db);

    let anonymous = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/updates")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let status = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/updates")
                .header(header::COOKIE, cookie(&kasir_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(status.status(), StatusCode::OK);
    let body = body_json(status).await;
    assert_eq!(body["phase"], json!("idle"));
    assert_eq!(body["current_version"], json!(env!("CARGO_PKG_VERSION")));

    for path in ["/api/updates/download", "/api/updates/install"] {
        let refused = router(&state)
            .oneshot(
                same_origin(Method::POST, path)
                    .header(header::COOKIE, cookie(&kasir_token))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(refused.status(), StatusCode::FORBIDDEN, "{path}");
    }

    // An admin gets past the role check and is then told, in a 422 rather
    // than a 500, that there is nothing to download yet.
    let nothing_yet = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/updates/download")
                .header(header::COOKIE, cookie(&admin_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(nothing_yet.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body_json(nothing_yet).await["code"], json!("validation"));
}
