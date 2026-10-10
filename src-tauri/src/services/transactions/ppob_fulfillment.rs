//! Asking the provider for a PPOB line and recording its answer.
//!
//! Checkout and retry both end here: they build a request from the stored line,
//! hand it to [`spawn_fulfillment`], and the outcome is written back onto the
//! line (and the provider's struk into `ppob_receipts`).

use sea_orm::sea_query::OnConflict;
use sea_orm::{ActiveModelTrait, ConnectionTrait, DatabaseConnection, EntityTrait, Set};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::{PPOB_STATUS_FAILED, PPOB_STATUS_SUCCESS, PPOB_STATUS_UNCERTAIN};
use crate::domain::ppob::PaymentResult;
use crate::entity::{ppob_receipts, transaction_items};
use crate::services::ppob::executor::{execute_fulfillment_request, PpobFulfillmentRequest};
use crate::services::ppob::MitraClient;
use crate::utils::logging::log_error;
use crate::utils::time::now_ts;
use crate::utils::AppError;

/// `pin` comes from the checkout (or retry) call, never from `item` — a
/// `transaction_items` row has no PIN column and never will.
pub(super) fn build_ppob_request(
    item: &transaction_items::Model,
    pin: String,
) -> Result<PpobFulfillmentRequest, AppError> {
    let service_type = item
        .service_type
        .clone()
        .ok_or_else(|| AppError::Validation("Item PPOB tidak memiliki service type".into()))?;
    // `ppob_flag_id` doubles as the PLN meter flag and the BPJS phone number;
    // BPJS also pays the amount the inquiry quoted.
    let is_pln = service_type == "pln";
    let is_bpjs = service_type == "bpjs";

    Ok(PpobFulfillmentRequest {
        customer_id: item.service_ref.clone(),
        inquiry_id: item.ppob_inquiry_id.clone(),
        product_id: item.ppob_product_id,
        product_code: item.ppob_product_code.clone(),
        payment_code: item.ppob_payment_code.clone(),
        flag_id: is_pln.then(|| item.ppob_flag_id.clone()).flatten(),
        phone_number: is_bpjs.then(|| item.ppob_flag_id.clone()).flatten(),
        amount: is_bpjs.then_some(item.buy_price).flatten(),
        service_type,
        pin,
    })
}

fn build_ppob_success_message(payment_result: &PaymentResult) -> String {
    if let Some(serial_number) = &payment_result.serial_number {
        return format!("Fulfillment PPOB berhasil. SN: {}", serial_number);
    }

    if let Some(product_name) = &payment_result.product_name {
        return format!("Fulfillment PPOB berhasil untuk {}", product_name);
    }

    "Fulfillment PPOB berhasil".to_string()
}

/// Everything the provider's answer changes on a PPOB line. The four columns
/// move together — a success carries a serial and a struk, a failure carries
/// neither — so they are written as one value rather than four arguments whose
/// order nobody can remember.
pub(super) struct PpobOutcome {
    status: &'static str,
    message: Option<String>,
    serial_number: Option<String>,
    /// The provider's whole payment response, as JSON text, so the struk can be
    /// printed again days later. See migration 023.
    receipt_data: Option<String>,
    /// Mitra's references from an ADVICE answer (`Some("{}")` when it sent
    /// none); `None` for every other outcome. See migration 031.
    advice: Option<String>,
}

impl PpobOutcome {
    fn success(payment_result: &PaymentResult) -> Self {
        let receipt_data = if payment_result.receipt_data.is_null() {
            None
        } else {
            // A `Value` parsed from a response always serialises back, so the
            // `ok()` is belt and braces: losing the struk data must not cost the
            // cashier the far more important `success` status.
            serde_json::to_string(&payment_result.receipt_data).ok()
        };

        Self {
            status: PPOB_STATUS_SUCCESS,
            message: Some(build_ppob_success_message(payment_result)),
            serial_number: payment_result.serial_number.clone(),
            receipt_data,
            advice: None,
        }
    }

