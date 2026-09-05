use sea_orm::DatabaseConnection;
use tauri::State;

use crate::commands::resolve_actor;
use crate::domain::auth::{CreateUserInput, LoginInput, ToggleUserActiveInput, UpdateUserInput};
use crate::domain::Actor;
use crate::entity::users;
use crate::services;
use crate::utils::AppError;

#[tauri::command]
pub async fn login(
    db: State<'_, DatabaseConnection>,
    input: LoginInput,
) -> Result<users::Model, AppError> {
    services::auth::login(db.inner(), input).await
}

#[tauri::command]
pub async fn get_current_user(
    db: State<'_, DatabaseConnection>,
    user_id: i64,
) -> Result<users::Model, AppError> {
    // This handler resolves the identity itself, so the id is passed through
    // unverified and the service performs the active-user check.
    let actor = Actor::unverified(user_id);
    services::auth::get_current_user(db.inner(), &actor).await
}

#[tauri::command]
pub async fn list_users(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
) -> Result<Vec<users::Model>, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::auth::list_users(db.inner(), &actor).await
}

#[tauri::command]
pub async fn create_user(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    input: CreateUserInput,
) -> Result<users::Model, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::auth::create_user(db.inner(), &actor, input).await
}

#[tauri::command]
pub async fn update_user(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    input: UpdateUserInput,
) -> Result<users::Model, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::auth::update_user(db.inner(), &actor, input).await
}

#[tauri::command]
pub async fn toggle_user_active(
    db: State<'_, DatabaseConnection>,
    user_id: i64,
    is_active: bool,
    current_user_id: i64,
) -> Result<users::Model, AppError> {
    let actor = resolve_actor(db.inner(), current_user_id).await?;
    services::auth::toggle_user_active(
        db.inner(),
        &actor,
        ToggleUserActiveInput { user_id, is_active },
    )
    .await
}
