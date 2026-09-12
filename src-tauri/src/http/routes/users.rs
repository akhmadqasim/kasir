//! Staff accounts. Admin only, all four of them.
//!
//! The account being edited is named by the URL, never by the body. That is not
//! cosmetic: `UpdateUserInput` and `ToggleUserActiveInput` both carry a
//! `user_id`, and if the handler forwarded the body's copy a request could
//! address `/api/users/7` and quietly rewrite user 1. The body types here
//! deliberately have no id field at all, so there is nothing to confuse.
//!
//! Changing *your own* PIN is not here — that is `PUT /api/auth/me/pin`, which
//! needs no role because the current PIN is the proof.

use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::Router;
use serde::Deserialize;

use crate::domain::auth::{CreateUserInput, ToggleUserActiveInput, UpdateUserInput};
use crate::domain::Actor;
use crate::entity::users;
use crate::http::error::ApiResult;
use crate::http::extract::Json;
use crate::http::AppState;
use crate::services;

pub fn admin() -> Router<AppState> {
    Router::new()
        .route("/users", get(list).post(create))
        .route("/users/{id}", patch(update))
        .route("/users/{id}/active", patch(set_active))
}

async fn list(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
) -> ApiResult<axum::Json<Vec<users::Model>>> {
    Ok(axum::Json(
        services::auth::list_users(&state.db, &actor).await?,
    ))
}

async fn create(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<CreateUserInput>,
) -> ApiResult<(StatusCode, axum::Json<users::Model>)> {
    let user = services::auth::create_user(&state.db, &actor, input).await?;
    Ok((StatusCode::CREATED, axum::Json(user)))
}

/// Every field optional: a PATCH changes what it names and leaves the rest.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateUserBody {
    username: Option<String>,
    full_name: Option<String>,
    role: Option<String>,
    /// An admin resetting someone's forgotten PIN. Changing your own goes
    /// through `/api/auth/me/pin`, which asks for the current one.
    new_pin: Option<String>,
}

async fn update(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateUserBody>,
) -> ApiResult<axum::Json<users::Model>> {
    let input = UpdateUserInput {
        user_id: id,
        username: body.username,
        full_name: body.full_name,
        role: body.role,
        new_pin: body.new_pin,
    };
    Ok(axum::Json(
        services::auth::update_user(&state.db, &actor, input).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetActiveBody {
    is_active: bool,
}

async fn set_active(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
    Json(body): Json<SetActiveBody>,
) -> ApiResult<axum::Json<users::Model>> {
    let input = ToggleUserActiveInput {
        user_id: id,
        is_active: body.is_active,
    };
    Ok(axum::Json(
        services::auth::toggle_user_active(&state.db, &actor, input).await?,
    ))
}
