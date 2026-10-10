//! First-run setup: the store row and its first admin.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, DatabaseConnection, EntityTrait, PaginatorTrait, Set,
    TransactionTrait,
};

use crate::domain::onboarding::CompleteOnboardingInput;
use crate::domain::settings::{validate_store_name, StoreInfo};
use crate::entity::{store_info, users};
use crate::services::auth::{hash_pin, validate_pin};
use crate::services::settings::get_store_info;
use crate::utils::text::ensure_printable_len;
use crate::utils::time::now_ts;
use crate::utils::AppError;

/// True while the store row is still missing, i.e. onboarding is still needed.
pub async fn is_pending(db: &DatabaseConnection) -> Result<bool, AppError> {
    let count = store_info::Entity::find().count(db).await?;
    Ok(count == 0)
}

/// What a call to [`complete`] did.
#[derive(Debug)]
pub enum Onboarding {
    /// This call created the store and its admin.
    Created(StoreInfo),
    /// The store already existed and nothing was written. The route is
    /// public, so this carries nothing about the existing store — least of
    /// all its settings blob, which holds the PPOB credentials.
    AlreadyDone,
}

/// Create the store and its first admin in one transaction.
///
/// Runs before any account exists, so it takes no actor. Once the store row is
/// there nothing is written and [`Onboarding::AlreadyDone`] comes back.
///
/// The early existence check alone is not enough: two requests can both pass it
/// before either commits. The store is therefore always inserted as row 1, so
/// the slower of two racing requests hits the primary key, rolls back its admin
/// with it, and is told onboarding is already done.
pub async fn complete(
    db: &DatabaseConnection,
    input: CompleteOnboardingInput,
) -> Result<Onboarding, AppError> {
    if get_store_info(db).await?.is_some() {
        return Ok(Onboarding::AlreadyDone);
    }

    let store_name = validate_store_name(&input.store.name)?;
    ensure_printable_len(input.store.address.as_deref(), "Alamat toko")?;
    ensure_printable_len(input.store.phone.as_deref(), "Telepon toko")?;

    let admin_username = input.admin.username.trim().to_string();
    if admin_username.is_empty() {
        return Err(AppError::Validation(
            "Username admin tidak boleh kosong".to_string(),
        ));
    }

    // The rule `create_user` applies: the first admin is a user too, and their
    // name is what every receipt they ring up prints as the cashier.
    let admin_full_name = input.admin.full_name.trim().to_string();
    if admin_full_name.is_empty() {
        return Err(AppError::Validation(
            "Nama lengkap tidak boleh kosong".to_string(),
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
            // Lost the race: the other request created the store.
            return match get_store_info(db).await? {
                Some(_) => Ok(Onboarding::AlreadyDone),
                None => Err(e.into()),
            };
        }
    };

    let admin = users::ActiveModel {
        id: NotSet,
        username: Set(admin_username),
        pin_hash: Set(pin_hash),
        full_name: Set(admin_full_name),
        role: Set("admin".to_string()),
        is_active: Set(true),
        created_at: Set(Some(now.clone())),
        updated_at: Set(Some(now)),
    };

    admin.insert(&txn).await?;

    txn.commit().await?;

    Ok(Onboarding::Created(store_result.into()))
}
