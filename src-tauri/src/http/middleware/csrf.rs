//! The Origin/Referer check that keeps another site's page from changing
//! anything here.

use axum::extract::{Request, State};
use axum::http::header;
use axum::http::{HeaderMap, Method};
use axum::middleware::Next;
use axum::response::Response;

use super::{first_csv_entry, header_str};
use crate::http::error::{ApiError, ApiResult};
use crate::http::{AppState, ServerConfig};

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

#[cfg(test)]
mod tests {
    use super::super::test_fixtures::{behind_nginx, headers, plain};
    use super::*;

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
}
