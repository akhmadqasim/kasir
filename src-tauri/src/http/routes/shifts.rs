//! Shifts and the cash that moves in and out of the drawer during one.
//!
//! Four of the six commands behind these routes took a `userId` from the
//! payload and none of them checked it, so a cashier could open a shift, book a
//! cash withdrawal, or read someone else's open shift by editing a number. Here
//! the owner is the session, full stop: `POST /shifts` opens *your* shift and
//! `GET /shifts/active` answers about *yours*.
//!
//! Deleting a cash-flow entry is the one rule the router cannot express — the
//! author may do it, and so may an admin — so it stays in the session group and
//! the service decides.

use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::Router;

use crate::domain::shifts::{
    CashFlowResponse, CloseShiftInput, CreateCashFlowInput, OpenShiftInput, ShiftResponse,
    ShiftSummaryResponse,
};
use crate::domain::Actor;
use crate::http::error::ApiResult;
use crate::http::extract::Json;
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/shifts", post(open))
        .route("/shifts/active", get(active))
        .route("/shifts/{id}/close", post(close))
        .route("/shifts/{id}/summary", get(summary))
        .route("/shifts/{id}/cash-flows", get(list_cash_flows))
        .route("/shifts/{id}/cash-flows", post(create_cash_flow))
        .route("/cash-flows/{id}", delete(delete_cash_flow))
}

async fn open(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<OpenShiftInput>,
) -> ApiResult<(StatusCode, axum::Json<ShiftResponse>)> {
    let shift = services::shifts::open(&state.db, &actor, input).await?;
    Ok((StatusCode::CREATED, axum::Json(shift)))
}

/// The caller's own open shift, or `null`.
async fn active(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
) -> ApiResult<axum::Json<Option<ShiftResponse>>> {
    Ok(axum::Json(
        services::shifts::active_for(&state.db, &actor).await?,
    ))
}

/// The body of a close, minus the shift id the URL already carries.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseShiftBody {
    closing_cash: Option<f64>,
    notes: Option<String>,
}

async fn close(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<CloseShiftBody>,
) -> ApiResult<axum::Json<ShiftSummaryResponse>> {
    Ok(axum::Json(
        services::shifts::close(
            &state.db,
            CloseShiftInput {
                shift_id: id,
                closing_cash: body.closing_cash,
                notes: body.notes,
            },
        )
        .await?,
    ))
}

async fn summary(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<ShiftSummaryResponse>> {
    Ok(axum::Json(services::shifts::summary(&state.db, id).await?))
}

async fn list_cash_flows(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<Vec<CashFlowResponse>>> {
    Ok(axum::Json(
        services::shifts::list_cash_flows(&state.db, id).await?,
    ))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCashFlowBody {
    flow_type: String,
    amount: f64,
    description: String,
}

async fn create_cash_flow(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
    Json(body): Json<CreateCashFlowBody>,
) -> ApiResult<(StatusCode, axum::Json<CashFlowResponse>)> {
    let flow = services::shifts::create_cash_flow(
        &state.db,
        &actor,
        CreateCashFlowInput {
            shift_id: id,
            flow_type: body.flow_type,
            amount: body.amount,
            description: body.description,
        },
    )
    .await?;
    Ok((StatusCode::CREATED, axum::Json(flow)))
}

/// Remove a cash-flow entry. The service allows its author or an admin, and
/// only while the shift is still open.
async fn delete_cash_flow(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> ApiResult<StatusCode> {
    services::shifts::delete_cash_flow(&state.db, &actor, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
