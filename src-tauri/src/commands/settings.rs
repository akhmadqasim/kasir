use sea_orm::{DatabaseConnection, EntityTrait};
use tauri::State;

use crate::entity::store_info;
use crate::utils::AppError;

#[tauri::command]
pub async fn get_store_info(
    db: State<'_, DatabaseConnection>,
) -> Result<Option<store_info::Model>, AppError> {
    let info = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?;
    Ok(info)
}
