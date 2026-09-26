//! What the transport knows about the caller.

use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::header;
use axum::http::request::Parts;
use axum::http::HeaderMap;

use super::{first_csv_entry, header_str};
use crate::http::{AppState, ServerConfig};

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

#[cfg(test)]
mod tests {
    use super::super::test_fixtures::{behind_nginx, headers, plain};
    use super::*;

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
}
