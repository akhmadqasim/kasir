//! At-most-once execution for the three requests that move money.
//!
//! IPC had two outcomes: the call returned, or the process died. HTTP has a
//! third — the work committed and the answer was lost — and on shop wifi that
//! third outcome is routine. A retry of `POST /api/transactions` that the server
//! cannot tell from a fresh sale charges the customer twice.
//!
//! So each such request carries an `Idempotency-Key` the client chooses, and the
//! server remembers what that key produced. The protocol is the usual one:
//!
//! ```text
//!  claim(scope, actor, key, body)
//!        │
//!        ├── no row ──────────────► insert `in_progress` ──► Fresh(Guard)
//!        │                                                    │
//!        │                                       success ─────┴──► complete(): store the JSON, 201
//!        │                                       failure ──────────► release(): delete the row
//!        │
//!        ├── row `completed`, same body ────────────────────► Replay: the stored JSON, 201
//!        ├── row `completed`, different body ───────────────► 422, the key means something else
//!        └── row `in_progress` ─────────────────────────────► 409, an attempt is already running
//! ```
//!
//! Two details are worth stating because getting either wrong makes the whole
//! thing a liability rather than a safeguard.
//!
//! **A failure releases the key.** If a checkout is refused for insufficient
//! stock, the row is deleted. Keeping it would mean the cashier fixes the cart,
//! presses pay again with the same key, and is told the sale already happened.
//!
//! **The request digest is checked.** A key reused with a different body is a
//! client bug, and replaying the first response would swallow a real second
//! sale. It is refused instead — loudly, with a 422.

use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Duration, Utc};
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::entity::idempotency_keys;
use crate::http::error::{ApiError, ApiResult};
use crate::http::session::format_ts;
use crate::utils::AppError;

/// The header the client stamps its attempt with.
pub const HEADER: &str = "idempotency-key";

/// Set on a response that came out of the table rather than out of the work.
/// Purely informational — a client that ignores it still behaves correctly.
pub const REPLAY_HEADER: &str = "idempotency-replayed";

/// How long a key is remembered. A retry that matters happens in seconds; a day
/// covers a till that was carried out of wifi range and back.
const RETENTION_HOURS: i64 = 24;

/// A key shorter than this is likely a counter that will collide across
/// restarts; a UUID is 36 characters, which is what clients should send.
const MIN_KEY_LEN: usize = 8;
const MAX_KEY_LEN: usize = 200;

/// Scope names. Distinct so one key can be reused across endpoints without one
/// being mistaken for another.
pub const SCOPE_CHECKOUT: &str = "checkout";
pub const SCOPE_PPOB_PAYMENT: &str = "ppob_payment";
pub const SCOPE_PPOB_TOPUP: &str = "ppob_topup";

/// A claimed key. Must be resolved with [`Guard::complete`] or
/// [`Guard::release`]; dropping it without either leaves the key held until it
/// expires, which is why every call site does both arms explicitly.
#[derive(Debug)]
pub struct Guard {
    id: String,
}

#[derive(Debug)]
pub enum Claim {
    /// Nobody has used this key: do the work.
    Fresh(Guard),
    /// This key already produced an answer. Send it again.
    Replay(Response),
}

/// The `Idempotency-Key` header, validated.
///
/// Required rather than optional. An optional guard is one a buggy client
/// silently opts out of, and the request it protects is the one that takes money
/// — so a missing header is a refusal, not a fallback to "just run it".
pub fn key_from_headers(headers: &HeaderMap) -> Result<String, ApiError> {
    let raw = headers
        .get(HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ApiError::bad_request(
                "Permintaan ini wajib menyertakan header Idempotency-Key agar tidak terjadi transaksi ganda.",
            )
        })?;

    if raw.len() < MIN_KEY_LEN || raw.len() > MAX_KEY_LEN {
        return Err(ApiError::bad_request(format!(
            "Idempotency-Key harus {MIN_KEY_LEN}-{MAX_KEY_LEN} karakter."
        )));
    }

    if !raw
        .bytes()
        .all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\\')
    {
        return Err(ApiError::bad_request(
            "Idempotency-Key hanya boleh berisi karakter ASCII yang dapat dicetak.",
        ));
    }

    Ok(raw.to_string())
}

fn digest(parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
        // A separator no hex digest and no ASCII key can contain, so
        // ("ab", "c") and ("a", "bc") cannot hash alike.
        hasher.update([0x1f]);
    }
    hex::encode(hasher.finalize())
}

/// `sha256(scope | user_id | key)`.
fn row_id(scope: &str, user_id: i64, key: &str) -> String {
    digest(&[
        scope.as_bytes(),
        user_id.to_string().as_bytes(),
        key.as_bytes(),
    ])
}

