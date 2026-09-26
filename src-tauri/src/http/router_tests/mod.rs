//! End-to-end tests for the HTTP layer, driven through the real router.
//!
//! Every case goes through `tower::ServiceExt::oneshot`, which runs the exact
//! `Router` [`crate::http::start`] serves — same middleware, same order — without
//! binding a port. That matters more than it sounds: most of what is being
//! tested here *is* the middleware order, and a test that assembled its own
//! router would prove nothing about the one that ships.

use axum::body::Body;
use axum::http::{header, Method, Request};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, DatabaseConnection, NotSet, Set};
use serde_json::{json, Value};

use crate::entity;
use crate::http::{session, AppState, ServerConfig};
use crate::utils::time::now_ts;

mod backups;
mod checkout;
mod csrf;
mod login_backoff;
mod logs;
mod ppob;
mod printing;
mod products;
mod refunds;
mod reports;
mod sessions;
mod settings;
mod shifts;
mod stock;
mod store_logo;
mod surface;
mod updates;
mod users;
mod window;

/// The authority every test request claims, on both the `Host` and `Origin`
/// sides, so same-origin is the default and a mismatch is deliberate.
const HOST: &str = "127.0.0.1:17720";

fn state(db: DatabaseConnection) -> AppState {
    AppState::new(db, ServerConfig::default())
}

fn router(state: &AppState) -> axum::Router {
    crate::http::router(state.clone())
}

/// A request that looks like it came from the app's own page.
fn same_origin(method: Method, uri: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, HOST)
        .header(header::ORIGIN, format!("http://{HOST}"))
}

fn json_body(value: Value) -> Body {
    Body::from(serde_json::to_vec(&value).expect("serialise"))
}

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

async fn body_text(response: axum::response::Response) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    String::from_utf8_lossy(&bytes).into_owned()
}

/// A user whose PIN is really hashed. The shared fixture stores the literal
/// string `"hash"`, which no PIN verifies against.
async fn insert_user_with_pin(
    db: &DatabaseConnection,
    username: &str,
    pin: &str,
    role: &str,
) -> entity::users::Model {
    entity::users::ActiveModel {
        id: NotSet,
        username: Set(username.to_string()),
        pin_hash: Set(bcrypt::hash(pin, bcrypt::DEFAULT_COST).expect("hash")),
        full_name: Set(username.to_string()),
        role: Set(role.to_string()),
        is_active: Set(true),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(db)
    .await
    .expect("user insert")
}

/// Mint a live session directly, for the cases where logging in over HTTP is
/// not the thing under test.
async fn login_token(db: &DatabaseConnection, user_id: i64) -> String {
    session::issue(db, user_id, 30, None, None, Utc::now())
        .await
        .expect("issue session")
        .token
}

fn cookie(token: &str) -> String {
    format!("{}={token}", session::COOKIE_NAME)
}

/// A cart of one unit of `product`, priced by the product row.
fn cart_of(product_id: i64, price: f64) -> Value {
    json!({
        "items": [{ "product_id": product_id, "quantity": 1 }],
        "payment_method": "cash",
        "payment_amount": price,
    })
}

/// Point `KASIR_DATA_DIR` at a scratch folder for this test binary.
///
/// `services::backup` and `services::settings` resolve the database and backup
/// directory from it. Without the override the export test would read the
/// developer's real `kasir.db` and the import test would stage a restore next to
/// it — which the next real launch would then apply.
///
/// The path is fixed rather than per-run. The backup routes need a real file on
/// disk, and the test harness offers no teardown hook to delete one afterwards,
/// so a per-run directory would pile up in the temp folder run after run. Wiping
/// the one fixed directory on the way in gives each run a clean slate and leaves
/// the machine with a single scratch folder however often the suite is run.
/// Also removes the per-pid directories the earlier naming left behind.
fn scratch_data_dir() -> &'static std::path::Path {
    static DIR: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    DIR.get_or_init(|| {
        let temp = std::env::temp_dir();
        if let Ok(entries) = std::fs::read_dir(&temp) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                if name.to_string_lossy().starts_with("kasir-http-tests-") {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }

        let dir = temp.join("kasir-http-tests");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        std::env::set_var("KASIR_DATA_DIR", &dir);

        // A real SQLite file, so the WAL checkpoint on the export path has
        // something valid to open.
        let db = dir.join("kasir.db");
        let conn = rusqlite::Connection::open(&db).expect("scratch database");
        conn.execute_batch("CREATE TABLE IF NOT EXISTS scratch (id INTEGER);")
            .expect("scratch schema");
        drop(conn);

        dir
    })
}

const MULTIPART_BOUNDARY: &str = "----kasirtestboundary";

/// A `multipart/form-data` body with one part, so the upload route can be
/// driven the way a browser drives it.
fn multipart_file(field: &str, filename: &str, data: &[u8]) -> Body {
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{MULTIPART_BOUNDARY}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{MULTIPART_BOUNDARY}--\r\n").as_bytes());
    Body::from(body)
}

fn multipart_content_type() -> String {
    format!("multipart/form-data; boundary={MULTIPART_BOUNDARY}")
}
