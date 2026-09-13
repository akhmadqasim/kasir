//! Thin wrappers over axum's extractors that fail the way the rest of the API
//! fails.
//!
//! `axum::Json`'s own rejection is a plain-text body with no `code`, so a
//! malformed request would be the one failure a client could not parse the same
//! way as every other. These exist purely so that never happens.

use axum::body::Bytes;
use axum::extract::multipart::MultipartError;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{FromRequest, FromRequestParts, Multipart, Request};
use axum::http::request::Parts;
use axum::http::StatusCode;
use serde::de::DeserializeOwned;

use crate::http::error::ApiError;

/// A JSON request body.
pub struct Json<T>(pub T);

impl<T, S> FromRequest<S> for Json<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let axum::Json(value) = axum::Json::<T>::from_request(req, state)
            .await
            .map_err(to_api_error)?;
        Ok(Self(value))
    }
}

/// A parsed query string.
pub struct Query<T>(pub T);

impl<T, S> FromRequestParts<S> for Query<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let axum::extract::Query(value) =
            axum::extract::Query::<T>::from_request_parts(parts, state)
                .await
                .map_err(|rejection: QueryRejection| {
                    ApiError::bad_request(format!("Parameter tidak valid: {rejection}"))
                })?;
        Ok(Self(value))
    }
}

/// A body that is syntactically broken is a 400; one that parses but does not
/// fit the type is a 422, matching how [`crate::utils::AppError::Validation`] is
/// mapped.
fn to_api_error(rejection: JsonRejection) -> ApiError {
    match rejection {
        JsonRejection::JsonDataError(err) => {
            ApiError::validation(format!("Data tidak sesuai: {err}"))
        }
        other => ApiError::bad_request(format!("Format data tidak valid: {other}")),
    }
}

/// Deserialise a body the handler already holds, failing exactly as [`Json`]
/// would.
///
/// The idempotent routes cannot use `Json<T>`: they have to hash the bytes the
/// client actually sent, and an extractor that consumes the body leaves nothing
/// to hash. They take `Bytes` and come here, so the error shape a client sees
/// does not depend on which of the two paths parsed its request.
pub fn json_from_slice<T: DeserializeOwned>(body: &[u8]) -> Result<T, ApiError> {
    serde_json::from_slice(body).map_err(|err| match err.classify() {
        serde_json::error::Category::Data => {
            ApiError::validation(format!("Data tidak sesuai: {err}"))
        }
        _ => ApiError::bad_request(format!("Format data tidak valid: {err}")),
    })
}

/// The bytes of the one part named `file` in a `multipart/form-data` body.
///
/// Both uploads the API takes — a database image and the store logo — want
/// exactly this and nothing else. The part's `filename` and `Content-Type` are
/// deliberately not exposed: both are attacker-controlled, and every caller
/// decides what the bytes are by looking at the bytes.
pub struct UploadedFile(pub Bytes);

impl<S> FromRequest<S> for UploadedFile
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        // A body that runs past the route's `DefaultBodyLimit` surfaces here as
        // a multipart read error with a 413 status. A phone photo dropped on the
        // logo picker is that case, and "unreadable upload" would send the admin
        // looking for a corrupt file instead of a smaller one.
        let unreadable = |e: MultipartError| {
            if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
                ApiError::new(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "validation",
                    "Berkas terlalu besar untuk diunggah.",
                )
            } else {
                ApiError::bad_request(format!("Unggahan tidak dapat dibaca: {}", e.body_text()))
            }
        };

        let mut multipart = Multipart::from_request(req, state).await.map_err(|e| {
            ApiError::bad_request(format!("Unggahan tidak dapat dibaca: {}", e.body_text()))
        })?;

        while let Some(field) = multipart.next_field().await.map_err(unreadable)? {
            // Only the field named `file` is considered, so a stray text field
            // cannot be mistaken for the upload.
            if field.name() != Some("file") {
                continue;
            }
            return Ok(Self(field.bytes().await.map_err(unreadable)?));
        }

        Err(ApiError::validation(
            "Unggahan harus berisi berkas pada field bernama 'file'.",
        ))
    }
}
