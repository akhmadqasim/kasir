use sea_orm::DatabaseConnection;
use tauri::State;

use crate::commands::resolve_actor;
use crate::domain::stock::{
    CreateWriteoffInput, ListWriteoffsInput, ListWriteoffsResult, StockWriteoffResponse,
};
use crate::services;
use crate::utils::AppError;

#[tauri::command]
pub async fn list_stock_writeoffs(
    db: State<'_, DatabaseConnection>,
    input: ListWriteoffsInput,
) -> Result<ListWriteoffsResult, AppError> {
    services::stock::list(db.inner(), input).await
}

#[tauri::command]
pub async fn create_stock_writeoff(
    db: State<'_, DatabaseConnection>,
    input: CreateWriteoffInput,
    caller_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::stock::create(db.inner(), &actor, input).await
}

#[tauri::command]
pub async fn approve_stock_writeoff(
    db: State<'_, DatabaseConnection>,
    writeoff_id: i64,
    caller_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::stock::approve(db.inner(), &actor, writeoff_id).await
}

#[tauri::command]
pub async fn reject_stock_writeoff(
    db: State<'_, DatabaseConnection>,
    writeoff_id: i64,
    caller_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::stock::reject(db.inner(), &actor, writeoff_id).await
}

#[tauri::command]
pub async fn delete_stock_writeoff(
    db: State<'_, DatabaseConnection>,
    writeoff_id: i64,
    caller_id: i64,
) -> Result<(), AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::stock::delete(db.inner(), &actor, writeoff_id).await
}

#[tauri::command]
pub async fn get_stock_writeoff_detail(
    db: State<'_, DatabaseConnection>,
    writeoff_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    services::stock::detail(db.inner(), writeoff_id).await
}
