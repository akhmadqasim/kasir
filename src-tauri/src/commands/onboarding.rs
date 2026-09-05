use sea_orm::DatabaseConnection;
use tauri::State;

use crate::domain::onboarding::CompleteOnboardingInput;
use crate::entity::store_info;
use crate::services;
use crate::utils::AppError;

#[tauri::command]
pub async fn check_onboarding_status(db: State<'_, DatabaseConnection>) -> Result<bool, AppError> {
    services::onboarding::is_pending(db.inner()).await
}

#[tauri::command]
pub async fn complete_onboarding(
    db: State<'_, DatabaseConnection>,
    input: CompleteOnboardingInput,
) -> Result<store_info::Model, AppError> {
    services::onboarding::complete(db.inner(), input).await
}
