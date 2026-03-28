use sea_orm::DatabaseConnection;
use serde_json::json;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use super::auth::get_mitra_client;
use super::client::MitraClient;
use super::models::{HistoryDetailItem, HistoryPaymentItem};
use super::parsers::{get_num_field, get_str_field};
use crate::utils::AppError;

#[tauri::command]
pub async fn ppob_get_history(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    start_date: String,
    end_date: String,
) -> Result<Vec<HistoryPaymentItem>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client
        .post(
            "history-payment",
            json!({
                "start_date": start_date,
                "end_date": end_date
            }),
        )
        .await?;

    // Response key might be "history", "data", "list", or similar
    let items_value = result
        .get("history")
        .or_else(|| result.get("data"))
        .or_else(|| result.get("list"))
        .or_else(|| result.get("payments"))
        .or_else(|| {
            result
                .as_object()
                .and_then(|obj| obj.values().find(|v| v.is_array()))
        });

    let items: Vec<HistoryPaymentItem> = match items_value {
        Some(val) => val
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let obj = item.as_object()?;
                        Some(HistoryPaymentItem {
                            trx_id: get_str_field(
                                obj,
                                &["trxid", "trx_id", "trxId", "id", "transaction_id"],
                            ),
                            inquiry_id: get_str_field(
                                obj,
                                &["inquiry_id", "inquiryId", "ref_id", "advice_id"],
                            ),
                            product_name: get_str_field(
                                obj,
                                &["product_name", "productName", "nama_produk", "produk"],
                            ),
                            description: get_str_field(
                                obj,
                                &[
                                    "plu_desc",
                                    "description",
                                    "desc",
                                    "deskripsi",
                                    "keterangan",
                                    "igr_desc",
                                    "target",
                                    "tujuan",
                                    "customer_no",
                                    "nomor",
                                ],
                            ),
                            serial_number: get_str_field(
                                obj,
                                &[
                                    "token_number",
                                    "serial_number",
                                    "serialNumber",
                                    "no_seri",
                                    "sn",
                                    "token",
                                    "phone_number",
                                ],
                            ),
                            total: get_num_field(
                                obj,
                                &["total", "harga_jual", "sell_price", "price"],
                            ),
                            amount: get_num_field(obj, &["amount", "nominal", "denom_value"]),
                            admin_fee: get_num_field(
                                obj,
                                &["amount_fee", "admin_fee", "adminFee", "fee", "biaya_admin"],
                            ),
                            status: get_str_field(
                                obj,
                                &["status", "trx_status", "transaction_status"],
                            ),
                            created_at: get_str_field(
                                obj,
                                &[
                                    "created_at",
                                    "createdAt",
                                    "trx_date",
                                    "tanggal",
                                    "date",
                                    "datetime",
                                    "formatted_date",
                                ],
                            ),
                            vendor_price: get_num_field(
                                obj,
                                &["vendor_price", "vendorPrice", "harga_vendor"],
                            ),
                            base_price: get_num_field(
                                obj,
                                &[
                                    "amount_base_price",
                                    "base_price",
                                    "basePrice",
                                    "harga_modal",
                                    "harga_beli",
                                    "buy_price",
                                ],
                            ),
                            sell_price: get_num_field(
                                obj,
                                &["sell_price", "sellPrice", "harga_jual"],
                            ),
                            profit: get_num_field(obj, &["profit", "keuntungan", "laba"]),
                            margin: get_num_field(obj, &["margin"]),
                            denom: get_str_field(obj, &["denom", "denomination"]),
                            provider: get_str_field(obj, &["provider", "operator"]),
                            merchant: get_str_field(obj, &["merchant", "biller"]),
                            plu: get_str_field(obj, &["plu", "product_code", "kode_produk"]),
                            service_type: get_str_field(
                                obj,
                                &[
                                    "type",
                                    "service_type",
                                    "serviceType",
                                    "tipe",
                                    "kategori",
                                    "category",
                                ],
                            ),
                            customer_no: get_str_field(
                                obj,
                                &[
                                    "raw_paymentcode",
                                    "customer_no",
                                    "customerNo",
                                    "phone_number",
                                    "nomor",
                                    "no_hp",
                                    "id_pel",
                                    "meter_no",
                                ],
                            ),
                            token_number: get_str_field(obj, &["token_number", "phone_number"]),
                            payment_code: get_str_field(obj, &["payment_code", "kode_bayar"]),
                            receipt_text: get_str_field(obj, &["receipt_text", "invoice_string"]),
                            invoice_url: get_str_field(obj, &["invoice_url"]),
                            igr_desc: get_str_field(obj, &["igr_desc"]),
                            no_ref: get_str_field(obj, &["no_ref", "ref", "reference"]),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default(),
        None => vec![],
    };

    Ok(items)
}

#[tauri::command]
pub async fn ppob_get_history_detail(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    trx_id: String,
) -> Result<HistoryDetailItem, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;

    // Try different parameter names — API might expect "id" or "trx_id"
    let params_attempts = vec![
        json!({"trx_id": trx_id}),
        json!({"id": trx_id}),
        json!({"trx_id": trx_id.parse::<i64>().unwrap_or(0)}),
        json!({"id": trx_id.parse::<i64>().unwrap_or(0)}),
    ];

    let mut last_result: Option<serde_json::Value> = None;

    for params in params_attempts {
        match client.post("history-payment/detail", params).await {
            Ok(result) => {
                // Check for API-level error inside OK response
                if result.get("errorCode").is_some() {
                    last_result = Some(result);
                    continue;
                }

                let detail_value = result
                    .get("history_payment")
                    .or_else(|| result.get("detail"))
                    .or_else(|| result.get("data"))
                    .or_else(|| result.get("transaction"))
                    .unwrap_or(&result);

                if detail_value.is_null() {
                    last_result = Some(result);
                    continue;
                }

                let obj = detail_value
                    .as_object()
                    .ok_or_else(|| AppError::Internal("Invalid detail response format".into()))?;

                return Ok(HistoryDetailItem {
                    trx_id: get_str_field(obj, &["trx_id", "trxId", "id", "transaction_id"]),
                    product_name: get_str_field(
                        obj,
                        &["product_name", "productName", "nama_produk", "produk"],
                    ),
                    description: get_str_field(
                        obj,
                        &["description", "desc", "deskripsi", "keterangan"],
                    ),
                    serial_number: get_str_field(
                        obj,
                        &["serial_number", "serialNumber", "no_seri", "sn", "token"],
                    ),
                    total: get_num_field(obj, &["total", "harga_jual", "price"]),
                    amount: get_num_field(obj, &["amount", "nominal", "denom_value"]),
                    admin_fee: get_num_field(obj, &["admin_fee", "adminFee", "fee", "biaya_admin"]),
                    status: get_str_field(obj, &["status", "trx_status"]),
                    created_at: get_str_field(
                        obj,
                        &["created_at", "createdAt", "trx_date", "tanggal", "date"],
                    ),
                    customer_no: get_str_field(
                        obj,
                        &[
                            "customer_no",
                            "customerNo",
                            "nomor",
                            "no_hp",
                            "phone",
                            "target",
                            "tujuan",
                            "meter_no",
                            "id_pel",
                        ],
                    ),
                    customer_name: get_str_field(
                        obj,
                        &["customer_name", "customerName", "nama_pelanggan", "nama"],
                    ),
                    reference: get_str_field(
                        obj,
                        &["reference", "ref", "referensi", "inquiry_id", "ref_id"],
                    ),
                    payment_code: get_str_field(
                        obj,
                        &["payment_code", "kode_bayar", "kode_transaksi"],
                    ),
                    service_type: get_str_field(
                        obj,
                        &[
                            "service_type",
                            "serviceType",
                            "type",
                            "tipe",
                            "jenis_layanan",
                        ],
                    ),
                    provider: get_str_field(obj, &["provider", "operator"]),
                    denom: get_str_field(obj, &["denom", "denomination"]),
                    sell_price: get_num_field(obj, &["sell_price", "sellPrice", "harga_jual"]),
                    base_price: get_num_field(obj, &["base_price", "basePrice", "harga_modal"]),
                    profit: get_num_field(obj, &["profit", "keuntungan", "laba"]),
                });
            }
            Err(_) => {
                continue;
            }
        }
    }

    let err_msg = last_result
        .and_then(|r| {
            r.get("errorMessage")
                .and_then(|v| v.as_str())
                .map(String::from)
        })
        .unwrap_or_else(|| "Gagal memuat detail transaksi".into());
    Err(AppError::Internal(err_msg))
}
