//! Client-side log entries.
//!
//! The browser catches errors the server never sees — a render that threw, a
//! `fetch` that failed before it left the tab — and this is where it posts them
//! so they land in the same `data/logs` files as everything else. That is the
//! whole feature.
//!
//! It needs a session for one reason: an unauthenticated write endpoint that
//! appends attacker-controlled text to a file on the till is a way to fill a
//! disk, and there is no client that legitimately logs before logging in.

use axum::http::StatusCode;
use axum::routing::post;
use axum::Router;
use serde::Deserialize;

use crate::http::error::ApiResult;
use crate::http::extract::Json;
use crate::http::AppState;
use crate::services;

/// Cap on one entry. A stack trace fits comfortably; a paste of the whole DOM
/// does not.
const MAX_MESSAGE_CHARS: usize = 4_000;

pub fn session() -> Router<AppState> {
    Router::new().route("/logs", post(write))
}

#[derive(Debug, Deserialize)]
struct LogEntry {
    /// `startup`, `info`, `warning` or `error`. Anything else is filed as info
    /// by the service rather than refused — a mislabelled log is still a log.
    level: String,
    message: String,
}

async fn write(Json(entry): Json<LogEntry>) -> ApiResult<StatusCode> {
    let message: String = entry.message.chars().take(MAX_MESSAGE_CHARS).collect();
    services::logging::write_entry(&entry.level, &message);
    Ok(StatusCode::NO_CONTENT)
}
