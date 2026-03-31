use sea_orm::DatabaseConnection;
use serde_json::json;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use super::auth::get_mitra_client;
use super::client::MitraClient;
use super::executor::{execute_fulfillment_request, PpobFulfillmentRequest};
use super::models::{InquiryResult, PaymentResult};
use super::parsers::{extract_f64, extract_optional_string, extract_string};
use crate::utils::AppError;

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
    let client = mitra.lock().await;
    let result = client
        .post(
            "bpjs/inquiry",
            json!({
                "customer_id": customer_id,
                "phone_number": phone_number,
                "payment_code": payment_code,
                "type": bpjs_type,
                "period": period,
            }),
        )
        .await?;

    let amount = extract_f64(&result, &["amount", "tagihan", "premi"]);

    Ok(InquiryResult {
        inquiry_id: extract_string(&result, &["inquiry_id", "id"]),
        customer_name: extract_optional_string(&result, &["nama_pelanggan", "customer_name"]),
        customer_id: customer_id.clone(),
        product_name: extract_optional_string(&result, &["product_name"]),
        amount,
        admin_fee: extract_f64(&result, &["admin_fee", "admin"]),
        total: extract_f64(&result, &["total"]).max(amount),
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
        },
    )
    .await
}
