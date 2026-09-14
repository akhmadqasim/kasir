use std::fmt;
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::json;
use tokio::sync::Mutex;

use crate::domain::ppob::PaymentResult;
use crate::services::ppob::auth::get_mitra_request_context;
use crate::services::ppob::client::{MitraClient, MitraRequestContext};
use crate::services::ppob::parsers::{extract_f64, extract_optional_string};
use crate::utils::AppError;

/// Everything a PPOB fulfilment call needs, including the cashier's Mitra
/// transaction PIN.
///
/// The PIN used to live in `AppSettings.ppob.pin`, read silently off disk on
/// every purchase. It is typed by the cashier at the moment of sale instead
/// now, so it travels on this struct rather than through settings — and only
/// on this struct: [`execute_fulfillment_request`] sends it upstream and
/// nowhere else stores it. `Debug` is implemented by hand below, redacting
/// `pin`, so a stray `{:?}` of a value that carries a real PIN (a log line, a
/// panic message) cannot put it somewhere it can be read back.
#[derive(Clone)]
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
    pub pin: String,
}

impl fmt::Debug for PpobFulfillmentRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PpobFulfillmentRequest")
            .field("service_type", &self.service_type)
            .field("customer_id", &self.customer_id)
            .field("inquiry_id", &self.inquiry_id)
            .field("product_id", &self.product_id)
            .field("product_code", &self.product_code)
            .field("payment_code", &self.payment_code)
            .field("flag_id", &self.flag_id)
            .field("phone_number", &self.phone_number)
            .field("amount", &self.amount)
            .field("pin", &"<redacted>")
            .finish()
    }
}

/// A PIN typed at the moment of a PPOB purchase must satisfy this shape — the
/// same 4-6 ASCII digits a login PIN is checked against
/// (`services::settings::change_pin`).
fn pin_has_valid_format(pin: &str) -> bool {
    (4..=6).contains(&pin.len()) && pin.chars().all(|c| c.is_ascii_digit())
}

/// The one gate every code path that can spend PPOB money passes a PIN
/// through before a [`PpobFulfillmentRequest`] is built: checkout, a checkout
/// retry, and the two standalone `/ppob/payments` and `/ppob/topups` routes.
///
/// `required` is `false` only for a checkout cart with no PPOB line, where the
/// field is simply ignored — every other caller passes `true`. Never stores
/// or logs the PIN; it only checks its shape and hands it back.
pub fn validate_pin(pin: Option<String>, required: bool) -> Result<String, AppError> {
    if !required {
        return Ok(String::new());
    }

    let pin = pin
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Validation("PIN Mitra wajib diisi untuk transaksi PPOB".into()))?;

    if !pin_has_valid_format(&pin) {
        return Err(AppError::Validation(
            "PIN Mitra harus terdiri dari 4-6 digit angka".into(),
        ));
    }

    Ok(pin)
}

pub async fn execute_fulfillment_request(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    request: &PpobFulfillmentRequest,
) -> Result<PaymentResult, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;

    match request.service_type.as_str() {
        "pulsa" | "data" => execute_direct_topup(&client, &request.pin, request).await,
        "pln" | "pdam" | "bpjs" | "pp" | "transfer" | "emoney" => {
            execute_confirm_payment(&client, &request.pin, request).await
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_pin_is_a_no_op_when_not_required() {
        assert_eq!(validate_pin(None, false).unwrap(), "");
        assert_eq!(
            validate_pin(Some("anything".to_string()), false).unwrap(),
            ""
        );
    }

    #[test]
    fn validate_pin_requires_one_when_required() {
        match validate_pin(None, true) {
            Err(AppError::Validation(msg)) => {
                assert_eq!(msg, "PIN Mitra wajib diisi untuk transaksi PPOB")
            }
            other => panic!("expected Validation, got {other:?}"),
        }
        match validate_pin(Some("".to_string()), true) {
            Err(AppError::Validation(_)) => {}
            other => panic!("expected Validation, got {other:?}"),
        }
        match validate_pin(Some("   ".to_string()), true) {
            Err(AppError::Validation(_)) => {}
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn validate_pin_enforces_four_to_six_digits() {
        for bad in ["123", "1234567", "12a4", "12 45"] {
            match validate_pin(Some(bad.to_string()), true) {
                Err(AppError::Validation(msg)) => {
                    assert_eq!(msg, "PIN Mitra harus terdiri dari 4-6 digit angka")
                }
                other => panic!("expected Validation for {bad:?}, got {other:?}"),
            }
        }

        for good in ["1234", "12345", "123456"] {
            assert_eq!(validate_pin(Some(good.to_string()), true).unwrap(), good);
        }
    }

    #[test]
    fn debug_of_a_fulfillment_request_redacts_the_pin() {
        let request = PpobFulfillmentRequest {
            service_type: "pulsa".to_string(),
            customer_id: Some("0812".to_string()),
            inquiry_id: None,
            product_id: None,
            product_code: None,
            payment_code: None,
            flag_id: None,
            phone_number: None,
            amount: None,
            pin: "654321".to_string(),
        };

        let printed = format!("{request:?}");
        assert!(!printed.contains("654321"), "printed: {printed}");
        assert!(printed.contains("<redacted>"));
    }
}
