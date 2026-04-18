use sea_orm::{DatabaseConnection, EntityTrait};
use serde_json::json;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::commands::settings::parse_app_settings;
use crate::entity::store_info;
use super::auth::get_mitra_client;
use super::client::MitraClient;
use super::executor::{execute_fulfillment_request, PpobFulfillmentRequest};
use super::models::{InquiryResult, PaymentResult};
use super::parsers::{extract_f64, extract_optional_string, extract_string};
use crate::utils::AppError;

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

fn extract_bpjs_primary_name(data_book: &str, customer_id: &str) -> Option<String> {
    let mut current_number: Option<String> = None;
    let mut current_name: Option<String> = None;
    let mut first_name: Option<String> = None;

    let flush_current =
        |current_number: &mut Option<String>, current_name: &mut Option<String>, first_name: &mut Option<String>| {
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
            if let Some(name) = flush_current(&mut current_number, &mut current_name, &mut first_name) {
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

#[tauri::command]
pub async fn ppob_pln_inquiry(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    customer_id: String,
    payment_code: String,
    flag_id: String,
    amount: f64,
) -> Result<InquiryResult, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;
    let client = mitra.lock().await;
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

    Ok(InquiryResult {
        inquiry_id: extract_string(data, &["inquiry_id", "id"]),
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

#[tauri::command]
pub async fn ppob_pdam_inquiry(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    customer_id: String,
    product_id: i64,
    payment_code: String,
) -> Result<InquiryResult, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;
    let client = mitra.lock().await;
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

    Ok(InquiryResult {
        inquiry_id: extract_string(&result, &["inquiry_id", "id"]),
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

#[tauri::command]
pub async fn ppob_bpjs_inquiry(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    customer_id: String,
    phone_number: String,
    payment_code: String,
    bpjs_type: String,
    period: String,
) -> Result<InquiryResult, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let fallback_phone_number = store_info::Entity::find_by_id(1_i64)
        .one(db.inner())
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

    let client = mitra.lock().await;
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
        Err(AppError::Internal(message))
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
    let amount = extract_f64(data, &["amount", "tagihan", "premi", "Amount", "Total Tagihan"]);
    let admin_fee =
        extract_f64(&result, &["total_fee", "fee", "admin_fee", "admin"]).max(extract_f64(
            data,
            &["Fee", "fee", "admin_fee", "admin"],
        ));
    let total = extract_f64(&result, &["total", "total_amount"])
        .max(extract_f64(data, &["Total", "total", "total_amount"]))
        .max(amount + admin_fee);
    let customer_name = extract_optional_string(data, &["nama_pelanggan", "customer_name"])
        .or_else(|| extract_bpjs_primary_name(data_book, &customer_id))
        .or_else(|| extract_bpjs_data_book_value(data_book, "Nama Peserta"));
    let inquiry_id = {
        let value = extract_string(data, &["inquiry_id", "id"]);
        if value.is_empty() {
            extract_string(&result, &["inquiry_id", "id"])
        } else {
            value
        }
    };

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

#[tauri::command]
pub async fn ppob_pp_inquiry(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    customer_id: String,
    payment_point_group_id: i64,
    product_code: Option<String>,
) -> Result<InquiryResult, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;
    let client = mitra.lock().await;

    let mut body = json!({
        "customer_id": customer_id,
        "payment_point_group_id": payment_point_group_id,
    });
    if let Some(pc) = &product_code {
        body["product_code"] = json!(pc);
    }

    let result = client.post("pp/inquiry", body).await?;

    let amount = extract_f64(&result, &["amount", "tagihan"]);

    Ok(InquiryResult {
        inquiry_id: extract_string(&result, &["inquiry_id", "id"]),
        customer_name: extract_optional_string(&result, &["nama_pelanggan", "customer_name"]),
        customer_id: customer_id.clone(),
        product_name: extract_optional_string(&result, &["product_name", "description"]),
        amount,
        admin_fee: extract_f64(&result, &["admin_fee", "admin"]),
        total: extract_f64(&result, &["total"]).max(amount),
        service_type: "pp".to_string(),
        raw_data: result,
    })
}

#[tauri::command]
pub async fn ppob_transfer_inquiry(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    channel_id: String,
    nomor_rekening: String,
    amount: f64,
    channel_name: String,
    deskripsi: String,
    nama_pengirim: String,
    notelp_pengirim: String,
) -> Result<InquiryResult, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;
    let client = mitra.lock().await;
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

    Ok(InquiryResult {
        inquiry_id: extract_string(&result, &["inquiry_id", "id"]),
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

#[tauri::command]
pub async fn ppob_emoney_inquiry(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    customer_id: String,
    product_code: String,
) -> Result<InquiryResult, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;
    let client = mitra.lock().await;
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

    Ok(InquiryResult {
        inquiry_id: extract_string(&result, &["inquiry_id", "id"]),
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

#[tauri::command]
pub async fn ppob_pulsa_purchase(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    phone_number: String,
    product_code: String,
    product_id: i64,
    product_type: String,
) -> Result<PaymentResult, AppError> {
    execute_fulfillment_request(
        db.inner(),
        mitra.inner(),
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
        },
    )
    .await
}
