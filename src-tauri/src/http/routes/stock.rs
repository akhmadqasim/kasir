//! Stock write-offs: damaged, expired, lost.
//!
//! The role split here is finer than "session or admin", so it is drawn in two
//! places. Recording a write-off is a session route because a cashier holding
//! the broken bottle should not have to fetch the owner — but `lost` has no
//! broken bottle to hold, so the service refuses that reason to anyone who is
//! not an admin, and a cashier's write-off lands `pending` rather than
//! `approved`. Deciding a pending one, and deleting any one, are admin routes.
//!
//! Splitting it this way means the router expresses what it can express
//! ("approval is an admin action") and the service keeps what a router cannot
//! say ("this particular reason is").

use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::Router;

use crate::domain::stock::{
    CreateWriteoffInput, ListWriteoffsInput, ListWriteoffsResult, StockWriteoffResponse,
};
use crate::domain::Actor;
use crate::http::error::ApiResult;
use crate::http::extract::{Json, Query};
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/stock/writeoffs", get(list).post(create))
        .route("/stock/writeoffs/{id}", get(detail))
}

pub fn admin() -> Router<AppState> {
    Router::new()
        .route("/stock/writeoffs/{id}", delete(remove))
        .route("/stock/writeoffs/{id}/approve", post(approve))
        .route("/stock/writeoffs/{id}/reject", post(reject))
}

async fn list(
    State(state): State<AppState>,
    Query(input): Query<ListWriteoffsInput>,
) -> ApiResult<axum::Json<ListWriteoffsResult>> {
    Ok(axum::Json(services::stock::list(&state.db, input).await?))
}

async fn detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<StockWriteoffResponse>> {
    Ok(axum::Json(services::stock::detail(&state.db, id).await?))
}

async fn create(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<CreateWriteoffInput>,
) -> ApiResult<(StatusCode, axum::Json<StockWriteoffResponse>)> {
    let writeoff = services::stock::create(&state.db, &actor, input).await?;
    Ok((StatusCode::CREATED, axum::Json(writeoff)))
}

async fn approve(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<StockWriteoffResponse>> {
    Ok(axum::Json(
        services::stock::approve(&state.db, &actor, id).await?,
    ))
}

async fn reject(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<StockWriteoffResponse>> {
    Ok(axum::Json(
        services::stock::reject(&state.db, &actor, id).await?,
    ))
}

async fn remove(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> ApiResult<StatusCode> {
    services::stock::delete(&state.db, &actor, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
