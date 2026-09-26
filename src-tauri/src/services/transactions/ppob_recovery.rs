//! Getting a PPOB line unstuck after checkout: retrying one that failed,
//! settling one whose answer never arrived, and sweeping lines a restart cut
//! off mid-call.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, Statement};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::ppob_fulfillment::{build_ppob_request, spawn_fulfillment};
use super::{
    PPOB_STATUS_FAILED, PPOB_STATUS_PENDING, PPOB_STATUS_PROCESSING, PPOB_STATUS_SUCCESS,
    PPOB_STATUS_UNCERTAIN,
};
use crate::domain::Actor;
use crate::entity::{transaction_items, transactions, users};
use crate::services::ppob::executor::{validate_pin, PpobFulfillmentRequest};
use crate::services::ppob::MitraClient;
use crate::utils::AppError;

/// Claims a failed PPOB line for exactly one more fulfilment attempt.
///
/// The claim is a single conditional UPDATE, so of two callers racing on the
/// same line only one can move it out of `failed` and only that one goes on to
/// call the provider. The old code read the status, `await`ed, then wrote
/// `"pending"`: two clicks — or one click while the checkout's own background
/// task was still in flight — both passed the check and paid the provider twice
/// for a single sale.
///
/// `pending` means the checkout task has not reported back yet and `processing`
/// means another retry is in flight; neither is retryable. The request is built
/// before the claim so a malformed line fails without leaving the row stuck in
/// `processing`.
///
/// A line on a voided sale is not retryable either: the void handed the money
/// back, so paying the provider now would spend the shop's Mitra balance on a
/// sale that no longer exists.
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
    // between the read above and this write still stops the provider call.
    let claimed = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items
             SET ppob_status = $1, ppob_message = $2
             WHERE id = $3 AND ppob_status = $4
               AND EXISTS (SELECT 1 FROM transactions t
                           WHERE t.id = transaction_items.transaction_id
                             AND t.deleted_at IS NULL)",
            vec![
                PPOB_STATUS_PROCESSING.into(),
                "Sedang di-retry...".to_string().into(),
                item_id.into(),
                PPOB_STATUS_FAILED.into(),
            ],
        ))
        .await?;

    if claimed.rows_affected() != 1 {
        return Err(AppError::Validation(
            "Fulfillment PPOB sedang diproses oleh permintaan lain".into(),
        ));
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

/// Settle an `uncertain` PPOB line by hand, after someone has looked it up in
/// the Mitra history. `success` makes it printable (with the serial number
/// read off Mitra, if any); `failed` makes it retryable or refundable.
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
}
