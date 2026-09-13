use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::domain::ppob::{HistoryPaymentItem, MutasiItem};
use crate::services::ppob::auth::get_mitra_request_context;
use crate::services::ppob::client::MitraClient;
use crate::services::ppob::parsers::{get_num_field, get_str_field};
use crate::utils::AppError;

/// The array of rows in a history response. Mitra has not been consistent
/// about the key, so the first array under any of the known names wins, and
/// failing those the first array anywhere at the top level.
fn history_rows(result: &Value) -> Vec<&serde_json::Map<String, Value>> {
    result
        .get("history")
        .or_else(|| result.get("data"))
        .or_else(|| result.get("list"))
        .or_else(|| result.get("payments"))
        .or_else(|| {
            result
                .as_object()
                .and_then(|obj| obj.values().find(|v| v.is_array()))
        })
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter_map(Value::as_object).collect())
        .unwrap_or_default()
}

/// One row of `history-payment`, read with every spelling Mitra has used.
fn parse_history_item(obj: &serde_json::Map<String, Value>) -> HistoryPaymentItem {
    HistoryPaymentItem {
        trx_id: get_str_field(obj, &["trxid", "trx_id", "trxId", "id", "transaction_id"]),
        inquiry_id: get_str_field(obj, &["inquiry_id", "inquiryId", "ref_id", "advice_id"]),
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
        total: get_num_field(obj, &["total", "harga_jual", "sell_price", "price"]),
        amount: get_num_field(obj, &["amount", "nominal", "denom_value"]),
        admin_fee: get_num_field(
            obj,
            &["amount_fee", "admin_fee", "adminFee", "fee", "biaya_admin"],
        ),
        status: get_str_field(obj, &["status", "trx_status", "transaction_status"]),
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
        vendor_price: get_num_field(obj, &["vendor_price", "vendorPrice", "harga_vendor"]),
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
        sell_price: get_num_field(obj, &["sell_price", "sellPrice", "harga_jual"]),
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
    }
}

pub async fn list(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    start_date: String,
    end_date: String,
) -> Result<Vec<HistoryPaymentItem>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post(
            "history-payment",
            json!({
                "start_date": start_date,
                "end_date": end_date
            }),
        )
        .await?;

    let items: Vec<HistoryPaymentItem> = history_rows(&result)
        .into_iter()
        .map(parse_history_item)
        .collect();

    // The table the cashier is looking at is where the next print comes
    // from; remembering its settled rows now saves [`detail`] a second fetch
    // of the same list a moment later. A transaction still in flight may
    // change its mind, so only a settled one is worth remembering.
    items
        .iter()
        .filter(|item| is_success(item))
        .for_each(remember_detail);

    Ok(items)
}

/// How far back [`detail`] looks for a transaction.
///
/// Ninety days covers every struk a customer plausibly comes back for; the
/// reprint of a bill paid last quarter is not a case worth a heavier query.
const DETAIL_LOOKBACK_DAYS: i64 = 90;

/// How long a transaction found by [`detail`] is remembered.
///
/// The struk preview asks for the same transaction once per edit of the sell
/// price, and each answer would otherwise be a full history fetch upstream.
const DETAIL_CACHE_TTL: Duration = Duration::from_secs(300);

type DetailCache = HashMap<String, (Instant, HistoryPaymentItem)>;

static DETAIL_CACHE: LazyLock<std::sync::Mutex<DetailCache>> =
    LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

fn is_fresh(fetched_at: &Instant) -> bool {
    fetched_at.elapsed() < DETAIL_CACHE_TTL
}

fn cached_detail(trx_id: &str) -> Option<HistoryPaymentItem> {
    let cache = DETAIL_CACHE.lock().ok()?;
    cache
        .get(trx_id)
        .filter(|(fetched_at, _)| is_fresh(fetched_at))
        .map(|(_, item)| item.clone())
}

fn remember_detail(item: &HistoryPaymentItem) {
    let Some(trx_id) = item.trx_id.clone() else {
        return;
    };
    if let Ok(mut cache) = DETAIL_CACHE.lock() {
        cache.retain(|_, (fetched_at, _)| is_fresh(fetched_at));
        cache.insert(trx_id, (Instant::now(), item.clone()));
    }
}

/// Mitra's own words for a transaction that went through — the same set the
/// history table's `normalizeStatus` reads as `sukses`, so a row offered a
/// "Cetak Struk" button is one this side will print.
pub fn is_success(item: &HistoryPaymentItem) -> bool {
    item.status.as_deref().is_some_and(|status| {
        matches!(
            status.trim().to_lowercase().as_str(),
            "sukses" | "success" | "berhasil" | "done" | "completed"
        )
    })
}

