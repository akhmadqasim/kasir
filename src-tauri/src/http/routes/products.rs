//! Products: read for any cashier, write for an admin.
//!
//! The split is enforced twice on purpose. The router puts the write routes
//! behind `require_admin`, and the services behind them still call
//! `guard::require_admin` on the `Actor` they are handed. The layer is the fast,
//! visible rule; the service check is the one that survives someone moving a
//! route into the wrong group.

use axum::extract::{Extension, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::Router;

use crate::domain::products::{
    BulkImportResult, BulkProductInput, CreateProductInput, PaginatedProducts, ProductSearchParams,
    ShortcutProduct, UpdateProductInput,
};
use crate::domain::Actor;
use crate::entity::products;
use crate::http::error::ApiResult;
use crate::http::extract::{Json, Query};
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/products", get(search))
        .route("/products/popular", get(popular))
        .route("/products/import-template", get(import_template))
        .route("/products/barcode/{barcode}", get(by_barcode))
        .route("/products/{id}/select", post(track_selection))
        .route("/products/{id}/pin", post(toggle_pin))
}

pub fn admin() -> Router<AppState> {
    Router::new()
        .route("/products", post(create))
        .route("/products/bulk", post(bulk_create))
        .route("/products/{id}", put(update))
        .route("/products/{id}", delete(remove))
}

async fn search(
    State(state): State<AppState>,
    Query(params): Query<ProductSearchParams>,
) -> ApiResult<axum::Json<PaginatedProducts>> {
    Ok(axum::Json(
        services::products::search(&state.db, params).await?,
    ))
}

async fn by_barcode(
    State(state): State<AppState>,
    Path(barcode): Path<String>,
) -> ApiResult<axum::Json<Option<products::Model>>> {
    Ok(axum::Json(
        services::products::get_by_barcode(&state.db, &barcode).await?,
    ))
}

#[derive(Debug, serde::Deserialize)]
struct PopularParams {
    limit: Option<i64>,
}

async fn popular(
    State(state): State<AppState>,
    Query(params): Query<PopularParams>,
) -> ApiResult<axum::Json<Vec<ShortcutProduct>>> {
    Ok(axum::Json(
        services::products::popular(&state.db, params.limit).await?,
    ))
}

/// The import template as a download.
///
/// The Tauri command writes this file to the user's Desktop from content the
/// webview supplies. Over HTTP the server both generates and serves it, so no
/// client-supplied string ever becomes a path — the traversal question does not
/// arise because there is no filesystem write left to traverse into.
async fn import_template() -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!(
                    "attachment; filename=\"{}\"",
                    services::products::IMPORT_TEMPLATE_FILENAME
                ),
            ),
        ],
        services::products::import_template_csv(),
    )
        .into_response()
}

async fn track_selection(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<StatusCode> {
    services::products::track_selection(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Returns the pin state after toggling.
async fn toggle_pin(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<bool>> {
    Ok(axum::Json(
        services::products::toggle_pin(&state.db, id).await?,
    ))
}

async fn create(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<CreateProductInput>,
) -> ApiResult<(StatusCode, axum::Json<products::Model>)> {
    let product = services::products::create(&state.db, &actor, input).await?;
    Ok((StatusCode::CREATED, axum::Json(product)))
}

/// The id in the path wins over whatever the body claims, so a payload cannot
/// aim an update at a different row than the URL says.
async fn update(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
    Json(mut input): Json<UpdateProductInput>,
) -> ApiResult<axum::Json<products::Model>> {
    input.id = id;
    Ok(axum::Json(
        services::products::update(&state.db, &actor, input).await?,
    ))
}

async fn remove(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> ApiResult<StatusCode> {
    services::products::delete(&state.db, &actor, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn bulk_create(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<Vec<BulkProductInput>>,
) -> ApiResult<axum::Json<BulkImportResult>> {
    Ok(axum::Json(
        services::products::bulk_create(&state.db, &actor, input).await?,
    ))
}
