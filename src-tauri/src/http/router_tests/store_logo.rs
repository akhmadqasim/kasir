//! Store logo: an upload checked by content, served back, and removed.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use sea_orm::EntityTrait;
use serde_json::{json, Value};
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, login_token, multipart_content_type, multipart_file,
    router, same_origin, scratch_data_dir, state,
};
use crate::entity::store_info;
use crate::http::AppState;
use crate::test_support::setup_test_db;

/// A minimal but genuine PNG signature followed by padding. The route decides
/// the format from these bytes, never from the part's filename.
fn fake_png() -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(64, 0);
    bytes
}

async fn upload_logo(
    state: &AppState,
    token: &str,
    filename: &str,
    data: &[u8],
) -> axum::response::Response {
    router(state)
        .oneshot(
            same_origin(Method::POST, "/api/settings/store/logo")
                .header(header::COOKIE, cookie(token))
                .header(header::CONTENT_TYPE, multipart_content_type())
                .body(multipart_file("file", filename, data))
                .expect("request"),
        )
        .await
        .expect("response")
}

async fn fetch_logo(state: &AppState, token: &str) -> axum::response::Response {
    router(state)
        .oneshot(
            same_origin(Method::GET, "/api/store/logo")
                .header(header::COOKIE, cookie(token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response")
}

/// The whole life of a logo in one test, because every step touches the same
/// file under the shared scratch directory: split across parallel tests, a
/// delete in one would race the existence check in another.
#[tokio::test]
async fn a_logo_is_uploaded_served_and_removed() {
    let dir = scratch_data_dir();
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, false).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let admin_token = login_token(&db, admin.id).await;
    let kasir_token = login_token(&db, kasir.id).await;
    let state = state(db);

    // Nothing yet: a 404, not an empty body.
    let missing = fetch_logo(&state, &kasir_token).await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    // The filename is a lie; the bytes are a PNG, so the file is `logo.png`.
    let uploaded = upload_logo(&state, &admin_token, "../../toko.svg", &fake_png()).await;
    assert_eq!(uploaded.status(), StatusCode::OK);
    let body = body_json(uploaded).await;
    assert_eq!(body["logo_path"], json!("store/logo.png"));
    assert!(dir.join("store").join("logo.png").exists());
    assert!(!dir.join("toko.svg").exists());

    // It is served back with the type taken from the content.
    let served = fetch_logo(&state, &kasir_token).await;
    assert_eq!(served.status(), StatusCode::OK);
    assert_eq!(
        served
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("image/png")
    );
    assert!(served
        .headers()
        .contains_key(header::CONTENT_SECURITY_POLICY));
    let bytes = axum::body::to_bytes(served.into_body(), usize::MAX)
        .await
        .expect("read body");
    assert_eq!(bytes.as_ref(), fake_png().as_slice());

    // The login screen draws it before anyone has signed in: no cookie needed,
    // and the public store slice says there is one to fetch.
    let anonymous = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/store/logo")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(anonymous.status(), StatusCode::OK);
    let public = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/store/public")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(body_json(public).await["has_logo"], json!(true));

    // Replacing with an SVG leaves no PNG behind.
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><rect width=\"16\" height=\"16\"/></svg>";
    let replaced = upload_logo(&state, &admin_token, "logo.svg", svg).await;
    assert_eq!(replaced.status(), StatusCode::OK);
    assert_eq!(
        body_json(replaced).await["logo_path"],
        json!("store/logo.svg")
    );
    assert!(dir.join("store").join("logo.svg").exists());
    assert!(!dir.join("store").join("logo.png").exists());

    // Removing it clears both the file and the column.
    let removed = router(&state)
        .oneshot(
            same_origin(Method::DELETE, "/api/settings/store/logo")
                .header(header::COOKIE, cookie(&admin_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
    assert!(!dir.join("store").join("logo.svg").exists());

    let store = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/store")
                .header(header::COOKIE, cookie(&admin_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(body_json(store).await["logo_path"], Value::Null);

    let gone = fetch_logo(&state, &admin_token).await;
    assert_eq!(gone.status(), StatusCode::NOT_FOUND);
}

/// Neither the extension nor the `Content-Type` a client claims makes a file an
/// image. Plain text under an image name is refused with a message the settings
/// screen can show.
#[tokio::test]
async fn a_logo_that_is_not_an_image_is_refused() {
    scratch_data_dir();
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, false).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let response = upload_logo(&state, &token, "logo.png", b"ini bukan gambar").await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body_json(response).await["code"], json!("validation"));

    let stored = store_info::Entity::find_by_id(1_i64)
        .one(&db)
        .await
        .expect("query")
        .expect("store row");
    assert_eq!(
        stored.logo_path, None,
        "a refused upload must not be recorded"
    );
}

#[tokio::test]
async fn a_logo_over_one_megabyte_is_refused() {
    scratch_data_dir();
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, false).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let mut big = fake_png();
    big.resize(crate::domain::store_logo::MAX_LOGO_BYTES + 1, 0);

    let response = upload_logo(&state, &token, "logo.png", &big).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body_json(response).await["code"], json!("validation"));
}

#[tokio::test]
async fn the_logo_upload_and_removal_are_closed_to_a_cashier() {
    scratch_data_dir();
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, false).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    let uploaded = upload_logo(&state, &token, "logo.png", &fake_png()).await;
    assert_eq!(uploaded.status(), StatusCode::FORBIDDEN);

    let removed = router(&state)
        .oneshot(
            same_origin(Method::DELETE, "/api/settings/store/logo")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(removed.status(), StatusCode::FORBIDDEN);
}

/// A photo straight off a phone is several megabytes. That has to fail as a
/// size problem the settings screen can explain, not as an unreadable upload.
#[tokio::test]
async fn a_logo_far_over_the_route_limit_is_refused_as_too_large() {
    scratch_data_dir();
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, false).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db);

    let mut huge = fake_png();
    huge.resize(3 * 1024 * 1024, 0);

    let response = upload_logo(&state, &token, "foto.png", &huge).await;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(body_json(response).await["code"], json!("validation"));
}
