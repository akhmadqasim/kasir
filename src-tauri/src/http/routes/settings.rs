//! Store details and application settings.
//!
//! `/store` is the shop's name and address — every till needs it to draw a
//! receipt header, so a cashier may read it and only an admin may change it.
//! `/store/logo` is the shop's logo file on the same terms: any session may
//! fetch it for the sidebar, only an admin may upload (`POST
//! /settings/store/logo`) or remove it. The upload reads the bytes and nothing
//! else — the part's `filename` and `Content-Type` are never consulted;
//! `services::store_logo` decides the format from the content and writes to a
//! path it owns.
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

use axum::extract::{DefaultBodyLimit, Multipart, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::Extension;
use axum::Router;

use crate::domain::settings::{
    DatabaseInfo, PpobMarkup, PublicAppSettings, UpdateAppSettingsInput,
    UpdatePpobCredentialsInput, UpdateStoreInfoInput,
};
use crate::domain::store_logo::MAX_LOGO_BYTES;
use crate::domain::Actor;
use crate::entity::store_info;
use crate::http::error::{ApiError, ApiResult};
use crate::http::extract::Json;
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/store", get(get_store))
        .route("/store/logo", get(get_store_logo))
        .route("/settings/ppob/markup", get(get_ppob_markup))
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
/// Served with a `Content-Security-Policy` that forbids scripts: an SVG with a
/// `<script>` is refused at upload, but the header costs nothing and means a
/// logo opened directly in a tab still cannot run anything under the app's
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
    mut multipart: Multipart,
) -> ApiResult<axum::Json<store_info::Model>> {
    let mut data = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        ApiError::bad_request(format!("Unggahan tidak dapat dibaca: {}", e.body_text()))
    })? {
        if field.name() != Some("file") {
            continue;
        }
        data = Some(field.bytes().await.map_err(|e| {
            ApiError::bad_request(format!("Unggahan tidak dapat dibaca: {}", e.body_text()))
        })?);
        break;
    }

    let Some(data) = data else {
        return Err(ApiError::validation(
            "Unggahan harus berisi berkas gambar pada field bernama 'file'.",
        ));
    };

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
