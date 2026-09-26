use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use chrono::NaiveDate;
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::domain::ppob::{HistoryPaymentItem, MutasiItem};
use crate::services::ppob::auth::get_mitra_request_context;
use crate::services::ppob::client::MitraClient;
use crate::services::ppob::parsers::{get_num_field, get_str_field};
use crate::services::ppob::session_cache::{SessionCache, Ticket};
use crate::utils::AppError;

/// The keys `history-payment` has put its rows under.
const PAYMENT_ROW_KEYS: &[&str] = &["history", "data", "list", "payments"];

/// The keys `topup/history` has put its rows under.
const TOPUP_ROW_KEYS: &[&str] = &["history", "data", "list", "topup"];

/// The array of rows in a history response. Mitra has not been consistent
/// about the key, so the first of `keys` present wins, and failing those the
/// first array anywhere at the top level.
fn history_rows<'a>(result: &'a Value, keys: &[&str]) -> Vec<&'a serde_json::Map<String, Value>> {
    keys.iter()
        .find_map(|key| result.get(*key))
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
    // Taken before the first upstream request; see [`remember_details`].
    let ticket = DETAIL_CACHE.ticket();
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

    let items: Vec<HistoryPaymentItem> = history_rows(&result, PAYMENT_ROW_KEYS)
        .into_iter()
        .map(parse_history_item)
        .collect();

    // The table the cashier is looking at is where the next print comes
    // from; remembering its settled rows now saves [`detail`] a second fetch
    // of the same list a moment later. A transaction still in flight may
    // change its mind, so only a settled one is worth remembering.
    remember_details(ticket, &items);

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

static DETAIL_CACHE: LazyLock<SessionCache<DetailCache>> = LazyLock::new(SessionCache::new);

/// The generation a detail fetch starting now would belong to, for tests
/// outside this module that check a session reset moves it on.
#[cfg(test)]
pub(super) fn details_ticket() -> Ticket {
    DETAIL_CACHE.ticket()
}

fn is_fresh(fetched_at: &Instant) -> bool {
    fetched_at.elapsed() < DETAIL_CACHE_TTL
}

fn cached_detail(trx_id: &str) -> Option<HistoryPaymentItem> {
    DETAIL_CACHE
        .read(|cache| {
            cache
                .get(trx_id)
                .filter(|(fetched_at, _)| is_fresh(fetched_at))
                .map(|(_, item)| item.clone())
        })
        .flatten()
}

/// Drop every remembered row. Called when the Mitra session is cleared: the
/// cache is keyed by `trx_id` alone, and the next account must not be able
/// to print the last one's struk from it — nor from a history fetch that was
/// still in flight when the session ended.
pub fn forget_details() {
    DETAIL_CACHE.forget();
}

