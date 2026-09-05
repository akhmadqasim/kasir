use sea_orm::DatabaseConnection;
use tauri::State;

use crate::commands::resolve_actor;
use crate::domain::shifts::{
    CashFlowResponse, CloseShiftInput, CreateCashFlowInput, OpenShiftInput, ShiftResponse,
    ShiftSummaryResponse,
};
use crate::domain::Actor;
use crate::services;
use crate::utils::AppError;

/// The webview still sends `userId` on these two payloads. The service takes the
/// owner from the actor instead, so the field is unwrapped here and nowhere else.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShiftArgs {
    pub user_id: i64,
    pub opening_cash: Option<f64>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCashFlowArgs {
    pub shift_id: i64,
    pub user_id: i64,
    pub flow_type: String,
    pub amount: f64,
    pub description: String,
}

#[tauri::command]
pub async fn open_shift(
    db: State<'_, DatabaseConnection>,
    input: OpenShiftArgs,
) -> Result<ShiftResponse, AppError> {
    let actor = Actor::unverified(input.user_id);
    services::shifts::open(
        db.inner(),
        &actor,
        OpenShiftInput {
            opening_cash: input.opening_cash,
        },
    )
    .await
}

#[tauri::command]
pub async fn get_active_shift(
    db: State<'_, DatabaseConnection>,
    user_id: i64,
) -> Result<Option<ShiftResponse>, AppError> {
    let actor = Actor::unverified(user_id);
    services::shifts::active_for(db.inner(), &actor).await
}

#[tauri::command]
pub async fn close_shift(
    db: State<'_, DatabaseConnection>,
    input: CloseShiftInput,
) -> Result<ShiftSummaryResponse, AppError> {
    services::shifts::close(db.inner(), input).await
}

#[tauri::command]
pub async fn get_shift_summary(
    db: State<'_, DatabaseConnection>,
    shift_id: i64,
) -> Result<ShiftSummaryResponse, AppError> {
    services::shifts::summary(db.inner(), shift_id).await
}

#[tauri::command]
pub async fn create_cash_flow(
    db: State<'_, DatabaseConnection>,
    input: CreateCashFlowArgs,
) -> Result<CashFlowResponse, AppError> {
    let actor = Actor::unverified(input.user_id);
    services::shifts::create_cash_flow(
        db.inner(),
        &actor,
        CreateCashFlowInput {
            shift_id: input.shift_id,
            flow_type: input.flow_type,
            amount: input.amount,
            description: input.description,
        },
    )
    .await
}

#[tauri::command]
pub async fn list_cash_flows(
    db: State<'_, DatabaseConnection>,
    shift_id: i64,
) -> Result<Vec<CashFlowResponse>, AppError> {
    services::shifts::list_cash_flows(db.inner(), shift_id).await
}

#[tauri::command]
pub async fn delete_cash_flow(
    db: State<'_, DatabaseConnection>,
    cash_flow_id: i64,
    caller_id: i64,
) -> Result<(), AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::shifts::delete_cash_flow(db.inner(), &actor, cash_flow_id).await
}
