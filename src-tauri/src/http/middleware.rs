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

use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};

use axum::extract::{ConnectInfo, FromRequestParts, Request, State};
use axum::http::header;
use axum::http::request::Parts;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use chrono::Utc;

use crate::domain::Actor;
use crate::http::error::{ApiError, ApiResult, FailureInfo};
use crate::http::{session, AppState, ServerConfig};
use crate::services::guard;
use crate::utils::logging;

/// The one message every unauthenticated rejection uses. Distinguishing "no
/// cookie" from "expired cookie" from "revoked cookie" would tell a caller
/// something it has no use for, and tell an attacker something it does.
const SESSION_REQUIRED: &str = "Sesi tidak valid. Silakan login ulang.";

/// The session row backing this request, so `logout` can delete the right one.
#[derive(Clone, Debug)]
pub struct SessionId(pub String);

/// What the transport knows about the caller: where it came from, what it says
/// it is, and whether the connection was encrypted.
///
/// An extractor rather than three header reads in the login handler, because the
/// address is not a header at all when there is no proxy — it is the peer
/// address of the socket — and the rule for choosing between the two is a
/// deployment decision, not a handler's business.
#[derive(Clone, Debug)]
pub struct ClientInfo {
    /// Best-known client address, or `None` when neither a trusted proxy header
    /// nor a peer address is available (in-process tests).
    pub address: Option<String>,
    pub user_agent: Option<String>,
    /// True only when the request demonstrably arrived over HTTPS. Decides the
    /// `Secure` flag on the session cookie.
    pub secure: bool,
}

impl ClientInfo {
    /// Whether the caller is this machine — the app's own webview, which
    /// loads `http://127.0.0.1:<port>`. Behind nginx with `KASIR_TRUST_PROXY=1`
    /// the address is the forwarded one, so a tablet proxied from the LAN is
    /// not mistaken for the till because the proxy happens to run here.
    pub fn is_loopback(&self) -> bool {
        self.address
            .as_deref()
            .and_then(|address| address.parse::<IpAddr>().ok())
            .is_some_and(|ip| ip.is_loopback())
    }
}

impl FromRequestParts<AppState> for ClientInfo {
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let address = forwarded_address(&state.config, &parts.headers).or_else(|| {
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|ConnectInfo(addr)| addr.ip().to_string())
        });

        Ok(Self {
            address,
            user_agent: header_str(&parts.headers, header::USER_AGENT).map(str::to_owned),
            secure: request_is_https(&state.config, &parts.headers),
        })
    }
}

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
        let minutes = session::timeout_minutes(&state.db).await?;
        session::touch(&state.db, &resolved.session_id, minutes, now).await?;
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
    // check the Tauri path makes, not a second copy of it.
    guard::require_admin(actor)?;

    Ok(next.run(req).await)
}

/// Write every failed API call to the log files, in one place.
///
/// Before this, only `Database` and `Internal` errors were logged (they hide
/// their detail from the client, so the log was the only place it went) and
/// everything else — a 422 the cashier saw for a second as a toast, a 502
/// from Mitra — left no trace on disk. Diagnosing the till after the fact
/// means reading what it refused and why, so: 5xx to error.log, the rest of
/// 4xx to warning.log, each with method, path, status, code and the message
/// the client got. Not logged: 404 (a scan of an unknown barcode is not a
/// fault) and the session probe's 401 (every fresh start asks, and "not
/// logged in yet" is the expected answer).
pub async fn log_failures(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    let response = next.run(req).await;

    let status = response.status();
    if should_log_failure(status, &method, &path) {
        let (code, message) = response
            .extensions()
            .get::<FailureInfo>()
            .map(|info| (info.code, info.message.as_str()))
            .unwrap_or(("-", "-"));
        let line = format!("{method} {path} -> {} {code}: {message}", status.as_u16());
        if status.is_server_error() {
            logging::log_error(&line);
        } else {
            logging::log_warning(&line);
        }
    }

    response
}

fn should_log_failure(status: StatusCode, method: &Method, path: &str) -> bool {
    if !(status.is_client_error() || status.is_server_error()) {
        return false;
    }
    if status == StatusCode::NOT_FOUND {
        return false;
    }
    // `GET /api/auth/me` is "am I logged in?" — a 401 there is the normal
    // answer on every cold start, not a failure worth a line.
    !(status == StatusCode::UNAUTHORIZED && *method == Method::GET && path == "/api/auth/me")
}

