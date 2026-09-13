//! End-to-end tests for the HTTP layer, driven through the real router.
//!
//! Every case goes through `tower::ServiceExt::oneshot`, which runs the exact
//! `Router` [`crate::http::start`] serves — same middleware, same order — without
//! binding a port. That matters more than it sounds: most of what is being
//! tested here *is* the middleware order, and a test that assembled its own
//! router would prove nothing about the one that ships.

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use chrono::{Duration, Utc};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, NotSet, QueryFilter, Set,
};
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::entity::{store_info, users};
use crate::http::{session, AppState, ServerConfig};
use crate::test_support::{now_ts, setup_test_db};

/// The authority every test request claims, on both the `Host` and `Origin`
/// sides, so same-origin is the default and a mismatch is deliberate.
const HOST: &str = "127.0.0.1:17720";

fn state(db: DatabaseConnection) -> AppState {
    AppState::new(db, ServerConfig::default())
}

fn router(state: &AppState) -> axum::Router {
    crate::http::router(state.clone())
}

/// A request that looks like it came from the app's own page.
fn same_origin(method: Method, uri: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, HOST)
        .header(header::ORIGIN, format!("http://{HOST}"))
}

fn json_body(value: Value) -> Body {
    Body::from(serde_json::to_vec(&value).expect("serialise"))
}

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

async fn body_text(response: axum::response::Response) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    String::from_utf8_lossy(&bytes).into_owned()
}

/// A user whose PIN is really hashed. The shared fixture stores the literal
/// string `"hash"`, which no PIN verifies against.
async fn insert_user_with_pin(
    db: &DatabaseConnection,
    username: &str,
    pin: &str,
    role: &str,
) -> users::Model {
    users::ActiveModel {
        id: NotSet,
        username: Set(username.to_string()),
        pin_hash: Set(bcrypt::hash(pin, bcrypt::DEFAULT_COST).expect("hash")),
        full_name: Set(username.to_string()),
        role: Set(role.to_string()),
        is_active: Set(true),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(db)
    .await
    .expect("user insert")
}

/// Mint a live session directly, for the cases where logging in over HTTP is
/// not the thing under test.
async fn login_token(db: &DatabaseConnection, user_id: i64) -> String {
    session::issue(db, user_id, 30, None, None, Utc::now())
        .await
        .expect("issue session")
        .token
}

fn cookie(token: &str) -> String {
    format!("{}={token}", session::COOKIE_NAME)
}

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
// CSRF
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Login backoff
// ---------------------------------------------------------------------------

/// Three wrong PINs and the fourth attempt is refused without bcrypt ever
/// running — which is what makes a 10.000-value PIN space survivable.
#[tokio::test]
async fn repeated_failed_logins_are_locked_out_with_a_growing_wait() {
    let db = setup_test_db().await;
    insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let state = state(db.clone());

    let attempt = |pin: &'static str| {
        let state = state.clone();
        async move {
            router(&state)
                .oneshot(
                    same_origin(Method::POST, "/api/auth/login")
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(json_body(json!({ "username": "kasir1", "pin": pin })))
                        .expect("request"),
                )
                .await
                .expect("response")
        }
    };

    for _ in 0..2 {
        assert_eq!(attempt("0000").await.status(), StatusCode::UNAUTHORIZED);
    }

    // The third failure trips the lock.
    assert_eq!(attempt("0000").await.status(), StatusCode::UNAUTHORIZED);

    let locked = attempt("0000").await;
    assert_eq!(locked.status(), StatusCode::TOO_MANY_REQUESTS);
    let first_wait: u64 = locked
        .headers()
        .get(header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .expect("Retry-After");
    assert_eq!(body_json(locked).await["code"], json!("rate_limited"));

    // Even the correct PIN is refused while the lock stands, so an attacker
    // cannot use a lucky guess to escape the backoff.
    let correct = attempt("1234").await;
    assert_eq!(correct.status(), StatusCode::TOO_MANY_REQUESTS);

    // Each further attempt lengthens the wait rather than resetting it.
    let second_wait: u64 = attempt("0000")
        .await
        .headers()
        .get(header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .expect("Retry-After");
    assert!(
        second_wait >= first_wait,
        "the backoff must escalate, not reset: {first_wait} then {second_wait}"
    );
}

/// A correct PIN before the lock trips clears the counter.
#[tokio::test]
async fn a_successful_login_forgives_the_earlier_mistakes() {
    let db = setup_test_db().await;
    insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let state = state(db.clone());

    for _ in 0..2 {
        let response = router(&state)
            .oneshot(
                same_origin(Method::POST, "/api/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(json_body(json!({ "username": "kasir1", "pin": "0000" })))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    let ok = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "username": "kasir1", "pin": "1234" })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(ok.status(), StatusCode::OK);

    // Three more failures would have to trip the lock from zero again; two do
    // not.
    for _ in 0..2 {
        let response = router(&state)
            .oneshot(
                same_origin(Method::POST, "/api/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(json_body(json!({ "username": "kasir1", "pin": "0000" })))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
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

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/// `/api/users` is the clearest case of the admin group doing its job: a cashier
/// with a perfectly valid session must not be able to read the staff list, let
/// alone mint an account.
#[tokio::test]
async fn the_user_routes_are_closed_to_a_cashier_session() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let listed = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/users")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(listed.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(listed).await["code"], json!("forbidden"));

    let created = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/users")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "username": "penyusup",
                    "fullName": "Penyusup",
                    "role": "admin",
                    "pin": "9999",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(created.status(), StatusCode::FORBIDDEN);

    assert!(
        users::Entity::find()
            .filter(users::Column::Username.eq("penyusup"))
            .one(&db)
            .await
            .expect("query")
            .is_none(),
        "a refused create must not have written a row"
    );
}

/// The account a PATCH edits is the one in the URL. A body that names a
/// different id changes nothing about which row is written.
#[tokio::test]
async fn a_user_patch_edits_the_account_in_the_url_not_the_one_in_the_body() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::PATCH, &format!("/api/users/{}", kasir.id))
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "fullName": "Kasir Satu",
                    "userId": admin.id,
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["id"], json!(kasir.id));

    let untouched = users::Entity::find_by_id(admin.id)
        .one(&db)
        .await
        .expect("query")
        .expect("the admin row is still there");
    assert_eq!(untouched.full_name, "admin2");
}

#[tokio::test]
async fn an_admin_can_deactivate_an_account_through_the_active_route() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::PATCH, &format!("/api/users/{}/active", kasir.id))
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "isActive": false })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["is_active"], json!(false));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// A store row whose PPOB block holds real credentials, stored the way
/// `update_app_settings` stores them.
async fn insert_store_with_ppob_credentials(
    db: &DatabaseConnection,
    password: &str,
    pin: &str,
) -> store_info::Model {
    use crate::domain::settings::obfuscate;

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
                "security": { "session_timeout_minutes": 30 },
                "ppob": {
                    "enabled": true,
                    "phone_number": "0812000111",
                    "password": obfuscate(password),
                    "device_id": "device-1",
                    "pin": obfuscate(pin),
                },
                "backup": { "interval_hours": 3, "retention_days": 90 },
            })
            .to_string(),
        )),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(db)
    .await
    .expect("store info insert")
}

