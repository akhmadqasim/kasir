//! The built frontend, compiled into the binary.
//!
//! Embedding rather than reading from disk is what makes `kasir.exe` a single
//! file that cannot be started next to a stale or half-copied `dist/`. It also
//! means the tablet on the shop counter and the till window are guaranteed to be
//! running the same build as the server answering them.
//!
//! Two rules do all the work:
//!
//! * `assets/` is Vite's hashed output — a file's name changes whenever its
//!   contents do — so it is cached for a year. Everything else is revalidated,
//!   because `index.html` is the one file whose name never changes.
//! * Any path that is not a file and not under `/api` returns `index.html`, so
//!   a deep link like `/laporan/harian` is answered by the SPA router instead of
//!   a 404. `/api` is excluded on purpose: a mistyped endpoint must fail as an
//!   API call, not silently succeed with a page of HTML.

use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

use crate::http::error::ApiError;

/// Relative paths are resolved against `CARGO_MANIFEST_DIR`, so this is
/// `src-tauri/../dist` — the folder `bun run build` writes and
/// `tauri.conf.json` already names as `frontendDist`.
#[derive(RustEmbed)]
#[folder = "../dist"]
struct Assets;

const INDEX: &str = "index.html";

/// Hashed build output, safe to cache indefinitely.
const IMMUTABLE_CACHE: &str = "public, max-age=31536000, immutable";

/// The entry document and anything else without a content hash.
const REVALIDATE_CACHE: &str = "no-cache";

/// Router fallback: serve an embedded file, or the SPA shell.
pub async fn handler(uri: Uri) -> Response {
    let path = uri.path();

    if path.starts_with("/api/") || path == "/api" {
        return ApiError::not_found("Endpoint tidak ditemukan").into_response();
    }

    let relative = path.trim_start_matches('/');

    if let Some(response) = serve(relative) {
        return response;
    }

    // A missing file under `assets/` is a broken build, not a route. Answering
    // it with `index.html` would hand the browser HTML where it asked for
    // JavaScript, and the resulting syntax error hides the real problem.
    if relative.starts_with("assets/") {
        return ApiError::not_found("Berkas tidak ditemukan").into_response();
    }

    serve(INDEX).unwrap_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "Frontend belum dibangun. Jalankan `bun run build` lalu build ulang aplikasi.",
        )
            .into_response()
    })
}

fn serve(path: &str) -> Option<Response> {
    // `rust_embed` normalises and rejects `..`, so a traversal cannot escape the
    // embedded set — there is no filesystem behind it to escape to in the first
    // place.
    let file = Assets::get(path)?;

    let cache_control = if path.starts_with("assets/") {
        IMMUTABLE_CACHE
    } else {
        REVALIDATE_CACHE
    };

    Some(
        (
            [
                (header::CONTENT_TYPE, file.metadata.mimetype()),
                (header::CACHE_CONTROL, cache_control),
            ],
            file.data.into_owned(),
        )
            .into_response(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The embedded set has to actually contain the app, otherwise every test
    /// below passes for the wrong reason.
    #[test]
    fn the_frontend_build_is_embedded() {
        assert!(
            Assets::get(INDEX).is_some(),
            "dist/index.html is missing — run `bun run build` before building the backend"
        );
    }

    #[tokio::test]
    async fn an_unknown_page_falls_back_to_the_spa_shell() {
        let response = handler("/laporan/harian".parse().expect("uri")).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("text/html")
        );
    }

    #[tokio::test]
    async fn an_unknown_api_path_is_a_json_404_not_the_shell() {
        let response = handler("/api/tidak/ada".parse().expect("uri")).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("application/json")
        );
    }

    #[tokio::test]
    async fn a_missing_asset_is_a_404_rather_than_html() {
        let response = handler("/assets/index-deadbeef.js".parse().expect("uri")).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn hashed_assets_are_cached_for_a_year_and_the_shell_is_not() {
        let shell = handler("/".parse().expect("uri")).await;
        assert_eq!(
            shell
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|v| v.to_str().ok()),
            Some(REVALIDATE_CACHE)
        );

        let asset = Assets::iter()
            .find(|path| path.starts_with("assets/"))
            .expect("the build produces hashed assets");
        let response = handler(format!("/{asset}").parse().expect("uri")).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|v| v.to_str().ok()),
            Some(IMMUTABLE_CACHE)
        );
    }
}
