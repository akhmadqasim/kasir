use sea_orm::{DatabaseConnection, EntityTrait};
use serde_json::json;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use super::auth::get_mitra_client;
use super::client::MitraClient;
use super::models::{PaymentResult, PpobReceiptData};
use super::parsers::{extract_f64, extract_optional_string};
use crate::commands::settings::parse_app_settings;
use crate::entity::store_info;
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
) -> Result<PaymentResult, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let settings = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
        .await?
        .map(|store| parse_app_settings(&store.additional_info))
        .unwrap_or_default();

    let client = mitra.lock().await;

    let endpoint = match service_type.as_str() {
        "pulsa" => "pulsa/payment",
        "data" => "pulsa/payment",
        "pln" => "pln/payment",
        "pdam" => "pdam/payment",
        "bpjs" => "bpjs/payment",
        "pp" => "pp/payment",
        "transfer" => "transfer-uang/payment",
        "emoney" => "emoney/payment",
        _ => {
            return Err(AppError::Validation(format!(
                "Service type tidak valid: {}",
                service_type
            )))
        }
    };

    let mut body = json!({ "inquiry_id": inquiry_id });
    if !settings.ppob.pin.is_empty() {
        body["pin"] = json!(settings.ppob.pin);
    }
    if let Some(cid) = &customer_id {
        body["customer_id"] = json!(cid);
    }
    if let Some(pc) = &product_code {
        body["product_code"] = json!(pc);
    }
    if let Some(pyc) = &payment_code {
        body["payment_code"] = json!(pyc);
    }

    let result = client.post(endpoint, body).await?;

    Ok(PaymentResult {
        success: true,
        service_type: service_type.clone(),
        customer_id: customer_id.unwrap_or_default(),
        amount: extract_f64(&result, &["amount", "total_amount"]),
        admin_fee: extract_f64(&result, &["admin_fee", "admin"]),
        total: extract_f64(&result, &["total", "total_payment"]),
        product_name: extract_optional_string(&result, &["product_name"]),
        customer_name: extract_optional_string(&result, &["customer_name", "nama_pelanggan"]),
        serial_number: extract_optional_string(&result, &["serial_number", "token", "sn"]),
        receipt_data: result,
    })
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