    fn failure(message: String) -> Self {
        Self {
            status: PPOB_STATUS_FAILED,
            message: Some(message),
            serial_number: None,
            receipt_data: None,
            advice: None,
        }
    }

    fn uncertain(message: String) -> Self {
        Self {
            status: PPOB_STATUS_UNCERTAIN,
            message: Some(format!(
                "Hasil dari Mitra tidak jelas ({message}). Cek riwayat Mitra, lalu tandai berhasil atau gagal."
            )),
            serial_number: None,
            receipt_data: None,
            advice: None,
        }
    }

    /// Mitra said ADVICE: the biller has the payment and has not answered.
    /// `uncertain` like any lost answer — never retried, never refunded — but
    /// with Mitra's references kept so the history can settle it.
    fn advice(reference: Option<String>) -> Self {
        Self {
            status: PPOB_STATUS_UNCERTAIN,
            message: Some(
                "Menunggu konfirmasi biller (ADVICE): pembayaran sudah terkirim, hasil akhirnya belum ada. Jangan diulang — klik Cek status."
                    .into(),
            ),
            serial_number: None,
            receipt_data: None,
            advice: Some(reference.unwrap_or_else(|| "{}".into())),
        }
    }

    /// Only a definite refusal is `failed`. An answer that never arrived could
    /// hide a payment Mitra already made, and a `failed` line is retryable.
    pub(super) fn from_result(result: Result<PaymentResult, AppError>) -> Self {
        match result {
            Ok(payment_result) => Self::success(&payment_result),
            Err(AppError::UpstreamUncertain(message))
            | Err(AppError::UpstreamUnreachable {
                message,
                maybe_sent: true,
            }) => Self::uncertain(message),
            Err(AppError::UpstreamAdvice(reference)) => Self::advice(reference),
            Err(error) => Self::failure(error.to_string()),
        }
    }
}

