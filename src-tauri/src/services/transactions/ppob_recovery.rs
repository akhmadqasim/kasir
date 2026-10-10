//! Getting a PPOB line unstuck after checkout: retrying one that failed,
//! settling one whose answer never arrived, and sweeping lines a restart cut
//! off mid-call.

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, QueryFilter,
    Statement,
};
use std::sync::Arc;
use tokio::sync::Mutex;

use chrono::{DateTime, Duration, NaiveDateTime, Utc};

use super::ppob_fulfillment::{build_ppob_request, spawn_fulfillment};
use super::{
    PPOB_STATUS_FAILED, PPOB_STATUS_PENDING, PPOB_STATUS_PROCESSING, PPOB_STATUS_SUCCESS,
    PPOB_STATUS_UNCERTAIN,
};
use crate::domain::Actor;
use crate::entity::{refund_items, transaction_items, transactions, users};
use crate::services::ppob::executor::{validate_pin, PpobFulfillmentRequest};
use crate::services::ppob::MitraClient;
use crate::utils::time::{now_ts, utc_to_wib, TIMESTAMP_FORMAT};
use crate::utils::AppError;

/// Claims a failed PPOB line for exactly one more fulfilment attempt.
///
/// The claim is one conditional UPDATE, so of two racing callers only one moves
/// the line out of `failed` and calls the provider. A line still in flight, not
/// yet settled, on a voided sale, or already refunded is not retryable. The
/// request is built before the claim so a malformed line never sticks in
/// `processing`.
async fn claim_ppob_retry(
    db: &DatabaseConnection,
    item_id: i64,
    pin: String,
) -> Result<PpobFulfillmentRequest, AppError> {
    let item = transaction_items::Entity::find_by_id(item_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Item transaksi tidak ditemukan".into()))?;

    match item.ppob_status.as_deref().unwrap_or("") {
        PPOB_STATUS_FAILED => {}
        PPOB_STATUS_PENDING | PPOB_STATUS_PROCESSING => {
            return Err(AppError::Validation(
                "Fulfillment PPOB masih diproses. Tunggu hasilnya sebelum retry.".into(),
            ))
        }
        PPOB_STATUS_UNCERTAIN => return Err(AppError::Validation(
            "Hasil PPOB ini belum pasti. Cek riwayat Mitra dan tandai berhasil atau gagal dulu."
                .into(),
        )),
        _ => {
            return Err(AppError::Validation(
                "Hanya item PPOB yang gagal yang bisa di-retry".into(),
            ))
        }
    }

    let voided = transactions::Entity::find_by_id(item.transaction_id)
        .one(db)
        .await?
        .is_some_and(|sale| sale.deleted_at.is_some());
    if voided {
        return Err(AppError::Validation(
            "Transaksi ini sudah dihapus, PPOB-nya tidak bisa di-retry".into(),
        ));
    }

    let request = build_ppob_request(&item, pin)?;

    // The EXISTS repeats the void check inside the claim, so a void landing
    // after the read above still stops the provider call. The NOT EXISTS keeps
    // a refunded line (its money already went back) from being paid again.
    //
    // The claim starts a new attempt, so it also forgets the old one: the
    // ADVICE references of the attempt before (else the history reconciler
    // would match the new attempt against the old attempt's row, and the
    // Riwayat would show a stale ADVICE badge), any history row it was settled
    // from, and it stamps the attempt time the reconciler anchors on — a row
    // from before it belongs to an earlier attempt (migration 032).
    let claimed = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items
             SET ppob_status = $1, ppob_message = $2, ppob_advice = NULL,
                 ppob_history_trx_id = NULL, ppob_last_attempt_at = $3
             WHERE id = $4 AND ppob_status = $5
               AND EXISTS (SELECT 1 FROM transactions t
                           WHERE t.id = transaction_items.transaction_id
                             AND t.deleted_at IS NULL)
               AND NOT EXISTS (SELECT 1 FROM refund_items ri
                               WHERE ri.transaction_item_id = transaction_items.id)",
            vec![
                PPOB_STATUS_PROCESSING.into(),
                "Sedang di-retry...".to_string().into(),
                now_ts().into(),
                item_id.into(),
                PPOB_STATUS_FAILED.into(),
            ],
        ))
        .await?;

    if claimed.rows_affected() != 1 {
        let refunded = refund_items::Entity::find()
            .filter(refund_items::Column::TransactionItemId.eq(item_id))
            .one(db)
            .await?
            .is_some();
        return Err(AppError::Validation(if refunded {
            "Item PPOB ini sudah di-refund dan tidak bisa di-retry".into()
        } else {
            "Fulfillment PPOB sedang diproses oleh permintaan lain".into()
        }));
    }

    Ok(request)
}

