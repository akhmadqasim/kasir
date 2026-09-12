//! Confirming a PPOB purchase.

use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::domain::ppob::PaymentResult;
use crate::services::ppob::client::MitraClient;
use crate::services::ppob::executor::{execute_fulfillment_request, PpobFulfillmentRequest};
use crate::utils::AppError;

/// Everything the cashier screen sends to complete an inquiry-based purchase.
#[derive(Debug, Clone)]
pub struct ConfirmPaymentInput {
    pub service_type: String,
    pub inquiry_id: String,
    pub customer_id: Option<String>,
    pub product_code: Option<String>,
    pub payment_code: Option<String>,
    pub flag_id: Option<String>,
    pub phone_number: Option<String>,
    pub amount: Option<f64>,
}

pub async fn confirm(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    input: ConfirmPaymentInput,
) -> Result<PaymentResult, AppError> {
    execute_fulfillment_request(
        db,
        mitra,
        &PpobFulfillmentRequest {
            service_type: input.service_type,
            customer_id: input.customer_id,
            inquiry_id: Some(input.inquiry_id),
            product_id: None,
            product_code: input.product_code,
            payment_code: input.payment_code,
            flag_id: input.flag_id,
            phone_number: input.phone_number,
            amount: input.amount,
        },
    )
    .await
}
