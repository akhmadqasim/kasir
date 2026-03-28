use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, DatabaseConnection, EntityTrait, PaginatorTrait, Set,
    TransactionTrait,
};
use serde::Deserialize;
use tauri::State;

use crate::entity::{store_info, users};
use crate::utils::AppError;

#[derive(Debug, Deserialize)]
pub struct SetupStoreInput {
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetupAdminInput {
    pub username: String,
    pub pin: String,
    pub full_name: String,
}

#[derive(Debug, Deserialize)]
pub struct CompleteOnboardingInput {
    pub store: SetupStoreInput,
    pub admin: SetupAdminInput,
}

#[tauri::command]
pub async fn check_onboarding_status(db: State<'_, DatabaseConnection>) -> Result<bool, AppError> {
    let count = store_info::Entity::find().count(db.inner()).await?;
    Ok(count == 0)
}

#[tauri::command]
pub async fn complete_onboarding(
    db: State<'_, DatabaseConnection>,
    input: CompleteOnboardingInput,
) -> Result<store_info::Model, AppError> {
    // Idempotency: if already onboarded, return existing store info
    let existing = store_info::Entity::find().one(db.inner()).await?;
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