/// Ask the provider once more for a line that came back failed.
///
/// `pin` is validated first, before the item is even looked up: a retry with
/// no PIN (or a malformed one) must not claim the line, so a corrected retry
/// right after finds nothing already stuck in `processing`.
pub async fn retry_ppob_fulfillment(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    item_id: i64,
    pin: Option<String>,
) -> Result<String, AppError> {
    let pin = validate_pin(pin, true)?;

    let request = claim_ppob_retry(db, item_id, pin).await?;
    spawn_fulfillment(db.clone(), mitra.clone(), item_id, request);

    Ok("PPOB fulfillment sedang diproses ulang".into())
}

/// How long after its last payment attempt an ADVICE line may be marked
/// failed by hand. ADVICE means the biller has the payment; it can still come
/// through hours later, and "failed" unlocks a second payment (retry) and a
/// refund.
pub const ADVICE_MANUAL_FAIL_AFTER_HOURS: i64 = 24;

/// When the latest payment request for a line went out: the retry that last
/// claimed it, else the checkout that created it. UTC.
pub(crate) fn last_attempt_at(item: &transaction_items::Model) -> Option<DateTime<Utc>> {
    item.ppob_last_attempt_at
        .as_deref()
        .or(item.created_at.as_deref())
        .and_then(|text| NaiveDateTime::parse_from_str(text.trim(), TIMESTAMP_FORMAT).ok())
        .map(|at| at.and_utc())
}

/// When "Tandai gagal" opens for a line that waits on the biller (ADVICE):
/// [`ADVICE_MANUAL_FAIL_AFTER_HOURS`] after its last attempt. `None` for a line
/// without ADVICE, which has no such wait.
pub(crate) fn advice_fail_opens_at(item: &transaction_items::Model) -> Option<DateTime<Utc>> {
    item.ppob_advice.as_ref()?;
    Some(last_attempt_at(item)? + Duration::hours(ADVICE_MANUAL_FAIL_AFTER_HOURS))
}

/// Why `actor` may not settle `item` by hand, if they may not. Both
/// directions are admin-only. "Gagal" on a line that waits on the biller
/// (ADVICE) also has to wait [`ADVICE_MANUAL_FAIL_AFTER_HOURS`] from the last
/// attempt; a line without ADVICE (lost answer, app closed mid-call) has no
/// such wait.
fn manual_settle_refusal(
    actor: &Actor,
    item: &transaction_items::Model,
    success: bool,
    now: DateTime<Utc>,
) -> Option<AppError> {
    if !actor.is_admin() {
        return Some(AppError::Forbidden(
            "Hanya admin yang bisa menandai hasil PPOB secara manual".into(),
        ));
    }
    if success {
        return None;
    }
    let allowed_from = advice_fail_opens_at(item)?;
    (now < allowed_from).then(|| {
        AppError::Validation(format!(
            "PPOB ini menunggu konfirmasi biller (ADVICE). Tandai gagal baru bisa {ADVICE_MANUAL_FAIL_AFTER_HOURS} jam setelah percobaan terakhir, mulai {} WIB. Sebelum itu klik Cek status atau cek di aplikasi Mitra.",
            utc_to_wib(allowed_from).format("%d-%m-%Y %H:%M")
        ))
    })
}

