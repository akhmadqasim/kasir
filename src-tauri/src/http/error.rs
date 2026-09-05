//! `AppError` as an HTTP response.
//!
//! Every variant used to serialise to a bare string, so the only thing a client
//! could do with a failure was match on the Indonesian prose — there is a call
//! site in the frontend that literally tests `message.includes("belum
//! dikonfigurasi")`. A response here carries a status code and a stable
//! machine-readable `code`, and the prose becomes what it should always have
//! been: text for the person in front of the screen.
//!
//! `Database` and `Internal` never reach the client intact. Their message is the
//! one place a SQL string, a file path or a driver error could escape, so it goes
//! to the error log and the caller gets a fixed sentence.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::utils::{logging, AppError};

/// The body of every failed request.
#[derive(Debug, Serialize)]
pub struct ErrorBody {
    /// Stable identifier for code to branch on. Never translated.
    pub code: &'static str,
    /// Indonesian text meant for the user.
    pub message: String,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
    /// Seconds for the `Retry-After` header. Only the login backoff sets it.
    retry_after_secs: Option<u64>,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            retry_after_secs: None,
        }
    }

    /// No usable session on a route that needs one.
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "auth", message)
    }

    /// Authenticated, but not allowed to do this.
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", message)
    }

    /// The request itself is malformed — bad JSON, a query string that does not
    /// fit the parameters.
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    /// A well-formed request that breaks a rule.
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, "validation", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    /// The Origin/Referer check refused a state-changing request.
    pub fn csrf(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "csrf", message)
    }

    /// Login backoff. The seconds are echoed in the `Retry-After` header.
    pub fn rate_limited(message: impl Into<String>, retry_after_secs: u64) -> Self {
        Self {
            retry_after_secs: Some(retry_after_secs),
            ..Self::new(StatusCode::TOO_MANY_REQUESTS, "rate_limited", message)
        }
    }

    // Read by the tests, and by any future caller that needs to inspect a
    // failure before it becomes a response. Kept public rather than test-only
    // so an error stays inspectable outside `#[cfg(test)]`.
    #[allow(dead_code)]
    pub fn status(&self) -> StatusCode {
        self.status
    }

    #[allow(dead_code)]
    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl From<AppError> for ApiError {
    fn from(err: AppError) -> Self {
        match err {
            AppError::Auth(message) => ApiError::unauthorized(message),
            AppError::Forbidden(message) => ApiError::forbidden(message),
            AppError::NotFound(message) => ApiError::not_found(message),
            AppError::Validation(message) => ApiError::validation(message),
            // The two that must not be echoed. `Display` on the sea-orm error
            // includes the failing SQL; `Internal` routinely carries a path.
            AppError::Database(err) => {
                logging::log_error(&format!("database error: {err}"));
                ApiError::internal()
            }
            AppError::Internal(message) => {
                logging::log_error(&format!("internal error: {message}"));
                ApiError::internal()
            }
        }
    }
}

impl ApiError {
    fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "Terjadi kesalahan pada server. Coba lagi atau hubungi admin.",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let retry_after = self.retry_after_secs;
        let mut response = (
            self.status,
            Json(ErrorBody {
                code: self.code,
                message: self.message,
            }),
        )
            .into_response();

        if let Some(secs) = retry_after {
            if let Ok(value) = secs.to_string().parse() {
                response
                    .headers_mut()
                    .insert(axum::http::header::RETRY_AFTER, value);
            }
        }

        response
    }
}

/// What every route handler returns.
pub type ApiResult<T> = Result<T, ApiError>;

#[cfg(test)]
mod tests {
    use super::*;

    fn status_of(err: AppError) -> StatusCode {
        ApiError::from(err).status()
    }

    #[test]
    fn every_app_error_variant_maps_to_its_documented_status() {
        assert_eq!(
            status_of(AppError::Auth("x".into())),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status_of(AppError::Forbidden("x".into())),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            status_of(AppError::NotFound("x".into())),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            status_of(AppError::Validation("x".into())),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            status_of(AppError::Internal("x".into())),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            status_of(AppError::Database(sea_orm::DbErr::Custom("x".into()))),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    /// The user-facing variants keep their Indonesian text, because that text is
    /// what the screen shows.
    #[test]
    fn user_facing_messages_survive_the_conversion() {
        let err = ApiError::from(AppError::Validation("Nama toko tidak boleh kosong".into()));
        assert_eq!(err.message, "Nama toko tidak boleh kosong");
        assert_eq!(err.code(), "validation");
    }

    /// A database error's `Display` contains the failing statement. It must not
    /// be what the browser receives.
    #[test]
    fn internal_details_are_replaced_before_they_reach_the_client() {
        let leak = "SELECT pin_hash FROM users WHERE username = 'admin'";
        let err = ApiError::from(AppError::Database(sea_orm::DbErr::Custom(leak.into())));
        assert!(!err.message.contains(leak));
        assert_eq!(err.code(), "internal");

        let err = ApiError::from(AppError::Internal(format!("C:\\Users\\kasir\\{leak}")));
        assert!(!err.message.contains("C:\\Users"));
    }
}
