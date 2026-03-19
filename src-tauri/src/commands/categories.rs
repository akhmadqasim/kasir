use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, Set,
};
use tauri::State;

use crate::entity::{categories, products};
use crate::utils::AppError;

#[tauri::command]
pub async fn list_categories(
    db: State<'_, DatabaseConnection>,
) -> Result<Vec<categories::Model>, AppError> {
    let cats = categories::Entity::find()
        .order_by_asc(categories::Column::Name)
        .all(db.inner())
        .await?;
    Ok(cats)
}

#[tauri::command]
pub async fn create_category(
    db: State<'_, DatabaseConnection>,
    name: String,
    description: Option<String>,
) -> Result<categories::Model, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "Nama kategori tidak boleh kosong".to_string(),
        ));
    }

    let new_cat = categories::ActiveModel {
        id: NotSet,
        name: Set(name),
        description: Set(description),
        created_at: Set(Some(
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        )),
    };

    let result = new_cat.insert(db.inner()).await?;
    Ok(result)
}

#[tauri::command]
pub async fn update_category(
    db: State<'_, DatabaseConnection>,
    id: i64,
    name: String,
    description: Option<String>,
) -> Result<categories::Model, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "Nama kategori tidak boleh kosong".to_string(),
        ));
    }

    let existing = categories::Entity::find_by_id(id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Kategori tidak ditemukan".to_string()))?;

    let mut active: categories::ActiveModel = existing.into();
    active.name = Set(name);
    active.description = Set(description);

    let result = active.update(db.inner()).await?;
    Ok(result)
}

#[tauri::command]
pub async fn delete_category(
    db: State<'_, DatabaseConnection>,
    id: i64,
) -> Result<(), AppError> {
    let count = products::Entity::find()
        .filter(products::Column::CategoryId.eq(id))
        .filter(products::Column::IsActive.eq(true))
        .count(db.inner())
        .await?;

    if count > 0 {
        return Err(AppError::Validation(format!(
            "Kategori tidak dapat dihapus karena masih digunakan oleh {} produk",
            count
        )));
    }

    let result = categories::Entity::delete_by_id(id)
        .exec(db.inner())
        .await?;

    if result.rows_affected == 0 {
        return Err(AppError::NotFound("Kategori tidak ditemukan".to_string()));
    }

    Ok(())
}
