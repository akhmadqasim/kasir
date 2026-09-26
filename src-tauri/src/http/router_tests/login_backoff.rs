//! The login backoff, in-process and over a real socket.

use axum::http::{header, Method, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use super::{body_json, insert_user_with_pin, json_body, router, same_origin, state};
use crate::http::{AppState, ServerConfig};
use crate::test_support::setup_test_db;

// ---------------------------------------------------------------------------
// In process
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