/// Settle an `uncertain` PPOB line by hand, after someone has looked it up in
/// the Mitra history. `success` makes it printable (with the serial number
/// read off Mitra, if any); `failed` makes it retryable or refundable. Admins
/// only; see [`manual_settle_refusal`] for the ADVICE wait.
///
/// Like the retry claim, the write is conditional on the line still being
/// `uncertain`, so two people settling it at once cannot both win.
pub async fn resolve_uncertain_ppob(
    db: &DatabaseConnection,
    actor: &Actor,
    item_id: i64,
    success: bool,
    serial_number: Option<String>,
) -> Result<String, AppError> {
    let item = transaction_items::Entity::find_by_id(item_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Item transaksi tidak ditemukan".into()))?;
    if let Some(refusal) = manual_settle_refusal(actor, &item, success, Utc::now()) {
        return Err(refusal);
    }

    let who = users::Entity::find_by_id(actor.user_id)
        .one(db)
        .await?
        .map(|user| user.full_name)
        .unwrap_or_else(|| format!("user #{}", actor.user_id));
    let serial_number = serial_number
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let (status, message) = if success {
        (
            PPOB_STATUS_SUCCESS,
            format!("Ditandai berhasil oleh {who} setelah cek riwayat Mitra"),
        )
    } else {
        (
            PPOB_STATUS_FAILED,
            format!("Ditandai gagal oleh {who} setelah cek riwayat Mitra"),
        )
    };

    let resolved = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items
             SET ppob_status = $1, ppob_message = $2, ppob_serial_number = $3
             WHERE id = $4 AND ppob_status = $5",
            vec![
                status.into(),
                message.into(),
                (if success { serial_number } else { None }).into(),
                item_id.into(),
                PPOB_STATUS_UNCERTAIN.into(),
            ],
        ))
        .await?;

    if resolved.rows_affected() != 1 {
        return Err(AppError::Validation(
            "Hanya item PPOB berstatus 'Perlu Dicek' yang bisa ditandai".into(),
        ));
    }

    Ok(if success {
        "PPOB ditandai berhasil".into()
    } else {
        "PPOB ditandai gagal".into()
    })
}

