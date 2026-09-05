//! Login and user management.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
};

use crate::domain::auth::{CreateUserInput, LoginInput, ToggleUserActiveInput, UpdateUserInput};
use crate::domain::Actor;
use crate::entity::users;
use crate::services::guard;
use crate::utils::AppError;

fn now_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// A PIN is 4 to 6 digits, nothing else.
pub fn validate_pin(pin: &str) -> Result<(), AppError> {
    if pin.len() < 4 || pin.len() > 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation(
            "PIN harus terdiri dari 4-6 digit angka".into(),
        ));
    }
    Ok(())
}

fn validate_role(role: &str) -> Result<(), AppError> {
    if role != "admin" && role != "kasir" {
        return Err(AppError::Validation(
            "Role harus 'admin' atau 'kasir'".into(),
        ));
    }
    Ok(())
}

/// Verify a username/PIN pair. The same message covers both a missing user and
/// a wrong PIN so the response cannot be used to enumerate accounts.
pub async fn login(db: &DatabaseConnection, input: LoginInput) -> Result<users::Model, AppError> {
    let user = users::Entity::find()
        .filter(users::Column::Username.eq(&input.username))
        .filter(users::Column::IsActive.eq(true))
        .one(db)
        .await?
        .ok_or_else(|| AppError::Auth("Username atau PIN tidak sesuai".to_string()))?;

    let pin_valid = bcrypt::verify(&input.pin, &user.pin_hash)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !pin_valid {
        return Err(AppError::Auth("Username atau PIN tidak sesuai".to_string()));
    }

    Ok(user)
}

/// The account behind the actor, provided it is still active.
pub async fn get_current_user(
    db: &DatabaseConnection,
    actor: &Actor,
) -> Result<users::Model, AppError> {
    users::Entity::find_by_id(actor.user_id)
        .filter(users::Column::IsActive.eq(true))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".to_string()))
}

pub async fn list_users(
    db: &DatabaseConnection,
    actor: &Actor,
) -> Result<Vec<users::Model>, AppError> {
    guard::require_admin(actor)?;

    let users = users::Entity::find()
        .order_by_asc(users::Column::FullName)
        .all(db)
        .await?;
    Ok(users)
}

pub async fn create_user(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateUserInput,
) -> Result<users::Model, AppError> {
    guard::require_admin(actor)?;

    let username = input.username.trim().to_string();
    if username.is_empty() {
        return Err(AppError::Validation("Username tidak boleh kosong".into()));
    }

    let full_name = input.full_name.trim().to_string();
    if full_name.is_empty() {
        return Err(AppError::Validation(
            "Nama lengkap tidak boleh kosong".into(),
        ));
    }

    validate_role(&input.role)?;
    validate_pin(&input.pin)?;

    let existing = users::Entity::find()
        .filter(users::Column::Username.eq(&username))
        .one(db)
        .await?;

    if existing.is_some() {
        return Err(AppError::Validation("Username sudah digunakan".into()));
    }

    let pin_hash = bcrypt::hash(&input.pin, bcrypt::DEFAULT_COST)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let now = now_timestamp();
    let new_user = users::ActiveModel {
        id: sea_orm::NotSet,
        username: Set(username),
        pin_hash: Set(pin_hash),
        full_name: Set(full_name),
        role: Set(input.role),
        is_active: Set(true),
        created_at: Set(Some(now.clone())),
        updated_at: Set(Some(now)),
    };

    let created = new_user.insert(db).await?;
    Ok(created)
}

pub async fn update_user(
    db: &DatabaseConnection,
    actor: &Actor,
    input: UpdateUserInput,
) -> Result<users::Model, AppError> {
    guard::require_admin(actor)?;

    let user = users::Entity::find_by_id(input.user_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    let mut active: users::ActiveModel = user.into();

    if let Some(username) = &input.username {
        let username = username.trim().to_string();
        if username.is_empty() {
            return Err(AppError::Validation("Username tidak boleh kosong".into()));
        }
        // Uniqueness, excluding the row being edited.
        let existing = users::Entity::find()
            .filter(users::Column::Username.eq(&username))
            .filter(users::Column::Id.ne(input.user_id))
            .one(db)
            .await?;
        if existing.is_some() {
            return Err(AppError::Validation("Username sudah digunakan".into()));
        }
        active.username = Set(username);
    }

    if let Some(full_name) = &input.full_name {
        let full_name = full_name.trim().to_string();
        if full_name.is_empty() {
            return Err(AppError::Validation(
                "Nama lengkap tidak boleh kosong".into(),
            ));
        }
        active.full_name = Set(full_name);
    }

    if let Some(role) = &input.role {
        validate_role(role)?;
        active.role = Set(role.clone());
    }

    if let Some(new_pin) = &input.new_pin {
        validate_pin(new_pin)?;
        let pin_hash = bcrypt::hash(new_pin, bcrypt::DEFAULT_COST)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        active.pin_hash = Set(pin_hash);
    }

    active.updated_at = Set(Some(now_timestamp()));
    let updated = active.update(db).await?;
    Ok(updated)
}

/// Enable or disable an account. An admin may not lock themselves out.
pub async fn toggle_user_active(
    db: &DatabaseConnection,
    actor: &Actor,
    input: ToggleUserActiveInput,
) -> Result<users::Model, AppError> {
    guard::require_admin(actor)?;

    if input.user_id == actor.user_id && !input.is_active {
        return Err(AppError::Validation(
            "Tidak dapat menonaktifkan akun sendiri".into(),
        ));
    }

    let user = users::Entity::find_by_id(input.user_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    let mut active: users::ActiveModel = user.into();
    active.is_active = Set(input.is_active);
    active.updated_at = Set(Some(now_timestamp()));

    let updated = active.update(db).await?;
    Ok(updated)
}
