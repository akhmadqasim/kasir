//! Bill lookups. An inquiry asks the provider what a customer owes; paying it is
//! [`crate::services::ppob::payment`]'s job.

use sea_orm::{DatabaseConnection, EntityTrait};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::domain::ppob::{InquiryResult, PaymentResult};
use crate::domain::settings::parse_app_settings;
use crate::entity::store_info;
use crate::services::ppob::auth::get_mitra_request_context;
use crate::services::ppob::client::MitraClient;
use crate::services::ppob::executor::{execute_fulfillment_request, PpobFulfillmentRequest};
use crate::services::ppob::parsers::{
    extract_f64, extract_optional_string, get_str_field, response_objects,
};
use crate::utils::{logging, AppError};

fn extract_bpjs_data_book_value(data_book: &str, label: &str) -> Option<String> {
    data_book.lines().find_map(|line| {
        let trimmed = line.trim();
        if !trimmed.starts_with(label) {
            return None;
        }

        trimmed
            .split_once(':')
            .map(|(_, value)| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

/// The name attached to `customer_id` in a BPJS `data_book`, falling back to the
/// first participant listed when the id itself is not in the book.
fn extract_bpjs_primary_name(data_book: &str, customer_id: &str) -> Option<String> {
    let mut current_number: Option<String> = None;
    let mut current_name: Option<String> = None;
    let mut first_name: Option<String> = None;

    let flush_current = |current_number: &mut Option<String>,
                         current_name: &mut Option<String>,
                         first_name: &mut Option<String>| {
        if first_name.is_none() {
            *first_name = current_name.clone();
        }

        if current_number.as_deref() == Some(customer_id) {
            return current_name.clone();
        }

        *current_number = None;
        *current_name = None;
        None
    };

    for line in data_book.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("----- Peserta") {
            if let Some(name) =
                flush_current(&mut current_number, &mut current_name, &mut first_name)
            {
                return Some(name);
            }
            continue;
        }

        if let Some((label, value)) = trimmed.split_once(':') {
            let normalized_value = value.trim().to_string();
            if normalized_value.is_empty() {
                continue;
            }

            match label.trim() {
                "Nomor Peserta" => current_number = Some(normalized_value),
                "Nama Peserta" => current_name = Some(normalized_value),
                _ => {}
            }
        }
    }

    flush_current(&mut current_number, &mut current_name, &mut first_name).or(first_name)
}

/// Every object Mitra has been seen to put an inquiry's id in: the response
/// itself, each known wrapper, and the `inquiry` block PLN nests the customer
/// details under — at the root or inside `data`.
fn inquiry_objects(result: &Value) -> impl Iterator<Item = &serde_json::Map<String, Value>> {
    response_objects(result).chain(
        [
            result.get("inquiry"),
            result.get("data").and_then(|data| data.get("inquiry")),
        ]
        .into_iter()
        .flatten()
        .filter_map(Value::as_object),
    )
}

/// The id a payment must quote back, wherever this endpoint put it. An
/// `inquiry_id` anywhere wins over a bare `id` anywhere — `id` is the older
/// alias, and the likelier of the two to mean something else at the root.
fn resolve_inquiry_id(result: &Value) -> Option<String> {
    ["inquiry_id", "id"].into_iter().find_map(|key| {
        inquiry_objects(result)
            .find_map(|obj| get_str_field(obj, &[key]))
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
    })
}

/// [`resolve_inquiry_id`], or a loud failure. An inquiry that came back
/// without an id used to be reported as a success carrying an empty one, and
/// the cashier only found out at checkout ("Inquiry PPOB harus dilakukan
/// sebelum checkout") — after telling the customer the amount. The response's
/// shape goes to warning.log so the next such change can be read off the log;
/// keys only, never values, since the values are the customer.
fn require_inquiry_id(service: &str, result: &Value) -> Result<String, AppError> {
    resolve_inquiry_id(result).ok_or_else(|| {
        logging::log_warning(&format!(
            "[ppob] {service}/inquiry tanpa inquiry_id; bentuk respons: {}",
            describe_shape(result)
        ));
        AppError::Upstream(format!(
            "Mitra tidak mengembalikan inquiry_id untuk {service}. Coba cek tagihan lagi."
        ))
    })
}

/// A JSON value with every leaf replaced by its type, so a response can be
/// logged without logging what is in it. Arrays keep their first element only.
fn describe_shape(value: &Value) -> String {
    fn shape(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                Value::Object(map.iter().map(|(k, v)| (k.clone(), shape(v))).collect())
            }
            Value::Array(items) => Value::Array(items.iter().take(1).map(shape).collect()),
            Value::String(_) => Value::String("str".into()),
            Value::Number(_) => Value::String("num".into()),
            Value::Bool(_) => Value::String("bool".into()),
            Value::Null => Value::Null,
        }
    }
    shape(value).to_string()
}

pub async fn pln(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    customer_id: String,
    payment_code: String,
    flag_id: String,
    amount: f64,
) -> Result<InquiryResult, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post(
            "pln/inquiry",
            json!({
                "customer_id": customer_id,
                "payment_code": payment_code,
                "flag_id": flag_id,
                "amount": amount,
            }),
        )
        .await?;

    // Parse from result["data"] if present, else from result directly
    let data = if result["data"].is_object() {
        &result["data"]
    } else {
        &result
    };

    // PLN nests customer info under data.inquiry
    let inquiry = &data["inquiry"];
    let customer_name = inquiry["Nama"]
        .as_str()
        .map(String::from)
        .or_else(|| extract_optional_string(data, &["nama_pelanggan", "customer_name"]));

    let total = extract_f64(data, &["total", "total_amount"]).max(amount);
    let admin_fee = extract_f64(data, &["total_fee", "fee", "admin_fee", "admin"]);
    let inquiry_id = require_inquiry_id("pln", &result)?;

    Ok(InquiryResult {
        inquiry_id,
        customer_name,
        customer_id: customer_id.clone(),
        product_name: extract_optional_string(data, &["product_name", "denom"]),
        amount: extract_f64(data, &["price"]).max(amount),
        admin_fee,
        total,
        service_type: "pln".to_string(),
        raw_data: result,
    })
}

