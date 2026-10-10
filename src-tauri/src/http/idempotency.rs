//! At-most-once execution for the request that moves money: checkout.
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
//!        ├── no row ──────────────► insert `in_progress` ──► Fresh(claim)
//!        │                                                    │
//!        │                                       success ─────┴──► complete(): store the JSON, 201
//!        │                                       failure ──────────► release(): delete the row
//!        │
//!        ├── row `completed`, same body ────────────────────► Replay: the stored JSON, 201
//!        ├── row `completed`, different body ───────────────► 422, the key means something else
//!        ├── row `in_progress`, sale linked ────────────────► completed from the sale, Replay
//!        ├── row `in_progress`, no sale, stale ─────────────► released, then claimed Fresh
//!        │                  (released by another retry first: re-read, replay or 409)
//!        └── row `in_progress` ─────────────────────────────► 409, an attempt is already running
//! ```
//!
//! A key can be stranded `in_progress` when the app dies mid-checkout. The
//! checkout links the sale to its key inside the sale's DB transaction
//! (`transaction_id`), so recovery — at startup ([`recover_stranded`]) and on a
//! retry of a stale key — knows whether the sale committed.
//!
//! Every attempt with a key shares the row id, so each claim also carries a
//! random `claim_nonce`. Every later write (the sale link, complete, release)
//! is conditional on the exact claim it read, so two retries racing on one
//! stale key cannot delete each other's claim and ring the cart up twice.
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
//!
//! Routes go through [`run`], which also keeps a dropped connection from
//! cancelling the work halfway and leaving the key stuck `in_progress`.

use std::future::Future;

use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Duration, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::entity::idempotency_keys;
use crate::http::error::{ApiError, ApiResult};
use crate::services::transactions::IdempotencyClaim;
use crate::utils::time::format_ts;
use crate::utils::AppError;

/// The header the client stamps its attempt with.
const HEADER: &str = "idempotency-key";

/// Set on a response that came out of the table rather than out of the work.
/// Purely informational — a client that ignores it still behaves correctly.
const REPLAY_HEADER: &str = "idempotency-replayed";

/// How long a key is remembered. A retry that matters happens in seconds; a day
/// covers a till that was carried out of wifi range and back.
const RETENTION_HOURS: i64 = 24;

/// An `in_progress` key with no sale behind it is treated as dead after this
/// long. A checkout finishes in well under a second; even one queued behind
/// the single DB connection and its busy timeout is done in seconds.
const STALE_AFTER_MINUTES: i64 = 5;

/// A key shorter than this is likely a counter that will collide across
/// restarts; a UUID is 36 characters, which is what clients should send.
const MIN_KEY_LEN: usize = 8;
const MAX_KEY_LEN: usize = 200;

/// Scope names. Distinct so one key can be reused across endpoints without one
/// being mistaken for another.
pub const SCOPE_CHECKOUT: &str = "checkout";

#[derive(Debug)]
enum Claim {
    /// Nobody has used this key: do the work, then [`complete`] or [`release`]
    /// the claim.
    Fresh(IdempotencyClaim),
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

/// `sha256(scope | user_id | key)`: the `idempotency_keys.id` of a key.
fn row_id(scope: &str, user_id: i64, key: &str) -> String {
    digest(&[
        scope.as_bytes(),
        user_id.to_string().as_bytes(),
        key.as_bytes(),
    ])
}

/// Claim `key`, do `work` at most once, and answer with its result.
///
/// The work and the resolution of the key run on their own task, so a dropped
/// connection (hyper drops the handler's future) cannot cancel them halfway and
/// strand the key `in_progress`. A failure releases the key for the corrected
/// retry. `work` gets the claim so it can link its result to exactly this claim.
pub async fn run<T, W, F>(
    db: &DatabaseConnection,
    scope: &'static str,
    user_id: i64,
    key: &str,
    body: &[u8],
    work: W,
) -> ApiResult<Response>
where
    T: Serialize + Send + Sync + 'static,
    W: FnOnce(IdempotencyClaim) -> F,
    F: Future<Output = Result<T, AppError>> + Send + 'static,
{
    let claimed = match claim(db, scope, user_id, key, body, Utc::now()).await? {
        Claim::Replay(response) => return Ok(response),
        Claim::Fresh(claimed) => claimed,
    };

    let work = work(claimed.clone());
    let db = db.clone();
    tokio::spawn(async move {
        match work.await {
            Ok(value) => Ok(complete(&db, &claimed, &value).await),
            Err(e) => {
                release(&db, &claimed).await;
                Err(ApiError::from(e))
            }
        }
    })
    .await
    .map_err(|e| ApiError::from(AppError::Internal(format!("tugas transaksi gagal: {e}"))))?
}

/// Take the key, or hand back what it produced last time.
async fn claim(
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
        if let Some(claim) = settle_existing(db, existing, &request_hash, now).await? {
            return Ok(claim);
        }
    }

    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let row = idempotency_keys::ActiveModel {
        id: Set(id.clone()),
        scope: Set(scope.to_string()),
        user_id: Set(user_id),
        request_hash: Set(request_hash.clone()),
        status: Set("in_progress".to_string()),
        response_body: Set(None),
        created_at: Set(format_ts(now)),
        expires_at: Set(format_ts(now + Duration::hours(RETENTION_HOURS))),
        transaction_id: Set(None),
        claim_nonce: Set(nonce.clone()),
    }
    .insert(db)
    .await;