/// Remember the settled rows of a history fetch that started at `ticket`,
/// unless the session was forgotten since.
fn remember_details(ticket: Ticket, items: &[HistoryPaymentItem]) {
    DETAIL_CACHE.store(ticket, |cache| {
        cache.retain(|_, (fetched_at, _)| is_fresh(fetched_at));
        for item in items.iter().filter(|item| is_success(item)) {
            if let Some(trx_id) = item.trx_id.clone() {
                cache.insert(trx_id, (Instant::now(), item.clone()));
            }
        }
    });
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

/// The two upstream requests behind [`mutasi`], as `(path, body)`. The client
/// adds `device_id` to each.
struct MutasiRequests {
    payments: (&'static str, Value),
    topups: (&'static str, Value),
}

/// `history-payment` filters by date upstream. `topup/history` cannot: its
/// contract (`DeviceOnlyRequest` in the Mitra OpenAPI) takes nothing but a
/// `device_id` and answers with the account's whole topup history, so its
/// rows are narrowed by [`DayRange`] after they arrive.
fn mutasi_requests(start_date: &str, end_date: &str) -> MutasiRequests {
    MutasiRequests {
        payments: (
            "history-payment",
            json!({ "start_date": start_date, "end_date": end_date }),
        ),
        topups: ("topup/history", json!({})),
    }
}

/// An inclusive range of calendar days, compared against the day a vendor
/// timestamp is written in — the same reading the mutasi screen gives it.
#[derive(Debug, Clone, Copy)]
struct DayRange {
    start: NaiveDate,
    end: NaiveDate,
}

impl DayRange {
    /// `None` when either bound is not a `YYYY-MM-DD` date: with no range to
    /// apply, nothing is filtered.
    fn parse(start_date: &str, end_date: &str) -> Option<Self> {
        let start = NaiveDate::parse_from_str(start_date.trim(), "%Y-%m-%d").ok()?;
        let end = NaiveDate::parse_from_str(end_date.trim(), "%Y-%m-%d").ok()?;
        Some(Self { start, end })
    }

    /// A row whose date cannot be read is kept: it cannot be placed outside
    /// the range, and dropping it would drop money off the screen unseen.
    fn keeps(&self, created_at: Option<&str>) -> bool {
        created_at
            .and_then(vendor_day)
            .is_none_or(|day| self.start <= day && day <= self.end)
    }
}

/// The calendar day a vendor timestamp starts with: `DD-MM-YYYY` or
/// `DD/MM/YYYY` (the Mitra app's own) or `YYYY-MM-DD` (ISO), each optionally
/// followed by a time.
fn vendor_day(value: &str) -> Option<NaiveDate> {
    let date = value.trim().split([' ', 'T']).next()?;
    let parts: Vec<&str> = date.split(['-', '/']).collect();
    let [a, b, c] = parts.as_slice() else {
        return None;
    };
    let number = |part: &str| part.parse::<u32>().ok();
    let (year, month, day) = if a.len() == 4 {
        (number(a)?, number(b)?, number(c)?)
    } else if c.len() == 4 {
        (number(c)?, number(b)?, number(a)?)
    } else {
        return None;
    };
    NaiveDate::from_ymd_opt(i32::try_from(year).ok()?, month, day)
}

/// Saldo movements over a date range: payments out of `history-payment`,
/// topups in from `topup/history`.
///
/// Either request failing fails the whole answer. Showing only the half that
/// came back would read as "no topups this week" (or no mutations at all)
/// rather than as Mitra being unreachable, and the balance would not add up.
pub async fn mutasi(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    start_date: String,
    end_date: String,
) -> Result<Vec<MutasiItem>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let requests = mutasi_requests(&start_date, &end_date);

    // Fetch both payment history (out) and topup history (in) concurrently
    let (payment_result, topup_result) = tokio::join!(
        client.post(requests.payments.0, requests.payments.1),
        client.post(requests.topups.0, requests.topups.1),
    );
    let payment_result = payment_result?;
    let topup_result = topup_result?;

    let mut items: Vec<MutasiItem> = Vec::new();

    // Parse payment history (saldo OUT)
    for obj in history_rows(&payment_result, PAYMENT_ROW_KEYS) {
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
            reference: get_str_field(obj, &["no_ref", "ref", "reference", "trxid", "trx_id"]),
            raw_data: Value::Object(obj.clone()),
        });
    }

    // Parse topup history (saldo IN). The vendor sent every topup the account
    // ever had, so the range is applied here.
    let range = DayRange::parse(&start_date, &end_date);
    for obj in history_rows(&topup_result, TOPUP_ROW_KEYS) {
        let item = MutasiItem {
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
            raw_data: Value::Object(obj.clone()),
        };
        if range.is_none_or(|range| range.keeps(item.created_at.as_deref())) {
            items.push(item);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutasi_requests_send_the_range_to_payments_and_nothing_to_topups() {
        let requests = mutasi_requests("2026-09-05", "2026-09-12");

        assert_eq!(requests.payments.0, "history-payment");
        assert_eq!(
            requests.payments.1,
            json!({ "start_date": "2026-09-05", "end_date": "2026-09-12" })
        );
        // `DeviceOnlyRequest`: the client adds `device_id`, and a date field
        // here would be ignored upstream, not honoured.
        assert_eq!(requests.topups.0, "topup/history");
        assert_eq!(requests.topups.1, json!({}));
    }

    #[test]
    fn day_range_keeps_topups_inside_the_range_and_undated_ones() {
        let range = DayRange::parse("2026-09-05", "2026-09-12").unwrap();

        assert!(range.keeps(Some("2026-09-05 00:00:01")));
        assert!(range.keeps(Some("12-09-2026 23:59")));
        assert!(range.keeps(Some("2026-09-10T08:00:00Z")));
        assert!(range.keeps(Some("10/09/2026")));
        assert!(!range.keeps(Some("2026-09-04 23:59:59")));
        assert!(!range.keeps(Some("13-09-2026 00:00")));
        assert!(!range.keeps(Some("2025-09-10")));
        // Unreadable dates stay visible rather than vanish.
        assert!(range.keeps(Some("bukan tanggal")));
        assert!(range.keeps(None));
    }

    fn settled(trx_id: &str) -> HistoryPaymentItem {
        parse_history_item(
            json!({ "trxid": trx_id, "status": "SUKSES" })
                .as_object()
                .unwrap(),
        )
    }

    /// A history fetch that was in flight when the session ended holds the
    /// previous account's transactions; they must not become printable.
    #[test]
    fn details_fetched_across_a_forget_are_not_remembered() {
        let ticket = DETAIL_CACHE.ticket();
        forget_details();
        remember_details(ticket, &[settled("TRX-AKUN-LAMA")]);

        assert!(cached_detail("TRX-AKUN-LAMA").is_none());
    }

    #[test]
    fn day_range_is_absent_without_two_readable_bounds() {
        assert!(DayRange::parse("", "2026-09-12").is_none());
        assert!(DayRange::parse("2026-09-05", "kemarin").is_none());
    }
}