pub async fn pdam(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    customer_id: String,
    product_id: i64,
    payment_code: String,
) -> Result<InquiryResult, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post(
            "pdam/inquiry",
            json!({
                "product_id": product_id,
                "customer_id": customer_id,
                "payment_code": payment_code,
            }),
        )
        .await?;

    let amount = extract_f64(&result, &["amount", "tagihan", "total_tagihan"]);
    let inquiry_id = require_inquiry_id("pdam", &result)?;

    Ok(InquiryResult {
        inquiry_id,
        customer_name: extract_optional_string(&result, &["nama_pelanggan", "customer_name"]),
        customer_id: customer_id.clone(),
        product_name: extract_optional_string(&result, &["product_name", "merchant"]),
        amount,
        admin_fee: extract_f64(&result, &["admin_fee", "admin"]),
        total: extract_f64(&result, &["total"]).max(amount),
        service_type: "pdam".to_string(),
        raw_data: result,
    })
}

#[derive(Debug, Clone)]
pub struct BpjsInquiryInput {
    pub customer_id: String,
    pub phone_number: String,
    pub payment_code: String,
    pub bpjs_type: String,
    pub period: String,
}

pub async fn bpjs(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    input: BpjsInquiryInput,
) -> Result<InquiryResult, AppError> {
    let BpjsInquiryInput {
        customer_id,
        phone_number,
        payment_code,
        bpjs_type,
        period,
    } = input;

    let client = get_mitra_request_context(db, mitra).await?;

    let fallback_phone_number = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .map(|store| parse_app_settings(&store.additional_info).ppob.phone_number)
        .unwrap_or_default();

    let normalized_type = match bpjs_type.trim().to_uppercase().as_str() {
        "1" | "BPJSKES" | "KESEHATAN" => "BPJSKES".to_string(),
        "2" | "BPJSTK" | "KETENAGAKERJAAN" => "BPJSTK".to_string(),
        other if !other.is_empty() => other.to_string(),
        _ => "BPJSKES".to_string(),
    };

    let normalized_payment_code = if payment_code.trim().is_empty()
        || payment_code.trim().eq_ignore_ascii_case(&normalized_type)
    {
        customer_id.trim().to_string()
    } else {
        payment_code.trim().to_string()
    };

    let primary_phone_number = if phone_number.trim().is_empty() {
        "00".to_string()
    } else {
        phone_number.trim().to_string()
    };

    let request_body = |resolved_phone_number: &str| {
        json!({
            "customer_id": customer_id,
            "phone_number": resolved_phone_number,
            "payment_code": normalized_payment_code,
            "type": normalized_type,
            "period": period,
        })
    };

    let result = match client
        .post("bpjs/inquiry", request_body(&primary_phone_number))
        .await
    {
        Ok(result) => result,
        Err(AppError::Upstream(message))
            if message.contains("Inquiry Gagal")
                && !fallback_phone_number.is_empty()
                && fallback_phone_number != primary_phone_number =>
        {
            client
                .post("bpjs/inquiry", request_body(&fallback_phone_number))
                .await?
        }
        Err(err) => return Err(err),
    };

    let data = if result["data"].is_object() {
        &result["data"]
    } else if result["inquiry"].is_object() {
        &result["inquiry"]
    } else {
        &result
    };

    let data_book = data["data_book"].as_str().unwrap_or_default();
    let amount = extract_f64(
        data,
        &["amount", "tagihan", "premi", "Amount", "Total Tagihan"],
    );
    let admin_fee = extract_f64(&result, &["total_fee", "fee", "admin_fee", "admin"])
        .max(extract_f64(data, &["Fee", "fee", "admin_fee", "admin"]));
    let total = extract_f64(&result, &["total", "total_amount"])
        .max(extract_f64(data, &["Total", "total", "total_amount"]))
        .max(amount + admin_fee);
    let customer_name = extract_optional_string(data, &["nama_pelanggan", "customer_name"])
        .or_else(|| extract_bpjs_primary_name(data_book, &customer_id))
        .or_else(|| extract_bpjs_data_book_value(data_book, "Nama Peserta"));
    let inquiry_id = require_inquiry_id("bpjs", &result)?;

    Ok(InquiryResult {
        inquiry_id,
        customer_name,
        customer_id: customer_id.clone(),
        product_name: extract_optional_string(data, &["product_name", "PLU"])
            .or_else(|| Some(normalized_type.clone())),
        amount,
        admin_fee,
        total,
        service_type: "bpjs".to_string(),
        raw_data: result,
    })
}