/// Take the key, or hand back what it produced last time.
pub async fn claim(
    db: &DatabaseConnection,
    scope: &'static str,
    user_id: i64,
    key: &str,
    body: &[u8],
    now: DateTime<Utc>,
) -> ApiResult<Claim> {
    let id = row_id(scope, user_id, key);
    let request_hash = digest(&[body]);

    if let Some(existing) = live_row(db, &id, now).await? {
        return decide(existing, &request_hash);
    }

    let row = idempotency_keys::ActiveModel {
        id: Set(id.clone()),
        scope: Set(scope.to_string()),
        user_id: Set(user_id),
        request_hash: Set(request_hash.clone()),
        status: Set("in_progress".to_string()),
        response_body: Set(None),
        created_at: Set(format_ts(now)),
        expires_at: Set(format_ts(now + Duration::hours(RETENTION_HOURS))),
    }
    .insert(db)
    .await;

    match row {
        Ok(_) => Ok(Claim::Fresh(Guard { id })),
        Err(err) => {
            // Either another request inserted the same key between the read and
            // this write, or the write genuinely failed. Re-reading tells the
            // two apart without matching on a driver's error string.
            match live_row(db, &id, now).await? {
                Some(existing) => decide(existing, &request_hash),
                None => Err(AppError::from(err).into()),
            }
        }
    }
}

/// The row for `id`, unless it has expired — an expired row is deleted on the
/// way past, so the key becomes usable again rather than staying poisoned.
async fn live_row(
    db: &DatabaseConnection,
    id: &str,
    now: DateTime<Utc>,
) -> ApiResult<Option<idempotency_keys::Model>> {
    let Some(row) = idempotency_keys::Entity::find_by_id(id.to_string())
        .one(db)
        .await
        .map_err(AppError::from)?
    else {
        return Ok(None);
    };

    if row.expires_at <= format_ts(now) {
        idempotency_keys::Entity::delete_by_id(id.to_string())
            .exec(db)
            .await
            .map_err(AppError::from)?;
        return Ok(None);
    }

    Ok(Some(row))
}

fn decide(row: idempotency_keys::Model, request_hash: &str) -> ApiResult<Claim> {
    if row.request_hash != request_hash {
        return Err(ApiError::validation(
            "Idempotency-Key ini sudah dipakai untuk permintaan yang berbeda. Gunakan key baru.",
        ));
    }

    match (row.status.as_str(), row.response_body) {
        ("completed", Some(body)) => Ok(Claim::Replay(replayed(body))),
        // `completed` with no body should not exist, and `in_progress` means a
        // first attempt is still running. Both are answered the same way: the
        // caller already has an attempt outstanding and must wait for it rather
        // than start a second.
        _ => Err(ApiError::conflict(
            "Permintaan dengan Idempotency-Key ini sedang diproses. Tunggu hasilnya sebelum mencoba lagi.",
        )),
    }
}

/// The stored JSON, byte for byte, so a replay is indistinguishable from the
/// original except for the marker header.
fn replayed(body: String) -> Response {
    let mut response = (StatusCode::CREATED, body).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
        .headers_mut()
        .insert(REPLAY_HEADER, HeaderValue::from_static("true"));
    response
}

impl Guard {
    /// Remember the result and answer with it.
    ///
    /// If storing it fails, the response is still returned: the sale committed,
    /// and refusing to tell the client about a transaction that exists is worse
    /// than losing the protection against one more retry.
    pub async fn complete<T: Serialize>(self, db: &DatabaseConnection, value: &T) -> Response {
        let body = match serde_json::to_string(value) {
            Ok(body) => body,
            Err(e) => {
                crate::utils::logging::log_error(&format!(
                    "idempotent response could not be serialised: {e}"
                ));
                self.release(db).await;
                return ApiError::from(AppError::Internal(
                    "gagal menserialisasi hasil transaksi".into(),
                ))
                .into_response();
            }
        };

        let stored = idempotency_keys::ActiveModel {
            id: Set(self.id.clone()),
            status: Set("completed".to_string()),
            response_body: Set(Some(body.clone())),
            ..Default::default()
        }
        .update(db)
        .await;

        if let Err(e) = stored {
            crate::utils::logging::log_error(&format!(
                "idempotency key {} could not be completed: {e}",
                self.id
            ));
        }

        let mut response = (StatusCode::CREATED, body).into_response();
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        response
    }

    /// Give the key back. The work did not happen, so the same key must be able
    /// to try again.
    pub async fn release(self, db: &DatabaseConnection) {
        if let Err(e) = idempotency_keys::Entity::delete_by_id(self.id.clone())
            .exec(db)
            .await
        {
            crate::utils::logging::log_error(&format!(
                "idempotency key {} could not be released: {e}",
                self.id
            ));
        }
    }
}

