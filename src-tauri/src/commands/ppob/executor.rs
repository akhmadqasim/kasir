use sea_orm::{DatabaseConnection, EntityTrait};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::auth::get_mitra_request_context;
use super::client::{MitraClient, MitraRequestContext};
use super::models::PaymentResult;
use super::parsers::{extract_f64, extract_optional_string};
use crate::domain::settings::parse_app_settings;
use crate::entity::store_info;
use crate::utils::AppError;

#[derive(Debug, Clone)]
pub struct PpobFulfillmentRequest {
    pub service_type: String,
    pub customer_id: Option<String>,
    pub inquiry_id: Option<String>,
    pub product_id: Option<i64>,
    pub product_code: Option<String>,
    pub payment_code: Option<String>,
    pub flag_id: Option<String>,
    pub phone_number: Option<String>,
    pub amount: Option<f64>,
}

pub async fn execute_fulfillment_request(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    request: &PpobFulfillmentRequest,
) -> Result<PaymentResult, AppError> {
    let settings = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .map(|store| parse_app_settings(&store.additional_info))
        .unwrap_or_default();

    let client = get_mitra_request_context(db, mitra).await?;

    match request.service_type.as_str() {
        "pulsa" | "data" => execute_direct_topup(&client, &settings.ppob.pin, request).await,
        "pln" | "pdam" | "bpjs" | "pp" | "transfer" | "emoney" => {
            execute_confirm_payment(&client, &settings.ppob.pin, request).await
        }
        other => Err(AppError::Validation(format!(
            "Service type tidak valid: {}",
            other
        ))),
    }
}

async fn execute_direct_topup(
    client: &MitraRequestContext,
    pin: &str,
    request: &PpobFulfillmentRequest,
) -> Result<PaymentResult, AppError> {
    let customer_id = request
        .customer_id
        .clone()
        .ok_or_else(|| AppError::Validation("Customer ID PPOB harus diisi".into()))?;
    let product_code = request
        .product_code
        .clone()
        .ok_or_else(|| AppError::Validation("Kode produk PPOB harus diisi".into()))?;
    let product_id = request
        .product_id
        .ok_or_else(|| AppError::Validation("ID produk PPOB harus diisi".into()))?;

    let mut body = json!({
        "phone_number": customer_id,
        "product_code": product_code,
        "product_id": product_id,
        "type": request.service_type,
    });
    if !pin.is_empty() {
        body["pin"] = json!(pin);
    }

    let result = client.post("pulsa/v2/topup", body).await?;
    let history_payment = &result["history_payment"];

    Ok(PaymentResult {
        success: true,
        service_type: request.service_type.clone(),
        customer_id: customer_id.clone(),
        amount: extract_f64(history_payment, &["amount"]),
        admin_fee: 0.0,
        total: extract_f64(history_payment, &["amount"]),
        product_name: extract_optional_string(history_payment, &["plu_desc", "description"]),
        customer_name: None,
        serial_number: extract_optional_string(history_payment, &["no_ref", "token_number"]),
        receipt_data: result,
    })
}

async fn execute_confirm_payment(
    client: &MitraRequestContext,
    pin: &str,
    request: &PpobFulfillmentRequest,
) -> Result<PaymentResult, AppError> {
    let inquiry_id = request
        .inquiry_id
        .clone()
        .ok_or_else(|| AppError::Validation("Inquiry ID PPOB harus diisi".into()))?;

    let endpoint = match request.service_type.as_str() {
        "pln" => "pln/payment",
        "pdam" => "pdam/payment",
        "bpjs" => "bpjs/payment",
        "pp" => "pp/payment",
        "transfer" => "transfer-uang/payment",
        "emoney" => "emoney/payment",
        _ => {
            return Err(AppError::Validation(format!(
                "Service type tidak valid: {}",
                request.service_type
            )))
        }
    };

    let mut body = json!({ "inquiry_id": inquiry_id });
    if !pin.is_empty() {
        body["pin"] = json!(pin);
    }
    if let Some(customer_id) = &request.customer_id {
        body["customer_id"] = json!(customer_id);
    }
    if let Some(product_code) = &request.product_code {
        body["product_code"] = json!(product_code);
    }
    if let Some(payment_code) = &request.payment_code {
        body["payment_code"] = json!(payment_code);
    }
    if let Some(flag_id) = &request.flag_id {
        body["flag_id"] = json!(flag_id);
    }
    if let Some(phone_number) = &request.phone_number {
        body["phone_number"] = json!(phone_number);
    }
    if let Some(amount) = request.amount {
        body["amount"] = json!(amount);
    }
    if request.service_type == "bpjs" {
        if let Some(bpjs_type) = &request.product_code {
            body["type"] = json!(bpjs_type);
        }
    }

    let result = client.post(endpoint, body).await?;

    Ok(PaymentResult {
        success: true,
        service_type: request.service_type.clone(),
        customer_id: request.customer_id.clone().unwrap_or_default(),
        amount: extract_f64(&result, &["amount", "total_amount"]),
        admin_fee: extract_f64(&result, &["admin_fee", "admin"]),
        total: extract_f64(&result, &["total", "total_payment"]),
        product_name: extract_optional_string(&result, &["product_name"]),
        customer_name: extract_optional_string(&result, &["customer_name", "nama_pelanggan"]),
        serial_number: extract_optional_string(&result, &["serial_number", "token", "sn"]),
        receipt_data: result,
    })
}
