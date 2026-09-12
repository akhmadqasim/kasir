//! Store details and application settings.
//!
//! `/store` is the shop's name and address — every till needs it to draw a
//! receipt header, so a cashier may read it and only an admin may change it.
//!
//! `/settings/ppob/markup` is the one slice of the settings blob a cashier may
//! read directly: the PPOB markup table, needed by `PpobQuickAccess` to price
//! a top-up. It carries none of the fields `/settings` withholds, so it is
//! safe in the `session` group rather than `admin`.
//!
//! `/settings` is the whole configuration blob, and it is admin-only on both
//! sides for one specific reason: it used to contain the PPOB password and PIN
//! in the clear. `get_app_settings` deobfuscates them and checks no role, so
//! the Tauri command that wraps it hands a shop's payment-gateway credentials
//! to anyone who can invoke it — which, on a LAN, is anyone who can reach the
//! port. The read here answers with [`PublicAppSettings`], which reports
//! `has_credentials` and nothing else, and the write cannot carry them either.
//! Setting them is a separate request to `/settings/ppob/credentials`, so the
//! secrets travel in exactly one direction.
//!
//! [`PublicAppSettings`]: crate::domain::settings::PublicAppSettings

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, put};
use axum::Extension;
use axum::Router;

use crate::domain::settings::{
    DatabaseInfo, PpobMarkup, PublicAppSettings, UpdateAppSettingsInput,
    UpdatePpobCredentialsInput, UpdateStoreInfoInput,
};
use crate::domain::Actor;
use crate::entity::store_info;
use crate::http::error::ApiResult;
use crate::http::extract::Json;
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/store", get(get_store))
        .route("/settings/ppob/markup", get(get_ppob_markup))
}

pub fn admin() -> Router<AppState> {
    Router::new()
        .route("/store", put(update_store))
        .route("/settings", get(get_settings).put(update_settings))
        .route("/settings/ppob/credentials", put(update_ppob_credentials))
        .route("/settings/database", get(database_info))
}

async fn get_store(
    State(state): State<AppState>,
) -> ApiResult<axum::Json<Option<store_info::Model>>> {
    Ok(axum::Json(
        services::settings::get_store_info(&state.db).await?,
    ))
}

async fn update_store(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<UpdateStoreInfoInput>,
) -> ApiResult<axum::Json<store_info::Model>> {
    Ok(axum::Json(
        services::settings::update_store_info(&state.db, &actor, input).await?,
    ))
}

async fn get_settings(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
) -> ApiResult<axum::Json<PublicAppSettings>> {
    Ok(axum::Json(
        services::settings::public_app_settings(&state.db, &actor).await?,
    ))
}

/// The PPOB markup table only — no password, no PIN, open to any session.
async fn get_ppob_markup(State(state): State<AppState>) -> ApiResult<axum::Json<PpobMarkup>> {
    Ok(axum::Json(
        services::settings::ppob_markup(&state.db).await?,
    ))
}

async fn update_settings(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<UpdateAppSettingsInput>,
) -> ApiResult<StatusCode> {
    services::settings::update_public_app_settings(&state.db, &actor, &state.mitra, input).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn update_ppob_credentials(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(input): Json<UpdatePpobCredentialsInput>,
) -> ApiResult<StatusCode> {
    services::settings::update_ppob_credentials(&state.db, &actor, &state.mitra, input).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Size and location of the live database file. The path is server-side
/// information an admin uses to find the file on the till; nothing accepts a
/// path back.
async fn database_info() -> ApiResult<axum::Json<DatabaseInfo>> {
    Ok(axum::Json(services::settings::database_info()?))
}
