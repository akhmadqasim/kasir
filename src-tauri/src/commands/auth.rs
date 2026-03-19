use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder};
use serde::Deserialize;
use tauri::State;

use crate::entity::users;
use crate::utils::AppError;

#[derive(Debug, Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub pin: String,
}

#[tauri::command]
pub async fn login(
    db: State<'_, DatabaseConnection>,
    input: LoginInput,
) -> Result<users::Model, AppError> {
    let user = users::Entity::find()
        .filter(users::Column::Username.eq(&input.username))
        .filter(users::Column::IsActive.eq(true))
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::Auth("Username atau PIN tidak sesuai".to_string()))?;

    let pin_valid = bcrypt::verify(&input.pin, &user.pin_hash)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !pin_valid {
        return Err(AppError::Auth("Username atau PIN tidak sesuai".to_string()));
    }

    Ok(user)
}

#[tauri::command]
pub async fn get_current_user(
    db: State<'_, DatabaseConnection>,
    user_id: i64,
) -> Result<users::Model, AppError> {
    users::Entity::find_by_id(user_id)
        .filter(users::Column::IsActive.eq(true))
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".to_string()))
}

#[tauri::command]
pub async fn list_users(
    db: State<'_, DatabaseConnection>,
) -> Result<Vec<users::Model>, AppError> {
    let users = users::Entity::find()
        .filter(users::Column::IsActive.eq(true))
        .order_by_asc(users::Column::FullName)
        .all(db.inner())
        .await?;
    Ok(users)
}