pub(super) async fn update_ppob_item_status(
    db: &DatabaseConnection,
    item_id: i64,
    outcome: PpobOutcome,
) -> Result<(), AppError> {
    let item = transaction_items::Entity::find_by_id(item_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Item transaksi PPOB tidak ditemukan".into()))?;

    let mut active_item: transaction_items::ActiveModel = item.into();
    active_item.ppob_status = Set(Some(outcome.status.to_string()));
    active_item.ppob_message = Set(outcome.message);
    active_item.ppob_serial_number = Set(outcome.serial_number);
    active_item.ppob_advice = Set(outcome.advice);
    active_item.update(db).await?;

    // The provider's whole answer goes in its own table, keyed by the item, so
    // that everything else reading `transaction_items` never carries it. A
    // failure clears any earlier blob: only a failed line can be retried, so
    // whatever is there belongs to an attempt that no longer stands.
    match outcome.receipt_data {
        Some(data) => store_ppob_receipt(db, item_id, data).await?,
        None => {
            ppob_receipts::Entity::delete_by_id(item_id)
                .exec(db)
                .await?;
        }
    }

    Ok(())
}

/// Write the provider's response, replacing anything already stored for the
/// item. `insert` alone would fail on a retry that follows a stored success,
/// which cannot happen today but would be a silent loss of the struk if it did.
pub(super) async fn store_ppob_receipt<C: ConnectionTrait>(
    db: &C,
    item_id: i64,
    data: String,
) -> Result<(), AppError> {
    let receipt = ppob_receipts::ActiveModel {
        transaction_item_id: Set(item_id),
        data: Set(data),
        created_at: Set(Some(now_ts())),
    };

    ppob_receipts::Entity::insert(receipt)
        .on_conflict(
            OnConflict::column(ppob_receipts::Column::TransactionItemId)
                .update_columns([
                    ppob_receipts::Column::Data,
                    ppob_receipts::Column::CreatedAt,
                ])
                .to_owned(),
        )
        .exec(db)
        .await?;

    Ok(())
}

/// Ask the provider for one PPOB line in the background and record its
/// answer. A failure to record it is logged: the line would otherwise sit in
/// `pending`/`processing`, which no retry will touch, with no trace of why.
pub(super) fn spawn_fulfillment(
    conn: DatabaseConnection,
    mitra: Arc<Mutex<MitraClient>>,
    item_id: i64,
    request: PpobFulfillmentRequest,
) {
    // `request` (and the PIN on it) is moved into the task below and dropped
    // when it finishes — nothing outside this task ever holds it, and it is
    // never written back to `conn`.
    tokio::spawn(async move {
        let outcome =
            PpobOutcome::from_result(execute_fulfillment_request(&conn, &mitra, &request).await);
        let status = outcome.status;
        if let Err(error) = update_ppob_item_status(&conn, item_id, outcome).await {
            log_error(&format!(
                "[ppob] item {item_id}: hasil fulfillment '{status}' gagal disimpan: {error}"
            ));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::transactions::fixtures::{seed_ppob_sale, setup_test_db};

    /// A line that failed has nothing to print, and whatever a previous attempt
    /// left behind describes an attempt that no longer stands.
    #[tokio::test]
    async fn a_failed_fulfilment_leaves_no_provider_response_behind() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_SUCCESS).await;

        store_ppob_receipt(&conn, item.id, "{\"receipt_text\":\"STRUK\"}".to_string())
            .await
            .expect("store");

        update_ppob_item_status(
            &conn,
            item.id,
            PpobOutcome::failure("Provider timeout".to_string()),
        )
        .await
        .expect("mark failed");

        assert!(ppob_receipts::Entity::find_by_id(item.id)
            .one(&conn)
            .await
            .expect("query")
            .is_none());
    }

    // -----------------------------------------------------------------------
    // Outcome classification
    // -----------------------------------------------------------------------

    fn paid(
        serial: Option<&str>,
        product: Option<&str>,
        receipt: serde_json::Value,
    ) -> PaymentResult {
        PaymentResult {
            success: true,
            receipt_data: receipt,
            service_type: "pulsa".into(),
            customer_id: "08123456789".into(),
            amount: 10_000.0,
            admin_fee: 0.0,
            total: 10_000.0,
            product_name: product.map(str::to_string),
            customer_name: None,
            serial_number: serial.map(str::to_string),
        }
    }

    async fn line(conn: &DatabaseConnection, id: i64) -> transaction_items::Model {
        transaction_items::Entity::find_by_id(id)
            .one(conn)
            .await
            .expect("query")
            .expect("item")
    }

    /// Mitra answered and said no ("Saldo tidak cukup"): nothing was paid, so
    /// the line is `failed` — the one status the retry button accepts.
    #[test]
    fn a_mitra_refusal_is_a_definite_failure() {
        let outcome =
            PpobOutcome::from_result(Err(AppError::Upstream("Mitra: Saldo tidak cukup".into())));
        assert_eq!(outcome.status, PPOB_STATUS_FAILED);
        assert!(outcome
            .message
            .as_deref()
            .unwrap_or("")
            .contains("Saldo tidak cukup"));
        assert!(outcome.serial_number.is_none());
        assert!(outcome.receipt_data.is_none());
    }

    /// Every error that is not `UpstreamUncertain` is a refusal or a failure
    /// before the request left: a validation error, an internal one, a failed
    /// connect. Only the uncertain kind may hide a payment.
    #[test]
    fn only_an_uncertain_upstream_error_is_uncertain() {
        for error in [
            AppError::Validation("Inquiry ID PPOB harus diisi".into()),
            AppError::Internal("boom".into()),
            AppError::Upstream("Gagal koneksi ke Mitra (pulsa/v2/topup): refused".into()),
            AppError::UpstreamUnreachable {
                message: "Gagal koneksi ke Mitra (pulsa/v2/topup): refused".into(),
                maybe_sent: false,
            },
        ] {
            assert_eq!(
                PpobOutcome::from_result(Err(error)).status,
                PPOB_STATUS_FAILED
            );
        }
        let uncertain =
            PpobOutcome::from_result(Err(AppError::UpstreamUncertain("timed out".into())));
        assert_eq!(uncertain.status, PPOB_STATUS_UNCERTAIN);
        assert!(uncertain
            .message
            .as_deref()
            .unwrap_or("")
            .contains("timed out"));
        assert!(uncertain.serial_number.is_none());

        // A timeout after the purchase left this machine may hide a payment.
        let timed_out = PpobOutcome::from_result(Err(AppError::UpstreamUnreachable {
            message: "Gagal koneksi ke Mitra (pulsa/v2/topup): timed out".into(),
            maybe_sent: true,
        }));
        assert_eq!(timed_out.status, PPOB_STATUS_UNCERTAIN);
    }

    /// ADVICE is not a refusal: the line is `uncertain`, says so in words a
    /// cashier reads, and keeps Mitra's references for reconciling.
    #[tokio::test]
    async fn an_advice_answer_is_stored_uncertain_with_its_references() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, super::super::PPOB_STATUS_PENDING).await;

        let reference = r#"{"advice_id":"eyJpdiI6IkEifQ==","uid":"eyJpdiI6IlUifQ=="}"#;
        let outcome =
            PpobOutcome::from_result(Err(AppError::UpstreamAdvice(Some(reference.into()))));
        assert_eq!(outcome.status, PPOB_STATUS_UNCERTAIN);
        update_ppob_item_status(&conn, item.id, outcome)
            .await
            .expect("store");

        let stored = line(&conn, item.id).await;
        assert_eq!(stored.ppob_status.as_deref(), Some(PPOB_STATUS_UNCERTAIN));
        assert_eq!(stored.ppob_advice.as_deref(), Some(reference));
        assert!(stored.ppob_message.unwrap_or_default().contains("ADVICE"));

        // No references at all still marks the line as an ADVICE one.
        let bare = PpobOutcome::from_result(Err(AppError::UpstreamAdvice(None)));
        assert_eq!(bare.advice.as_deref(), Some("{}"));
    }

    #[tokio::test]
    async fn a_success_records_the_serial_and_keeps_the_provider_struk() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, super::super::PPOB_STATUS_PENDING).await;

        let outcome = PpobOutcome::from_result(Ok(paid(
            Some("SN-0099"),
            Some("Pulsa 10K"),
            serde_json::json!({ "message": "OK", "history_payment": { "no_ref": "SN-0099" } }),
        )));
        update_ppob_item_status(&conn, item.id, outcome)
            .await
            .expect("store");

        let stored = line(&conn, item.id).await;
        assert_eq!(stored.ppob_status.as_deref(), Some(PPOB_STATUS_SUCCESS));
        assert_eq!(stored.ppob_serial_number.as_deref(), Some("SN-0099"));
        assert!(stored
            .ppob_message
            .as_deref()
            .unwrap_or("")
            .contains("SN-0099"));
        let blob = ppob_receipts::Entity::find_by_id(item.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("provider struk stored");
        assert!(blob.data.contains("history_payment"));
    }

    /// No serial: the message names the product. A null provider body stores
    /// no struk row at all rather than the text `null`.
    #[tokio::test]
    async fn a_success_without_serial_or_body_stores_no_struk() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, super::super::PPOB_STATUS_PENDING).await;

        let outcome =
            PpobOutcome::from_result(Ok(paid(None, Some("Pulsa 10K"), serde_json::Value::Null)));
        update_ppob_item_status(&conn, item.id, outcome)
            .await
            .expect("store");

        let stored = line(&conn, item.id).await;
        assert_eq!(stored.ppob_status.as_deref(), Some(PPOB_STATUS_SUCCESS));
        assert!(stored.ppob_serial_number.is_none());
        assert!(stored
            .ppob_message
            .as_deref()
            .unwrap_or("")
            .contains("Pulsa 10K"));
        assert!(ppob_receipts::Entity::find_by_id(item.id)
            .one(&conn)
            .await
            .expect("query")
            .is_none());
    }

    /// A stored struk is replaced, not duplicated and not an insert error,
    /// when a second success is recorded for the same line.
    #[tokio::test]
    async fn a_second_success_replaces_the_stored_struk() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, super::super::PPOB_STATUS_PENDING).await;

        for sn in ["SN-1", "SN-2"] {
            let outcome =
                PpobOutcome::from_result(Ok(paid(Some(sn), None, serde_json::json!({ "sn": sn }))));
            update_ppob_item_status(&conn, item.id, outcome)
                .await
                .expect("store");
        }

        let blob = ppob_receipts::Entity::find_by_id(item.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("struk");
        assert!(blob.data.contains("SN-2"), "{}", blob.data);
        assert_eq!(
            line(&conn, item.id).await.ppob_serial_number.as_deref(),
            Some("SN-2")
        );
    }

    #[tokio::test]
    async fn recording_an_outcome_for_a_missing_line_is_not_found() {
        let conn = setup_test_db().await;
        let error = update_ppob_item_status(&conn, 9_999, PpobOutcome::failure("x".into()))
            .await
            .expect_err("no such line");
        assert!(matches!(error, AppError::NotFound(_)), "{error:?}");
    }

    // -----------------------------------------------------------------------
    // Building the provider request from the stored line
    // -----------------------------------------------------------------------

    fn stored_line(service_type: &str) -> transaction_items::Model {
        transaction_items::Model {
            id: 1,
            transaction_id: 1,
            product_id: None,
            product_name: "PPOB".into(),
            product_price: 52_500.0,
            buy_price: Some(50_000.0),
            quantity: 1,
            subtotal: 52_500.0,
            item_discount: 0.0,
            net_subtotal: 52_500.0,
            service_type: Some(service_type.into()),
            service_ref: Some("5412345678".into()),
            ppob_product_id: Some(7),
            ppob_product_code: Some("KODE".into()),
            ppob_inquiry_id: Some("INQ-1".into()),
            ppob_payment_code: Some("PAY-1".into()),
            ppob_flag_id: Some("FLAG".into()),
            ppob_status: Some("pending".into()),
            ppob_message: None,
            ppob_serial_number: None,
            created_at: None,
            ppob_advice: None,
            ppob_last_attempt_at: None,
            ppob_history_trx_id: None,
        }
    }

    /// `ppob_flag_id` means the meter flag for PLN and the phone number for
    /// BPJS; BPJS alone pays the quoted amount. No other service may pick
    /// either up, or Mitra would be sent a field it never asked for.
    #[test]
    fn the_flag_column_goes_to_the_field_its_service_means() {
        let pln = build_ppob_request(&stored_line("pln"), "123456".into()).expect("pln");
        assert_eq!(pln.flag_id.as_deref(), Some("FLAG"));
        assert!(pln.phone_number.is_none());
        assert!(pln.amount.is_none());

        let bpjs = build_ppob_request(&stored_line("bpjs"), "123456".into()).expect("bpjs");
        assert!(bpjs.flag_id.is_none());
        assert_eq!(bpjs.phone_number.as_deref(), Some("FLAG"));
        assert_eq!(bpjs.amount, Some(50_000.0));

        for service in ["pulsa", "data", "pdam", "pp", "transfer", "emoney"] {
            let request =
                build_ppob_request(&stored_line(service), "123456".into()).expect(service);
            assert!(request.flag_id.is_none(), "{service}");
            assert!(request.phone_number.is_none(), "{service}");
            assert!(request.amount.is_none(), "{service}");
            assert_eq!(request.pin, "123456");
            assert_eq!(request.inquiry_id.as_deref(), Some("INQ-1"));
        }
    }

    #[test]
    fn a_line_without_a_service_type_cannot_become_a_request() {
        let mut item = stored_line("pulsa");
        item.service_type = None;
        assert!(matches!(
            build_ppob_request(&item, "123456".into()),
            Err(AppError::Validation(_))
        ));
    }
}
