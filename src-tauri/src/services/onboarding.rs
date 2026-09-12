//! First-run setup: the store row and its first admin.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, DatabaseConnection, EntityTrait, PaginatorTrait, Set,
    TransactionTrait,
};

use crate::domain::onboarding::CompleteOnboardingInput;
use crate::entity::{store_info, users};
use crate::utils::AppError;

/// True while the store row is still missing, i.e. onboarding is still needed.
pub async fn is_pending(db: &DatabaseConnection) -> Result<bool, AppError> {
    let count = store_info::Entity::find().count(db).await?;
    Ok(count == 0)
}

/// Create the store and its first admin in one transaction.
///
/// Runs before any account exists, so it takes no actor. Idempotent: once the
/// store row is there the existing one is returned untouched.
pub async fn complete(
    db: &DatabaseConnection,
    input: CompleteOnboardingInput,
) -> Result<store_info::Model, AppError> {
    let existing = store_info::Entity::find().one(db).await?;
    if let Some(store) = existing {
        return Ok(store);
    }

    let store_name = input.store.name.trim().to_string();
    if store_name.is_empty() {
        return Err(AppError::Validation(
            "Nama toko tidak boleh kosong".to_string(),
        ));
    }

    let admin_username = input.admin.username.trim().to_string();
    if admin_username.is_empty() {
        return Err(AppError::Validation(
            "Username admin tidak boleh kosong".to_string(),
        ));
    }

    let pin = &input.admin.pin;
    if pin.len() < 4 || pin.len() > 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation(
            "PIN harus terdiri dari 4-6 digit angka".to_string(),
        ));
    }

    let txn = db.begin().await?;

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let store = store_info::ActiveModel {
        id: NotSet,
        name: Set(store_name),
        address: Set(input.store.address),
        phone: Set(input.store.phone),
        email: Set(input.store.email),
        logo_path: Set(None),
        additional_info: Set(None),
        created_at: Set(Some(now.clone())),
        updated_at: Set(Some(now.clone())),
    };

    let store_result = store.insert(&txn).await?;

    let pin_hash = bcrypt::hash(&input.admin.pin, 12)
        .map_err(|e| AppError::Internal(format!("Gagal hash PIN: {}", e)))?;

    let admin = users::ActiveModel {
        id: NotSet,
        username: Set(admin_username),
        pin_hash: Set(pin_hash),
        full_name: Set(input.admin.full_name.trim().to_string()),
        role: Set("admin".to_string()),
        is_active: Set(true),
        created_at: Set(Some(now.clone())),
        updated_at: Set(Some(now)),
    };

    admin.insert(&txn).await?;

    txn.commit().await?;

    Ok(store_result)
}
