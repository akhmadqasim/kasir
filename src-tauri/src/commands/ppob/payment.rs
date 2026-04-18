use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use super::client::MitraClient;
use super::executor::{execute_fulfillment_request, PpobFulfillmentRequest};
use super::models::{PaymentResult, PpobReceiptData};
use crate::utils::AppError;

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
    execute_fulfillment_request(
        db.inner(),
        mitra.inner(),
        &PpobFulfillmentRequest {
            service_type,
            customer_id,
            inquiry_id: Some(inquiry_id),
            product_id: None,
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
    let service_label = match payment_result.service_type.as_str() {
        "pln" => "Token PLN",
        "pdam" => "PDAM",
        "bpjs" => "BPJS Kesehatan",
        "pp" => "Payment Point",
        "transfer" => "Transfer Uang",
        "emoney" => "E-Money",
        "pulsa" => "Pulsa",
        "data" => "Paket Data",
        _ => "PPOB",
    };

    Ok(PpobReceiptData {
        service_type: payment_result.service_type,
        service_label: service_label.to_string(),
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