/// The whole reason `/api/settings` exists separately from `get_app_settings`.
///
/// The service deobfuscates the PPOB password and PIN because the fulfilment
/// executor needs them; serialising that struct over HTTP would hand a shop's
/// gateway credentials to anything that can reach the port. The response is
/// checked as raw text, not as parsed fields, so a future field that happens to
/// carry the secret is caught too.
#[tokio::test]
async fn the_settings_read_never_contains_the_ppob_credentials() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);

    let text = body_text(response).await;
    assert!(
        !text.contains("rahasia-sekali"),
        "the PPOB password must not be in the response: {text}"
    );
    assert!(
        !text.contains("424242"),
        "the PPOB PIN must not be in the response: {text}"
    );

    let body: Value = serde_json::from_str(&text).expect("json");
    assert!(body["ppob"].get("password").is_none());
    assert!(body["ppob"].get("pin").is_none());
    assert_eq!(body["ppob"]["has_credentials"], json!(true));
    // The non-secret half is still readable, or the settings page has nothing
    // to draw.
    assert_eq!(body["ppob"]["phone_number"], json!("0812000111"));
    assert_eq!(body["ppob"]["device_id"], json!("device-1"));
}

#[tokio::test]
async fn the_settings_read_is_closed_to_a_cashier() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

/// The one slice of `/api/settings` a cashier is allowed to read: the markup
/// table `PpobQuickAccess` needs to price a top-up. Everything the admin-only
/// read withholds must stay withheld here too.
#[tokio::test]
async fn a_cashier_can_read_the_ppob_markup_but_not_the_credentials() {
    let db = setup_test_db().await;
    let store = insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let mut settings: Value =
        serde_json::from_str(store.additional_info.as_deref().unwrap_or("{}")).expect("json");
    settings["ppob"]["markup"] = json!({
        "pulsa": { "type": "percentage", "value": 5.0 },
        "data": { "type": "fixed", "value": 1000.0 },
        "pln": { "type": "fixed", "value": 2500.0 },
        "pdam": { "type": "fixed", "value": 2500.0 },
        "bpjs": { "type": "fixed", "value": 2500.0 },
        "emoney": { "type": "percentage", "value": 2.0 },
        "custom_prices": {},
    });
    let mut active: store_info::ActiveModel = store.into();
    active.additional_info = Set(Some(settings.to_string()));
    active.update(&db).await.expect("store update");

    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings/ppob/markup")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);

    let text = body_text(response).await;
    assert!(
        !text.contains("rahasia-sekali"),
        "the PPOB password must not be in the response: {text}"
    );
    assert!(
        !text.contains("424242"),
        "the PPOB PIN must not be in the response: {text}"
    );

    let body: Value = serde_json::from_str(&text).expect("json");
    assert!(body.get("password").is_none());
    assert!(body.get("pin").is_none());
    assert_eq!(body["pulsa"]["type"], json!("percentage"));
    assert_eq!(body["pulsa"]["value"], json!(5.0));
}

