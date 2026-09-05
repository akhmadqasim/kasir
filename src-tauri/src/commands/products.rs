use sea_orm::DatabaseConnection;
use tauri::State;

use crate::commands::resolve_actor;
use crate::domain::products::{
    BulkImportResult, BulkProductInput, CreateProductInput, PaginatedProducts, ProductSearchParams,
    SaveTemplateFileInput, ShortcutProduct, UpdateProductInput,
};
use crate::entity::products as products_entity;
use crate::services;
use crate::utils::AppError;

#[tauri::command]
pub async fn search_products(
    db: State<'_, DatabaseConnection>,
    params: ProductSearchParams,
) -> Result<PaginatedProducts, AppError> {
    services::products::search(db.inner(), params).await
}

#[tauri::command]
pub async fn get_product_by_barcode(
    db: State<'_, DatabaseConnection>,
    barcode: String,
) -> Result<Option<products_entity::Model>, AppError> {
    services::products::get_by_barcode(db.inner(), &barcode).await
}

#[tauri::command]
pub async fn create_product(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    input: CreateProductInput,
) -> Result<products_entity::Model, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::products::create(db.inner(), &actor, input).await
}

#[tauri::command]
pub async fn update_product(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    input: UpdateProductInput,
) -> Result<products_entity::Model, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::products::update(db.inner(), &actor, input).await
}

#[tauri::command]
pub async fn delete_product(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    id: i64,
) -> Result<(), AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::products::delete(db.inner(), &actor, id).await
}

#[tauri::command]
pub async fn get_popular_products(
    db: State<'_, DatabaseConnection>,
    limit: Option<i64>,
) -> Result<Vec<ShortcutProduct>, AppError> {
    services::products::popular(db.inner(), limit).await
}

#[tauri::command]
pub async fn track_product_selection(
    db: State<'_, DatabaseConnection>,
    product_id: i64,
) -> Result<(), AppError> {
    services::products::track_selection(db.inner(), product_id).await
}

#[tauri::command]
pub async fn toggle_product_pin(
    db: State<'_, DatabaseConnection>,
    product_id: i64,
) -> Result<bool, AppError> {
    services::products::toggle_pin(db.inner(), product_id).await
}

#[tauri::command]
pub async fn bulk_create_products(
    db: State<'_, DatabaseConnection>,
    caller_id: i64,
    products: Vec<BulkProductInput>,
) -> Result<BulkImportResult, AppError> {
    let actor = resolve_actor(db.inner(), caller_id).await?;
    services::products::bulk_create(db.inner(), &actor, products).await
}

#[tauri::command]
pub fn save_template_file(content: String, filename: String) -> Result<(), AppError> {
    services::products::save_template_file(SaveTemplateFileInput { content, filename })
}