/// The bill amount a payment-point inquiry should report.
///
/// Most billers echo their own `amount`/`tagihan`, but an `input_amt` biller
/// (the cashier types the nominal, e.g. a top-up-style Payment Point product)
/// may just confirm success without restating it — the same reason
/// [`pln`]'s total falls back to the amount it was asked to inquire with.
/// Without this fallback the confirmation card would show Rp 0 for exactly
/// the billers that need the nominal to be visible.
fn resolve_pp_amount(result: &Value, input_amount: Option<f64>) -> f64 {
    extract_f64(result, &["amount", "tagihan"]).max(input_amount.unwrap_or(0.0))
}

pub async fn payment_point(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    customer_id: String,
    payment_point_group_id: i64,
    product_code: Option<String>,
    amount: Option<f64>,
) -> Result<InquiryResult, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;

    let mut body = json!({
        "customer_id": customer_id,
        "payment_point_group_id": payment_point_group_id,
    });
    if let Some(pc) = &product_code {
        body["product_code"] = json!(pc);
    }
    if let Some(amt) = amount {
        body["amount"] = json!(amt);
    }

    let result = client.post("pp/inquiry", body).await?;

    let bill_amount = resolve_pp_amount(&result, amount);
    let inquiry_id = require_inquiry_id("pp", &result)?;

    Ok(InquiryResult {
        inquiry_id,
        customer_name: extract_optional_string(&result, &["nama_pelanggan", "customer_name"]),
        customer_id: customer_id.clone(),
        product_name: extract_optional_string(&result, &["product_name", "description"]),
        amount: bill_amount,
        admin_fee: extract_f64(&result, &["admin_fee", "admin"]),
        total: extract_f64(&result, &["total"]).max(bill_amount),
        service_type: "pp".to_string(),
        raw_data: result,
    })
}