/// Reject a state-changing request whose `Origin` is not this server.
pub async fn csrf_guard(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> ApiResult<Response> {
    if is_safe_method(req.method()) {
        return Ok(next.run(req).await);
    }

    check_origin(&state.config, req.headers())?;
    Ok(next.run(req).await)
}

/// Methods that, by the HTTP spec and by this application's routing, do not
/// change anything. They are exempt because a cross-site `GET` cannot be
/// prevented anyway, and because the SPA's own navigations are `GET`s that
/// carry no `Origin`.
fn is_safe_method(method: &Method) -> bool {
    matches!(
        *method,
        Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
    )
}

/// The heart of the CSRF check.
///
/// Only the authority (`host[:port]`) is compared, not the scheme. Behind an
/// HTTPS nginx the browser sends `Origin: https://kasir.lokal` while the request
/// reaching this process is plain HTTP with `Host: kasir.lokal`; insisting the
/// schemes match would reject every write in exactly the deployment that is
/// most secure. What matters for CSRF is that the page making the request is
/// served from the same name as the API, and the authority is what carries that.
fn check_origin(config: &ServerConfig, headers: &HeaderMap) -> Result<(), ApiError> {
    let Some(expected) = expected_authority(config, headers) else {
        return Err(ApiError::csrf(
            "Permintaan ditolak: host tujuan tidak dikenali.",
        ));
    };

    // A browser always sends `Origin` on a non-GET request, so a missing one is
    // not a browser following the rules. Refusing is what makes the check
    // meaningful — an attacker who could simply omit the header would face no
    // check at all.
    let claimed = header_str(headers, header::ORIGIN)
        .and_then(origin_authority)
        .or_else(|| header_str(headers, header::REFERER).and_then(origin_authority));

    let Some(claimed) = claimed else {
        return Err(ApiError::csrf(
            "Permintaan ditolak: asal permintaan tidak disertakan.",
        ));
    };

    if claimed == expected {
        return Ok(());
    }

    let explicitly_allowed = config
        .allowed_origins
        .iter()
        .filter_map(|allowed| origin_authority(allowed))
        .any(|allowed| allowed == claimed);

    if explicitly_allowed {
        return Ok(());
    }

    Err(ApiError::csrf(
        "Permintaan ditolak: asal permintaan tidak sesuai.",
    ))
}

/// The authority this request was addressed to.
fn expected_authority(config: &ServerConfig, headers: &HeaderMap) -> Option<String> {
    if config.trust_proxy {
        if let Some(forwarded) = header_str(headers, "x-forwarded-host")
            .and_then(first_csv_entry)
            .and_then(origin_authority)
        {
            return Some(forwarded);
        }
    }

    header_str(headers, header::HOST).and_then(origin_authority)
}

/// Reduce an origin, a referer or a host to a lower-cased `host[:port]`.
///
/// Returns `None` for the opaque origin `null`, which is what a sandboxed iframe
/// or a `data:` document sends — precisely the callers that must not be trusted.
fn origin_authority(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("null") {
        return None;
    }

    let rest = value.split_once("://").map_or(value, |(_, rest)| rest);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    // A `Referer` may carry `user:pass@`; the credentials are not part of the
    // origin.
    let authority = authority.rsplit('@').next().unwrap_or_default();

    if authority.is_empty() {
        None
    } else {
        Some(authority.to_ascii_lowercase())
    }
}

/// `X-Forwarded-For`'s leftmost entry, but only when a proxy is trusted.
fn forwarded_address(config: &ServerConfig, headers: &HeaderMap) -> Option<String> {
    if !config.trust_proxy {
        return None;
    }
    header_str(headers, "x-forwarded-for")
        .and_then(first_csv_entry)
        .map(str::to_owned)
}

fn request_is_https(config: &ServerConfig, headers: &HeaderMap) -> bool {
    // This process only ever listens on plain HTTP, so the request can have
    // arrived over TLS only if something terminated it — and that something has
    // to be a proxy we were told to believe.
    if !config.trust_proxy {
        return false;
    }
    header_str(headers, "x-forwarded-proto")
        .and_then(first_csv_entry)
        .is_some_and(|proto| proto.eq_ignore_ascii_case("https"))
}

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

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                axum::http::HeaderName::from_bytes(name.as_bytes()).expect("header name"),
                value.parse().expect("header value"),
            );
        }
        map
    }

    fn plain() -> ServerConfig {
        ServerConfig::default()
    }

    fn behind_nginx() -> ServerConfig {
        ServerConfig {
            trust_proxy: true,
            ..ServerConfig::default()
        }
    }

    #[test]
    fn a_same_origin_write_is_accepted() {
        let headers = headers(&[
            ("host", "127.0.0.1:17720"),
            ("origin", "http://127.0.0.1:17720"),
        ]);
        assert!(check_origin(&plain(), &headers).is_ok());
    }

    #[test]
    fn a_foreign_origin_is_rejected() {
        let headers = headers(&[
            ("host", "127.0.0.1:17720"),
            ("origin", "http://evil.example"),
        ]);
        let err = check_origin(&plain(), &headers).expect_err("must reject");
        assert_eq!(err.code(), "csrf");
        assert_eq!(err.status(), axum::http::StatusCode::FORBIDDEN);
    }

    /// Same host, different port is a different origin, and it is the case an
    /// attacker on the same LAN can actually arrange.
    #[test]
    fn the_port_is_part_of_the_origin() {
        let headers = headers(&[
            ("host", "127.0.0.1:17720"),
            ("origin", "http://127.0.0.1:5173"),
        ]);
        assert!(check_origin(&plain(), &headers).is_err());
    }

    #[test]
    fn a_write_without_an_origin_or_referer_is_rejected() {
        let headers = headers(&[("host", "127.0.0.1:17720")]);
        assert!(check_origin(&plain(), &headers).is_err());
    }

    #[test]
    fn the_referer_stands_in_when_the_origin_is_absent() {
        let headers = headers(&[
            ("host", "kasir.lokal"),
            ("referer", "http://kasir.lokal/produk?page=2"),
        ]);
        assert!(check_origin(&plain(), &headers).is_ok());
    }

    #[test]
    fn an_opaque_origin_is_not_a_match() {
        let headers = headers(&[("host", "kasir.lokal"), ("origin", "null")]);
        assert!(check_origin(&plain(), &headers).is_err());
    }

    /// Behind an HTTPS nginx the browser's Origin is `https://` while this
    /// process still sees plain HTTP. Comparing authorities keeps that working.
    #[test]
    fn a_tls_terminating_proxy_does_not_break_the_check() {
        let headers = headers(&[
            ("host", "kasir.lokal"),
            ("origin", "https://kasir.lokal"),
            ("x-forwarded-proto", "https"),
        ]);
        assert!(check_origin(&behind_nginx(), &headers).is_ok());
    }

    #[test]
    fn x_forwarded_host_is_only_honoured_for_a_trusted_proxy() {
        let headers = headers(&[
            ("host", "127.0.0.1:17720"),
            ("x-forwarded-host", "kasir.lokal"),
            ("origin", "http://kasir.lokal"),
        ]);
        assert!(
            check_origin(&plain(), &headers).is_err(),
            "an untrusted client must not be able to nominate its own expected host"
        );
        assert!(check_origin(&behind_nginx(), &headers).is_ok());
    }

    #[test]
    fn an_extra_allowed_origin_is_honoured() {
        let config = ServerConfig {
            allowed_origins: vec!["http://kasir.lokal".into()],
            ..ServerConfig::default()
        };
        let headers = headers(&[
            ("host", "127.0.0.1:17720"),
            ("origin", "http://kasir.lokal"),
        ]);
        assert!(check_origin(&config, &headers).is_ok());
    }

    #[test]
    fn reads_are_exempt() {
        assert!(is_safe_method(&Method::GET));
        assert!(is_safe_method(&Method::HEAD));
        assert!(!is_safe_method(&Method::POST));
        assert!(!is_safe_method(&Method::PUT));
        assert!(!is_safe_method(&Method::PATCH));
        assert!(!is_safe_method(&Method::DELETE));
    }

    #[test]
    fn the_forwarded_address_is_ignored_unless_a_proxy_is_trusted() {
        let headers = headers(&[("x-forwarded-for", "203.0.113.7, 10.0.0.1")]);
        assert_eq!(forwarded_address(&plain(), &headers), None);
        assert_eq!(
            forwarded_address(&behind_nginx(), &headers),
            Some("203.0.113.7".to_string())
        );
    }

    #[test]
    fn the_cookie_is_only_marked_secure_on_a_trusted_https_request() {
        let https = headers(&[("x-forwarded-proto", "https")]);
        assert!(!request_is_https(&plain(), &https));
        assert!(request_is_https(&behind_nginx(), &https));

        let http = headers(&[("x-forwarded-proto", "http")]);
        assert!(!request_is_https(&behind_nginx(), &http));
        assert!(!request_is_https(&behind_nginx(), &HeaderMap::new()));
    }

    #[test]
    fn an_authority_is_normalised_the_same_way_on_both_sides() {
        assert_eq!(
            origin_authority("HTTP://Kasir.Lokal:8080/x"),
            Some("kasir.lokal:8080".to_string())
        );
        assert_eq!(
            origin_authority("http://user:pw@kasir.lokal/x"),
            Some("kasir.lokal".to_string())
        );
        assert_eq!(origin_authority("kasir.lokal"), Some("kasir.lokal".into()));
        assert_eq!(origin_authority("  "), None);
        assert_eq!(origin_authority("null"), None);
    }

    /// What gets a line in the log: every 4xx/5xx except the two that are
    /// normal traffic — an unknown barcode's 404 and the cold-start session
    /// probe's 401.
    #[test]
    fn failures_are_logged_except_the_expected_ones() {
        let get = Method::GET;
        let post = Method::POST;

        assert!(!should_log_failure(StatusCode::OK, &get, "/api/products"));
        assert!(!should_log_failure(StatusCode::NOT_FOUND, &get, "/api/products/barcode/x"));
        assert!(!should_log_failure(StatusCode::UNAUTHORIZED, &get, "/api/auth/me"));

        assert!(should_log_failure(StatusCode::UNAUTHORIZED, &post, "/api/auth/me"));
        assert!(should_log_failure(StatusCode::UNAUTHORIZED, &get, "/api/products"));
        assert!(should_log_failure(StatusCode::UNPROCESSABLE_ENTITY, &post, "/api/transactions"));
        assert!(should_log_failure(StatusCode::BAD_GATEWAY, &post, "/api/ppob/inquiries/pln"));
        assert!(should_log_failure(StatusCode::INTERNAL_SERVER_ERROR, &get, "/api/reports"));
    }
}
