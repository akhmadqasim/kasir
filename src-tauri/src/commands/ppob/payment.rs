use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::domain::ppob::{PaymentResult, PpobReceiptData};
use crate::services;
use crate::services::ppob::client::MitraClient;
use crate::services::ppob::payment::ConfirmPaymentInput;
use crate::utils::AppError;

// Tauri deserialises command parameters by name from the IPC payload, so this flat
// list *is* the wire shape the cashier screen sends. Taking `ConfirmPaymentInput`
// as a single parameter would nest every field under one key and break that
// contract, so the struct is assembled in the body instead.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ppob_confirm_payment(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    service_type: String,
    inquiry_id: String,
    customer_id: Option<String>,
    product_code: Option<String>,
    payment_code: Option<String>,
    flag_id: Option<String>,
    phone_number: Option<String>,
    amount: Option<f64>,
) -> Result<PaymentResult, AppError> {
    services::ppob::payment::confirm(
        db.inner(),
        mitra.inner(),
        ConfirmPaymentInput {
            service_type,
            inquiry_id,
            customer_id,
            product_code,
            payment_code,
            flag_id,
            phone_number,
            amount,
        },
    )
    .await
}

#[tauri::command]
pub async fn ppob_get_receipt_data(
    payment_result: PaymentResult,
) -> Result<PpobReceiptData, AppError> {
    services::ppob::payment::receipt_data(payment_result)
}
