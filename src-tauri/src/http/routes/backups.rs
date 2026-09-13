//! Backups, and moving the database in and out of the till.
//!
//! Everything here is admin-only, including the listing — `list_backups` is one
//! of the two commands the contract audit found had lost the role check its
//! siblings kept, and the group puts it back.
//!
//! ## No client string is ever a path
//!
//! Three routes look like they take a filename and none of them does anything a
//! traversal could exploit.
//!
//! `DELETE /backups/{filename}` and `POST /backups/{filename}/restore` pass the
//! segment to `services::backup`, which rebuilds the path from the backup
//! directory and refuses anything that is not a single normal component
//! matching `kasir_YYYY-MM-DD[_HHMMSS].db.gz`. `..`, an absolute path, and a
//! percent-encoded separator all fail that test before any filesystem call.
//!
//! `GET /backups/export` has no filename to abuse. The Tauri `export_database`
//! command copies the database to a path its caller supplies, which is a
//! traversal the moment the caller is a request; here the server opens its own
//! file, streams it, and puts a name it generated itself in
//! `Content-Disposition`. That header is a suggestion to the browser's download
//! folder, not a path this process ever resolves.
//!
//! `POST /backups/import` takes a multipart upload and reads only the bytes.
//! The `filename` a multipart part carries is attacker-controlled and is
//! ignored entirely — it is not read, not logged as a path, and not used to
//! name anything. What lands on disk is the fixed staging path next to the live
//! database.

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Router};
use tokio_util::io::ReaderStream;

use crate::domain::backup::{BackupInfo, BackupStatus};
use crate::domain::Actor;
use crate::http::error::{ApiError, ApiResult};
use crate::http::extract::UploadedFile;
use crate::http::AppState;
use crate::services;
use crate::utils::AppError;

/// A database image is bigger than a JSON payload, and the global 32 MB limit
/// exists for bulk product imports rather than for this. Raised only on the one
/// route that needs it.
const MAX_IMPORT_BYTES: usize = 512 * 1024 * 1024;

pub fn admin() -> Router<AppState> {
    Router::new()
        .route("/backups", get(list).post(create))
        .route("/backups/status", get(status))
        .route("/backups/export", get(export))
        .route(
            "/backups/import",
            post(import).layer(DefaultBodyLimit::max(MAX_IMPORT_BYTES)),
        )
        .route("/backups/{filename}", delete(remove))
        .route("/backups/{filename}/restore", post(restore))
}

async fn list() -> ApiResult<axum::Json<Vec<BackupInfo>>> {
    Ok(axum::Json(services::backup::list()?))
}

async fn create(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
) -> ApiResult<(StatusCode, axum::Json<BackupInfo>)> {
    let info = services::backup::create(&actor, &state.backup_scheduler).await?;
    Ok((StatusCode::CREATED, axum::Json(info)))
}

async fn status(State(state): State<AppState>) -> ApiResult<axum::Json<BackupStatus>> {
    Ok(axum::Json(
        services::backup::status(&state.backup_scheduler).await?,
    ))
}

/// Delete one backup. The service rebuilds the path from the backup directory
/// and refuses a name that is not a plain backup filename.
async fn remove(
    Extension(actor): Extension<Actor>,
    Path(filename): Path<String>,
) -> ApiResult<StatusCode> {
    services::backup::delete(&actor, &filename)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Stage a backup to become the live database at the next launch.
async fn restore(
    Extension(actor): Extension<Actor>,
    Path(filename): Path<String>,
) -> ApiResult<axum::Json<String>> {
    Ok(axum::Json(services::backup::restore(&actor, &filename)?))
}

/// Stream the live database as a download.
///
/// Streamed rather than buffered because the file is the whole shop's history
/// and reading it into memory to hand to `axum` would double that in RAM on a
/// till that has 4 GB of it.
async fn export(Extension(actor): Extension<Actor>) -> ApiResult<Response> {
    let export = services::settings::prepare_export(&actor)?;

    let file = tokio::fs::File::open(&export.path).await.map_err(|e| {
        ApiError::from(AppError::Internal(format!(
            "gagal membuka database untuk diekspor: {e}"
        )))
    })?;

    // No `Content-Length`. The size was read a moment ago and the database is
    // live: a sale committing in between would make the declared length a lie,
    // and a body that disagrees with its length is a truncated download the
    // admin has no way to notice. Chunked transfer costs a progress bar and
    // cannot be wrong. (The compression layer strips the header anyway for any
    // client that accepts gzip, which is all of them.)
    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.sqlite3".to_string()),
            (
                header::CONTENT_DISPOSITION,
                // The name is generated server-side and contains only digits,
                // dashes and underscores, so it needs no escaping.
                format!("attachment; filename=\"{}\"", export.filename),
            ),
        ],
        Body::from_stream(ReaderStream::new(file)),
    )
        .into_response())
}

/// Take a database image as a multipart upload and stage it.
///
/// The part's own `filename` is never read. A client that calls its upload
/// `../../kasir.db` or `C:\Windows\System32\config\SAM` gets exactly the same
/// treatment as one that calls it `backup.db`: the bytes are checked for the
/// SQLite header and written to the one staging path the service owns.
async fn import(
    Extension(actor): Extension<Actor>,
    UploadedFile(data): UploadedFile,
) -> ApiResult<axum::Json<String>> {
    Ok(axum::Json(services::settings::import_database_bytes(
        &actor, &data,
    )?))
}
