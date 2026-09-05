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

use crate::entity::users;
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