/// One transaction, by Mitra's `trx_id`.
///
/// Read from the `history-payment` list rather than `history-payment/detail`.
/// The detail endpoint answers `{"message":"OK","errorCode":…,
/// "errorMessage":"Inputan tidak sesuai"}` on the live account for every
/// parameter shape tried — `trx_id` as the spec has it, `id`, both as strings
/// and as numbers — and the earlier reader turned that into a 500 four
/// upstream round-trips later. The list rows already carry everything the
/// detail was going to be read for, the provider's `receipt_text` included, so
/// the transaction is found there instead: one request over the last
/// [`DETAIL_LOOKBACK_DAYS`], and the answer is kept for [`DETAIL_CACHE_TTL`].
pub async fn detail(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    trx_id: String,
) -> Result<HistoryPaymentItem, AppError> {
    let trx_id = trx_id.trim().to_string();
    if trx_id.is_empty() {
        return Err(AppError::Validation("Nomor transaksi kosong".into()));
    }
    if let Some(item) = cached_detail(&trx_id) {
        return Ok(item);
    }

    // The vendor reports WIB and the shop runs an hour ahead of it, so the
    // window closes tomorrow rather than today: a bill paid just before
    // midnight WITA is still today in Jakarta.
    let today = chrono::Local::now().date_naive();
    let start = (today - chrono::Duration::days(DETAIL_LOOKBACK_DAYS))
        .format("%Y-%m-%d")
        .to_string();
    let end = (today + chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();

    // `list` remembers every settled row it saw, this one included.
    list(db, mitra, start, end)
        .await?
        .into_iter()
        .find(|item| item.trx_id.as_deref() == Some(trx_id.as_str()))
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "Transaksi {trx_id} tidak ditemukan di riwayat {DETAIL_LOOKBACK_DAYS} hari terakhir"
            ))
        })
}

pub async fn mutasi(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    start_date: String,
    end_date: String,
) -> Result<Vec<MutasiItem>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;

    // Fetch both payment history (out) and topup history (in) concurrently
    let payment_client = client.clone();
    let payment_future = payment_client.post(
        "history-payment",
        json!({ "start_date": &start_date, "end_date": &end_date }),
    );
    let topup_future = client.post("topup/history", json!({}));

    let (payment_result, topup_result) = tokio::join!(payment_future, topup_future);

    let mut items: Vec<MutasiItem> = Vec::new();

    // Parse payment history (saldo OUT)
    if let Ok(result) = payment_result {
        let arr = result
            .get("history")
            .or_else(|| result.get("data"))
            .or_else(|| result.get("list"))
            .or_else(|| {
                result
                    .as_object()
                    .and_then(|obj| obj.values().find(|v| v.is_array()))
            })
            .and_then(|v| v.as_array());

        if let Some(arr) = arr {
            for item in arr {
                if let Some(obj) = item.as_object() {
                    items.push(MutasiItem {
                        id: get_str_field(obj, &["trxid", "trx_id", "trxId", "id"]),
                        mutation_type: "out".to_string(),
                        description: get_str_field(
                            obj,
                            &[
                                "plu_desc",
                                "igr_desc",
                                "description",
                                "product_name",
                                "target",
                                "tujuan",
                            ],
                        ),
                        amount: get_num_field(obj, &["total", "sell_price", "amount", "price"]),
                        status: get_str_field(obj, &["status", "trx_status"]),
                        created_at: get_str_field(
                            obj,
                            &[
                                "created_at",
                                "createdAt",
                                "trx_date",
                                "date",
                                "formatted_date",
                            ],
                        ),
                        payment_method: get_str_field(obj, &["payment_method", "method"]),
                        reference: get_str_field(
                            obj,
                            &["no_ref", "ref", "reference", "trxid", "trx_id"],
                        ),
                        raw_data: item.clone(),
                    });
                }
            }
        }
    }

    // Parse topup history (saldo IN)
    if let Ok(result) = topup_result {
        let arr = result
            .get("history")
            .or_else(|| result.get("data"))
            .or_else(|| result.get("list"))
            .or_else(|| result.get("topup"))
            .or_else(|| {
                result
                    .as_object()
                    .and_then(|obj| obj.values().find(|v| v.is_array()))
            })
            .and_then(|v| v.as_array());

        if let Some(arr) = arr {
            for item in arr {
                if let Some(obj) = item.as_object() {
                    items.push(MutasiItem {
                        id: get_str_field(
                            obj,
                            &["id", "topup_id", "trx_id", "transaction_id", "payment_code"],
                        ),
                        mutation_type: "in".to_string(),
                        description: get_str_field(
                            obj,
                            &[
                                "description",
                                "desc",
                                "keterangan",
                                "channel",
                                "merchant",
                                "payment_method",
                                "bank",
                            ],
                        )
                        .or_else(|| Some("Topup Saldo".to_string())),
                        amount: get_num_field(
                            obj,
                            &["amount", "nominal", "total", "topup_amount", "value"],
                        ),
                        status: get_str_field(obj, &["status", "topup_status", "trx_status"]),
                        created_at: get_str_field(
                            obj,
                            &["created_at", "createdAt", "date", "topup_date", "datetime"],
                        ),
                        payment_method: get_str_field(
                            obj,
                            &[
                                "payment_method",
                                "channel",
                                "merchant",
                                "bank",
                                "method",
                                "via",
                            ],
                        ),
                        reference: get_str_field(
                            obj,
                            &[
                                "payment_code",
                                "reference",
                                "ref",
                                "no_ref",
                                "id",
                                "topup_id",
                            ],
                        ),
                        raw_data: item.clone(),
                    });
                }
            }
        }
    }

    // Sort by date descending (newest first)
    items.sort_by(|a, b| {
        let date_a = a.created_at.as_deref().unwrap_or("");
        let date_b = b.created_at.as_deref().unwrap_or("");
        date_b.cmp(date_a)
    });

    Ok(items)
}