/// At startup no fulfilment task survives from the previous run, so a line
/// still `pending`/`processing` was cut off mid-call — its payment may or may
/// not have gone through. Returns how many lines were moved to `uncertain`.
pub async fn mark_interrupted_ppob_uncertain(db: &DatabaseConnection) -> Result<u64, AppError> {
    let result = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items
             SET ppob_status = $1, ppob_message = $2
             WHERE ppob_status IN ($3, $4)",
            vec![
                PPOB_STATUS_UNCERTAIN.into(),
                "Aplikasi tertutup saat PPOB diproses. Cek riwayat Mitra, lalu tandai berhasil atau gagal."
                    .into(),
                PPOB_STATUS_PENDING.into(),
                PPOB_STATUS_PROCESSING.into(),
            ],
        ))
        .await?;

    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::transactions::DeleteTransactionInput;
    use crate::services::transactions::fixtures::{
        admin, ppob_status_of, seed_ppob_sale, setup_test_db,
    };
    use crate::services::transactions::ppob_fulfillment::{update_ppob_item_status, PpobOutcome};

    /// A `Mitra` client for the retry seam — never actually reached, since the
    /// PIN is rejected first.
    fn test_mitra() -> Arc<Mutex<MitraClient>> {
        Arc::new(Mutex::new(MitraClient::new()))
    }

    #[tokio::test]
    async fn ppob_retry_claims_a_failed_line_once() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;

        claim_ppob_retry(&conn, item.id, "654321".to_string())
            .await
            .expect("first retry claims the line");
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_PROCESSING)
        );

        // A second click, while the first attempt is still in flight, must not
        // reach the provider again.
        match claim_ppob_retry(&conn, item.id, "654321".to_string()).await {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("diproses"),
                "Error should say a call is in flight, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    /// A failed line whose money already went back on a refund must not be
    /// delivered after all: that would be a free top-up.
    #[tokio::test]
    async fn ppob_retry_refuses_a_failed_line_that_was_refunded() {
        use crate::domain::refunds::{CreateRefundInput, RefundItemInput};

        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;
        crate::services::refunds::create(
            &conn,
            &admin(),
            CreateRefundInput {
                transaction_id: item.transaction_id,
                reason: None,
                items: vec![RefundItemInput {
                    transaction_item_id: item.id,
                    quantity: item.quantity,
                    condition: "good".into(),
                }],
                exchange_items: None,
            },
        )
        .await
        .expect("a failed top-up is refundable");

        match claim_ppob_retry(&conn, item.id, "654321".to_string()).await {
            Err(AppError::Validation(msg)) => assert!(msg.contains("refund"), "got: {msg}"),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_FAILED)
        );
    }

    #[tokio::test]
    async fn ppob_retry_refuses_a_pending_line() {
        let conn = setup_test_db().await;
        // Checkout leaves the line `pending` while its background task runs.
        let item = seed_ppob_sale(&conn, PPOB_STATUS_PENDING).await;

        match claim_ppob_retry(&conn, item.id, "654321".to_string()).await {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("diproses"),
                "Error should say a call is in flight, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_PENDING)
        );
    }

    #[tokio::test]
    async fn ppob_retry_refuses_an_already_fulfilled_line() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_SUCCESS).await;

        match claim_ppob_retry(&conn, item.id, "654321".to_string()).await {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("gagal"),
                "Error should say only failed lines retry, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_SUCCESS)
        );
    }

    /// The void gave the customer their money back; a retry afterwards would
    /// pay the provider for a sale that no longer exists.
    #[tokio::test]
    async fn ppob_retry_refuses_a_line_on_a_voided_sale() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;

        crate::services::transactions::void(
            &conn,
            &admin(),
            DeleteTransactionInput {
                transaction_id: item.transaction_id,
                reason: "Pelanggan batal".to_string(),
            },
        )
        .await
        .expect("an admin may void");

        match claim_ppob_retry(&conn, item.id, "654321".to_string()).await {
            Err(AppError::Validation(msg)) => assert!(msg.contains("dihapus"), "{msg}"),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_FAILED)
        );
    }

    /// A timeout after the request went out may hide a payment Mitra made: the
    /// line must not come back `failed`, which the retry button would re-pay.
    #[tokio::test]
    async fn an_unanswered_fulfilment_is_uncertain_not_failed() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_PENDING).await;

        let outcome = PpobOutcome::from_result(Err(AppError::UpstreamUncertain(
            "operation timed out".into(),
        )));
        update_ppob_item_status(&conn, item.id, outcome)
            .await
            .expect("store outcome");

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );
        match claim_ppob_retry(&conn, item.id, "654321".to_string()).await {
            Err(AppError::Validation(msg)) => assert!(msg.contains("belum pasti"), "{msg}"),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn an_uncertain_line_is_settled_once_by_hand() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;

        resolve_uncertain_ppob(&conn, &admin(), item.id, true, Some(" SN-42 ".into()))
            .await
            .expect("settles as success");
        let settled = transaction_items::Entity::find_by_id(item.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("item");
        assert_eq!(settled.ppob_status.as_deref(), Some(PPOB_STATUS_SUCCESS));
        assert_eq!(settled.ppob_serial_number.as_deref(), Some("SN-42"));

        // A second hand on the same line, or one on a line that was never
        // uncertain, changes nothing.
        assert!(
            resolve_uncertain_ppob(&conn, &admin(), item.id, false, None)
                .await
                .is_err()
        );
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_SUCCESS)
        );
    }

    #[tokio::test]
    async fn an_uncertain_line_marked_failed_becomes_retryable() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;

        resolve_uncertain_ppob(&conn, &admin(), item.id, false, Some("ignored".into()))
            .await
            .expect("settles as failed");

        let settled = transaction_items::Entity::find_by_id(item.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("item");
        assert_eq!(settled.ppob_status.as_deref(), Some(PPOB_STATUS_FAILED));
        assert!(settled.ppob_serial_number.is_none());
        claim_ppob_retry(&conn, item.id, "654321".to_string())
            .await
            .expect("a failed line is retryable");
    }

    async fn set_columns(conn: &DatabaseConnection, id: i64, sql_set: &str) {
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            format!("UPDATE transaction_items SET {sql_set} WHERE id = $1"),
            vec![id.into()],
        ))
        .await
        .expect("update line");
    }

    /// A retry starts a new attempt: the old ADVICE references and settled
    /// history row are forgotten, and the attempt time is stamped.
    #[tokio::test]
    async fn a_retry_claim_forgets_the_old_advice_and_stamps_the_attempt() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;
        set_columns(
            &conn,
            item.id,
            r#"ppob_advice = '{"advice_id":"eyJpdiI6IkEifQ=="}', ppob_history_trx_id = 'OLD-1',
               ppob_last_attempt_at = '2020-01-01 00:00:00'"#,
        )
        .await;

        claim_ppob_retry(&conn, item.id, "654321".into())
            .await
            .expect("claim");

        let claimed = transaction_items::Entity::find_by_id(item.id)
            .one(&conn)
            .await
            .unwrap()
            .unwrap();
        assert!(claimed.ppob_advice.is_none());
        assert!(claimed.ppob_history_trx_id.is_none());
        let attempt = last_attempt_at(&claimed).expect("stamped");
        assert!(Utc::now() - attempt < Duration::minutes(1), "{attempt}");
    }

    /// Both manual buttons are admin-only.
    #[tokio::test]
    async fn a_cashier_cannot_settle_by_hand() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        let kasir = Actor::new(2, "kasir");

        for success in [true, false] {
            assert!(matches!(
                resolve_uncertain_ppob(&conn, &kasir, item.id, success, None).await,
                Err(AppError::Forbidden(_))
            ));
        }
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );
    }

    /// An ADVICE line may be marked failed only 24 hours after its last
    /// attempt — counted from a retry when there was one — while "berhasil"
    /// has no wait.
    #[tokio::test]
    async fn an_advice_line_is_marked_failed_only_after_24_hours() {
        let conn = setup_test_db().await;
        let fresh = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        set_columns(&conn, fresh.id, "ppob_advice = '{}'").await;

        match resolve_uncertain_ppob(&conn, &admin(), fresh.id, false, None).await {
            Err(AppError::Validation(msg)) => assert!(msg.contains("24 jam"), "{msg}"),
            other => panic!("expected the 24h refusal, got {other:?}"),
        }
        assert_eq!(
            ppob_status_of(&conn, fresh.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );

        // Sold two days ago but retried an hour ago: still too early.
        let retried = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        set_columns(
            &conn,
            retried.id,
            "ppob_advice = '{}', created_at = datetime('now', '-2 days'),
             ppob_last_attempt_at = datetime('now', '-1 hours')",
        )
        .await;
        assert!(
            resolve_uncertain_ppob(&conn, &admin(), retried.id, false, None)
                .await
                .is_err()
        );

        let old = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        set_columns(
            &conn,
            old.id,
            "ppob_advice = '{}', created_at = datetime('now', '-25 hours')",
        )
        .await;
        resolve_uncertain_ppob(&conn, &admin(), old.id, false, None)
            .await
            .expect("24 hours on, an admin may mark it failed");
        assert_eq!(
            ppob_status_of(&conn, old.id).await.as_deref(),
            Some(PPOB_STATUS_FAILED)
        );

        // "Berhasil" needs no wait.
        resolve_uncertain_ppob(&conn, &admin(), fresh.id, true, None)
            .await
            .expect("success has no wait");
    }

    #[tokio::test]
    async fn lines_cut_off_by_a_restart_become_uncertain() {
        let conn = setup_test_db().await;
        let pending = seed_ppob_sale(&conn, PPOB_STATUS_PENDING).await;
        let processing = seed_ppob_sale(&conn, PPOB_STATUS_PROCESSING).await;
        let done = seed_ppob_sale(&conn, PPOB_STATUS_SUCCESS).await;

        let moved = mark_interrupted_ppob_uncertain(&conn).await.expect("sweep");

        assert_eq!(moved, 2);
        for id in [pending.id, processing.id] {
            assert_eq!(
                ppob_status_of(&conn, id).await.as_deref(),
                Some(PPOB_STATUS_UNCERTAIN)
            );
        }
        assert_eq!(
            ppob_status_of(&conn, done.id).await.as_deref(),
            Some(PPOB_STATUS_SUCCESS)
        );
    }

    /// A retry without a PIN is refused before the line is claimed, so it is
    /// left exactly as it was — still `failed`, not stuck in `processing`.
    #[tokio::test]
    async fn ppob_retry_without_a_pin_is_rejected() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;

        match retry_ppob_fulfillment(&conn, &test_mitra(), item.id, None).await {
            Err(AppError::Validation(msg)) => {
                assert_eq!(msg, "PIN Mitra wajib diisi untuk transaksi PPOB")
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_FAILED)
        );
    }

    /// A malformed PIN is refused just like a missing one, before the claim.
    #[tokio::test]
    async fn ppob_retry_with_a_malformed_pin_leaves_the_line_failed() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;

        for pin in ["12", "12ab", "1234567", "   "] {
            let result =
                retry_ppob_fulfillment(&conn, &test_mitra(), item.id, Some(pin.into())).await;
            assert!(
                matches!(result, Err(AppError::Validation(_))),
                "PIN {pin:?}: {result:?}"
            );
        }
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_FAILED)
        );
    }

    #[tokio::test]
    async fn ppob_retry_of_a_missing_line_is_not_found() {
        let conn = setup_test_db().await;
        assert!(matches!(
            claim_ppob_retry(&conn, 9_999, "654321".into()).await,
            Err(AppError::NotFound(_))
        ));
    }

    /// The request is built before the claim, so a line that cannot become a
    /// request is refused without being left stuck in `processing`.
    #[tokio::test]
    async fn a_malformed_failed_line_is_refused_without_being_claimed() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items SET service_type = NULL WHERE id = $1",
            vec![item.id.into()],
        ))
        .await
        .expect("strip service type");

        // With no service type the line is no longer a PPOB line at all, but
        // its status is still `failed`.
        assert!(claim_ppob_retry(&conn, item.id, "654321".into())
            .await
            .is_err());
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_FAILED)
        );
    }

    /// Two retries fired at once: exactly one wins the claim.
    #[tokio::test]
    async fn two_racing_retries_claim_the_line_exactly_once() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;

        let (a, b) = tokio::join!(
            claim_ppob_retry(&conn, item.id, "654321".into()),
            claim_ppob_retry(&conn, item.id, "654321".into()),
        );

        assert_eq!(
            [a.is_ok(), b.is_ok()].iter().filter(|ok| **ok).count(),
            1,
            "a: {a:?}, b: {b:?}"
        );
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_PROCESSING)
        );
    }

    /// Only an `uncertain` line can be settled by hand. A `pending` one still
    /// has a provider call in flight whose answer would land on top; a
    /// `failed` one is settled already.
    #[tokio::test]
    async fn only_an_uncertain_line_can_be_settled_by_hand() {
        let conn = setup_test_db().await;

        for status in [
            PPOB_STATUS_PENDING,
            PPOB_STATUS_PROCESSING,
            PPOB_STATUS_FAILED,
            PPOB_STATUS_SUCCESS,
        ] {
            let item = seed_ppob_sale(&conn, status).await;
            for success in [true, false] {
                assert!(
                    resolve_uncertain_ppob(&conn, &admin(), item.id, success, None)
                        .await
                        .is_err(),
                    "{status} settled as {success}"
                );
            }
            assert_eq!(
                ppob_status_of(&conn, item.id).await.as_deref(),
                Some(status)
            );
        }
    }

    /// A blank serial typed into the form is no serial; the message says who
    /// settled the line.
    #[tokio::test]
    async fn settling_with_a_blank_serial_stores_none_and_names_the_user() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;

        resolve_uncertain_ppob(&conn, &admin(), item.id, true, Some("   ".into()))
            .await
            .expect("settle");

        let settled = transaction_items::Entity::find_by_id(item.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("item");
        assert_eq!(settled.ppob_status.as_deref(), Some(PPOB_STATUS_SUCCESS));
        assert!(settled.ppob_serial_number.is_none());
        assert!(
            settled
                .ppob_message
                .as_deref()
                .unwrap_or("")
                .contains("Admin Test"),
            "{:?}",
            settled.ppob_message
        );
    }

    /// The startup sweep touches only lines cut off mid-call. Running it again
    /// finds nothing, and settled lines and plain goods lines stay as they were.
    #[tokio::test]
    async fn the_restart_sweep_is_idempotent_and_leaves_settled_lines_alone() {
        let conn = setup_test_db().await;
        let failed = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;
        let uncertain = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        let pending = seed_ppob_sale(&conn, PPOB_STATUS_PENDING).await;

        assert_eq!(
            mark_interrupted_ppob_uncertain(&conn).await.expect("sweep"),
            1
        );
        assert_eq!(
            mark_interrupted_ppob_uncertain(&conn).await.expect("sweep"),
            0
        );

        assert_eq!(
            ppob_status_of(&conn, failed.id).await.as_deref(),
            Some(PPOB_STATUS_FAILED)
        );
        assert_eq!(
            ppob_status_of(&conn, uncertain.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );
        assert_eq!(
            ppob_status_of(&conn, pending.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );
        // The swept line is now neither retryable nor voidable until settled.
        assert!(claim_ppob_retry(&conn, pending.id, "654321".into())
            .await
            .is_err());
    }
}
