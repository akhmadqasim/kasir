//! Thin wrappers over axum's extractors that fail the way the rest of the API
//! fails.
//!
//! `axum::Json`'s own rejection is a plain-text body with no `code`, so a
//! malformed request would be the one failure a client could not parse the same
//! way as every other. These exist purely so that never happens.

use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
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