    match row {
        Ok(_) => Ok(Claim::Fresh(IdempotencyClaim { key_id: id, nonce })),
        Err(err) => {
            // Either another request inserted the same key between the read and
            // this write, or the write genuinely failed. Re-reading tells the
            // two apart without matching on a driver's error string.
            match live_row(db, &id, now).await? {
                Some(existing) => answer_existing(db, existing, &request_hash).await,
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
    let now = format_ts(now);
    let Some(row) = find_row(db, id).await? else {
        return Ok(None);
    };
    if row.expires_at > now {
        return Ok(Some(row));
    }

    // Only the expired claim read here: a retry that replaced it keeps its row.
    delete_claim(db, &row.id, &row.claim_nonce, false).await?;
    Ok(find_row(db, id).await?.filter(|row| row.expires_at > now))
}

async fn find_row(
    db: &DatabaseConnection,
    id: &str,
) -> Result<Option<idempotency_keys::Model>, AppError> {
    Ok(idempotency_keys::Entity::find_by_id(id.to_string())
        .one(db)
        .await?)
}

/// An existing row for the key, with a stranded `in_progress` row recovered
/// first. `None` means the row was released and the key may be claimed fresh.
///
/// A row stays `in_progress` past its work only when that work died: the app
/// was killed (a power cut) or its task panicked. The cart and its key outlive
/// that in the browser's localStorage, so without this every retry got a 409
/// for the key's whole 24 hours. Whether the sale committed is read off
/// `transaction_id`, which the checkout writes inside the sale's own DB
/// transaction:
///
/// * set: the sale exists. The key is completed with it and the retry gets a
///   replay — never a second sale. This needs no age check: the sale is final
///   whether or not the first attempt is still on its way to `complete`.
/// * not set, and older than [`STALE_AFTER_MINUTES`]: no checkout takes that
///   long, so the attempt is dead and nothing was sold. The key is released.
/// * not set and recent: the first attempt may still be running — 409.
///
/// The release deletes only the claim read here. If it deletes nothing, another
/// retry settled that claim first (and may have re-claimed it and sold), so the
/// row is read again and answered as it is now: a replay or a 409.
async fn settle_existing(
    db: &DatabaseConnection,
    row: idempotency_keys::Model,
    request_hash: &str,
    now: DateTime<Utc>,
) -> ApiResult<Option<Claim>> {
    let stale = row.status == "in_progress"
        && row.request_hash == request_hash
        && row.transaction_id.is_none()
        && row.created_at <= format_ts(now - Duration::minutes(STALE_AFTER_MINUTES));
    if !stale {
        return answer_existing(db, row, request_hash).await.map(Some);
    }

    if delete_claim(db, &row.id, &row.claim_nonce, true).await? {
        return Ok(None);
    }
    match live_row(db, &row.id, now).await? {
        Some(current) => answer_existing(db, current, request_hash).await.map(Some),
        None => Ok(None),
    }
}

/// The answer for a row that stays: a replay of its linked sale, or [`decide`].
async fn answer_existing(
    db: &DatabaseConnection,
    row: idempotency_keys::Model,
    request_hash: &str,
) -> ApiResult<Claim> {
    if row.status == "in_progress" && row.request_hash == request_hash {
        if let Some(transaction_id) = row.transaction_id {
            let body = complete_from_sale(db, &row, transaction_id).await?;
            return Ok(Claim::Replay(replayed(body)));
        }
    }
    decide(row, request_hash)
}

/// Store the answer for a key whose sale committed but whose response never
/// got stored, rebuilt from the sale itself, and return it.
async fn complete_from_sale(
    db: &DatabaseConnection,
    row: &idempotency_keys::Model,
    transaction_id: i64,
) -> Result<String, AppError> {
    let body = match row.scope.as_str() {
        SCOPE_CHECKOUT => {
            let sale = crate::services::transactions::sale_result(db, transaction_id).await?;
            serde_json::to_string(&sale).map_err(|e| {
                AppError::Internal(format!("gagal menserialisasi hasil transaksi: {e}"))
            })?
        }
        other => {
            return Err(AppError::Internal(format!(
                "idempotency scope '{other}' tidak dapat dipulihkan"
            )))
        }
    };

    let claim = IdempotencyClaim {
        key_id: row.id.clone(),
        nonce: row.claim_nonce.clone(),
    };
    // Nothing stored means a concurrent retry completed it first, with the
    // same sale, so the body is the same either way.
    mark_completed(db, &claim, &body).await?;

    Ok(body)
}

/// Store `body` as the key's answer, on `claim`'s row only: a key released and
/// re-claimed by a retry keeps the retry's row. Returns whether it was stored.
async fn mark_completed(
    db: &DatabaseConnection,
    claim: &IdempotencyClaim,
    body: &str,
) -> Result<bool, AppError> {
    let stored = idempotency_keys::Entity::update_many()
        .col_expr(
            idempotency_keys::Column::Status,
            Expr::value("completed".to_string()),
        )
        .col_expr(
            idempotency_keys::Column::ResponseBody,
            Expr::value(Some(body.to_string())),
        )
        .filter(idempotency_keys::Column::Id.eq(claim.key_id.clone()))
        .filter(idempotency_keys::Column::ClaimNonce.eq(claim.nonce.clone()))
        .filter(idempotency_keys::Column::Status.eq("in_progress"))
        .exec(db)
        .await?;
    Ok(stored.rows_affected > 0)
}

/// Delete one exact claim: row `id` while it still carries `nonce`. With
/// `unsettled_only`, also only while it is `in_progress` with no sale linked,
/// which is what a release needs. Returns whether a row was deleted; `false`
/// means someone else settled the claim first.
async fn delete_claim(
    db: &DatabaseConnection,
    id: &str,
    nonce: &str,
    unsettled_only: bool,
) -> Result<bool, AppError> {
    let mut delete = idempotency_keys::Entity::delete_many()
        .filter(idempotency_keys::Column::Id.eq(id))
        .filter(idempotency_keys::Column::ClaimNonce.eq(nonce));
    if unsettled_only {
        delete = delete
            .filter(idempotency_keys::Column::Status.eq("in_progress"))
            .filter(idempotency_keys::Column::TransactionId.is_null());
    }
    Ok(delete.exec(db).await?.rows_affected > 0)
}

/// Resolve every key left `in_progress` by the previous run of the app. Called
/// once at startup, before any request is served, so no attempt can still be
/// running: a key with a committed sale is completed with it, any other is
/// released. Returns `(completed, released)`.
///
/// One key that cannot be settled (its sale row unreadable, say) is logged and
/// skipped: stopping there left every key after it stranded until its retry.
/// A skipped key is still settled on its own retry by [`settle_existing`].
pub async fn recover_stranded(db: &DatabaseConnection) -> Result<(u64, u64), AppError> {
    let stranded = idempotency_keys::Entity::find()
        .filter(idempotency_keys::Column::Status.eq("in_progress"))
        .all(db)
        .await?;

    let (mut completed, mut released) = (0, 0);
    for row in stranded {
        let settled = match row.transaction_id {
            Some(transaction_id) => complete_from_sale(db, &row, transaction_id)
                .await
                .map(|_| completed += 1),
            None => delete_claim(db, &row.id, &row.claim_nonce, true)
                .await
                .map(|deleted| released += u64::from(deleted)),
        };
        if let Err(e) = settled {
            crate::utils::logging::log_error(&format!(
                "stranded idempotency key {} could not be settled: {e}",
                row.id
            ));
        }
    }
    Ok((completed, released))
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
    let mut response = created_json(body);
    response
        .headers_mut()
        .insert(REPLAY_HEADER, HeaderValue::from_static("true"));
    response
}

/// A 201 carrying an already-serialised JSON body.
fn created_json(body: String) -> Response {
    let mut response = (StatusCode::CREATED, body).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

/// Remember the work's result for `claim` and answer with it. If storing it
/// fails the response is still returned: the sale committed, and hiding it from
/// the client is worse than losing protection against one more retry.
async fn complete<T: Serialize>(
    db: &DatabaseConnection,
    claim: &IdempotencyClaim,
    value: &T,
) -> Response {
    let body = match serde_json::to_string(value) {
        Ok(body) => body,
        Err(e) => {
            crate::utils::logging::log_error(&format!(
                "idempotent response could not be serialised: {e}"
            ));
            release(db, claim).await;
            return ApiError::from(AppError::Internal(
                "gagal menserialisasi hasil transaksi".into(),
            ))
            .into_response();
        }
    };

    match mark_completed(db, claim, &body).await {
        Ok(true) => {}
        Ok(false) => {
            if let Some(problem) = unstored_completion_problem(db, claim).await {
                crate::utils::logging::log_error(&problem);
            }
        }
        Err(e) => crate::utils::logging::log_error(&format!(
            "idempotency key {} could not be completed: {e}",
            claim.key_id
        )),
    }

    created_json(body)
}

/// Why [`complete`] storing nothing for `claim` deserves an error line, or
/// `None` when it does not.
///
/// A retry that arrives after the sale committed but before the original
/// attempt reaches `complete` is answered by [`answer_existing`], which
/// completes the row from its linked sale. The original's update then changes
/// no row, yet nothing is wrong: the row is completed, on this same claim, with
/// this claim's sale. Only any other outcome (a row released and re-claimed by
/// a retry, or gone) is worth reporting.
async fn unstored_completion_problem(
    db: &DatabaseConnection,
    claim: &IdempotencyClaim,
) -> Option<String> {
    match find_row(db, &claim.key_id).await {
        Ok(Some(row))
            if row.status == "completed"
                && row.claim_nonce == claim.nonce
                && row.transaction_id.is_some() =>
        {
            None
        }
        Ok(_) => Some(format!(
            "idempotency key {} was claimed again before it could be completed",
            claim.key_id
        )),
        Err(e) => Some(format!(
            "idempotency key {} was not completed and could not be read again: {e}",
            claim.key_id
        )),
    }
}

/// Give the key back: the work did not happen, so the same key may try again.
/// Only `claim`'s own unlinked row is removed: a retry that re-claimed the key
/// keeps its own, and a row with a committed sale stays for the replay.
async fn release(db: &DatabaseConnection, claim: &IdempotencyClaim) {
    if let Err(e) = delete_claim(db, &claim.key_id, &claim.nonce, true).await {
        crate::utils::logging::log_error(&format!(
            "idempotency key {} could not be released: {e}",
            claim.key_id
        ));
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
            row_id("other_scope", 1, key)
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
        release(&db, &guard).await;

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
        complete(&db, &guard, &serde_json::json!({ "id": 1 })).await;

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

    /// A client that disconnects mid-sale drops the handler's future. The work
    /// must still finish and resolve the key, so the retry replays instead of
    /// getting a 409 for a day.
    #[tokio::test]
    async fn dropping_the_caller_mid_work_does_not_strand_the_key() {
        let db = setup_test_db().await;
        let (started_tx, started_rx) = tokio::sync::oneshot::channel::<()>();
        let (finish_tx, finish_rx) = tokio::sync::oneshot::channel::<()>();

        let request = run(
            &db,
            SCOPE_CHECKOUT,
            1,
            "key-satu-dua",
            b"{}",
            |_| async move {
                let _ = started_tx.send(());
                let _ = finish_rx.await;
                Ok::<_, AppError>(serde_json::json!({ "id": 3 }))
            },
        );
        tokio::select! {
            _ = request => panic!("the work cannot finish before it is released"),
            _ = started_rx => {}
        }
        finish_tx.send(()).expect("the work is still running");

        for _ in 0..100 {
            match claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", Utc::now()).await {
                Ok(Claim::Replay(_)) => return,
                Ok(Claim::Fresh(_)) => panic!("the key was dropped instead of completed"),
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        }
        panic!("the key never left in_progress");
    }

    async fn stranded(db: &DatabaseConnection, key: &str, at: DateTime<Utc>, sale: Option<i64>) {
        let guard = match claim(db, SCOPE_CHECKOUT, 1, key, b"{}", at)
            .await
            .expect("claim")
        {
            Claim::Fresh(guard) => guard,
            Claim::Replay(_) => panic!("a fresh key must not replay"),
        };
        idempotency_keys::ActiveModel {
            id: Set(guard.key_id),
            transaction_id: Set(sale),
            ..Default::default()
        }
        .update(db)
        .await
        .expect("link sale");
    }

    /// A key a crash left `in_progress` with no sale behind it is released
    /// once stale, so the retry rings the cart up; a recent one still waits.
    #[tokio::test]
    async fn a_stale_in_progress_key_without_a_sale_is_released() {
        let db = setup_test_db().await;
        let crashed_at = Utc::now() - Duration::minutes(STALE_AFTER_MINUTES + 1);
        stranded(&db, "key-satu-dua", crashed_at, None).await;

        assert!(matches!(
            claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", Utc::now())
                .await
                .expect("claim"),
            Claim::Fresh(_)
        ));

        let err = claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", Utc::now())
            .await
            .expect_err("the fresh attempt is the one running now");
        assert_eq!(err.status(), StatusCode::CONFLICT);
    }

    /// The sale committed but the app died before storing the answer: the
    /// retry replays that sale, however recent the key.
    #[tokio::test]
    async fn an_in_progress_key_with_a_committed_sale_replays_it() {
        let db = setup_test_db().await;
        let sale = crate::test_support::insert_transaction(
            &db,
            1,
            10_000.0,
            "completed",
            &format_ts(Utc::now()),
        )
        .await;
        stranded(&db, "key-satu-dua", Utc::now(), Some(sale.id)).await;

        match claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", Utc::now())
            .await
            .expect("claim")
        {
            Claim::Replay(response) => assert_eq!(response.status(), StatusCode::CREATED),
            Claim::Fresh(_) => panic!("a key whose sale committed must replay"),
        }
        let row = idempotency_keys::Entity::find_by_id(row_id(SCOPE_CHECKOUT, 1, "key-satu-dua"))
            .one(&db)
            .await
            .expect("query")
            .expect("row kept");
        assert_eq!(row.status, "completed");
        assert!(row
            .response_body
            .is_some_and(|body| body.contains("\"transaction\"")));
    }

    /// At startup nothing can still be running: every stranded key is settled.
    #[tokio::test]
    async fn startup_settles_every_stranded_key() {
        let db = setup_test_db().await;
        let sale = crate::test_support::insert_transaction(
            &db,
            1,
            10_000.0,
            "completed",
            &format_ts(Utc::now()),
        )
        .await;
        stranded(&db, "key-dengan-jual", Utc::now(), Some(sale.id)).await;
        stranded(&db, "key-tanpa-jual", Utc::now(), None).await;

        assert_eq!(recover_stranded(&db).await.expect("recover"), (1, 1));
        assert!(matches!(
            claim(&db, SCOPE_CHECKOUT, 1, "key-dengan-jual", b"{}", Utc::now())
                .await
                .expect("claim"),
            Claim::Replay(_)
        ));
        assert!(matches!(
            claim(&db, SCOPE_CHECKOUT, 1, "key-tanpa-jual", b"{}", Utc::now())
                .await
                .expect("claim"),
            Claim::Fresh(_)
        ));
    }

    /// One key that cannot be settled (its sale is gone) must not leave the
    /// keys after it stranded.
    #[tokio::test]
    async fn startup_skips_a_key_it_cannot_settle_and_settles_the_rest() {
        let db = setup_test_db().await;
        stranded(&db, "key-jual-hilang", Utc::now(), Some(999_999)).await;
        stranded(&db, "key-tanpa-jual", Utc::now(), None).await;

        assert_eq!(recover_stranded(&db).await.expect("recover"), (0, 1));
        assert!(matches!(
            claim(&db, SCOPE_CHECKOUT, 1, "key-tanpa-jual", b"{}", Utc::now())
                .await
                .expect("claim"),
            Claim::Fresh(_)
        ));
    }

    /// A slow attempt whose stale key a retry re-claimed must not release or
    /// complete the retry's row when it finally finishes.
    #[tokio::test]
    async fn a_stale_attempt_cannot_resolve_the_retrys_claim() {
        let db = setup_test_db().await;
        let first_at = Utc::now() - Duration::minutes(STALE_AFTER_MINUTES + 1);
        let Claim::Fresh(slow) = claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", first_at)
            .await
            .expect("claim")
        else {
            panic!("a fresh key must not replay");
        };
        let Claim::Fresh(_retry) = claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", Utc::now())
            .await
            .expect("stale key re-claimed")
        else {
            panic!("a stale key must be re-claimed");
        };

        release(&db, &slow).await;

        let err = claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", Utc::now())
            .await
            .expect_err("the retry's claim is still held");
        assert_eq!(err.status(), StatusCode::CONFLICT);
    }

    fn fresh(claimed: ApiResult<Claim>) -> IdempotencyClaim {
        match claimed.expect("claim") {
            Claim::Fresh(guard) => guard,
            Claim::Replay(_) => panic!("expected a fresh claim"),
        }
    }

    async fn read_row(db: &DatabaseConnection, key: &str) -> idempotency_keys::Model {
        find_row(db, &row_id(SCOPE_CHECKOUT, 1, key))
            .await
            .expect("query")
            .expect("row")
    }

    /// Two retries read the same stale row. R1 releases it, re-claims and
    /// sells; R2's release must then miss R1's row and replay R1's sale
    /// instead of deleting it and selling a second time.
    #[tokio::test]
    async fn two_retries_of_a_stale_key_sell_once() {
        let db = setup_test_db().await;
        let now = Utc::now();
        stranded(
            &db,
            "key-satu-dua",
            now - Duration::minutes(STALE_AFTER_MINUTES + 1),
            None,
        )
        .await;
        let seen_by_r1 = read_row(&db, "key-satu-dua").await;
        let seen_by_r2 = seen_by_r1.clone();
        let hash = digest(&[b"{}"]);

        assert!(settle_existing(&db, seen_by_r1, &hash, now)
            .await
            .expect("settle")
            .is_none());
        let r1 = fresh(claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now).await);

        // R1 is still selling: R2 waits rather than claiming.
        let err = settle_existing(&db, seen_by_r2.clone(), &hash, now)
            .await
            .expect_err("R1's claim is running");
        assert_eq!(err.status(), StatusCode::CONFLICT);

        let sale =
            crate::test_support::insert_transaction(&db, 1, 10_000.0, "completed", &format_ts(now))
                .await;
        idempotency_keys::ActiveModel {
            id: Set(r1.key_id.clone()),
            transaction_id: Set(Some(sale.id)),
            ..Default::default()
        }
        .update(&db)
        .await
        .expect("link sale");

        match settle_existing(&db, seen_by_r2, &hash, now)
            .await
            .expect("settle")
        {
            Some(Claim::Replay(response)) => assert_eq!(response.status(), StatusCode::CREATED),
            _ => panic!("R2 must replay R1's sale, not claim the key again"),
        }
        let row = read_row(&db, "key-satu-dua").await;
        assert_eq!(row.claim_nonce, r1.nonce);
        assert_eq!(row.transaction_id, Some(sale.id));
    }

    /// The same race through `claim`: only one of two concurrent retries gets
    /// the stale key.
    #[tokio::test]
    async fn concurrent_retries_of_a_stale_key_claim_it_once() {
        let db = setup_test_db().await;
        let now = Utc::now();
        stranded(
            &db,
            "key-satu-dua",
            now - Duration::minutes(STALE_AFTER_MINUTES + 1),
            None,
        )
        .await;

        let (a, b) = tokio::join!(
            claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now),
            claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now),
        );
        let fresh_count = [&a, &b]
            .iter()
            .filter(|result| matches!(result, Ok(Claim::Fresh(_))))
            .count();
        assert_eq!(fresh_count, 1, "exactly one retry may ring the cart up");
        for result in [a, b] {
            if let Err(err) = result {
                assert_eq!(err.status(), StatusCode::CONFLICT);
            }
        }
    }

    /// Two claims in the same second share `created_at`; a late release of
    /// the first must still not delete the second.
    #[tokio::test]
    async fn a_release_misses_a_re_claim_made_in_the_same_second() {
        let db = setup_test_db().await;
        let now = Utc::now();

        let first = fresh(claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now).await);
        release(&db, &first).await;
        let second = fresh(claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now).await);
        assert_ne!(first.nonce, second.nonce);

        release(&db, &first).await;

        let err = claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now)
            .await
            .expect_err("the second claim is still held");
        assert_eq!(err.status(), StatusCode::CONFLICT);
    }

    /// A release never drops a row whose sale committed: the retry replays it.
    #[tokio::test]
    async fn a_release_keeps_a_claim_with_a_linked_sale() {
        let db = setup_test_db().await;
        let now = Utc::now();
        let guard = fresh(claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now).await);
        let sale =
            crate::test_support::insert_transaction(&db, 1, 10_000.0, "completed", &format_ts(now))
                .await;
        idempotency_keys::ActiveModel {
            id: Set(guard.key_id.clone()),
            transaction_id: Set(Some(sale.id)),
            ..Default::default()
        }
        .update(&db)
        .await
        .expect("link sale");

        release(&db, &guard).await;

        assert!(matches!(
            claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now)
                .await
                .expect("claim"),
            Claim::Replay(_)
        ));
    }

    /// A retry completed the key from its linked sale while the original
    /// attempt was on its way to `complete`. The original's store then changes
    /// no row, which is not an error: the row holds this claim's own sale.
    #[tokio::test]
    async fn completing_a_key_a_retry_already_completed_is_not_an_error() {
        let db = setup_test_db().await;
        let now = Utc::now();
        let guard = fresh(claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now).await);
        let sale =
            crate::test_support::insert_transaction(&db, 1, 10_000.0, "completed", &format_ts(now))
                .await;
        idempotency_keys::ActiveModel {
            id: Set(guard.key_id.clone()),
            transaction_id: Set(Some(sale.id)),
            ..Default::default()
        }
        .update(&db)
        .await
        .expect("link sale");

        // The retry replays the linked sale and completes the row.
        assert!(matches!(
            claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now)
                .await
                .expect("claim"),
            Claim::Replay(_)
        ));

        // The original attempt's store finds nothing left to change...
        assert!(!mark_completed(&db, &guard, "{}").await.expect("update"));
        // ...and that is not reported.
        assert_eq!(unstored_completion_problem(&db, &guard).await, None);
        let response = complete(&db, &guard, &serde_json::json!({ "id": sale.id })).await;
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    /// A claim whose row was released and claimed again by a retry is still
    /// reported when it cannot be completed.
    #[tokio::test]
    async fn completing_a_re_claimed_key_is_still_reported() {
        let db = setup_test_db().await;
        let now = Utc::now();
        let guard = fresh(claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now).await);
        release(&db, &guard).await;
        let _retry = fresh(claim(&db, SCOPE_CHECKOUT, 1, "key-satu-dua", b"{}", now).await);

        assert!(!mark_completed(&db, &guard, "{}").await.expect("update"));
        let problem = unstored_completion_problem(&db, &guard)
            .await
            .expect("a re-claimed key is reported");
        assert!(problem.contains("claimed again"), "{problem}");
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
        complete(&db, &guard, &serde_json::json!({ "id": 7 })).await;

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
