//! Asking the provider for a PPOB line and recording its answer.
//!
//! Checkout and retry both end here: they build a request from the stored line,
//! hand it to [`spawn_fulfillment`], and the outcome is written back onto the
//! line (and the provider's struk into `ppob_receipts`).

use sea_orm::sea_query::OnConflict;
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};
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
        }
    }

    fn failure(message: String) -> Self {
        Self {
            status: PPOB_STATUS_FAILED,
            message: Some(message),
            serial_number: None,
            receipt_data: None,
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
        }
    }

    /// Only a definite refusal is `failed`. An answer that never arrived could
    /// hide a payment Mitra already made, and a `failed` line is retryable.
    pub(super) fn from_result(result: Result<PaymentResult, AppError>) -> Self {
        match result {
            Ok(payment_result) => Self::success(&payment_result),
            Err(AppError::UpstreamUncertain(message)) => Self::uncertain(message),
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
async fn store_ppob_receipt(
    db: &DatabaseConnection,
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
}
