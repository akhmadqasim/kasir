use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entity::users;
use crate::utils::AppError;

/// Verify user exists, is active, and has the required role.
/// Returns the user model on success.
pub async fn require_role(
    db: &DatabaseConnection,
    user_id: i64,
    required_role: &str,
) -> Result<users::Model, AppError> {
    let user = users::Entity::find_by_id(user_id)
        .filter(users::Column::IsActive.eq(true))
        .one(db)
        .await?
        .ok_or_else(|| AppError::Auth("Sesi tidak valid. Silakan login ulang.".to_string()))?;

    if required_role == "any" {
        return Ok(user);
    }

    if user.role != required_role {
        return Err(AppError::Forbidden(format!(
            "Akses ditolak. Hanya {} yang boleh mengakses fitur ini.",
            required_role
        )));
    }

    Ok(user)
}

/// Verify user exists and is active (any role).
pub async fn require_auth(
    db: &DatabaseConnection,
    user_id: i64,
) -> Result<users::Model, AppError> {
    require_role(db, user_id, "any").await
}
