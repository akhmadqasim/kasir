//! The till window: its zoom.
//!
//! `GET` answers the stored factor plus whether *this caller* may change it.
//! The API is also served to tablets on the shop LAN, and the zoom toolbar in
//! the frontend shows on exactly those small screens — so without the check a
//! cashier tapping "+" on a tablet would enlarge the desktop window in the
//! next room. The caller is the window when the request came in over loopback
//! and a window is attached; anyone else is told `available: false` and left
//! to their browser's own zoom.

use axum::extract::State;
use axum::routing::get;
use axum::Router;
use serde::{Deserialize, Serialize};

use crate::http::error::{ApiError, ApiResult};
use crate::http::extract::Json;
use crate::http::middleware::ClientInfo;
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new().route("/window/zoom", get(zoom).put(set_zoom))
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