/// No session at all — the endpoint still requires login, it is just open to
/// every role once logged in.
#[tokio::test]
async fn the_ppob_markup_route_requires_a_session() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings/ppob/markup")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

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

/// Because the client never receives the credentials, it cannot send them back
/// — so a settings save must not read their absence as "clear them".
#[tokio::test]
async fn saving_the_settings_leaves_the_stored_credentials_intact() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::PUT, "/api/settings")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "sales": { "allow_negative_stock": false, "default_payment_method": "qris" },
                    "security": { "session_timeout_minutes": 45 },
                    "ppob": {
                        "enabled": true,
                        "phone_number": "0812000111",
                        "device_id": "device-1",
                    },
                    "backup": { "interval_hours": 6, "retention_days": 30 },
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let stored = crate::services::settings::get_app_settings(&db)
        .await
        .expect("settings");
    assert_eq!(stored.ppob.password, "rahasia-sekali");
    assert_eq!(stored.ppob.pin, "424242");
    assert_eq!(stored.sales.default_payment_method, "qris");
    assert_eq!(stored.security.session_timeout_minutes, 45);
}

#[tokio::test]
async fn the_credentials_route_is_the_only_way_to_change_them() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::PUT, "/api/settings/ppob/credentials")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(
                    json!({ "password": "sandi-baru", "pin": "111111" }),
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let stored = crate::services::settings::get_app_settings(&db)
        .await
        .expect("settings");
    assert_eq!(stored.ppob.password, "sandi-baru");
    assert_eq!(stored.ppob.pin, "111111");

    // And what is on disk is still obfuscated, not the plain string.
    let row = store_info::Entity::find_by_id(1_i64)
        .one(&db)
        .await
        .expect("query")
        .expect("store row");
    let raw = row.additional_info.unwrap_or_default();
    assert!(
        !raw.contains("sandi-baru"),
        "credentials stored in the clear"
    );
}

// ---------------------------------------------------------------------------
// Product list sorting
// ---------------------------------------------------------------------------

/// The names in the order `GET /api/products?{query}` returns them.
async fn product_names(db: &DatabaseConnection, token: &str, query: &str) -> Vec<String> {
    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::GET, &format!("/api/products?{query}"))
                .header(header::COOKIE, cookie(token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK, "{query}");
    body_json(response).await["data"]
        .as_array()
        .expect("a page of products")
        .iter()
        .map(|p| p["name"].as_str().expect("name").to_string())
        .collect()
}

/// `sort_by` and `sort_order` ride on the query string in the names the Rust
/// struct declares. Both are optional, a column off the allowlist is ignored
/// rather than refused, and `desc` is the only spelling that reverses.
#[tokio::test]
async fn the_product_list_sorts_by_the_query_string() {
    let db = setup_test_db().await;
    crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    crate::test_support::insert_product(&db, "Air Mineral", 2_000.0, 3_000.0, 40).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    assert_eq!(
        product_names(&db, &token, "sort_by=stock&sort_order=desc").await,
        vec!["Air Mineral", "Beras 5kg"]
    );
    assert_eq!(
        product_names(&db, &token, "sort_by=sell_price&sort_order=asc").await,
        vec!["Air Mineral", "Beras 5kg"]
    );
    // No sort at all, an unknown column, and an unknown direction: the
    // default order (name ascending), never an error.
    for query in ["", "sort_by=buy_price", "sort_by=name&sort_order=sideways"] {
        assert_eq!(
            product_names(&db, &token, query).await,
            vec!["Air Mineral", "Beras 5kg"],
            "{query:?}"
        );
    }
}

// ---------------------------------------------------------------------------
// Checkout and idempotency
// ---------------------------------------------------------------------------

/// A cart of one unit of `product`, priced by the product row.
fn cart_of(product_id: i64, price: f64) -> Value {
    json!({
        "items": [{ "product_id": product_id, "quantity": 1 }],
        "payment_method": "cash",
        "payment_amount": price,
    })
}

