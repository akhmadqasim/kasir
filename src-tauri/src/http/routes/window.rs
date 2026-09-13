//! The till window: its zoom and its icon.
//!
//! `GET` answers the stored factor plus whether *this caller* may change it.
//! The API is also served to tablets on the shop LAN, and the zoom toolbar in
//! the frontend shows on exactly those small screens — so without the check a
//! cashier tapping "+" on a tablet would enlarge the desktop window in the
//! next room. The caller is the window when the request came in over loopback
//! and a window is attached; anyone else is told `available: false` and left
//! to their browser's own zoom. The icon is guarded the same way: only the
//! window itself may repaint its own taskbar entry with the store logo.

use axum::extract::{DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};

use crate::http::error::{ApiError, ApiResult};
use crate::http::extract::{Json, UploadedFile};
use crate::http::middleware::ClientInfo;
use crate::http::AppState;
use crate::services;

/// A 256-pixel PNG the page draws is a few kilobytes; anything near this is
/// not that.
const MAX_ICON_BYTES: usize = 512 * 1024;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/window/zoom", get(zoom).put(set_zoom))
        .route(
            "/window/icon",
            post(set_icon)
                .delete(reset_icon)
                .layer(DefaultBodyLimit::max(MAX_ICON_BYTES)),
        )
}

#[derive(Debug, Serialize)]
pub struct ZoomResponse {
    pub factor: f64,
    /// Whether `PUT` from this caller would do anything.
    pub available: bool,
}

#[derive(Debug, Deserialize)]
pub struct SetZoomInput {
    pub factor: f64,
}

fn is_the_till_window(state: &AppState, client: &ClientInfo) -> bool {
    state.window_zoom.is_attached() && client.is_loopback()
}

fn may_paint_the_icon(state: &AppState, client: &ClientInfo) -> ApiResult<()> {
    if state.window_icon.is_attached() && client.is_loopback() {
        Ok(())
    } else {
        Err(ApiError::conflict(
            "Ikon jendela hanya bisa diubah dari jendela aplikasi di komputer kasir.",
        ))
    }
}

/// Show the PNG posted as `file` on the window: the store logo, drawn square
/// by the page.
async fn set_icon(
    State(state): State<AppState>,
    client: ClientInfo,
    UploadedFile(png): UploadedFile,
) -> ApiResult<StatusCode> {
    may_paint_the_icon(&state, &client)?;
    state.window_icon.apply(Some(&png))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Back to the icon built into the executable.
async fn reset_icon(State(state): State<AppState>, client: ClientInfo) -> ApiResult<StatusCode> {
    may_paint_the_icon(&state, &client)?;
    state.window_icon.apply(None)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn zoom(
    State(state): State<AppState>,
    client: ClientInfo,
) -> ApiResult<axum::Json<ZoomResponse>> {
    let factor = services::settings::ui_zoom(&state.db).await?;
    Ok(axum::Json(ZoomResponse {
        factor,
        available: is_the_till_window(&state, &client),
    }))
}

async fn set_zoom(
    State(state): State<AppState>,
    client: ClientInfo,
    Json(input): Json<SetZoomInput>,
) -> ApiResult<axum::Json<ZoomResponse>> {
    if !is_the_till_window(&state, &client) {
        return Err(ApiError::conflict(
            "Ukuran tampilan hanya bisa diubah dari jendela aplikasi di komputer kasir.",
        ));
    }
    // Stored first, then applied: the factor the window shows is the one a
    // restart will open at, already clamped and rounded by the store.
    let factor = state
        .window_zoom
        .store_then_apply(services::settings::save_ui_zoom(&state.db, input.factor))
        .await?;
    Ok(axum::Json(ZoomResponse {
        factor,
        available: true,
    }))
}
