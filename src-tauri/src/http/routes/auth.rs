//! Login, logout, and "who am I".
//!
//! These three are the only routes that deal in the session itself. Every other
//! route in the application receives an `Actor` and never learns that a cookie
//! was involved.

use std::time::Instant;

use axum::extract::{Extension, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::Router;
use chrono::Utc;

use crate::domain::auth::LoginInput;
use crate::domain::settings::ChangePinInput;
use crate::domain::Actor;
use crate::http::error::{ApiError, ApiResult};
use crate::http::extract::Json;
use crate::http::middleware::{ClientInfo, SessionId};
use crate::http::{session, throttle, AppState};
use crate::services;
use crate::utils::AppError;

pub fn public() -> Router<AppState> {
    Router::new().route("/auth/login", post(login))
}

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/auth/me/pin", put(change_own_pin))
}

/// Verify the PIN, mint a session, hand back a cookie.
///
/// The order of operations is deliberate. The backoff is consulted *before* the
/// PIN is checked, so a locked-out attacker never gets bcrypt run on their
/// behalf: the lock is cheap to enforce and expensive to ignore.
async fn login(
    State(state): State<AppState>,
    client: ClientInfo,
    Json(input): Json<LoginInput>,
) -> ApiResult<Response> {
    let keys = throttle_keys(&input.username, client.address.as_deref());
    let attempted_at = Instant::now();

    if let Some(wait) = state.throttle.retry_after(&keys, attempted_at) {
        let seconds = wait.as_secs().max(1);
        return Err(ApiError::rate_limited(
            format!("Terlalu banyak percobaan login. Coba lagi dalam {seconds} detik."),
            seconds,
        ));
    }

    let user = match services::auth::login(&state.db, input).await {
        Ok(user) => user,
        Err(AppError::Auth(message)) => {
            state.throttle.record_failure(&keys, attempted_at);
            return Err(ApiError::unauthorized(message));
        }
        Err(other) => return Err(other.into()),
    };

    state.throttle.record_success(&keys);

    let minutes = session::timeout_minutes(&state.db).await?;
    let issued = session::issue(
        &state.db,
        user.id,
        minutes,
        client.user_agent,
        client.address,
        Utc::now(),
    )
    .await?;

    let cookie = session::build_cookie(&issued.token, client.secure, issued.max_age_secs);
    let mut response = axum::Json(user).into_response();
    set_cookie(&mut response, &cookie);
    Ok(response)
}

/// Drop the session row, then tell the browser to drop the cookie. Doing both
/// matters: deleting only the row leaves a cookie that produces a 401 on every
/// request, and clearing only the cookie leaves a live session anyone holding
/// the token could keep using.
async fn logout(
    State(state): State<AppState>,
    client: ClientInfo,
    Extension(SessionId(session_id)): Extension<SessionId>,
) -> ApiResult<Response> {
    session::revoke(&state.db, &session_id).await?;

    let mut response = axum::http::StatusCode::NO_CONTENT.into_response();
    set_cookie(&mut response, &session::clear_cookie(client.secure));
    Ok(response)
}

/// The account behind the current session. Used by the frontend at boot, which
/// is why identity is asked for rather than remembered in `localStorage`.
async fn me(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
) -> ApiResult<axum::Json<crate::entity::users::Model>> {
    let user = services::auth::get_current_user(&state.db, &actor).await?;
    Ok(axum::Json(user))
}

/// Change your own PIN. The current PIN is the proof of identity, so this needs
/// no role — but it does need a session, which is what pins it to *your* account
/// rather than one named in the payload.
async fn change_own_pin(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<ChangePinInput>,
) -> ApiResult<axum::http::StatusCode> {
    services::settings::change_pin(&state.db, &actor, input).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Both counters a login attempt is charged against.
fn throttle_keys(username: &str, address: Option<&str>) -> Vec<String> {
    let mut keys = vec![throttle::username_key(username)];
    if let Some(address) = address {
        keys.push(throttle::address_key(address));
    }
    keys
}

fn set_cookie(response: &mut Response, cookie: &str) {
    match cookie.parse() {
        Ok(value) => {
            response.headers_mut().append(header::SET_COOKIE, value);
        }
        Err(_) => {
            // Only reachable if a token stopped being hex, which would be a bug
            // in `session::issue` rather than anything a client can cause.
            crate::utils::logging::log_error("session cookie was not a valid header value");
        }
    }
}