/// The failure mode HTTP introduced and IPC did not: the sale commits, the
/// answer is lost, the client retries. Without a key that is two sales; with one
/// it is the same sale, twice reported.
#[tokio::test]
async fn a_retried_checkout_returns_the_first_sale_and_does_not_ring_up_a_second() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let key = "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55";
    let send = |state: AppState, token: String| {
        let cart = cart_of(product.id, 65_000.0);
        async move {
            router(&state)
                .oneshot(
                    same_origin(Method::POST, "/api/transactions")
                        .header(header::COOKIE, cookie(&token))
                        .header(header::CONTENT_TYPE, "application/json")
                        .header("idempotency-key", key)
                        .body(json_body(cart))
                        .expect("request"),
                )
                .await
                .expect("response")
        }
    };

    let first = send(state.clone(), token.clone()).await;
    assert_eq!(first.status(), StatusCode::CREATED);
    assert!(first.headers().get("idempotency-replayed").is_none());
    let first_body = body_json(first).await;
    let receipt = first_body["transaction"]["receipt_number"].clone();
    assert!(receipt.is_string());

    let second = send(state, token).await;
    assert_eq!(second.status(), StatusCode::CREATED);
    assert_eq!(
        second
            .headers()
            .get("idempotency-replayed")
            .and_then(|v| v.to_str().ok()),
        Some("true"),
        "the second answer must be the stored one"
    );
    let second_body = body_json(second).await;
    assert_eq!(second_body, first_body, "a retry must replay, not re-run");

    // The two things a double charge would show up in.
    assert_eq!(
        crate::entity::transactions::Entity::find()
            .all(&db)
            .await
            .expect("query")
            .len(),
        1,
        "the retry must not have created a second transaction"
    );
    assert_eq!(
        crate::entity::products::Entity::find_by_id(product.id)
            .one(&db)
            .await
            .expect("query")
            .expect("product")
            .stock,
        9,
        "stock must have been deducted exactly once"
    );
}

/// The guard is not optional. A client that forgets the header is told so
/// rather than quietly given the unprotected behaviour.
#[tokio::test]
async fn a_checkout_without_an_idempotency_key_is_refused() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(cart_of(product.id, 65_000.0)))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(body_json(response).await["code"], json!("bad_request"));
    assert_eq!(
        crate::entity::transactions::Entity::find()
            .all(&db)
            .await
            .expect("query")
            .len(),
        0
    );
}

/// Reusing a key for a genuinely different cart is a client bug. Replaying the
/// first answer would swallow a real sale, so it is refused instead.
#[tokio::test]
async fn a_reused_key_with_a_different_cart_is_refused() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());
    let key = "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55";

    let first = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", key)
                .body(json_body(cart_of(product.id, 65_000.0)))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(first.status(), StatusCode::CREATED);

    let different = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", key)
                .body(json_body(json!({
                    "items": [{ "product_id": product.id, "quantity": 3 }],
                    "payment_method": "cash",
                    "payment_amount": 195_000.0,
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(different.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        crate::entity::transactions::Entity::find()
            .all(&db)
            .await
            .expect("query")
            .len(),
        1
    );
}

/// A refused sale must give the key back, or the cashier who fixes the cart is
/// told the sale already happened.
#[tokio::test]
async fn a_failed_checkout_frees_its_key_for_the_corrected_retry() {
    let db = setup_test_db().await;
    // Negative stock disallowed, so a cart bigger than stock is refused.
    crate::test_support::insert_store_info(&db, false).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 1).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());
    let key = "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55";

    let refused = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", key)
                .body(json_body(json!({
                    "items": [{ "product_id": product.id, "quantity": 5 }],
                    "payment_method": "cash",
                    "payment_amount": 325_000.0,
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let corrected = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", key)
                .body(json_body(cart_of(product.id, 65_000.0)))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(
        corrected.status(),
        StatusCode::CREATED,
        "the same key must work once the cart is fixed"
    );
}

/// The sale is recorded against the session, not against anything the payload
/// says. This is the `checkout_transaction` hole the phase exists to close.
#[tokio::test]
async fn a_checkout_is_recorded_against_the_logged_in_cashier() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let mut cart = cart_of(product.id, 65_000.0);
    cart["user_id"] = json!(admin.id);
    cart["userId"] = json!(admin.id);

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55")
                .body(json_body(cart))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        body_json(response).await["transaction"]["user_id"],
        json!(kasir.id),
        "a cashier must not be able to sell under the admin's name"
    );
}

/// Voiding is admin-only even though the route sits in the session group: the
/// service is what decides, and it decides the same way for both transports.
#[tokio::test]
async fn a_cashier_cannot_void_a_sale() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let sale =
        crate::test_support::insert_transaction(&db, kasir.id, 65_000.0, "completed", &now_ts())
            .await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::DELETE, &format!("/api/transactions/{}", sale.id))
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "reason": "salah input" })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/// `create_refund` believed the `user_id` in its payload and checked nothing, so
/// a return could be booked under anyone's name. The author is now the session.
#[tokio::test]
async fn a_refund_is_recorded_against_the_session_not_the_payload() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let product =
        crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let sale = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/transactions")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55")
                .body(json_body(cart_of(product.id, 65_000.0)))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(sale.status(), StatusCode::CREATED);
    let sale = body_json(sale).await;
    let transaction_id = sale["transaction"]["id"].as_i64().expect("id");
    let item_id = sale["items"][0]["id"].as_i64().expect("item id");

    let response = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/refunds")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "transaction_id": transaction_id,
                    "user_id": admin.id,
                    "reason": "rusak",
                    "items": [{
                        "transaction_item_id": item_id,
                        "quantity": 1,
                        "condition": "good",
                    }],
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        body_json(response).await["refund"]["user_id"],
        json!(kasir.id),
        "the refund belongs to whoever's session took it"
    );
}

