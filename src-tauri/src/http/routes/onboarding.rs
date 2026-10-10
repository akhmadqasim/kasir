//! First-run setup.
//!
//! Public by necessity: it runs before any account exists, so there is nobody to
//! authenticate as. What keeps it from being an open door is the service, which
//! writes nothing once the store exists — a second POST cannot mint a second
//! admin. Such a POST gets a 409 and no store data at all: anyone on the LAN can
//! send it, and the store row holds the PPOB credentials.

use axum::extract::State;
use axum::routing::{get, post};
use axum::Router;

use crate::domain::onboarding::CompleteOnboardingInput;
use crate::domain::settings::StoreInfo;
use crate::http::error::{ApiError, ApiResult};
use crate::http::extract::Json;
use crate::http::AppState;
use crate::services;
use crate::services::onboarding::Onboarding;

pub fn public() -> Router<AppState> {
    Router::new()
        .route("/onboarding/status", get(status))
        .route("/onboarding", post(complete))
}

/// `true` while the store row is still missing.
async fn status(State(state): State<AppState>) -> ApiResult<axum::Json<bool>> {
    Ok(axum::Json(
        services::onboarding::is_pending(&state.db).await?,
    ))
}

async fn complete(
    State(state): State<AppState>,
    Json(input): Json<CompleteOnboardingInput>,
) -> ApiResult<axum::Json<StoreInfo>> {
    match services::onboarding::complete(&state.db, input).await? {
        Onboarding::Created(store) => Ok(axum::Json(store)),
        Onboarding::AlreadyDone => Err(ApiError::conflict("Toko sudah diatur sebelumnya")),
    }
}