#[derive(Debug, Clone)]
pub struct TransferInquiryInput {
    pub channel_id: String,
    pub nomor_rekening: String,
    pub amount: f64,
    pub channel_name: String,
    pub deskripsi: String,
    pub nama_pengirim: String,
    pub notelp_pengirim: String,
}

pub async fn transfer(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    input: TransferInquiryInput,
) -> Result<InquiryResult, AppError> {
    let TransferInquiryInput {
        channel_id,
        nomor_rekening,
        amount,
        channel_name,
        deskripsi,
        nama_pengirim,
        notelp_pengirim,
    } = input;

    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post(
            "transfer-uang/inquiry",
            json!({
                "channel_id": channel_id,
                "nomor_rekening": nomor_rekening,
                "amount": amount,
                "channel_name": channel_name,
                "deskripsi": deskripsi,
                "nama_pengirim": nama_pengirim,
                "notelp_pengirim": notelp_pengirim,
            }),
        )
        .await?;

    let inquiry_id = require_inquiry_id("transfer", &result)?;

    Ok(InquiryResult {
        inquiry_id,
        customer_name: extract_optional_string(&result, &["nama_penerima", "customer_name"]),
        customer_id: nomor_rekening.clone(),
        product_name: Some(channel_name.clone()),
        amount,
        admin_fee: extract_f64(&result, &["admin_fee", "fee", "admin"]),
        total: extract_f64(&result, &["total"]).max(amount),
        service_type: "transfer".to_string(),
        raw_data: result,
    })
}

pub async fn emoney(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    customer_id: String,
    product_code: String,
) -> Result<InquiryResult, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post(
            "emoney/inquiry",
            json!({
                "customer_id": customer_id,
                "product_code": product_code,
            }),
        )
        .await?;

    let amount = extract_f64(&result, &["amount", "nominal"]);
    let inquiry_id = require_inquiry_id("emoney", &result)?;

    Ok(InquiryResult {
        inquiry_id,
        customer_name: extract_optional_string(&result, &["nama_pelanggan", "customer_name"]),
        customer_id: customer_id.clone(),
        product_name: extract_optional_string(&result, &["product_name"]),
        amount,
        admin_fee: extract_f64(&result, &["admin_fee", "admin"]),
        total: extract_f64(&result, &["total"]).max(amount),
        service_type: "emoney".to_string(),
        raw_data: result,
    })
}

