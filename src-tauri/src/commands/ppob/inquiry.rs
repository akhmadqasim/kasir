use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::domain::ppob::{InquiryResult, PaymentResult};
use crate::services;
use crate::services::ppob::client::MitraClient;
use crate::services::ppob::inquiry::{BpjsInquiryInput, TransferInquiryInput};
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
    services::ppob::inquiry::pln(
        db.inner(),
        mitra.inner(),
        customer_id,
        payment_code,
        flag_id,
        amount,
    )
    .await
}

#[tauri::command]
pub async fn ppob_pdam_inquiry(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    customer_id: String,
    product_id: i64,
    payment_code: String,
) -> Result<InquiryResult, AppError> {
    services::ppob::inquiry::pdam(
        db.inner(),
        mitra.inner(),
        customer_id,
        product_id,
        payment_code,
    )
    .await
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
    services::ppob::inquiry::bpjs(
        db.inner(),
        mitra.inner(),
        BpjsInquiryInput {
            customer_id,
            phone_number,
            payment_code,
            bpjs_type,
            period,
        },
    )
    .await
}

#[tauri::command]
pub async fn ppob_pp_inquiry(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    customer_id: String,
    payment_point_group_id: i64,
    product_code: Option<String>,
) -> Result<InquiryResult, AppError> {
    services::ppob::inquiry::payment_point(
        db.inner(),
        mitra.inner(),
        customer_id,
        payment_point_group_id,
        product_code,
    )
    .await
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
    services::ppob::inquiry::transfer(
        db.inner(),
        mitra.inner(),
        TransferInquiryInput {
            channel_id,
            nomor_rekening,
            amount,
            channel_name,
            deskripsi,
            nama_pengirim,
            notelp_pengirim,
        },
    )
    .await
}

#[tauri::command]
pub async fn ppob_emoney_inquiry(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    customer_id: String,
    product_code: String,
) -> Result<InquiryResult, AppError> {
    services::ppob::inquiry::emoney(db.inner(), mitra.inner(), customer_id, product_code).await
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
    services::ppob::inquiry::pulsa_purchase(
        db.inner(),
        mitra.inner(),
        phone_number,
        product_code,
        product_id,
        product_type,
    )
    .await
}