#[tokio::test]
async fn the_refund_routes_need_a_session() {
    let db = setup_test_db().await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/refunds")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// ---------------------------------------------------------------------------
// Stock write-offs
// ---------------------------------------------------------------------------

/// Approval is an admin action, and it is the router that says so.
#[tokio::test]
async fn a_cashier_cannot_approve_a_writeoff() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/stock/writeoffs/1/approve")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(response).await["code"], json!("forbidden"));
}

/// Recording a write-off is a session route, but `lost` is admin-only — there is
/// no broken bottle to hold up as evidence. That rule is finer than the router
/// can express, so the service holds it, and it has to survive the trip through
/// HTTP intact.
#[tokio::test]
async fn a_cashier_may_write_off_breakage_but_not_a_loss() {
    let db = setup_test_db().await;
    let product =
        crate::test_support::insert_product(&db, "Telur 1kg", 25_000.0, 30_000.0, 10).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let damaged = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/stock/writeoffs")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "productId": product.id,
                    "quantity": 1,
                    "reason": "damaged",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(damaged.status(), StatusCode::CREATED);
    let body = body_json(damaged).await;
    assert_eq!(body["userId"], json!(kasir.id));
    assert_eq!(
        body["status"],
        json!("approved"),
        "the broken goods are in the storeroom; a cashier does not need an admin \
         to write them off, and the stock came off either way"
    );
    assert_eq!(body["approvedBy"], json!(kasir.id));

    let lost = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/stock/writeoffs")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "productId": product.id,
                    "quantity": 1,
                    "reason": "lost",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(lost.status(), StatusCode::FORBIDDEN);
}

// ---------------------------------------------------------------------------
// Shifts and cash flows
// ---------------------------------------------------------------------------

