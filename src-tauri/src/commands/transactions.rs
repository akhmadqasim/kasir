use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::commands::resolve_actor;
use crate::domain::transactions::{
    CheckoutTransactionInput, DeleteTransactionInput, ListTransactionsInput, PaginatedTransactions,
    PaymentSplitInput, TransactionDetail, TransactionItemInput, TransactionResult,
    UpdatePaymentMethodInput,
};
use crate::domain::Actor;
use crate::entity::transactions;
use crate::services;
use crate::services::ppob::MitraClient;
use crate::utils::AppError;

/// The webview still sends `user_id` on these three payloads. The services take
/// the identity from the actor instead, so the field is unwrapped here and
/// nowhere else.
#[derive(Debug, serde::Deserialize)]
pub struct CheckoutArgs {
    pub user_id: i64,
    pub items: Vec<TransactionItemInput>,
    pub payment_method: String,
    pub payment_amount: f64,
    pub payment_breakdown: Option<Vec<PaymentSplitInput>>,
    pub notes: Option<String>,
    pub transaction_discount: Option<f64>,
    pub shift_id: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
pub struct DeleteTransactionArgs {
    pub transaction_id: i64,
    pub user_id: i64,
    pub reason: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdatePaymentMethodArgs {
    pub transaction_id: i64,
    pub user_id: i64,
    pub payment_method: String,
    pub reason: String,
}

#[tauri::command]
pub async fn checkout_transaction(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    input: CheckoutArgs,
) -> Result<TransactionResult, AppError> {
    let actor = Actor::unverified(input.user_id);
    services::transactions::checkout(
        db.inner(),
        mitra.inner(),
        &actor,
        CheckoutTransactionInput {
            items: input.items,
            payment_method: input.payment_method,
            payment_amount: input.payment_amount,
            payment_breakdown: input.payment_breakdown,
            notes: input.notes,
            transaction_discount: input.transaction_discount,
            shift_id: input.shift_id,
        },
    )
    .await
}

#[tauri::command]
pub async fn retry_ppob_fulfillment(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    item_id: i64,
) -> Result<String, AppError> {
    services::transactions::retry_ppob_fulfillment(db.inner(), mitra.inner(), item_id).await
}

#[tauri::command]
pub async fn get_next_receipt_number(
    db: State<'_, DatabaseConnection>,
) -> Result<String, AppError> {
    services::transactions::next_receipt_number(db.inner()).await
}

#[tauri::command]
pub async fn list_transactions(
    db: State<'_, DatabaseConnection>,
    input: ListTransactionsInput,
) -> Result<PaginatedTransactions, AppError> {
    services::transactions::list(db.inner(), input).await
}

#[tauri::command]
pub async fn get_transaction_detail(
    db: State<'_, DatabaseConnection>,
    transaction_id: i64,
) -> Result<TransactionDetail, AppError> {
    services::transactions::detail(db.inner(), transaction_id).await
}

#[tauri::command]
pub async fn delete_transaction(
    db: State<'_, DatabaseConnection>,
    input: DeleteTransactionArgs,
) -> Result<(), AppError> {
    let actor = resolve_actor(db.inner(), input.user_id).await?;
    services::transactions::void(
        db.inner(),
        &actor,
        DeleteTransactionInput {
            transaction_id: input.transaction_id,
            reason: input.reason,
        },
    )
    .await
}

#[tauri::command]
pub async fn update_payment_method(
    db: State<'_, DatabaseConnection>,
    input: UpdatePaymentMethodArgs,
) -> Result<transactions::Model, AppError> {
    let actor = resolve_actor(db.inner(), input.user_id).await?;
    services::transactions::update_payment_method(
        db.inner(),
        &actor,
        UpdatePaymentMethodInput {
            transaction_id: input.transaction_id,
            payment_method: input.payment_method,
            reason: input.reason,
        },
    )
    .await
}
