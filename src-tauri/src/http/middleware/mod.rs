//! Who the request is, and whether it is allowed to change anything.
//!
//! Two independent checks live here and they defend different things.
//!
//! [`require_session`] answers *who*. It is the only producer of an [`Actor`] on
//! the HTTP side, so a handler that wants an identity has no way to obtain one
//! except by sitting behind this layer — the type system, not a convention,
//! enforces it.
//!
//! [`csrf_guard`] answers *may this request change state at all*. `SameSite=Lax`
//! already stops a cross-site form post, but it says nothing about a request a
//! page on another origin makes with `fetch`, and it is a browser-side promise
//! the server cannot verify. Checking `Origin` is the server-side half.
//!
//! Beside them: [`ClientInfo`], what the transport knows about the caller, and
//! [`log_failures`], which writes every refused request to the log files.

mod client_info;
mod csrf;
mod failure_log;

pub use client_info::ClientInfo;
pub use csrf::csrf_guard;
pub use failure_log::log_failures;

use axum::extract::{Request, State};
use axum::http::header;
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::Response;
use chrono::Utc;

use crate::domain::Actor;
use crate::http::error::{ApiError, ApiResult};
use crate::http::{session, AppState};
use crate::services::guard;

/// The one message every unauthenticated rejection uses. Distinguishing "no
/// cookie" from "expired cookie" from "revoked cookie" would tell a caller
/// something it has no use for, and tell an attacker something it does.
const SESSION_REQUIRED: &str = "Sesi tidak valid. Silakan login ulang.";

/// The session row backing this request, so `logout` can delete the right one.
#[derive(Clone, Debug)]
pub struct SessionId(pub String);

/// Turn the session cookie into an [`Actor`] and put it where handlers can find
/// it. Rejects with 401 if there is no live session behind the cookie.
pub async fn require_session(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> ApiResult<Response> {
    let token = header_str(req.headers(), header::COOKIE)
        .and_then(session::token_from_cookie_header)
        .ok_or_else(|| ApiError::unauthorized(SESSION_REQUIRED))?;

    let now = Utc::now();
    let resolved = session::resolve(&state.db, &token, now)
        .await?
        .ok_or_else(|| ApiError::unauthorized(SESSION_REQUIRED))?;

    // Sliding expiry: activity postpones the deadline. Only written when the
    // stored timestamp has actually gone stale, so a burst of requests does not
    // become a burst of writes on a single-connection SQLite pool.
    if resolved.needs_touch {
        session::touch(
            &state.db,
            &resolved.session_id,
            session::TIMEOUT_MINUTES,
            now,
        )
        .await?;
    }

    req.extensions_mut().insert(resolved.actor);
    req.extensions_mut().insert(SessionId(resolved.session_id));

    Ok(next.run(req).await)
}

/// Refuse anyone who is not an admin.
///
/// Must be layered *inside* [`require_session`], which is what puts the `Actor`
/// in the extensions; a missing one is treated as unauthenticated rather than
/// silently allowed.
pub async fn require_admin(req: Request, next: Next) -> ApiResult<Response> {
    let actor = req
        .extensions()
        .get::<Actor>()
        .ok_or_else(|| ApiError::unauthorized(SESSION_REQUIRED))?;

    // The rule and its wording belong to the service layer; this is the same
    // check the services make for their own admin-only operations, not a
    // second copy of it.
    guard::require_admin(actor)?;

    Ok(next.run(req).await)
}

/// The first entry of a comma-separated proxy header (`X-Forwarded-*`).
fn first_csv_entry(value: &str) -> Option<&str> {
    value
        .split(',')
        .next()
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn header_str<K>(headers: &HeaderMap, key: K) -> Option<&str>
where
    K: axum::http::header::AsHeaderName,
{
    headers.get(key).and_then(|value| value.to_str().ok())
}

/// Header maps and server configs shared by the CSRF and client-info tests.
#[cfg(test)]
mod test_fixtures {
    use axum::http::HeaderMap;

    use crate::http::ServerConfig;

    pub fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                axum::http::HeaderName::from_bytes(name.as_bytes()).expect("header name"),
                value.parse().expect("header value"),
            );
        }
        map
    }

    pub fn plain() -> ServerConfig {
        ServerConfig::default()
    }

    pub fn behind_nginx() -> ServerConfig {
        ServerConfig {
            trust_proxy: true,
            ..ServerConfig::default()
        }
    }
}