/// `open_shift` and `get_active_shift` both took an unchecked `userId`, so one
/// cashier could open a shift as another and read that other's drawer. The owner
/// is now the session on both.
#[tokio::test]
async fn a_shift_belongs_to_the_session_that_opened_it() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let kasir_token = login_token(&db, kasir.id).await;
    let admin_token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let opened = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/shifts")
                .header(header::COOKIE, cookie(&kasir_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(
                    json!({ "openingCash": 100_000.0, "userId": admin.id }),
                ))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(opened.status(), StatusCode::CREATED);
    assert_eq!(body_json(opened).await["userId"], json!(kasir.id));

    // The admin has no shift of their own, and asking does not surface the
    // cashier's.
    let admins_active = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/shifts/active")
                .header(header::COOKIE, cookie(&admin_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(admins_active.status(), StatusCode::OK);
    assert_eq!(body_json(admins_active).await, Value::Null);
}

/// A cash-flow entry is deletable by its author or an admin, and only while the
/// shift is open. That is not a rule a route table can hold, so the service does
/// — and the route has to let the service see the real actor for it to work.
#[tokio::test]
async fn a_cash_flow_can_only_be_removed_by_its_author_or_an_admin() {
    let db = setup_test_db().await;
    let owner = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let other = insert_user_with_pin(&db, "kasir2", "1234", "kasir").await;
    let owner_token = login_token(&db, owner.id).await;
    let other_token = login_token(&db, other.id).await;
    let state = state(db.clone());

    let shift = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/shifts")
                .header(header::COOKIE, cookie(&owner_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "openingCash": 100_000.0 })))
                .expect("request"),
        )
        .await
        .expect("response");
    let shift_id = body_json(shift).await["id"].as_i64().expect("shift id");

    let flow = router(&state)
        .oneshot(
            same_origin(Method::POST, &format!("/api/shifts/{shift_id}/cash-flows"))
                .header(header::COOKIE, cookie(&owner_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "flowType": "out",
                    "amount": 50_000.0,
                    "description": "beli plastik",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(flow.status(), StatusCode::CREATED);
    let flow = body_json(flow).await;
    assert_eq!(flow["userId"], json!(owner.id));
    let flow_id = flow["id"].as_i64().expect("flow id");

    let refused = router(&state)
        .oneshot(
            same_origin(Method::DELETE, &format!("/api/cash-flows/{flow_id}"))
                .header(header::COOKIE, cookie(&other_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);

    let allowed = router(&state)
        .oneshot(
            same_origin(Method::DELETE, &format!("/api/cash-flows/{flow_id}"))
                .header(header::COOKIE, cookie(&owner_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(allowed.status(), StatusCode::NO_CONTENT);
}

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

// ---------------------------------------------------------------------------
// Backups: a download, an upload, and no client-supplied paths
// ---------------------------------------------------------------------------

/// Point `KASIR_DATA_DIR` at a scratch folder for this test binary.
///
/// `services::backup` and `services::settings` resolve the database and backup
/// directory from it. Without the override the export test would read the
/// developer's real `kasir.db` and the import test would stage a restore next to
/// it — which the next real launch would then apply.
///
/// The path is fixed rather than per-run. The backup routes need a real file on
/// disk, and the test harness offers no teardown hook to delete one afterwards,
/// so a per-run directory would pile up in the temp folder run after run. Wiping
/// the one fixed directory on the way in gives each run a clean slate and leaves
/// the machine with a single scratch folder however often the suite is run.
/// Also removes the per-pid directories the earlier naming left behind.
fn scratch_data_dir() -> &'static std::path::Path {
    static DIR: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    DIR.get_or_init(|| {
        let temp = std::env::temp_dir();
        if let Ok(entries) = std::fs::read_dir(&temp) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                if name.to_string_lossy().starts_with("kasir-http-tests-") {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }

        let dir = temp.join("kasir-http-tests");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        std::env::set_var("KASIR_DATA_DIR", &dir);

        // A real SQLite file, so the WAL checkpoint on the export path has
        // something valid to open.
        let db = dir.join("kasir.db");
        let conn = rusqlite::Connection::open(&db).expect("scratch database");
        conn.execute_batch("CREATE TABLE IF NOT EXISTS scratch (id INTEGER);")
            .expect("scratch schema");
        drop(conn);

        dir
    })
}

const MULTIPART_BOUNDARY: &str = "----kasirtestboundary";

/// A `multipart/form-data` body with one part, so the upload route can be
/// driven the way a browser drives it.
fn multipart_file(field: &str, filename: &str, data: &[u8]) -> Body {
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{MULTIPART_BOUNDARY}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{MULTIPART_BOUNDARY}--\r\n").as_bytes());
    Body::from(body)
}

fn multipart_content_type() -> String {
    format!("multipart/form-data; boundary={MULTIPART_BOUNDARY}")
}

/// The 16 bytes that make a file a SQLite database, followed by enough padding
/// to look like a page.
fn fake_sqlite_image() -> Vec<u8> {
    let mut bytes = b"SQLite format 3\0".to_vec();
    bytes.resize(512, 0);
    bytes
}

/// The export is a download, not a copy to a path the caller named.
#[tokio::test]
async fn the_database_export_is_a_download_with_a_server_chosen_filename() {
    scratch_data_dir();
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/backups/export")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);

    let disposition = response
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .expect("a download header")
        .to_string();
    assert!(disposition.starts_with("attachment; filename=\"kasir-export-"));
    assert!(disposition.ends_with(".db\""));

    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/vnd.sqlite3")
    );

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    assert!(
        bytes.starts_with(b"SQLite format 3\0"),
        "the download must be the database itself"
    );
}

#[tokio::test]
async fn the_database_export_is_closed_to_a_cashier() {
    scratch_data_dir();
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/backups/export")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

/// An upload that is not a database must be refused before anything is staged.
/// A file that only fails at the next launch would brick the till in a way
/// nobody could connect back to the upload.
#[tokio::test]
async fn an_upload_that_is_not_a_sqlite_database_is_refused() {
    let dir = scratch_data_dir();
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let pending = dir.join("kasir.db.restore-pending");
    let _ = std::fs::remove_file(&pending);

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/backups/import")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, multipart_content_type())
                .body(multipart_file("file", "kasir.db", b"ini bukan database"))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body_json(response).await["code"], json!("validation"));
    assert!(
        !pending.exists(),
        "a rejected upload must not have been staged"
    );
}

/// The `filename` on a multipart part is attacker-controlled. The import must
/// not read it at all — what lands on disk is the one staging path the service
/// owns, whatever the part claims to be called.
#[tokio::test]
async fn an_upload_filename_never_becomes_a_path() {
    let dir = scratch_data_dir();
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let escape = dir.join("dicuri.db");
    let _ = std::fs::remove_file(&escape);

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::POST, "/api/backups/import")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, multipart_content_type())
                .body(multipart_file(
                    "file",
                    "../../dicuri.db",
                    &fake_sqlite_image(),
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        dir.join("kasir.db.restore-pending").exists(),
        "the upload is staged next to the live database"
    );
    assert!(
        !escape.exists(),
        "the name the client chose must not have created a file"
    );

    std::fs::remove_file(dir.join("kasir.db.restore-pending")).expect("cleanup");
}

/// The two routes that do take a filename rebuild the path themselves and
/// refuse anything that is not a plain backup name.
#[tokio::test]
async fn a_backup_filename_that_leaves_the_backup_directory_is_refused() {
    let dir = scratch_data_dir();
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db);

    for filename in [
        "..",
        "..%2F..%2Fkasir.db",
        "%2Fetc%2Fpasswd",
        "C:%5CWindows%5Cwin.ini",
        "kasir_2026-09-05.db.gz%00",
    ] {
        let deleted = router(&state)
            .oneshot(
                same_origin(Method::DELETE, &format!("/api/backups/{filename}"))
                    .header(header::COOKIE, cookie(&token))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(
            deleted.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "DELETE {filename}"
        );

        let restored = router(&state)
            .oneshot(
                same_origin(Method::POST, &format!("/api/backups/{filename}/restore"))
                    .header(header::COOKIE, cookie(&token))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(
            restored.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "POST {filename}/restore"
        );
    }

    assert!(
        dir.join("kasir.db").exists(),
        "nothing outside the backup directory may have been touched"
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

// ---------------------------------------------------------------------------
// PPOB
// ---------------------------------------------------------------------------

// Everything past these checks talks to a third party over the network, so what
// is worth asserting in-process is that the guards fire *before* it does.

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

/// The two PPOB routes that spend money refuse to run without a key, and they
/// refuse before anything is sent upstream.
#[tokio::test]
async fn the_ppob_money_routes_refuse_to_run_without_an_idempotency_key() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    let payment = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/ppob/payments")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "serviceType": "pln",
                    "inquiryId": "INQ-1",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(payment.status(), StatusCode::BAD_REQUEST);
    assert_eq!(body_json(payment).await["code"], json!("bad_request"));

    let topup = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/ppob/topups")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "phoneNumber": "081200001111",
                    "productCode": "TSEL10",
                    "productId": 1,
                    "productType": "pulsa",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(topup.status(), StatusCode::BAD_REQUEST);
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

// ---------------------------------------------------------------------------
// Client logs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Self-update
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Window zoom
// ---------------------------------------------------------------------------

/// A request whose socket peer is `ip`, the way `into_make_service_with_connect_info`
/// would have recorded it.
fn from_address(
    builder: axum::http::request::Builder,
    ip: [u8; 4],
) -> axum::http::request::Builder {
    builder.extension(axum::extract::ConnectInfo(std::net::SocketAddr::from((
        ip, 51000,
    ))))
}

#[tokio::test]
async fn the_zoom_routes_need_a_session_and_report_no_window_in_a_bare_server() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let token = login_token(&db, 1).await;
    let state = state(db);

    let anonymous = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/window/zoom")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    // Nothing attached a window, so the stored default is reported as not
    // controllable — which is what a tablet on the LAN should also be told.
    let status = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/window/zoom")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(status.status(), StatusCode::OK);
    assert_eq!(
        body_json(status).await,
        json!({ "factor": 1.0, "available": false })
    );

    let refused = router(&state)
        .oneshot(
            same_origin(Method::PUT, "/api/window/zoom")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "factor": 1.5 })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::CONFLICT);
    assert_eq!(body_json(refused).await["code"], json!("conflict"));
}

/// With a window attached, the till's own webview — and only it — can zoom
/// it. The factor is clamped, stored, applied, and read back.
#[tokio::test]
async fn the_till_window_zooms_itself_and_a_lan_client_cannot() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let token = login_token(&db, 1).await;
    let state = state(db);

    let applied = std::sync::Arc::new(std::sync::Mutex::new(Vec::<f64>::new()));
    let sink = applied.clone();
    state.window_zoom.attach(move |factor| {
        sink.lock().expect("lock").push(factor);
        Ok(())
    });

    // Past the ceiling on purpose: the answer is the clamped factor.
    let zoomed = router(&state)
        .oneshot(
            from_address(same_origin(Method::PUT, "/api/window/zoom"), [127, 0, 0, 1])
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "factor": 2.5 })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(zoomed.status(), StatusCode::OK);
    assert_eq!(
        body_json(zoomed).await,
        json!({ "factor": 2.0, "available": true })
    );
    assert_eq!(*applied.lock().expect("lock"), vec![2.0]);

    let read_back = router(&state)
        .oneshot(
            from_address(same_origin(Method::GET, "/api/window/zoom"), [127, 0, 0, 1])
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(
        body_json(read_back).await,
        json!({ "factor": 2.0, "available": true })
    );

    // A tablet on the shop LAN sees the factor but is told it cannot change
    // it, and a PUT from there must not move the desktop window.
    let from_lan = router(&state)
        .oneshot(
            from_address(
                same_origin(Method::GET, "/api/window/zoom"),
                [192, 168, 1, 20],
            )
            .header(header::COOKIE, cookie(&token))
            .body(Body::empty())
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(
        body_json(from_lan).await,
        json!({ "factor": 2.0, "available": false })
    );

    let refused = router(&state)
        .oneshot(
            from_address(
                same_origin(Method::PUT, "/api/window/zoom"),
                [192, 168, 1, 20],
            )
            .header(header::COOKIE, cookie(&token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(json!({ "factor": 1.0 })))
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::CONFLICT);
    assert_eq!(*applied.lock().expect("lock"), vec![2.0]);

    // A body that does not fit the shape is the usual 422, not a 500.
    let malformed = router(&state)
        .oneshot(
            from_address(same_origin(Method::PUT, "/api/window/zoom"), [127, 0, 0, 1])
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "factor": "besar" })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(malformed.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn the_till_window_paints_its_own_icon_and_a_lan_client_cannot() {
    let db = setup_test_db().await;
    crate::test_support::insert_store_info(&db, true).await;
    let token = login_token(&db, 1).await;
    let state = state(db);

    // A bare server has no window: the route answers 409 rather than 500.
    let no_window = router(&state)
        .oneshot(
            from_address(same_origin(Method::DELETE, "/api/window/icon"), [127, 0, 0, 1])
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(no_window.status(), StatusCode::CONFLICT);

    let painted = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Option<Vec<u8>>>::new()));
    let sink = painted.clone();
    state.window_icon.attach(move |png| {
        sink.lock().expect("lock").push(png.map(<[u8]>::to_vec));
        Ok(())
    });

    let set = router(&state)
        .oneshot(
            from_address(same_origin(Method::POST, "/api/window/icon"), [127, 0, 0, 1])
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, multipart_content_type())
                .body(multipart_file("file", "icon.png", b"png-bytes"))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(set.status(), StatusCode::NO_CONTENT);

    let reset = router(&state)
        .oneshot(
            from_address(same_origin(Method::DELETE, "/api/window/icon"), [127, 0, 0, 1])
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(reset.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        *painted.lock().expect("lock"),
        vec![Some(b"png-bytes".to_vec()), None]
    );

    // A tablet on the LAN must not repaint the desktop window's taskbar entry.
    let refused = router(&state)
        .oneshot(
            from_address(
                same_origin(Method::POST, "/api/window/icon"),
                [192, 168, 1, 20],
            )
            .header(header::COOKIE, cookie(&token))
            .header(header::CONTENT_TYPE, multipart_content_type())
            .body(multipart_file("file", "icon.png", b"png-bytes"))
            .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::CONFLICT);
    assert_eq!(painted.lock().expect("lock").len(), 2);
}

// ---------------------------------------------------------------------------
// The real listener
// ---------------------------------------------------------------------------

/// The one case `oneshot` cannot cover.
///
/// Two things only exist once a socket does: the port scan actually binding, and
/// `ConnectInfo` carrying the peer address that the per-address half of the login
/// backoff counts. In-process the address is `None`, so the address counter is
/// never exercised — and that is exactly the half that stops an attacker
/// spraying many usernames from one machine.
#[tokio::test]
async fn a_bound_server_serves_requests_and_counts_failures_per_address() {
    let db = setup_test_db().await;
    let state = AppState::new(
        db,
        ServerConfig {
            bind: std::net::IpAddr::from([127, 0, 0, 1]),
            // 0 asks the OS for a free port, so the test cannot collide with a
            // developer's running app.
            port: 0,
            ..ServerConfig::default()
        },
    );

    let server = crate::http::start(state).await.expect("server starts");
    let base = format!("http://127.0.0.1:{}", server.port);
    let client = reqwest::Client::new();

    let status = client
        .get(format!("{base}/api/onboarding/status"))
        .send()
        .await
        .expect("request");
    assert_eq!(status.status(), 200);

    // Three failures from this address, each against a different username, so
    // the address counter is the only thing that can be accumulating.
    for username in ["satu", "dua", "tiga"] {
        let response = client
            .post(format!("{base}/api/auth/login"))
            .header("origin", &base)
            .json(&json!({ "username": username, "pin": "0000" }))
            .send()
            .await
            .expect("request");
        assert_eq!(response.status(), 401, "attempt for {username}");
    }

    let sprayed = client
        .post(format!("{base}/api/auth/login"))
        .header("origin", &base)
        .json(&json!({ "username": "empat", "pin": "0000" }))
        .send()
        .await
        .expect("request");
    assert_eq!(
        sprayed.status(),
        429,
        "a fourth username from the same address must still hit the backoff"
    );

    server.shutdown();
}

// ---------------------------------------------------------------------------
// Store logo: an upload checked by content, served back, and removed
// ---------------------------------------------------------------------------

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

    // Any session may read it back, with the type taken from the content.
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
