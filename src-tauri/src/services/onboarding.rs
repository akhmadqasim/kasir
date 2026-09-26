//! First-run setup: the store row and its first admin.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, DatabaseConnection, EntityTrait, PaginatorTrait, Set,
    TransactionTrait,
};

use crate::domain::onboarding::CompleteOnboardingInput;
use crate::entity::{store_info, users};
use crate::services::auth::{hash_pin, validate_pin};
use crate::services::settings::get_store_info;
use crate::utils::time::now_ts;
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
///
/// The early existence check alone is not enough: two requests can both pass it
/// before either commits. The store is therefore always inserted as row 1, so
/// the slower of two racing requests hits the primary key, rolls back its admin
/// with it, and returns the store the faster one created.
pub async fn complete(
    db: &DatabaseConnection,
    input: CompleteOnboardingInput,
) -> Result<store_info::Model, AppError> {
    if let Some(store) = get_store_info(db).await? {
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

    validate_pin(&input.admin.pin)?;
    // Hashed before the transaction opens, so the write lock is not held for
    // the quarter second bcrypt takes.
    let pin_hash = hash_pin(&input.admin.pin).await?;

    let txn = db.begin().await?;

    let now = now_ts();

    let store = store_info::ActiveModel {
        id: Set(1),
        name: Set(store_name),
        address: Set(input.store.address),
        phone: Set(input.store.phone),
        email: Set(input.store.email),
        logo_path: Set(None),
        additional_info: Set(None),
        created_at: Set(Some(now.clone())),
        updated_at: Set(Some(now.clone())),
    };

    let store_result = match store.insert(&txn).await {
        Ok(store) => store,
        Err(e) => {
            txn.rollback().await?;
            // Lost the race: the other request's store is the answer.
            return match get_store_info(db).await? {
                Some(store) => Ok(store),
                None => Err(e.into()),
            };
        }
    };

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
