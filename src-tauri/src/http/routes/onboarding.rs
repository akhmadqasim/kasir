//! First-run setup.
//!
//! Public by necessity: it runs before any account exists, so there is nobody to
//! authenticate as. What keeps it from being an open door is the service, which
//! returns the existing store untouched once one is there — a second POST cannot
//! mint a second admin.

use axum::extract::State;
use axum::routing::{get, post};
use axum::Router;

use crate::domain::onboarding::CompleteOnboardingInput;
use crate::entity::store_info;
use crate::http::error::ApiResult;
use crate::http::extract::Json;
use crate::http::AppState;
use crate::services;

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
) -> ApiResult<axum::Json<store_info::Model>> {
    Ok(axum::Json(
        services::onboarding::complete(&state.db, input).await?,
    ))
}
