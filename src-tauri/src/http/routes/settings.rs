//! Store details and application settings.
//!
//! `/store` is the shop's name and address — every till needs it to draw a
//! receipt header, so a cashier may read it and only an admin may change it.
//! `/store/public` is the part of that row the login screen shows before anyone
//! has signed in — the name and whether there is a logo, nothing else — so it
//! sits in the `public` group. `/store/logo` is the shop's logo file: public for
//! the same reason (it is on every printed receipt, and the login screen draws
//! it), while only an admin may upload (`POST /settings/store/logo`) or remove
//! it. The upload reads the bytes and nothing
//! else — the part's `filename` and `Content-Type` are never consulted;
//! `services::store_logo` decides the format from the content and writes to a
//! path it owns.
//!
//! `/settings/ppob/markup` is the one slice of the settings blob a cashier may
//! read directly: the PPOB markup table, needed by `PpobQuickAccess` to price
//! a top-up. It carries none of the fields `/settings` withholds, so it is
//! safe in the `session` group rather than `admin`. `/settings/sales` is the
//! same kind of slice: the sales block (default payment method, negative-stock
//! policy), which the till's payment dialog needs.
//!
//! `/settings` is the whole configuration blob, and it is admin-only on both
//! sides for one specific reason: it used to contain the PPOB password in the
//! clear. `get_app_settings` deobfuscates it and checks no role, so serving it
//! as-is would hand a shop's payment-gateway credential to anyone who can reach
//! the port. The read here answers with [`PublicAppSettings`], which reports
//! `has_credentials` and nothing else, and the write cannot carry it either.
//! Setting it is a separate request to `/settings/ppob/credentials`, so the
//! secret travels in exactly one direction. The PPOB transaction PIN is not
//! part of any of this: it is never a setting, only ever a field on the
//! checkout/retry requests that spend money — see
//! `services::ppob::executor::validate_pin`.
//!
//! [`PublicAppSettings`]: crate::domain::settings::PublicAppSettings

use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::Extension;
use axum::Router;

use crate::domain::settings::{
    DatabaseInfo, PpobMarkup, PublicAppSettings, PublicStoreInfo, SalesSettings,
    UpdateAppSettingsInput, UpdatePpobCredentialsInput, UpdateStoreInfoInput,
};
use crate::domain::store_logo::MAX_LOGO_BYTES;
use crate::domain::Actor;
use crate::entity::store_info;
use crate::http::error::{ApiError, ApiResult};
use crate::http::extract::{Json, UploadedFile};
use crate::http::AppState;
use crate::services;

pub fn public() -> Router<AppState> {
    Router::new()
        .route("/store/public", get(get_public_store))
        .route("/store/logo", get(get_store_logo))
}

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/store", get(get_store))
        .route("/settings/ppob/markup", get(get_ppob_markup))
        .route("/settings/sales", get(get_sales_settings))
}

pub fn admin() -> Router<AppState> {
    Router::new()
        .route("/store", put(update_store))
        .route(
            "/settings/store/logo",
            // Tighter than the global 32 MB: the service refuses anything over
            // `MAX_LOGO_BYTES` anyway, and there is no reason to buffer a
            // spreadsheet-sized body to find that out. The slack covers the
            // multipart framing around the file.
            post(upload_store_logo)
                .delete(delete_store_logo)
                .layer(DefaultBodyLimit::max(MAX_LOGO_BYTES + 64 * 1024)),
        )
        .route("/settings", get(get_settings).put(update_settings))
        .route("/settings/ppob/credentials", put(update_ppob_credentials))
        .route("/settings/database", get(database_info))
}

/// `null` before onboarding; the login screen then simply shows no name.
async fn get_public_store(
    State(state): State<AppState>,
) -> ApiResult<axum::Json<Option<PublicStoreInfo>>> {
    Ok(axum::Json(
        services::settings::public_store_info(&state.db).await?,
    ))
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

/// The logo file, or 404 when the store has none.
///
/// Served with a `Content-Security-Policy` that forbids scripts. That, not the
/// upload check, is what makes an SVG safe here: an `<img>` never runs one, and
/// a logo opened directly in a tab cannot run anything under the app's
/// origin. `nosniff` keeps the browser from second-guessing the type.
async fn get_store_logo(State(state): State<AppState>) -> ApiResult<Response> {
    let Some(logo) = services::store_logo::load(&state.db).await? else {
        return Err(ApiError::not_found("Toko belum punya logo"));
    };

    Ok((
        [
            (header::CONTENT_TYPE, logo.format.content_type()),
            // The frontend cache-busts with `?v=<updated_at>`, so a stale copy
            // lives at most an hour and only until the next change anyway.
            (header::CACHE_CONTROL, "private, max-age=3600"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; style-src 'unsafe-inline'",
            ),
        ],
        logo.bytes,
    )
        .into_response())
}

/// Take the logo as a multipart upload on the field named `file`.
///
/// Like the backup import, the part's `filename` is never read; the service
/// picks the format from the bytes and the name on disk from the format.
async fn upload_store_logo(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    UploadedFile(data): UploadedFile,
) -> ApiResult<axum::Json<store_info::Model>> {
    Ok(axum::Json(
        services::store_logo::save(&state.db, &actor, &data).await?,
    ))
}

async fn delete_store_logo(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
) -> ApiResult<StatusCode> {
    services::store_logo::remove(&state.db, &actor).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_settings(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
) -> ApiResult<axum::Json<PublicAppSettings>> {
    Ok(axum::Json(
        services::settings::public_app_settings(&state.db, &actor).await?,
    ))
}

/// The PPOB markup table only — no password, open to any session.
async fn get_ppob_markup(State(state): State<AppState>) -> ApiResult<axum::Json<PpobMarkup>> {
    Ok(axum::Json(
        services::settings::ppob_markup(&state.db).await?,
    ))
}

async fn get_sales_settings(State(state): State<AppState>) -> ApiResult<axum::Json<SalesSettings>> {
    Ok(axum::Json(
        services::settings::sales_settings(&state.db).await?,
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
