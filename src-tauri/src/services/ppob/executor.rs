use std::fmt;
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::domain::auth::pin_has_valid_format;
use crate::domain::ppob::PaymentResult;
use crate::services::ppob::auth::get_mitra_request_context;
use crate::services::ppob::client::{MitraClient, MitraRequestContext};
use crate::services::ppob::parsers::{find_f64, find_string};
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

/// The one gate every code path that can spend PPOB money passes a PIN
/// through before a [`PpobFulfillmentRequest`] is built: checkout and a
/// checkout retry.
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

    // The same 4-6 ASCII digits a login PIN is held to.
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
    let client = get_mitra_request_context(db, mitra)
        .await
        .map_err(nothing_spent_yet)?;

    let service_type = request.service_type.as_str();
    if matches!(service_type, "pulsa" | "data") {
        return execute_direct_topup(&client, request).await;
    }
    match confirm_endpoint(service_type) {
        Some(endpoint) => execute_confirm_payment(&client, endpoint, request).await,
        None => Err(AppError::Validation(format!(
            "Service type tidak valid: {}",
            service_type
        ))),
    }
}

/// An error from before the purchase request was sent. The session lookup may
/// POST `get-menu-saldo`, and a timeout there comes back as
/// [`AppError::UpstreamUncertain`] or a possibly-sent
/// [`AppError::UpstreamUnreachable`] — but that request only reads the
/// balance, so no money can have moved. Passed on as uncertain it would leave
/// the line waiting to be settled by hand instead of simply retryable.
fn nothing_spent_yet(error: AppError) -> AppError {
    match error {
        AppError::UpstreamUncertain(message) => AppError::Upstream(message),
        AppError::UpstreamUnreachable { message, .. } => AppError::UpstreamUnreachable {
            message,
            maybe_sent: false,
        },
        other => other,
    }
}

/// The direct pulsa/data top-up, which needs no inquiry.
const TOPUP_PATH: &str = "pulsa/v2/topup";

/// The payment endpoint for a service paid against an earlier inquiry.
fn confirm_endpoint(service_type: &str) -> Option<&'static str> {
    Some(match service_type {
        "pln" => "pln/payment",
        "pdam" => "pdam/payment",
        "bpjs" => "bpjs/payment",
        "pp" => "pp/payment",
        "transfer" => "transfer-uang/payment",
        "emoney" => "emoney/payment",
        _ => return None,
    })
}

async fn execute_direct_topup(
    client: &MitraRequestContext,
    request: &PpobFulfillmentRequest,
) -> Result<PaymentResult, AppError> {
    let body = topup_body(request)?;
    let result = client.post(TOPUP_PATH, body).await?;
    Ok(topup_result(request, result))
}

/// `pulsa/v2/topup`'s body. The contract (`PulsaTopupRequest`) requires
/// `phone_number` and `product_code` (the `plu` from `pulsa/v2/get-details`);
/// `product_id` and `type` are ours, kept because live top-ups have gone
/// through with them, and `pin` rides along whenever the cashier typed one.
fn topup_body(request: &PpobFulfillmentRequest) -> Result<Value, AppError> {
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
    if !request.pin.is_empty() {
        body["pin"] = json!(request.pin);
    }
    Ok(body)
}

/// A settled top-up answer, read off whichever wrapper Mitra used
/// (`history_payment` so far). The serial a pulsa buyer is told is the
/// provider's `no_ref`/SN.
fn topup_result(request: &PpobFulfillmentRequest, result: Value) -> PaymentResult {
    PaymentResult {
        success: true,
        service_type: request.service_type.clone(),
        customer_id: request.customer_id.clone().unwrap_or_default(),
        amount: find_f64(&result, &["amount"]),
        admin_fee: 0.0,
        total: find_f64(&result, &["amount"]),
        product_name: find_string(&result, &["plu_desc", "description", "product_name"]),
        customer_name: None,
        serial_number: find_string(&result, &["no_ref", "serial_number", "sn", "token_number"]),
        receipt_data: result,
    }
}

async fn execute_confirm_payment(
    client: &MitraRequestContext,
    endpoint: &str,
    request: &PpobFulfillmentRequest,
) -> Result<PaymentResult, AppError> {
    let body = confirm_body(request)?;
    let result = client.post(endpoint, body).await?;
    Ok(confirm_result(request, result))
}

