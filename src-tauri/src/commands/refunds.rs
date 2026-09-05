use sea_orm::DatabaseConnection;
use tauri::State;

use crate::domain::refunds::{
    CreateRefundInput, ExchangeItemInput, ListRefundsInput, ListRefundsResult, RefundDetailResult,
    RefundItemInput, RefundResult,
};
use crate::domain::Actor;
use crate::services;
use crate::utils::AppError;

/// The webview still sends `user_id` on the refund payload. The service takes
/// the author from the actor instead, so the field is unwrapped here and
/// nowhere else.
#[derive(Debug, serde::Deserialize)]
pub struct CreateRefundArgs {
    pub transaction_id: i64,
    pub user_id: i64,
    pub reason: Option<String>,
    pub items: Vec<RefundItemInput>,
    pub exchange_items: Option<Vec<ExchangeItemInput>>,
}

#[tauri::command]
pub async fn create_refund(
    db: State<'_, DatabaseConnection>,
    input: CreateRefundArgs,
) -> Result<RefundResult, AppError> {
    let actor = Actor::unverified(input.user_id);
    services::refunds::create(
        db.inner(),
        &actor,
        CreateRefundInput {
            transaction_id: input.transaction_id,
            reason: input.reason,
            items: input.items,
            exchange_items: input.exchange_items,
        },
    )
    .await
}

#[tauri::command]
pub async fn get_refund_detail(
    db: State<'_, DatabaseConnection>,
    refund_id: i64,
) -> Result<RefundDetailResult, AppError> {
    services::refunds::detail(db.inner(), refund_id).await
}

#[tauri::command]
pub async fn list_refunds(
    db: State<'_, DatabaseConnection>,
    input: ListRefundsInput,
) -> Result<ListRefundsResult, AppError> {
    services::refunds::list(db.inner(), input).await
}
