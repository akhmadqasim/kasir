//! Confirming a PPOB purchase and turning its result into a receipt.

use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::domain::ppob::{PaymentResult, PpobReceiptData};
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

/// Indonesian label for each service type, as printed on the receipt.
fn service_label(service_type: &str) -> &'static str {
    match service_type {
        "pln" => "Token PLN",
        "pdam" => "PDAM",
        "bpjs" => "BPJS Kesehatan",
        "pp" => "Payment Point",
        "transfer" => "Transfer Uang",
        "emoney" => "E-Money",
        "pulsa" => "Pulsa",
        "data" => "Paket Data",
        _ => "PPOB",
    }
}

pub fn receipt_data(payment_result: PaymentResult) -> Result<PpobReceiptData, AppError> {
    let label = service_label(&payment_result.service_type);

    Ok(PpobReceiptData {
        service_type: payment_result.service_type,
        service_label: label.to_string(),
        customer_id: payment_result.customer_id,
        customer_name: payment_result.customer_name,
        product_name: payment_result.product_name,
        amount: payment_result.amount,
        admin_fee: payment_result.admin_fee,
        total: payment_result.total,
        serial_number: payment_result.serial_number,
        date_time: chrono::Local::now().format("%d/%m/%Y %H:%M:%S").to_string(),
        receipt_number: format!("PPOB-{}", chrono::Local::now().format("%Y%m%d%H%M%S")),
    })
}