/// Airtime and data bundles are bought outright — there is nothing to inquire
/// first, so this goes straight to fulfilment.
///
/// `pin` is validated by the caller (`crate::http::routes::ppob::topup`) via
/// `crate::services::ppob::executor::validate_pin` before it reaches here.
pub async fn pulsa_purchase(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    phone_number: String,
    product_code: String,
    product_id: i64,
    product_type: String,
    pin: String,
) -> Result<PaymentResult, AppError> {
    execute_fulfillment_request(
        db,
        mitra,
        &PpobFulfillmentRequest {
            service_type: product_type,
            customer_id: Some(phone_number),
            inquiry_id: None,
            product_id: Some(product_id),
            product_code: Some(product_code),
            payment_code: None,
            flag_id: None,
            phone_number: None,
            amount: None,
            pin,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolve_pp_amount_prefers_the_providers_own_amount() {
        let result = json!({ "amount": 150_000 });
        assert_eq!(resolve_pp_amount(&result, Some(50_000.0)), 150_000.0);
    }

    #[test]
    fn resolve_pp_amount_reads_the_tagihan_alias() {
        let result = json!({ "tagihan": 75_000 });
        assert_eq!(resolve_pp_amount(&result, None), 75_000.0);
    }

    #[test]
    fn resolve_pp_amount_falls_back_to_the_input_amount_biller_typed() {
        // An `input_amt` biller that just confirms success without restating
        // the nominal — the confirmation card must still show what the
        // cashier typed in, not Rp 0.
        let result = json!({ "message": "OK" });
        assert_eq!(resolve_pp_amount(&result, Some(25_000.0)), 25_000.0);
    }

    #[test]
    fn resolve_pp_amount_is_zero_without_either() {
        let result = json!({});
        assert_eq!(resolve_pp_amount(&result, None), 0.0);
    }

    #[test]
    fn resolve_inquiry_id_reads_the_root() {
        let result = json!({ "message": "OK", "inquiry_id": "INQ-1" });
        assert_eq!(resolve_inquiry_id(&result).as_deref(), Some("INQ-1"));
    }

    #[test]
    fn resolve_inquiry_id_reads_the_data_wrapper() {
        let result = json!({ "message": "OK", "data": { "inquiry_id": "INQ-2" } });
        assert_eq!(resolve_inquiry_id(&result).as_deref(), Some("INQ-2"));
    }

    #[test]
    fn resolve_inquiry_id_reads_a_nested_inquiry_block() {
        // PLN keeps the customer details under `data.inquiry`; if the id ever
        // moves in there with them, it must still be found.
        let under_data = json!({
            "message": "OK",
            "data": { "inquiry": { "inquiry_id": "INQ-3", "Nama": "BUDI" } }
        });
        assert_eq!(resolve_inquiry_id(&under_data).as_deref(), Some("INQ-3"));

        let at_root = json!({ "message": "OK", "inquiry": { "inquiry_id": "INQ-4" } });
        assert_eq!(resolve_inquiry_id(&at_root).as_deref(), Some("INQ-4"));
    }

    #[test]
    fn resolve_inquiry_id_prefers_inquiry_id_anywhere_over_a_bare_id() {
        let result = json!({ "id": 7, "data": { "inquiry_id": "INQ-5" } });
        assert_eq!(resolve_inquiry_id(&result).as_deref(), Some("INQ-5"));
    }

    #[test]
    fn resolve_inquiry_id_accepts_a_numeric_id() {
        let result = json!({ "data": { "id": 42 } });
        assert_eq!(resolve_inquiry_id(&result).as_deref(), Some("42"));
    }

    #[test]
    fn resolve_inquiry_id_is_none_when_missing_or_blank() {
        let missing = json!({ "message": "OK", "data": { "inquiry": { "Nama": "BUDI" } } });
        assert_eq!(resolve_inquiry_id(&missing), None);

        let blank = json!({ "message": "OK", "inquiry_id": "   " });
        assert_eq!(resolve_inquiry_id(&blank), None);
    }

    /// An inquiry with no id must fail here, at "Cek Tagihan" — not later at
    /// checkout as "Inquiry PPOB harus dilakukan sebelum checkout".
    #[test]
    fn require_inquiry_id_is_an_upstream_error_without_one() {
        let result = json!({ "message": "OK", "data": { "inquiry": { "Nama": "BUDI" } } });
        match require_inquiry_id("pln", &result) {
            Err(AppError::Upstream(message)) => assert!(message.contains("pln"), "{message}"),
            other => panic!("expected Upstream, got {other:?}"),
        }
    }

    /// The logged shape must carry the keys (that is the diagnosis) and none
    /// of the values (that is the customer).
    #[test]
    fn describe_shape_keeps_keys_and_drops_values() {
        let result = json!({
            "message": "OK",
            "data": {
                "inquiry": { "Nama": "BUDI SANTOSO" },
                "price": 50000,
                "items": [{ "a": 1 }, { "b": 2 }]
            }
        });
        let shape = describe_shape(&result);
        assert!(!shape.contains("BUDI"), "{shape}");
        assert!(!shape.contains("50000"), "{shape}");
        assert!(shape.contains(r#""Nama":"str""#), "{shape}");
        assert!(shape.contains(r#""price":"num""#), "{shape}");
        assert!(shape.contains(r#""items":[{"a":"num"}]"#), "{shape}");
    }
}
