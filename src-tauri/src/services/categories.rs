//! Category CRUD.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, Set,
};

use crate::domain::categories::{CreateCategoryInput, UpdateCategoryInput};
use crate::domain::Actor;
use crate::entity::{categories, products};
use crate::services::guard;
use crate::utils::AppError;

pub async fn list(db: &DatabaseConnection) -> Result<Vec<categories::Model>, AppError> {
    let cats = categories::Entity::find()
        .order_by_asc(categories::Column::Name)
        .all(db)
        .await?;
    Ok(cats)
}

fn validate_name(name: &str) -> Result<String, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "Nama kategori tidak boleh kosong".to_string(),
        ));
    }
    Ok(name)
}

pub async fn create(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateCategoryInput,
) -> Result<categories::Model, AppError> {
    guard::require_admin(actor)?;

    let name = validate_name(&input.name)?;

    let new_cat = categories::ActiveModel {
        id: NotSet,
        name: Set(name),
        description: Set(input.description),
        created_at: Set(Some(
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        )),
    };

    let result = new_cat.insert(db).await?;
    Ok(result)
}

pub async fn update(
    db: &DatabaseConnection,
    actor: &Actor,
    input: UpdateCategoryInput,
) -> Result<categories::Model, AppError> {
    guard::require_admin(actor)?;

    let name = validate_name(&input.name)?;

    let existing = categories::Entity::find_by_id(input.id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Kategori tidak ditemukan".to_string()))?;

    let mut active: categories::ActiveModel = existing.into();
    active.name = Set(name);
    active.description = Set(input.description);

    let result = active.update(db).await?;
    Ok(result)
}

pub async fn delete(db: &DatabaseConnection, actor: &Actor, id: i64) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    let count = products::Entity::find()
        .filter(products::Column::CategoryId.eq(id))
        .filter(products::Column::IsActive.eq(true))
        .count(db)
        .await?;

    if count > 0 {
        return Err(AppError::Validation(format!(
            "Kategori tidak dapat dihapus karena masih digunakan oleh {} produk",
            count
        )));
    }

    let result = categories::Entity::delete_by_id(id).exec(db).await?;

    if result.rows_affected == 0 {
        return Err(AppError::NotFound("Kategori tidak ditemukan".to_string()));
    }

    Ok(())
}
