use sea_orm::DatabaseConnection;
use tauri::State;

use crate::commands::resolve_actor;
use crate::domain::categories::{CreateCategoryInput, UpdateCategoryInput};
use crate::entity::categories;
use crate::services;
use crate::utils::AppError;

#[tauri::command]
pub async fn list_categories(
    db: State<'_, DatabaseConnection>,
) -> Result<Vec<categories::Model>, AppError> {
    services::categories::list(db.inner()).await
}

#[tauri::command]
pub async fn create_category(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    name: String,
    description: Option<String>,
) -> Result<categories::Model, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::categories::create(
        db.inner(),
        &actor,
        CreateCategoryInput { name, description },
    )
    .await
}

#[tauri::command]
pub async fn update_category(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    id: i64,
    name: String,
    description: Option<String>,
) -> Result<categories::Model, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::categories::update(
        db.inner(),
        &actor,
        UpdateCategoryInput {
            id,
            name,
            description,
        },
    )
    .await
}

#[tauri::command]
pub async fn delete_category(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    id: i64,
) -> Result<(), AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::categories::delete(db.inner(), &actor, id).await
}