/// The body of a `*/payment` call against an earlier inquiry.
///
/// Against the APK 8.21.1 contract: `PlnPaymentRequest` requires
/// `inquiry_id`, `customer_id` and `product_code` (for a token, the chosen
/// `pln/get-denom` row, which the cart line carries since this change);
/// `GenericPaymentRequest` (pdam, bpjs, pp, emoney, transfer-uang) requires
/// only `inquiry_id`, with `customer_id`, `product_code`, `payment_code` and
/// `pin` optional. `flag_id` (PLN), and `phone_number`/`amount`/`type`
/// (BPJS) are not in the contract; they stay because Mitra has needed them
/// (commit e85fe55 for `flag_id`) and an extra field costs nothing.
fn confirm_body(request: &PpobFulfillmentRequest) -> Result<Value, AppError> {
    let inquiry_id = request
        .inquiry_id
        .clone()
        .ok_or_else(|| AppError::Validation("Inquiry ID PPOB harus diisi".into()))?;

    let mut body = json!({ "inquiry_id": inquiry_id });
    if !request.pin.is_empty() {
        body["pin"] = json!(request.pin);
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
    Ok(body)
}

/// A settled `*/payment` answer. The contract nests it under `data`; live
/// answers have come flat. Both are read. A PLN prepaid token is
/// `token_number`, so it is looked for before any other serial.
fn confirm_result(request: &PpobFulfillmentRequest, result: Value) -> PaymentResult {
    PaymentResult {
        success: true,
        service_type: request.service_type.clone(),
        customer_id: request.customer_id.clone().unwrap_or_default(),
        amount: find_f64(&result, &["amount", "total_amount"]),
        admin_fee: find_f64(&result, &["admin_fee", "admin"]),
        total: find_f64(&result, &["total", "total_payment", "total_amount"]),
        product_name: find_string(&result, &["product_name"]),
        customer_name: find_string(&result, &["customer_name", "nama_pelanggan"]),
        serial_number: find_string(&result, &["token_number", "serial_number", "token", "sn"]),
        receipt_data: result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A session lookup that timed out on `get-menu-saldo` bought nothing, so
    /// it must fail the line outright (retryable), not leave it uncertain.
    #[test]
    fn a_session_lookup_timeout_is_a_definite_failure() {
        match nothing_spent_yet(AppError::UpstreamUncertain("timeout".into())) {
            AppError::Upstream(message) => assert_eq!(message, "timeout"),
            other => panic!("expected Upstream, got {other:?}"),
        }
        assert!(matches!(
            nothing_spent_yet(AppError::Validation("x".into())),
            AppError::Validation(_)
        ));
        // A balance lookup that timed out after sending is still no purchase:
        // the transport failure stays one, but no longer "maybe sent".
        match nothing_spent_yet(AppError::UpstreamUnreachable {
            message: "timed out".into(),
            maybe_sent: true,
        }) {
            AppError::UpstreamUnreachable {
                message,
                maybe_sent: false,
            } => assert_eq!(message, "timed out"),
            other => panic!("expected an unsent UpstreamUnreachable, got {other:?}"),
        }
    }

    /// The client reads a purchase answer more strictly (ADVICE, uncertain)
    /// only on a purchase path, so every endpoint that spends money must be
    /// one.
    #[test]
    fn every_purchase_endpoint_is_a_purchase_path() {
        use crate::services::ppob::client::is_purchase_path;

        assert!(is_purchase_path(TOPUP_PATH));
        for service in ["pln", "pdam", "bpjs", "pp", "transfer", "emoney"] {
            let endpoint = confirm_endpoint(service).expect(service);
            assert!(is_purchase_path(endpoint), "{endpoint}");
        }
    }

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

    fn request(service_type: &str) -> PpobFulfillmentRequest {
        PpobFulfillmentRequest {
            service_type: service_type.to_string(),
            customer_id: Some("14300000001".to_string()),
            inquiry_id: Some("INQ-1".to_string()),
            product_id: None,
            product_code: None,
            payment_code: None,
            flag_id: None,
            phone_number: None,
            amount: None,
            pin: "123456".to_string(),
        }
    }

    /// What the store sent on its three PLN token sales was missing the one
    /// field `PlnPaymentRequest` names besides the ids: `product_code`, the
    /// denomination picked from `pln/get-denom`. A token line now carries it.
    #[test]
    fn a_pln_token_payment_sends_every_field_the_contract_requires() {
        let mut pln = request("pln");
        pln.product_id = Some(17);
        pln.product_code = Some("17".to_string());
        pln.payment_code = Some("14300000001".to_string());
        pln.flag_id = Some("0".to_string());

        let body = confirm_body(&pln).expect("body");
        // `device_id` is added by the client on every POST.
        for field in ["inquiry_id", "customer_id", "product_code"] {
            assert!(body[field].is_string(), "missing {field}: {body}");
        }
        assert_eq!(body["product_code"], "17");
        assert_eq!(body["inquiry_id"], "INQ-1");
        assert_eq!(body["customer_id"], "14300000001");
        assert_eq!(body["payment_code"], "14300000001");
        assert_eq!(body["flag_id"], "0");
        assert_eq!(body["pin"], "123456");
        // Not in `PlnPaymentRequest`, so not sent.
        assert!(body.get("product_id").is_none(), "{body}");
        assert!(body.get("amount").is_none(), "{body}");
    }

    /// `GenericPaymentRequest` (pdam, bpjs, pp, emoney, transfer-uang)
    /// requires `inquiry_id` only; every optional field the line has goes too.
    #[test]
    fn a_generic_payment_sends_the_inquiry_and_what_the_line_carries() {
        let mut pdam = request("pdam");
        pdam.product_id = Some(168);
        pdam.payment_code = Some("123000858".to_string());
        let body = confirm_body(&pdam).expect("pdam");
        assert_eq!(body["inquiry_id"], "INQ-1");
        assert_eq!(body["customer_id"], "14300000001");
        assert_eq!(body["payment_code"], "123000858");
        assert!(body.get("product_id").is_none());

        let mut bpjs = request("bpjs");
        bpjs.product_code = Some("BPJSKES".to_string());
        bpjs.phone_number = Some("00".to_string());
        bpjs.amount = Some(150_000.0);
        let body = confirm_body(&bpjs).expect("bpjs");
        assert_eq!(body["product_code"], "BPJSKES");
        assert_eq!(body["type"], "BPJSKES");
        assert_eq!(body["phone_number"], "00");
        assert_eq!(body["amount"], 150_000.0);

        let mut emoney = request("emoney");
        emoney.product_code = Some("20000.00".to_string());
        assert_eq!(
            confirm_body(&emoney).expect("emoney")["product_code"],
            "20000.00"
        );

        let mut no_inquiry = request("pp");
        no_inquiry.inquiry_id = None;
        assert!(matches!(
            confirm_body(&no_inquiry),
            Err(AppError::Validation(_))
        ));
    }

    /// `PulsaTopupRequest` requires `phone_number` and `product_code`.
    #[test]
    fn a_topup_sends_the_number_and_the_plu() {
        let mut pulsa = request("pulsa");
        pulsa.customer_id = Some("081234567890".to_string());
        pulsa.product_id = Some(979);
        pulsa.product_code = Some("223316077".to_string());
        let body = topup_body(&pulsa).expect("body");
        assert_eq!(body["phone_number"], "081234567890");
        assert_eq!(body["product_code"], "223316077");
        assert_eq!(body["product_id"], 979);
        assert_eq!(body["pin"], "123456");

        pulsa.product_code = None;
        assert!(matches!(topup_body(&pulsa), Err(AppError::Validation(_))));
    }

    /// A PLN token is `token_number`, and the contract puts it under `data`:
    /// it must end up as the line's serial, ahead of any other field.
    #[test]
    fn a_pln_token_number_becomes_the_serial_wherever_it_sits() {
        let nested = json!({
            "message": "OK",
            "data": {
                "trx_id": "50151852",
                "serial_number": "",
                "token_number": "4617 5400 1832 5962 7611",
                "amount": 23500,
                "admin_fee": 3500,
                "customer_name": "BUDI SANTOSA",
                "status": "SUKSES"
            }
        });
        let paid = confirm_result(&request("pln"), nested);
        assert_eq!(
            paid.serial_number.as_deref(),
            Some("4617 5400 1832 5962 7611")
        );
        assert_eq!(paid.amount, 23_500.0);
        assert_eq!(paid.admin_fee, 3_500.0);
        assert_eq!(paid.customer_name.as_deref(), Some("BUDI SANTOSA"));

        let flat = json!({
            "message": "OK",
            "serial_number": "SN-OLD",
            "token_number": "1111 2222 3333 4444 5555"
        });
        assert_eq!(
            confirm_result(&request("pln"), flat)
                .serial_number
                .as_deref(),
            Some("1111 2222 3333 4444 5555")
        );

        let pdam = json!({ "message": "OK", "sn": "PDAM-9" });
        assert_eq!(
            confirm_result(&request("pdam"), pdam)
                .serial_number
                .as_deref(),
            Some("PDAM-9")
        );
    }

    #[test]
    fn a_topup_serial_is_its_reference_number() {
        let result = json!({
            "message": "OK",
            "history_payment": {
                "no_ref": "REF-9",
                "amount": "50600.00",
                "plu_desc": "TELKOMSEL 50.000",
                "status": "SUKSES"
            }
        });
        let paid = topup_result(&request("pulsa"), result);
        assert_eq!(paid.serial_number.as_deref(), Some("REF-9"));
        assert_eq!(paid.amount, 50_600.0);
        assert_eq!(paid.product_name.as_deref(), Some("TELKOMSEL 50.000"));
    }
}
