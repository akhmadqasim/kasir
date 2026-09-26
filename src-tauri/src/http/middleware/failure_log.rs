//! Every failed API call, written to the log files in one place.

use axum::extract::Request;
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;

use crate::http::error::FailureInfo;
use crate::utils::logging;

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

#[cfg(test)]
mod tests {
    use super::*;

    /// What gets a line in the log: every 4xx/5xx except the two that are
    /// normal traffic — an unknown barcode's 404 and the cold-start session
    /// probe's 401.
    #[test]
    fn failures_are_logged_except_the_expected_ones() {
        let get = Method::GET;
        let post = Method::POST;

        assert!(!should_log_failure(StatusCode::OK, &get, "/api/products"));
        assert!(!should_log_failure(
            StatusCode::NOT_FOUND,
            &get,
            "/api/products/barcode/x"
        ));
        assert!(!should_log_failure(
            StatusCode::UNAUTHORIZED,
            &get,
            "/api/auth/me"
        ));

        assert!(should_log_failure(
            StatusCode::UNAUTHORIZED,
            &post,
            "/api/auth/me"
        ));
        assert!(should_log_failure(
            StatusCode::UNAUTHORIZED,
            &get,
            "/api/products"
        ));
        assert!(should_log_failure(
            StatusCode::UNPROCESSABLE_ENTITY,
            &post,
            "/api/transactions"
        ));
        assert!(should_log_failure(
            StatusCode::BAD_GATEWAY,
            &post,
            "/api/ppob/inquiries/pln"
        ));
        assert!(should_log_failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            &get,
            "/api/reports"
        ));
    }
}
