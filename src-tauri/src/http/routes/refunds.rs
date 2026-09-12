//! Returns and exchanges.
//!
//! Any cashier may take a return — that is the point of a till — so all three
//! routes are in the session group. What stops abuse is not a role but the
//! service's own rules: seven days from the sale, no more than was bought, and
//! the refund is recorded against whoever's session took it. That last part is
//! the change: `create_refund` used to believe the `user_id` in the payload,
//! which meant a return could be booked under anyone's name.

use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::Router;

use crate::domain::refunds::{
    CreateRefundInput, ListRefundsInput, ListRefundsResult, RefundDetailResult, RefundResult,
};
use crate::domain::Actor;
use crate::http::error::ApiResult;
use crate::http::extract::{Json, Query};
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/refunds", get(list).post(create))
        .route("/refunds/{id}", get(detail))
}

async fn list(
    State(state): State<AppState>,
    Query(input): Query<ListRefundsInput>,
) -> ApiResult<axum::Json<ListRefundsResult>> {
    Ok(axum::Json(services::refunds::list(&state.db, input).await?))
}

async fn detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<RefundDetailResult>> {
    Ok(axum::Json(services::refunds::detail(&state.db, id).await?))
}

async fn create(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<CreateRefundInput>,
) -> ApiResult<(StatusCode, axum::Json<RefundResult>)> {
    let result = services::refunds::create(&state.db, &actor, input).await?;
    Ok((StatusCode::CREATED, axum::Json(result)))
}