/// Drop every key past its retention. Runs on the same hourly tick as the
/// session sweep.
pub async fn sweep_expired(db: &DatabaseConnection, now: DateTime<Utc>) -> Result<u64, AppError> {
    let result = idempotency_keys::Entity::delete_many()
        .filter(idempotency_keys::Column::ExpiresAt.lte(format_ts(now)))
        .exec(db)
        .await?;
    Ok(result.rows_affected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::setup_test_db;

    fn headers_with(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(HEADER, value.parse().expect("header value"));
        headers
    }

    #[test]
    fn a_missing_key_is_refused_rather_than_defaulted() {
        let err = key_from_headers(&HeaderMap::new()).expect_err("must refuse");
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn a_key_must_be_long_enough_to_be_unique_and_short_enough_to_store() {
        assert!(key_from_headers(&headers_with("short")).is_err());
        assert!(key_from_headers(&headers_with(&"a".repeat(MAX_KEY_LEN + 1))).is_err());
        assert!(key_from_headers(&headers_with("0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55")).is_ok());
    }

    #[test]
    fn surrounding_whitespace_does_not_make_two_keys_out_of_one() {
        assert_eq!(
            key_from_headers(&headers_with("  abcdefgh  ")).expect("valid"),
            "abcdefgh"
        );
    }

    /// The same key in two scopes, or from two users, must not collide — that is
    /// what stops one till's retry from replaying another till's sale.
    #[test]
    fn the_row_id_separates_scopes_and_users() {
        let key = "0198f3c1-6f2c-7a1b-9d40-2f9e0c1b7a55";
        assert_ne!(
            row_id(SCOPE_CHECKOUT, 1, key),
            row_id(SCOPE_PPOB_PAYMENT, 1, key)
        );
        assert_ne!(
            row_id(SCOPE_CHECKOUT, 1, key),
            row_id(SCOPE_CHECKOUT, 2, key)
        );
        assert_eq!(
            row_id(SCOPE_CHECKOUT, 1, key),
            row_id(SCOPE_CHECKOUT, 1, key)
        );
    }

    /// The separator is what keeps concatenation from being ambiguous.
    #[test]
    fn adjacent_fields_cannot_be_shifted_into_each_other() {
        assert_ne!(row_id("check", 1, "out"), row_id("checkout", 1, ""));
    }

    #[tokio::test]
    async fn a_released_key_can_be_claimed_again() {
        let db = setup_test_db().await;
        let now = Utc::now();

        let guard = match claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now)
            .await
            .expect("claim")
        {
            Claim::Fresh(guard) => guard,
            Claim::Replay(_) => panic!("a fresh key must not replay"),
        };
        guard.release(&db).await;

        assert!(matches!(
            claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now)
                .await
                .expect("claim"),
            Claim::Fresh(_)
        ));
    }

    #[tokio::test]
    async fn a_second_attempt_while_the_first_runs_is_refused() {
        let db = setup_test_db().await;
        let now = Utc::now();

        let _held = claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now)
            .await
            .expect("claim");

        let err = claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now)
            .await
            .expect_err("must refuse");
        assert_eq!(err.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn the_same_key_with_a_different_body_is_refused() {
        let db = setup_test_db().await;
        let now = Utc::now();

        let _held = claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{\"a\":1}", now)
            .await
            .expect("claim");

        let err = claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{\"a\":2}", now)
            .await
            .expect_err("must refuse");
        assert_eq!(err.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn an_expired_key_frees_itself_and_is_swept() {
        let db = setup_test_db().await;
        let issued = Utc::now();

        let guard = match claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", issued)
            .await
            .expect("claim")
        {
            Claim::Fresh(guard) => guard,
            Claim::Replay(_) => panic!("a fresh key must not replay"),
        };
        guard.complete(&db, &serde_json::json!({ "id": 1 })).await;

        let later = issued + Duration::hours(RETENTION_HOURS + 1);
        assert!(matches!(
            claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", later)
                .await
                .expect("claim"),
            Claim::Fresh(_),
        ));

        assert_eq!(
            sweep_expired(&db, later + Duration::hours(RETENTION_HOURS + 1))
                .await
                .expect("sweep"),
            1
        );
    }

    #[tokio::test]
    async fn a_completed_key_replays_the_stored_body() {
        let db = setup_test_db().await;
        let now = Utc::now();

        let guard = match claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now)
            .await
            .expect("claim")
        {
            Claim::Fresh(guard) => guard,
            Claim::Replay(_) => panic!("a fresh key must not replay"),
        };
        guard.complete(&db, &serde_json::json!({ "id": 7 })).await;

        match claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now)
            .await
            .expect("claim")
        {
            Claim::Replay(response) => {
                assert_eq!(response.status(), StatusCode::CREATED);
                assert_eq!(
                    response.headers().get(REPLAY_HEADER).map(|v| v.as_bytes()),
                    Some("true".as_bytes())
                );
            }
            Claim::Fresh(_) => panic!("a completed key must replay"),
        }
    }
}
