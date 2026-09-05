//! Categories: readable by anyone logged in, writable by an admin.

use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post, put};
use axum::Router;

use crate::domain::categories::{CreateCategoryInput, UpdateCategoryInput};
use crate::domain::Actor;
use crate::entity::categories;
use crate::http::error::ApiResult;
use crate::http::extract::Json;
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new().route("/categories", get(list))
}

pub fn admin() -> Router<AppState> {
    Router::new()
        .route("/categories", post(create))
        .route("/categories/{id}", put(update))
        .route("/categories/{id}", delete(remove))
}

async fn list(State(state): State<AppState>) -> ApiResult<axum::Json<Vec<categories::Model>>> {
    Ok(axum::Json(services::categories::list(&state.db).await?))
}

async fn create(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<CreateCategoryInput>,
) -> ApiResult<(StatusCode, axum::Json<categories::Model>)> {
    let category = services::categories::create(&state.db, &actor, input).await?;
    Ok((StatusCode::CREATED, axum::Json(category)))
}

/// The path id wins over the body's, as it does for products.
async fn update(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
    Json(mut input): Json<UpdateCategoryInput>,
) -> ApiResult<axum::Json<categories::Model>> {
    input.id = id;
    Ok(axum::Json(
        services::categories::update(&state.db, &actor, input).await?,
    ))
}

async fn remove(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> ApiResult<StatusCode> {
    services::categories::delete(&state.db, &actor, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
