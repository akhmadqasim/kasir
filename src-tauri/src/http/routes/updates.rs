//! Self-update: status, check, download, install.
//!
//! Thin on purpose — the state machine is [`crate::updater::Updater`]. Reading
//! the status and asking for a check need only a session, because knowing a
//! newer version exists helps a cashier tell the owner. Downloading and
//! installing close and replace the program on the till, so they are admin
//! actions like restoring a backup.
//!
//! All three writes answer `202 Accepted` with the status they moved to: the
//! download and the install carry on after the response, and `check` returns
//! the phase it ended in.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Router;

use crate::http::error::ApiResult;
use crate::http::AppState;
use crate::updater::UpdateStatus;
use crate::utils::AppError;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/updates", get(status))
        .route("/updates/check", post(check))
}

pub fn admin() -> Router<AppState> {
    Router::new()
        .route("/updates/download", post(download))
        .route("/updates/install", post(install))
}

async fn status(State(state): State<AppState>) -> axum::Json<UpdateStatus> {
    axum::Json(state.updater.status())
}

type Accepted = ApiResult<(StatusCode, axum::Json<UpdateStatus>)>;

fn accepted(moved_to: Result<UpdateStatus, AppError>) -> Accepted {
    Ok((StatusCode::ACCEPTED, axum::Json(moved_to?)))
}

async fn check(State(state): State<AppState>) -> Accepted {
    accepted(state.updater.check().await)
}

async fn download(State(state): State<AppState>) -> Accepted {
    accepted(state.updater.download())
}

async fn install(State(state): State<AppState>) -> Accepted {
    accepted(state.updater.install())
}
