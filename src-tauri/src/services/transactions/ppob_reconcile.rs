//! Settling `uncertain` PPOB lines from the Mitra payment history.
//!
//! A line is `uncertain` when Mitra answered a payment with `ADVICE` (the
//! biller has it, the result is not known yet) or when no usable answer came
//! back at all. Mitra's own app no longer has `pln/advice`, so the only place
//! the final result shows up is `history-payment`. This module reads it and
//! settles a line only on a confident match. Every match starts from the line's
//! *last attempt* (`ppob_last_attempt_at`, else `created_at`; migration 032):
//! a history row stamped before it belongs to an earlier attempt and is never
//! looked at.
//!
//! 1. **ADVICE reference (best effort).** A row whose `advice_id` equals the
//!    one Mitra gave us with the ADVICE answer, for the same customer. These
//!    are Laravel `encrypt()` strings with a random IV, so a row probably never
//!    repeats it; the match is kept in case Mitra stores it verbatim. A row
//!    still pending here falls through to the matches below.
//! 2. **Payment code.** Mitra's `payment_code` is
//!    `L{customer}-{1|2}-{yymmddHHMMSS}`: the customer, prepaid/postpaid for
//!    PLN, and when Mitra took the payment. A row whose code names our customer
//!    within a few minutes of our attempt, for the same service/product, and
//!    that no other line of ours could own.
//! 3. **Amount and time (fallback).** A row without a readable payment code
//!    that names the customer, at an amount the line was sold or bought for,
//!    within a window after the attempt — only when it is the single such row
//!    and no other line of ours could own it.
//!
//! A history row settles at most one line: the matched `trx_id` is stored on
//! the line (`ppob_history_trx_id`, unique) and a row another line holds is
//! skipped. A `sukses` row settles the line `success` and keeps the row as the
//! line's struk data. A `gagal` row settles it `failed` only through the ADVICE
//! reference: "failed" unlocks a second payment and a refund, so a gagal row
//! found any other way is reported, and a person decides. Anything else — no
//! row, two rows, a row still pending — leaves the line `uncertain`.
//!
//! The background loop checks only lines younger than
//! [`AUTO_CHECK_MAX_AGE_DAYS`], backs off while nothing settles, runs only when
//! PPOB is set up with a session it can reuse, and never logs in with the
//! password (see [`LoginPolicy::StoredSessionOnly`]).

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, LazyLock};
use std::time::Instant;

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait,
    QueryFilter, Statement, TransactionTrait,
};
use serde::Serialize;
use serde_json::{Map, Value};
use tokio::sync::Mutex;

use super::ppob_fulfillment::store_ppob_receipt;
use super::ppob_recovery::last_attempt_at;
use super::{PPOB_STATUS_FAILED, PPOB_STATUS_SUCCESS, PPOB_STATUS_UNCERTAIN};
use crate::domain::ppob::HistoryPaymentItem;
use crate::entity::{ppob_receipts, transaction_items};
use crate::services::ppob::auth::{has_reusable_session, LoginPolicy};
use crate::services::ppob::history::{
    self, classify_status_word, history_receipt_blob, parse_history_item, vendor_day, PaymentCode,
    StatusWord,
};
use crate::services::ppob::parsers::{parse_number, parse_string};
use crate::services::ppob::MitraClient;
use crate::utils::logging;
use crate::utils::time::{format_ts, utc_to_wib, wib_to_utc};
use crate::utils::AppError;

/// One row of `history-payment`, every field Mitra sent.
pub(crate) type HistoryRow = Map<String, Value>;

/// How far before our attempt a history row may be stamped and still count:
/// the two clocks are not ours to align. Anything older is an earlier attempt.
const CLOCK_SKEW_MINUTES: i64 = 10;

/// How far after our attempt the fallback match accepts a row: an ADVICE
/// settles minutes to hours later, and the row may carry the settling time.
const WINDOW_AFTER_HOURS: i64 = 48;

/// How far after our attempt a payment code may be stamped: Mitra stamps it
/// when it takes the payment, seconds after our request went out.
const CODE_WINDOW_AFTER_MINUTES: i64 = 20;

/// Lines whose last attempt is older than this are not checked automatically;
/// "Cek status" sends them to the Mitra app instead.
pub const AUTO_CHECK_MAX_AGE_DAYS: i64 = 7;

/// How far back `history-payment` reaches at all.
const HISTORY_HORIZON_DAYS: i64 = 90;

/// A customer reference shorter than this could match unrelated numbers.
const MIN_REF_LEN: usize = 5;

/// Amounts closer than this are the same rupiah figure.
const AMOUNT_TOLERANCE: f64 = 1.0;

/// How long "Cek status" on one line answers from what is stored instead of
/// asking Mitra again.
const CHECK_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(45);

/// Where a check came from, for the line's message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CheckOrigin {
    /// The background loop.
    Auto,
    /// Someone clicked "Cek status".
    Manual,
}

impl CheckOrigin {
    fn note(self) -> &'static str {
        match self {
            Self::Auto => "dicek otomatis",
            Self::Manual => "dicek lewat tombol Cek status",
        }
    }
}

/// What the history says about one uncertain line.
#[derive(Debug)]
enum Verdict<'a> {
    Success(&'a Row<'a>),
    Failed(&'a Row<'a>),
    /// Not settled; the message is for the cashier.
    Unknown(String),
}

fn not_yet(reason: &str) -> Verdict<'static> {
    Verdict::Unknown(format!(
        "Belum ada hasil pasti: {reason}. Coba cek lagi nanti."
    ))
}

const AMBIGUOUS: &str = "lebih dari satu transaksi cocok di riwayat Mitra";
const CONTESTED: &str = "ada PPOB lain ke nomor yang sama di waktu yang berdekatan";

/// What a check did to one line, for the route and the log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PpobCheckResult {
    /// The line's status after the check: `success`, `failed` or `uncertain`
    /// (or `pending`/`processing` for a line that is not waiting on a check).
    pub status: String,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Reading a history row
// ---------------------------------------------------------------------------

/// The keys a history row has carried a rupiah figure under. Which one means
/// the bill and which the total differs per endpoint, so any of them counts.
const ROW_AMOUNT_KEYS: &[&str] = &[
    "amount",
    "total",
    "sell_price",
    "base_price",
    "amount_base_price",
    "price",
    "harga_jual",
    "nominal",
];

/// The keys a settled row carries its token or serial under, best first. Kept
/// apart from the parsed item's list: a placeholder under one key must not
/// hide a real value under the next.
const ROW_SERIAL_KEYS: &[&str] = &["token_number", "serial_number", "sn", "token", "no_seri"];

/// A row's own time: to the second when it can be read so, else the day.
#[derive(Debug, Clone, Copy, PartialEq)]
enum RowTime {
    Exact(DateTime<Utc>),
    Day(NaiveDate),
}

/// A string or number as trimmed text; `None` when blank.
fn text(value: Option<&Value>) -> Option<String> {
    parse_string(value)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn wib_day(at: DateTime<Utc>) -> NaiveDate {
    utc_to_wib(at).date_naive()
}

/// A vendor timestamp read as UTC. RFC 3339 carries its own zone; a bare
/// date-time is WIB, like everything else Mitra sends.
fn parse_vendor_time(text: &str) -> Option<DateTime<Utc>> {
    let text = text.trim();
    if let Ok(at) = DateTime::parse_from_rfc3339(text) {
        return Some(at.with_timezone(&Utc));
    }
    const FORMATS: &[&str] = &[
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
    ];
    FORMATS.iter().find_map(|format| {
        NaiveDateTime::parse_from_str(text, format)
            .ok()
            .map(wib_to_utc)
    })
}

fn row_time(text: &str) -> Option<RowTime> {
    parse_vendor_time(text)
        .map(RowTime::Exact)
        .or_else(|| vendor_day(text).map(RowTime::Day))
}

/// One history row, read once per fetch: the raw row (kept as the struk data
/// of a line it settles), the parsed item and the fields the matcher reads.
#[derive(Debug)]
pub(crate) struct Row<'a> {
    raw: &'a HistoryRow,
    item: HistoryPaymentItem,
    /// Mitra's own id for the row — what a settled line keeps, so no other
    /// line can be settled from the same row.
    trx_id: Option<String>,
    advice_id: Option<String>,
    payment_code: Option<PaymentCode>,
    time: Option<RowTime>,
    /// Every positive rupiah figure on the row.
    amounts: Vec<f64>,
    /// Every field as text, for the customer search.
    texts: Vec<String>,
}

impl<'a> Row<'a> {
    pub(crate) fn new(raw: &'a HistoryRow) -> Self {
        let item = parse_history_item(raw);
        Self {
            trx_id: item
                .trx_id
                .as_deref()
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string),
            advice_id: text(raw.get("advice_id")),
            payment_code: item.payment_code.as_deref().and_then(PaymentCode::parse),
            time: item.created_at.as_deref().and_then(row_time),
            amounts: ROW_AMOUNT_KEYS
                .iter()
                .filter_map(|key| parse_number(raw.get(*key)))
                .filter(|amount| *amount > 0.0)
                .collect(),
            texts: raw.values().filter_map(|value| text(Some(value))).collect(),
            raw,
            item,
        }
    }

    /// The token or serial the row carries, if it is a real one. Mitra puts
    /// placeholders (`""`, `"-"`, `"0"`) where a service has none.
    fn serial(&self) -> Option<String> {
        ROW_SERIAL_KEYS
            .iter()
            .filter_map(|key| text(self.raw.get(*key)))
            .find(|value| !matches!(value.as_str(), "-" | "0"))
    }

    fn label(&self) -> String {
        self.trx_id
            .as_ref()
            .map(|id| format!(" (trx {id})"))
            .unwrap_or_default()
    }
}

/// `needle` inside `haystack` as a whole number: not part of a longer run of
/// digits or letters. `14307194556` is in `NO METER : 14307194556`, not in
/// `9914307194556` — nor in `L14307194556-1-…`, which is why the payment code
/// is taken apart by [`PaymentCode::parse`] instead.
fn contains_whole(haystack: &str, needle: &str) -> bool {
    haystack.match_indices(needle).any(|(start, _)| {
        let before = haystack[..start].chars().next_back();
        let after = haystack[start + needle.len()..].chars().next();
        !before.is_some_and(|c| c.is_ascii_alphanumeric())
            && !after.is_some_and(|c| c.is_ascii_alphanumeric())
    })
}

/// Whether any field of the row names the customer, in any of `spellings`.
/// Every field, not a list of keys: the customer number has turned up as
/// `raw_paymentcode`, `customer_no`, inside `plu_desc` and inside
/// `receipt_text`.
fn row_names_customer(row: &Row, spellings: &[String]) -> bool {
    row.texts.iter().any(|text| {
        spellings
            .iter()
            .any(|spelling| contains_whole(text, spelling))
    })
}

/// [`history::service_key`], with pulsa and paket data as one family: the
/// history may file either under the other. `None` for a name we have not
/// seen, which then decides nothing.
fn service_family(raw: &str) -> Option<&'static str> {
    history::service_key(raw).map(|key| if key == "data" { "pulsa" } else { key })
}

/// A product code that is a Mitra PLU (all digits, long enough), the only
/// kind that can be compared with a row's `plu`. Our `ppob_product_code` holds
/// a denomination or a BPJS type for some services instead.
fn as_plu(code: Option<&str>) -> Option<&str> {
    code.map(str::trim)
        .filter(|code| code.len() >= 6 && code.bytes().all(|b| b.is_ascii_digit()))
}

/// The row is for the line's service and product, as far as both say: a
/// field only one side has decides nothing.
fn product_matches(item: &transaction_items::Model, row: &Row) -> bool {
    let ours = item.service_type.as_deref().and_then(service_family);
    let theirs = row.item.service_type.as_deref().and_then(service_family);
    if let (Some(ours), Some(theirs)) = (ours, theirs) {
        if ours != theirs {
            return false;
        }
    }
    match (
        as_plu(item.ppob_product_code.as_deref()),
        as_plu(row.item.plu.as_deref()),
    ) {
        (Some(ours), Some(theirs)) => ours == theirs,
        _ => true,
    }
}

// ---------------------------------------------------------------------------
// Reading our line
// ---------------------------------------------------------------------------

/// Services whose customer reference is a phone number, which Mitra may write
/// `62…` where the cashier typed `08…`.
fn is_phone_service(item: &transaction_items::Model) -> bool {
    matches!(
        item.service_type.as_deref(),
        Some("pulsa" | "data" | "emoney")
    )
}

/// A reference with everything but letters and digits removed; for a phone
/// number, `62…` written as `0…`.
fn canonical_ref(raw: &str, phone: bool) -> String {
    let compact: String = raw.chars().filter(char::is_ascii_alphanumeric).collect();
    if phone {
        if let Some(rest) = compact.strip_prefix("62") {
            if rest.starts_with('8') {
                return format!("0{rest}");
            }
        }
    }
    compact
}

/// The line's customer reference, canonical, if it is long enough to be told
/// apart from other numbers.
fn customer_ref(item: &transaction_items::Model) -> Option<String> {
    let reference = canonical_ref(item.service_ref.as_deref()?, is_phone_service(item));
    (reference.len() >= MIN_REF_LEN).then_some(reference)
}

/// Every way a row may write the customer: `08…` and `628…` for a phone.
fn customer_spellings(item: &transaction_items::Model, customer: &str) -> Vec<String> {
    let mut spellings = vec![customer.to_string()];
    if is_phone_service(item) {
        if let Some(rest) = customer.strip_prefix('0') {
            spellings.push(format!("62{rest}"));
        }
    }
    spellings
}

/// Mitra's `advice_id` kept from an ADVICE answer. `uid` is not used: it may
/// be the same on every row of the account.
fn advice_id(item: &transaction_items::Model) -> Option<String> {
    let advice = serde_json::from_str::<Value>(item.ppob_advice.as_deref()?).ok()?;
    text(advice.get("advice_id"))
}

/// PLN's payment-code kind for the line: `1` prepaid, `2` postpaid.
fn pln_kind(item: &transaction_items::Model) -> Option<&'static str> {
    if item.service_type.as_deref() != Some("pln") {
        return None;
    }
    match item.ppob_flag_id.as_deref().map(str::trim) {
        Some("0") => Some("1"),
        Some("1") => Some("2"),
        _ => None,
    }
}

fn amount_matches(item: &transaction_items::Model, row: &Row) -> bool {
    let ours: Vec<f64> = [item.buy_price, Some(item.product_price)]
        .into_iter()
        .flatten()
        .filter(|amount| *amount > 0.0)
        .collect();
    row.amounts.iter().any(|theirs| {
        ours.iter()
            .any(|our| (our - theirs).abs() < AMOUNT_TOLERANCE)
    })
}

/// The row is from before the attempt (beyond clock skew): an earlier attempt's.
fn row_predates(anchor: DateTime<Utc>, row: &Row) -> bool {
    let floor = anchor - Duration::minutes(CLOCK_SKEW_MINUTES);
    match row.time {
        Some(RowTime::Exact(at)) => at < floor,
        Some(RowTime::Day(day)) => day < wib_day(floor),
        None => false,
    }
}

/// The row's own time is inside the fallback window after the attempt. A row
/// dated only to the day is not precise enough for a match on amount alone.
fn in_window(anchor: DateTime<Utc>, row: &Row) -> bool {
    match row.time {
        Some(RowTime::Exact(at)) => {
            let offset = at - anchor;
            offset >= -Duration::minutes(CLOCK_SKEW_MINUTES)
                && offset <= Duration::hours(WINDOW_AFTER_HOURS)
        }
        _ => false,
    }
}

/// The payment code is this line's attempt: our customer, the PLN kind the
/// line was sold as, stamped within minutes of the attempt.
fn code_fits(
    item: &transaction_items::Model,
    customer: &str,
    anchor: DateTime<Utc>,
    code: &PaymentCode,
) -> bool {
    let offset = wib_to_utc(code.stamped_at) - anchor;
    canonical_ref(&code.customer, is_phone_service(item)) == customer
        && pln_kind(item).is_none_or(|kind| kind == code.kind)
        && offset >= -Duration::minutes(CLOCK_SKEW_MINUTES)
        && offset <= Duration::minutes(CODE_WINDOW_AFTER_MINUTES)
}

/// Whether `item` is still checked automatically at `now`.
fn auto_checkable(item: &transaction_items::Model, now: DateTime<Utc>) -> bool {
    last_attempt_at(item).is_some_and(|at| now - at <= Duration::days(AUTO_CHECK_MAX_AGE_DAYS))
}

/// What "Cek status" says, without asking Mitra, for a line too old to check.
fn manual_only_message(item: &transaction_items::Model, now: DateTime<Utc>) -> Option<String> {
    let age = now - last_attempt_at(item)?;
    if age > Duration::days(HISTORY_HORIZON_DAYS) {
        Some(format!(
            "Di luar riwayat {HISTORY_HORIZON_DAYS} hari Mitra — cek manual di aplikasi Mitra, lalu tandai berhasil atau gagal."
        ))
    } else if age > Duration::days(AUTO_CHECK_MAX_AGE_DAYS) {
        Some(format!(
            "Sudah lebih dari {AUTO_CHECK_MAX_AGE_DAYS} hari — cek manual di aplikasi Mitra, lalu tandai berhasil atau gagal."
        ))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

fn judge<'a>(row: &'a Row<'a>) -> Verdict<'a> {
    match row.item.status.as_deref().map(classify_status_word) {
        Some(StatusWord::Success) => Verdict::Success(row),
        Some(StatusWord::Failed) => Verdict::Failed(row),
        _ => not_yet("transaksi masih diproses di riwayat Mitra"),
    }
}

/// A row found by payment code or by amount and time: a success settles the
/// line (if the row can be claimed by its `trx_id`); a failure never does.
fn conclude_weak<'a>(row: &'a Row<'a>) -> Verdict<'a> {
    match judge(row) {
        Verdict::Success(row) if row.trx_id.is_none() => {
            not_yet("baris riwayat Mitra tanpa nomor transaksi")
        }
        Verdict::Failed(row) => Verdict::Unknown(format!(
            "Riwayat Mitra mencatat transaksi gagal{}, tapi kecocokannya tidak pasti. Cek di aplikasi Mitra, lalu tandai secara manual.",
            row.label()
        )),
        other => other,
    }
}

/// What `rows` say about `item`. `neighbours` are our other PPOB lines (any
/// status) that could compete with it for the same row; `claimed` maps each
/// history `trx_id` already settled onto a line to that line.
fn verdict<'a>(
    item: &transaction_items::Model,
    rows: &'a [Row<'a>],
    neighbours: &[transaction_items::Model],
    claimed: &HashMap<String, i64>,
) -> Verdict<'a> {
    let Some(anchor) = last_attempt_at(item) else {
        return not_yet("waktu transaksi tidak terbaca");
    };
    let Some(customer) = customer_ref(item) else {
        return not_yet("nomor pelanggan tidak bisa dicocokkan");
    };
    let spellings = customer_spellings(item, &customer);
    let usable: Vec<&Row> = rows
        .iter()
        .filter(|row| {
            !row.trx_id
                .as_ref()
                .and_then(|id| claimed.get(id))
                .is_some_and(|owner| *owner != item.id)
        })
        .filter(|row| !row_predates(anchor, row))
        .collect();

    // 1. Mitra's own ADVICE reference, key for key, for the same customer.
    if let Some(advice) = advice_id(item) {
        let hits: Vec<&Row> = usable
            .iter()
            .copied()
            .filter(|row| {
                row.advice_id.as_deref() == Some(advice.as_str())
                    && row_names_customer(row, &spellings)
            })
            .collect();
        if let [row] = hits.as_slice() {
            match judge(row) {
                // Still pending there: the rows below may know more.
                Verdict::Unknown(_) => {}
                settled => return settled,
            }
        }
    }

    let others = || {
        neighbours
            .iter()
            .filter(|other| other.id != item.id)
            .filter(|other| customer_ref(other).as_deref() == Some(customer.as_str()))
    };

    // 2. Mitra's payment code: customer, kind and the minute it was paid.
    let by_code: Vec<(&Row, &PaymentCode)> = usable
        .iter()
        .filter_map(|row| row.payment_code.as_ref().map(|code| (*row, code)))
        .filter(|(row, code)| {
            code_fits(item, &customer, anchor, code) && product_matches(item, row)
        })
        .collect();
    match by_code.as_slice() {
        [] => {}
        [(row, code)] => {
            let contested = others().any(|other| {
                last_attempt_at(other).is_some_and(|at| code_fits(other, &customer, at, code))
            });
            return if contested {
                not_yet(CONTESTED)
            } else {
                conclude_weak(row)
            };
        }
        _ => return not_yet(AMBIGUOUS),
    }

    // 3. Amount and time, for rows that carry no payment code we can read. A
    // row whose code we can read and that did not fit above is another
    // purchase.
    let candidates: Vec<&Row> = usable
        .iter()
        .copied()
        .filter(|row| {
            row.payment_code.is_none()
                && row_names_customer(row, &spellings)
                && amount_matches(item, row)
                && in_window(anchor, row)
                && product_matches(item, row)
        })
        .collect();
    let row = match candidates.as_slice() {
        [] => return not_yet("belum ada di riwayat Mitra"),
        [row] => *row,
        _ => return not_yet(AMBIGUOUS),
    };
    let contested = others().any(|other| {
        amount_matches(other, row) && last_attempt_at(other).is_some_and(|at| in_window(at, row))
    });
    if contested {
        return not_yet(CONTESTED);
    }
    conclude_weak(row)
}

/// The shapes of unmatched rows already logged, as sorted key lists.
static LOGGED_SHAPES: LazyLock<std::sync::Mutex<HashSet<String>>> =
    LazyLock::new(|| std::sync::Mutex::new(HashSet::new()));

/// Log the keys (never the values) of a history row that names an uncertain
/// line's customer but did not settle it, once per distinct shape, so the
/// real shape of a pending ADVICE row can be learned from `logs/`. Returns
/// whether it logged.
fn log_row_shape_once(row: &HistoryRow) -> bool {
    let mut keys: Vec<&str> = row.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let shape = keys.join(",");
    let fresh = LOGGED_SHAPES
        .lock()
        .map(|mut seen| seen.insert(shape.clone()))
        .unwrap_or(false);
    if fresh {
        logging::log_info(&format!(
            "[ppob] baris riwayat Mitra yang belum mencocokkan item uncertain, kuncinya: {shape}"
        ));
    }
    fresh
}

// ---------------------------------------------------------------------------
// Writing the result
// ---------------------------------------------------------------------------

/// Settle one line, only if it is still `uncertain` and — for a success — the
/// row is not already another line's. Returns whether this call settled it.
async fn settle(
    db: &DatabaseConnection,
    item_id: i64,
    verdict: &Verdict<'_>,
    origin: CheckOrigin,
) -> Result<bool, AppError> {
    let (status, message, serial, receipt, trx_id) = match verdict {
        Verdict::Success(row) => (
            PPOB_STATUS_SUCCESS,
            format!(
                "Berhasil menurut riwayat Mitra{} — {}.",
                row.label(),
                origin.note()
            ),
            row.serial(),
            // Labelled, so the struk reads `amount` as the total it is here.
            Some(history_receipt_blob(row.raw)),
            row.trx_id.clone(),
        ),
        Verdict::Failed(row) => (
            PPOB_STATUS_FAILED,
            format!(
                "Gagal menurut riwayat Mitra{} — {}. Bisa dicoba ulang atau di-refund.",
                row.label(),
                origin.note()
            ),
            None,
            None,
            None,
        ),
        Verdict::Unknown(_) => return Ok(false),
    };

    let txn = db.begin().await?;
    let updated = txn
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items
             SET ppob_status = $1, ppob_message = $2, ppob_serial_number = $3,
                 ppob_history_trx_id = $4
             WHERE id = $5 AND ppob_status = $6
               AND ($4 IS NULL OR NOT EXISTS (
                     SELECT 1 FROM transaction_items other
                     WHERE other.ppob_history_trx_id = $4 AND other.id <> $5))",
            vec![
                status.into(),
                message.into(),
                serial.into(),
                trx_id.into(),
                item_id.into(),
                PPOB_STATUS_UNCERTAIN.into(),
            ],
        ))
        .await?;
    if updated.rows_affected() != 1 {
        txn.rollback().await?;
        return Ok(false);
    }
    match receipt {
        Some(data) => store_ppob_receipt(&txn, item_id, data).await?,
        None => {
            ppob_receipts::Entity::delete_by_id(item_id)
                .exec(&txn)
                .await?;
        }
    }
    txn.commit().await?;
    Ok(true)
}

/// Which of the fetched rows' `trx_id`s are already settled onto a line, and
/// that line.
async fn load_claimed(
    db: &DatabaseConnection,
    rows: &[Row<'_>],
) -> Result<HashMap<String, i64>, AppError> {
    let trx_ids: Vec<&str> = rows
        .iter()
        .filter_map(|row| row.trx_id.as_deref())
        .collect();
    if trx_ids.is_empty() {
        return Ok(HashMap::new());
    }
    Ok(transaction_items::Entity::find()
        .filter(transaction_items::Column::PpobHistoryTrxId.is_in(trx_ids))
        .all(db)
        .await?
        .into_iter()
        .filter_map(|item| item.ppob_history_trx_id.map(|trx_id| (trx_id, item.id)))
        .collect())
}

/// Our PPOB lines whose attempt could fall in the window of a line attempted
/// at or after `earliest`: created or retried since a little before it.
async fn load_neighbours(
    db: &DatabaseConnection,
    earliest: DateTime<Utc>,
) -> Result<Vec<transaction_items::Model>, AppError> {
    let horizon = format_ts(earliest - Duration::hours(WINDOW_AFTER_HOURS) - Duration::days(1));
    Ok(transaction_items::Entity::find()
        .filter(transaction_items::Column::ServiceType.is_not_null())
        .filter(
            Condition::any()
                .add(transaction_items::Column::CreatedAt.gte(horizon.clone()))
                .add(transaction_items::Column::PpobLastAttemptAt.gte(horizon)),
        )
        .all(db)
        .await?)
}

/// Settle every line in `lines` that `rows` decide. Returns each line with its
/// status afterwards.
async fn reconcile_lines(
    db: &DatabaseConnection,
    lines: &[transaction_items::Model],
    rows: &[HistoryRow],
    origin: CheckOrigin,
) -> Result<Vec<(i64, PpobCheckResult)>, AppError> {
    let rows: Vec<Row> = rows.iter().map(Row::new).collect();
    let neighbours = match lines.iter().filter_map(last_attempt_at).min() {
        Some(earliest) => load_neighbours(db, earliest).await?,
        None => Vec::new(),
    };
    let mut claimed = load_claimed(db, &rows).await?;

    let mut results = Vec::with_capacity(lines.len());
    for item in lines {
        let verdict = verdict(item, &rows, &neighbours, &claimed);
        let settled = settle(db, item.id, &verdict, origin).await?;
        let result = match (&verdict, settled) {
            (Verdict::Success(row), true) => {
                if let Some(trx_id) = &row.trx_id {
                    claimed.insert(trx_id.clone(), item.id);
                }
                PpobCheckResult {
                    status: PPOB_STATUS_SUCCESS.into(),
                    message: "Berhasil menurut riwayat Mitra. Struk bisa dicetak.".into(),
                }
            }
            (Verdict::Failed(_), true) => PpobCheckResult {
                status: PPOB_STATUS_FAILED.into(),
                message: "Gagal menurut riwayat Mitra. PPOB bisa dicoba ulang atau di-refund."
                    .into(),
            },
            (Verdict::Unknown(message), _) => {
                if let Some(customer) = customer_ref(item) {
                    let spellings = customer_spellings(item, &customer);
                    for row in rows
                        .iter()
                        .filter(|row| row_names_customer(row, &spellings))
                    {
                        log_row_shape_once(row.raw);
                    }
                }
                PpobCheckResult {
                    status: PPOB_STATUS_UNCERTAIN.into(),
                    message: message.clone(),
                }
            }
            // Someone settled it between our read and our write, or another
            // line took the row first.
            (_, false) => {
                let status = current_status(db, item.id).await?;
                let message = if status == PPOB_STATUS_UNCERTAIN {
                    "Baris riwayat Mitra itu sudah dipakai item PPOB lain. Cek di aplikasi Mitra, lalu tandai secara manual."
                } else {
                    "Status PPOB ini sudah diperbarui."
                };
                PpobCheckResult {
                    status,
                    message: message.into(),
                }
            }
        };
        results.push((item.id, result));
    }
    Ok(results)
}

async fn current_status(db: &DatabaseConnection, item_id: i64) -> Result<String, AppError> {
    Ok(transaction_items::Entity::find_by_id(item_id)
        .one(db)
        .await?
        .and_then(|item| item.ppob_status)
        .unwrap_or_default())
}

#[cfg(test)]
async fn load_uncertain(
    db: &DatabaseConnection,
    only: Option<i64>,
) -> Result<Vec<transaction_items::Model>, AppError> {
    let mut query = transaction_items::Entity::find()
        .filter(transaction_items::Column::ServiceType.is_not_null())
        .filter(transaction_items::Column::PpobStatus.eq(PPOB_STATUS_UNCERTAIN));
    if let Some(item_id) = only {
        query = query.filter(transaction_items::Column::Id.eq(item_id));
    }
    Ok(query.all(db).await?)
}

/// The `uncertain` lines [`auto_checkable`] at `now`. SQL drops the old ones;
/// the same test in Rust then drops a line whose timestamps do not parse.
async fn load_auto_checkable(
    db: &DatabaseConnection,
    now: DateTime<Utc>,
) -> Result<Vec<transaction_items::Model>, AppError> {
    let cutoff = format_ts(now - Duration::days(AUTO_CHECK_MAX_AGE_DAYS));
    Ok(transaction_items::Entity::find()
        .filter(transaction_items::Column::ServiceType.is_not_null())
        .filter(transaction_items::Column::PpobStatus.eq(PPOB_STATUS_UNCERTAIN))
        .filter(Expr::cust_with_values(
            "COALESCE(ppob_last_attempt_at, created_at) >= ?",
            [cutoff],
        ))
        .all(db)
        .await?
        .into_iter()
        .filter(|item| auto_checkable(item, now))
        .collect())
}

/// The `history-payment` range for `lines`, as WIB `YYYY-MM-DD`: from the day
/// of the earliest attempt (less clock skew) to tomorrow, so a sale just
/// before midnight in our zone is still inside. With lines no older than
/// [`AUTO_CHECK_MAX_AGE_DAYS`] that is about a week, not the 90 days the
/// history holds.
fn fetch_range(lines: &[transaction_items::Model], now: DateTime<Utc>) -> (NaiveDate, NaiveDate) {
    let floor = wib_day(now) - Duration::days(HISTORY_HORIZON_DAYS);
    let start = lines
        .iter()
        .filter_map(window_start)
        .min()
        .unwrap_or(floor)
        .max(floor);
    (start, wib_day(now) + Duration::days(1))
}

/// The first WIB day a row of `line`'s last attempt can be stamped.
fn window_start(line: &transaction_items::Model) -> Option<NaiveDate> {
    last_attempt_at(line).map(|at| wib_day(at - Duration::minutes(CLOCK_SKEW_MINUTES)))
}

/// Fetch the history over `range` once and settle what it decides for `lines`.
async fn fetch_and_reconcile(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    lines: &[transaction_items::Model],
    (start, end): (NaiveDate, NaiveDate),
    origin: CheckOrigin,
    policy: LoginPolicy,
) -> Result<Vec<(i64, PpobCheckResult)>, AppError> {
    if lines.is_empty() {
        return Ok(Vec::new());
    }
    let rows = history::payment_rows(
        db,
        mitra,
        start.format("%Y-%m-%d").to_string(),
        end.format("%Y-%m-%d").to_string(),
        policy,
    )
    .await?;
    reconcile_lines(db, lines, &rows, origin).await
}

/// Per-line memory of the last "Cek status", so repeated clicks (or a cashier
/// script) answer from the database instead of fetching the history again.
struct CheckCooldown(std::sync::Mutex<HashMap<i64, Instant>>);

impl CheckCooldown {
    fn new() -> Self {
        Self(std::sync::Mutex::new(HashMap::new()))
    }

    /// Start a check of `item_id` at `now`, or say how many seconds remain.
    fn try_begin(&self, item_id: i64, now: Instant) -> Result<(), u64> {
        let mut last = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        last.retain(|_, at| now.saturating_duration_since(*at) < CHECK_COOLDOWN);
        if let Some(at) = last.get(&item_id) {
            let left = CHECK_COOLDOWN.saturating_sub(now.saturating_duration_since(*at));
            return Err(left.as_secs().max(1));
        }
        last.insert(item_id, now);
        Ok(())
    }

    /// Forget the check of `item_id` begun at `began`, so a check whose fetch
    /// failed does not block the next click. A newer check's entry is kept.
    fn release(&self, item_id: i64, began: Instant) {
        let mut last = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if last.get(&item_id) == Some(&began) {
            last.remove(&item_id);
        }
    }
}

static CHECK_COOLDOWNS: LazyLock<CheckCooldown> = LazyLock::new(CheckCooldown::new);

fn status_label(status: &str) -> &'static str {
    match status {
        PPOB_STATUS_SUCCESS => "berhasil",
        PPOB_STATUS_FAILED => "gagal",
        _ => "sedang diproses",
    }
}

/// "Cek status" on one line. A line that is not `uncertain` answers its
/// current status; a line too old for the history answers where to look
/// instead; a line checked moments ago answers without asking Mitra again.
/// The rows fetched for it also settle every other line young enough for the
/// automatic check whose window they cover.
pub async fn check_ppob_status(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    item_id: i64,
) -> Result<PpobCheckResult, AppError> {
    check_with(
        db,
        mitra,
        item_id,
        &CHECK_COOLDOWNS,
        LoginPolicy::AllowPasswordLogin,
        Utc::now(),
    )
    .await
}

async fn check_with(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    item_id: i64,
    cooldown: &CheckCooldown,
    policy: LoginPolicy,
    now: DateTime<Utc>,
) -> Result<PpobCheckResult, AppError> {
    let item = transaction_items::Entity::find_by_id(item_id)
        .one(db)
        .await?
        .filter(|item| item.service_type.is_some())
        .ok_or_else(|| AppError::NotFound("Item PPOB tidak ditemukan".into()))?;
    let status = item.ppob_status.clone().unwrap_or_default();
    if status != PPOB_STATUS_UNCERTAIN {
        return Ok(PpobCheckResult {
            message: format!("PPOB ini sudah {}.", status_label(&status)),
            status,
        });
    }
    let uncertain = |message: String| PpobCheckResult {
        status: PPOB_STATUS_UNCERTAIN.into(),
        message,
    };
    if let Some(message) = manual_only_message(&item, now) {
        return Ok(uncertain(message));
    }
    // Taken before the fetch, so two clicks at once do not both ask Mitra;
    // released again if the fetch fails, so a failure (no network, Mitra
    // down) does not block a retry for the whole cooldown.
    let began = Instant::now();
    if let Err(seconds) = cooldown.try_begin(item_id, began) {
        return Ok(uncertain(format!(
            "Baru saja dicek. Coba lagi dalam {seconds} detik."
        )));
    }

    let fetched = async {
        // The fetch covers this line's window. A line whose window starts
        // earlier could miss its own row in it, so only the lines it fully
        // covers join.
        let range = fetch_range(std::slice::from_ref(&item), now);
        let others = load_auto_checkable(db, now)
            .await?
            .into_iter()
            .filter(|line| {
                line.id != item_id && window_start(line).is_some_and(|start| start >= range.0)
            });
        let lines: Vec<transaction_items::Model> = std::iter::once(item).chain(others).collect();
        fetch_and_reconcile(db, mitra, &lines, range, CheckOrigin::Manual, policy).await
    }
    .await;
    if fetched.is_err() {
        cooldown.release(item_id, began);
    }
    let results = fetched?;
    log_settled(&results);
    Ok(results
        .into_iter()
        .find(|(id, _)| *id == item_id)
        .map(|(_, result)| result)
        .unwrap_or_else(|| uncertain("Status PPOB ini sudah diperbarui.".into())))
}

fn log_settled(results: &[(i64, PpobCheckResult)]) {
    for (item_id, result) in results {
        if result.status != PPOB_STATUS_UNCERTAIN {
            logging::log_info(&format!(
                "[ppob] item {item_id}: diselesaikan dari riwayat Mitra -> {}",
                result.status
            ));
        }
    }
}

// ---------------------------------------------------------------------------
// The background loop
// ---------------------------------------------------------------------------

/// How long after startup the first background check waits, so it does not
/// compete with the window opening and the first Mitra login.
const FIRST_CHECK_DELAY_SECS: u64 = 30;

/// How often the loop looks at the database for lines to check. Reading the
/// `uncertain` lines is local and indexed; Mitra is only asked when
/// [`Backoff`] says a check is due.
const TICK_SECS: u64 = 60;

/// The wait after a run, in minutes: the first entry after a run that settled
/// something (or when a new uncertain line appears), each later one after a
/// run that settled nothing, the last repeating.
const BACKOFF_MINUTES: &[u64] = &[10, 30, 60];

/// When the next background check is due.
#[derive(Debug)]
struct Backoff {
    step: usize,
    next_due: Option<Instant>,
    known: BTreeSet<i64>,
}

impl Backoff {
    /// The first check is due at `now`: lines the restart sweep just made
    /// `uncertain` are looked up straight away.
    fn new(now: Instant) -> Self {
        Self {
            step: 0,
            next_due: Some(now),
            known: BTreeSet::new(),
        }
    }

    fn delay(step: usize) -> std::time::Duration {
        let minutes = BACKOFF_MINUTES[step.min(BACKOFF_MINUTES.len() - 1)];
        std::time::Duration::from_secs(minutes * 60)
    }

    /// Record the lines waiting now. A new one starts the backoff over, due
    /// at most the first interval from now.
    fn observe(&mut self, ids: &BTreeSet<i64>, now: Instant) {
        if ids.is_empty() {
            self.step = 0;
            self.next_due = None;
        } else if !ids.is_subset(&self.known) {
            self.step = 0;
            let due = now + Self::delay(0);
            self.next_due = Some(self.next_due.map_or(due, |current| current.min(due)));
        }
        self.known = ids.clone();
    }

    fn is_due(&self, now: Instant) -> bool {
        self.next_due.is_some_and(|due| now >= due)
    }

    /// Schedule the next run after one that did or did not settle a line.
    fn after_run(&mut self, settled_any: bool, now: Instant) {
        if settled_any {
            self.step = 0;
        }
        self.next_due = Some(now + Self::delay(self.step));
        if !settled_any {
            self.step = (self.step + 1).min(BACKOFF_MINUTES.len() - 1);
        }
    }
}

/// One look at the database, and a check against Mitra when one is due.
async fn tick(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    backoff: &mut Backoff,
    last_error: &mut Option<String>,
) {
    // PPOB switched off, no credentials, or no session to reuse: nothing to
    // ask Mitra with, so the lines are not even read. Looked at again next
    // tick, without a log line each time.
    if !matches!(has_reusable_session(db, mitra).await, Ok(true)) {
        return;
    }
    let now = Utc::now();
    let lines = match load_auto_checkable(db, now).await {
        Ok(lines) => lines,
        Err(error) => {
            logging::log_error(&format!("[ppob] gagal membaca item uncertain: {error}"));
            return;
        }
    };
    let ids: BTreeSet<i64> = lines.iter().map(|item| item.id).collect();
    backoff.observe(&ids, Instant::now());
    if !backoff.is_due(Instant::now()) {
        return;
    }

    let outcome = fetch_and_reconcile(
        db,
        mitra,
        &lines,
        fetch_range(&lines, now),
        CheckOrigin::Auto,
        LoginPolicy::StoredSessionOnly,
    )
    .await;
    match outcome {
        Ok(results) => {
            log_settled(&results);
            let settled_any = results
                .iter()
                .any(|(_, result)| result.status != PPOB_STATUS_UNCERTAIN);
            backoff.after_run(settled_any, Instant::now());
            *last_error = None;
        }
        Err(error) => {
            let message = error.to_string();
            if last_error.as_deref() != Some(message.as_str()) {
                logging::log_warning(&format!(
                    "[ppob] cek otomatis riwayat Mitra gagal: {message}"
                ));
            }
            *last_error = Some(message);
            backoff.after_run(false, Instant::now());
        }
    }
}

/// Check the history for uncertain lines shortly after startup (after the
/// interrupted-line sweep has run), then on [`Backoff`]'s schedule. Only
/// touches Mitra while a line young enough to check exists, never with a
/// password login, and logs a repeated error once.
pub async fn run_ppob_reconciler(db: DatabaseConnection, mitra: Arc<Mutex<MitraClient>>) {
    tokio::time::sleep(std::time::Duration::from_secs(FIRST_CHECK_DELAY_SECS)).await;
    let mut backoff = Backoff::new(Instant::now());
    let mut last_error: Option<String> = None;
    loop {
        tick(&db, &mitra, &mut backoff, &mut last_error).await;
        tokio::time::sleep(std::time::Duration::from_secs(TICK_SECS)).await;
    }
}

#[cfg(test)]
pub(crate) async fn reconcile_with_rows(
    db: &DatabaseConnection,
    rows: &[HistoryRow],
    only: Option<i64>,
) -> Result<Vec<(i64, PpobCheckResult)>, AppError> {
    let lines = load_uncertain(db, only).await?;
    reconcile_lines(db, &lines, rows, CheckOrigin::Auto).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::transactions::fixtures::{
        admin, ppob_status_of, seed_ppob_sale, setup_test_db,
    };
    use crate::services::transactions::ppob_fulfillment::{update_ppob_item_status, PpobOutcome};
    use crate::utils::time::TIMESTAMP_FORMAT;
    use serde_json::json;

    async fn exec(conn: &DatabaseConnection, sql: &str, values: Vec<sea_orm::Value>) {
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            sql,
            values,
        ))
        .await
        .expect("update");
    }

    /// A PLN token line sold at 23.500 (bought at 23.500), stored `uncertain`
    /// after an ADVICE, at 2026-09-28 03:10:00 UTC (10:10 WIB).
    async fn advice_line(
        conn: &DatabaseConnection,
        meter: &str,
        advice: Option<&str>,
    ) -> transaction_items::Model {
        let item = seed_ppob_sale(conn, PPOB_STATUS_UNCERTAIN).await;
        exec(
            conn,
            "UPDATE transaction_items
             SET service_type = 'pln', service_ref = $1, buy_price = 23500,
                 product_price = 23500, created_at = '2026-09-28 03:10:00',
                 ppob_advice = $2, ppob_product_code = NULL, ppob_flag_id = '0'
             WHERE id = $3",
            vec![
                meter.into(),
                advice.unwrap_or("{}").to_string().into(),
                item.id.into(),
            ],
        )
        .await;
        line(conn, item.id).await
    }

    /// A live-shaped row: `amount` the total, no payment code (the fallback
    /// path). [`coded_row`] adds Mitra's payment code.
    fn history_row(meter: &str, status: &str, at: &str) -> HistoryRow {
        json!({
            "trxid": format!("TRX-{status}-{at}"),
            "status": status,
            "created_at": at,
            "amount": 23500,
            "amount_base_price": 20000,
            "amount_fee": 3500,
            "raw_paymentcode": meter,
            "token_number": "4617 5400 1832 5962 7611",
            "receipt_text": format!("NO METER   : {meter}\r\nTOKEN : 4617 5400 1832 5962 7611"),
        })
        .as_object()
        .unwrap()
        .clone()
    }

    /// [`history_row`] with Mitra's `payment_code`, stamped at `stamp`
    /// (`yymmddHHMMSS`, WIB), for a prepaid meter.
    fn coded_row(meter: &str, status: &str, at: &str, stamp: &str) -> HistoryRow {
        let mut row = history_row(meter, status, at);
        row.insert("payment_code".into(), json!(format!("L{meter}-1-{stamp}")));
        row.insert("type".into(), json!("PLN"));
        row
    }

    async fn line(conn: &DatabaseConnection, id: i64) -> transaction_items::Model {
        transaction_items::Entity::find_by_id(id)
            .one(conn)
            .await
            .unwrap()
            .unwrap()
    }

    fn at(text: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(text, TIMESTAMP_FORMAT)
            .unwrap()
            .and_utc()
    }

    /// A `sukses` row for the same meter, amount and hour settles the line,
    /// keeps the row (labelled as a history row) as the struk data, the token
    /// as its serial and the row's `trx_id` as the line's claim.
    #[tokio::test]
    async fn a_matching_sukses_row_settles_the_line_as_success_with_its_struk() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;
        let rows = vec![
            history_row("14203938783", "SUKSES", "2026-09-28 10:11:05"),
            // Another customer's purchase in the same minute.
            history_row("14307194556", "SUKSES", "2026-09-28 10:11:30"),
        ];

        let results = reconcile_with_rows(&conn, &rows, None).await.unwrap();
        assert_eq!(results[0].1.status, PPOB_STATUS_SUCCESS);

        let settled = line(&conn, item.id).await;
        assert_eq!(settled.ppob_status.as_deref(), Some(PPOB_STATUS_SUCCESS));
        assert_eq!(
            settled.ppob_serial_number.as_deref(),
            Some("4617 5400 1832 5962 7611")
        );
        assert_eq!(
            settled.ppob_history_trx_id.as_deref(),
            Some("TRX-SUKSES-2026-09-28 10:11:05")
        );
        assert!(
            settled
                .ppob_message
                .as_deref()
                .unwrap()
                .contains("dicek otomatis"),
            "{:?}",
            settled.ppob_message
        );
        let struk = ppob_receipts::Entity::find_by_id(item.id)
            .one(&conn)
            .await
            .unwrap()
            .expect("the history row is kept as the struk data");
        let blob: Value = serde_json::from_str(&struk.data).unwrap();
        assert_eq!(
            history::history_row_of_blob(&blob),
            Some(&rows[0]),
            "{}",
            struk.data
        );
    }

    /// Item 1: a `gagal` row found by customer, amount and time does not make
    /// the line `failed` — that would unlock a second payment — it says what
    /// the history shows and leaves the decision to a person.
    #[tokio::test]
    async fn a_weak_gagal_match_never_settles_the_line_failed() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;

        for rows in [
            vec![history_row("14203938783", "Gagal", "28-09-2026 10:12:00")],
            vec![coded_row(
                "14203938783",
                "GAGAL",
                "2026-09-28 10:10:20",
                "260928101020",
            )],
        ] {
            let results = reconcile_with_rows(&conn, &rows, None).await.unwrap();
            assert_eq!(results[0].1.status, PPOB_STATUS_UNCERTAIN);
            assert!(
                results[0].1.message.contains("tandai secara manual"),
                "{}",
                results[0].1.message
            );
            assert_eq!(
                ppob_status_of(&conn, item.id).await.as_deref(),
                Some(PPOB_STATUS_UNCERTAIN)
            );
        }
    }

    /// Item 1: after a retry the window starts at the retry. The first
    /// attempt's `gagal` row and an earlier `sukses` for the same meter are
    /// both from before it and settle nothing, while the retry is pending.
    #[tokio::test]
    async fn rows_from_before_the_last_attempt_are_ignored() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;
        exec(
            &conn,
            "UPDATE transaction_items SET ppob_last_attempt_at = '2026-09-28 05:00:00'
             WHERE id = $1",
            vec![item.id.into()],
        )
        .await;

        let rows = vec![
            history_row("14203938783", "GAGAL", "2026-09-28 10:12:00"),
            history_row("14203938783", "SUKSES", "2026-09-28 10:40:00"),
            coded_row(
                "14203938783",
                "SUKSES",
                "2026-09-28 10:10:20",
                "260928101020",
            ),
        ];
        let results = reconcile_with_rows(&conn, &rows, None).await.unwrap();
        assert_eq!(results[0].1.status, PPOB_STATUS_UNCERTAIN);

        // The retry's own row (12:00 WIB, after the 05:00 UTC attempt) does.
        let mut rows = rows;
        rows.push(coded_row(
            "14203938783",
            "SUKSES",
            "2026-09-28 12:00:30",
            "260928120030",
        ));
        reconcile_with_rows(&conn, &rows, None).await.unwrap();
        let settled = line(&conn, item.id).await;
        assert_eq!(settled.ppob_status.as_deref(), Some(PPOB_STATUS_SUCCESS));
        assert_eq!(
            settled.ppob_history_trx_id.as_deref(),
            Some("TRX-SUKSES-2026-09-28 12:00:30")
        );
    }

    /// Item 2: the cashier bought the same meter, same amount again an hour
    /// later in the official Mitra app. Amount and time see two rows; the
    /// payment code tells ours apart.
    #[tokio::test]
    async fn the_payment_code_picks_our_row_over_a_rebuy_in_the_mitra_app() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;
        let ours = coded_row(
            "14203938783",
            "SUKSES",
            "2026-09-28 10:10:20",
            "260928101020",
        );
        let mut rebuy = coded_row(
            "14203938783",
            "SUKSES",
            "2026-09-28 11:15:00",
            "260928111500",
        );
        rebuy.insert("token_number".into(), json!("9999 0000 1111 2222 3333"));
        let rows = vec![rebuy, ours];

        reconcile_with_rows(&conn, &rows, None).await.unwrap();

        let settled = line(&conn, item.id).await;
        assert_eq!(settled.ppob_status.as_deref(), Some(PPOB_STATUS_SUCCESS));
        assert_eq!(
            settled.ppob_serial_number.as_deref(),
            Some("4617 5400 1832 5962 7611")
        );
    }

    /// Item 2: only the rebuy is in the history (ours is still pending). Its
    /// code is stamped an hour after our attempt, so it is someone else's,
    /// and amount and time do not get to take it either.
    #[tokio::test]
    async fn a_rebuy_alone_does_not_settle_the_line() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;
        let rows = vec![coded_row(
            "14203938783",
            "SUKSES",
            "2026-09-28 11:15:00",
            "260928111500",
        )];

        reconcile_with_rows(&conn, &rows, None).await.unwrap();

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );
    }

    /// Item 2: a code for the right meter and minute but the wrong kind
    /// (postpaid), service or product is not ours.
    #[tokio::test]
    async fn a_code_for_another_kind_service_or_product_is_refused() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;
        exec(
            &conn,
            "UPDATE transaction_items SET ppob_product_code = '321700757' WHERE id = $1",
            vec![item.id.into()],
        )
        .await;
        let base = || {
            coded_row(
                "14203938783",
                "SUKSES",
                "2026-09-28 10:10:20",
                "260928101020",
            )
        };
        let mut postpaid = base();
        postpaid.insert("payment_code".into(), json!("L14203938783-2-260928101020"));
        let mut pdam = base();
        pdam.insert("type".into(), json!("PDAM"));
        let mut other_plu = base();
        other_plu.insert("plu".into(), json!("321700758"));

        for row in [postpaid, pdam, other_plu] {
            reconcile_with_rows(&conn, std::slice::from_ref(&row), None)
                .await
                .unwrap();
            assert_eq!(
                ppob_status_of(&conn, item.id).await.as_deref(),
                Some(PPOB_STATUS_UNCERTAIN),
                "{row:?}"
            );
        }

        let mut ours = base();
        ours.insert("plu".into(), json!("321700757"));
        reconcile_with_rows(&conn, &[ours], None).await.unwrap();
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_SUCCESS)
        );
    }

    /// Item 2: a row another line already settled from is not taken again —
    /// not even by a line that would otherwise match it perfectly.
    #[tokio::test]
    async fn a_row_another_line_claimed_is_refused() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;
        let row = coded_row(
            "14203938783",
            "SUKSES",
            "2026-09-28 10:10:20",
            "260928101020",
        );
        let other = seed_ppob_sale(&conn, PPOB_STATUS_SUCCESS).await;
        exec(
            &conn,
            "UPDATE transaction_items SET ppob_history_trx_id = $1 WHERE id = $2",
            vec![Row::new(&row).trx_id.unwrap().into(), other.id.into()],
        )
        .await;

        reconcile_with_rows(&conn, &[row], None).await.unwrap();

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );
    }

    /// Two uncertain lines that both fit one row in the same run: at most one
    /// gets it.
    #[tokio::test]
    async fn one_row_settles_at_most_one_line() {
        let conn = setup_test_db().await;
        let first = advice_line(&conn, "14203938783", None).await;
        let row = coded_row(
            "14203938783",
            "SUKSES",
            "2026-09-28 10:10:20",
            "260928101020",
        );
        let claimed = HashMap::new();
        let parsed = [Row::new(&row)];
        assert!(matches!(
            verdict(&first, &parsed, &[], &claimed),
            Verdict::Success(_)
        ));
        assert!(settle(
            &conn,
            first.id,
            &Verdict::Success(&parsed[0]),
            CheckOrigin::Auto
        )
        .await
        .unwrap());

        let second = advice_line(&conn, "14203938783", None).await;
        assert!(!settle(
            &conn,
            second.id,
            &Verdict::Success(&parsed[0]),
            CheckOrigin::Auto
        )
        .await
        .unwrap());
        assert_eq!(
            ppob_status_of(&conn, second.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );
    }

    /// No row, a row for another meter, a row before the attempt, a row at
    /// another amount, a row still pending, a row whose time cannot be read
    /// and a row dated only to the day all leave the line alone.
    #[tokio::test]
    async fn no_confident_row_leaves_the_line_uncertain() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;

        let mut other_amount = history_row("14203938783", "SUKSES", "2026-09-28 10:11:00");
        other_amount.insert("amount".into(), json!(53500));
        other_amount.insert("amount_base_price".into(), json!(50000));
        let cases: Vec<Vec<HistoryRow>> = vec![
            vec![],
            vec![history_row("14307194556", "SUKSES", "2026-09-28 10:11:00")],
            // The meter only as part of a longer number.
            vec![history_row(
                "9914203938783",
                "SUKSES",
                "2026-09-28 10:11:00",
            )],
            vec![history_row("14203938783", "SUKSES", "2026-09-25 10:11:00")],
            vec![history_row("14203938783", "SUKSES", "2026-09-28 09:50:00")],
            vec![other_amount],
            vec![history_row("14203938783", "PENDING", "2026-09-28 10:11:00")],
            vec![history_row("14203938783", "SUKSES", "bukan tanggal")],
            vec![history_row("14203938783", "SUKSES", "2026-09-28")],
        ];
        for rows in cases {
            let results = reconcile_with_rows(&conn, &rows, None).await.unwrap();
            assert_eq!(results[0].1.status, PPOB_STATUS_UNCERTAIN, "{rows:?}");
            assert_eq!(
                ppob_status_of(&conn, item.id).await.as_deref(),
                Some(PPOB_STATUS_UNCERTAIN),
                "{rows:?}"
            );
        }
    }

    /// Two rows that both fit — two tokens for one meter, or a sukses and a
    /// gagal — cannot be told apart: the line stays uncertain.
    #[tokio::test]
    async fn an_ambiguous_double_match_stays_uncertain() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;

        for rows in [
            vec![
                history_row("14203938783", "SUKSES", "2026-09-28 10:11:00"),
                history_row("14203938783", "SUKSES", "2026-09-28 10:40:00"),
            ],
            vec![
                history_row("14203938783", "SUKSES", "2026-09-28 10:11:00"),
                history_row("14203938783", "GAGAL", "2026-09-28 10:12:00"),
            ],
            vec![
                coded_row(
                    "14203938783",
                    "SUKSES",
                    "2026-09-28 10:10:20",
                    "260928101020",
                ),
                coded_row(
                    "14203938783",
                    "SUKSES",
                    "2026-09-28 10:12:20",
                    "260928101220",
                ),
            ],
        ] {
            reconcile_with_rows(&conn, &rows, None).await.unwrap();
            assert_eq!(
                ppob_status_of(&conn, item.id).await.as_deref(),
                Some(PPOB_STATUS_UNCERTAIN)
            );
        }
    }

    /// One row, but two of our lines (the other already delivered) fit it:
    /// the row may well be the other one's, so nothing is settled.
    #[tokio::test]
    async fn a_row_another_of_our_lines_could_own_stays_uncertain() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;
        let earlier = advice_line(&conn, "14203938783", None).await;
        exec(
            &conn,
            "UPDATE transaction_items SET ppob_status = 'success' WHERE id = $1",
            vec![earlier.id.into()],
        )
        .await;

        for rows in [
            vec![history_row("14203938783", "SUKSES", "2026-09-28 10:11:00")],
            vec![coded_row(
                "14203938783",
                "SUKSES",
                "2026-09-28 10:10:20",
                "260928101020",
            )],
        ] {
            reconcile_with_rows(&conn, &rows, Some(item.id))
                .await
                .unwrap();
            assert_eq!(
                ppob_status_of(&conn, item.id).await.as_deref(),
                Some(PPOB_STATUS_UNCERTAIN)
            );
        }
    }

    /// Item 3: `advice_id` on a row, key for key and for the same customer,
    /// settles the line even when nothing else about the row would have.
    #[tokio::test]
    async fn the_advice_reference_is_a_strong_match() {
        let conn = setup_test_db().await;
        let item = advice_line(
            &conn,
            "14203938783",
            Some(r#"{"advice_id":"eyJpdiI6IkEifQ==","uid":"eyJpdiI6IlUifQ=="}"#),
        )
        .await;
        let mut ours = history_row("14203938783", "Gagal", "2026-10-01 08:00:00");
        ours.insert("advice_id".into(), json!("eyJpdiI6IkEifQ=="));

        reconcile_with_rows(&conn, &[ours], Some(item.id))
            .await
            .unwrap();

        // The only path allowed to settle `failed` on its own.
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_FAILED)
        );
    }

    /// Item 3 and the second audit: `uid` matches nothing (it may be the same
    /// on every row), `advice_id` is not compared against `uid`, and an
    /// `advice_id` on another customer's row is not ours.
    #[tokio::test]
    async fn the_strong_match_is_key_for_key_and_needs_the_customer() {
        let conn = setup_test_db().await;
        let item = advice_line(
            &conn,
            "14203938783",
            Some(r#"{"advice_id":"eyJpdiI6IkEifQ==","uid":"eyJpdiI6IlUifQ=="}"#),
        )
        .await;
        // Three days after the sale: too late for the amount-and-time match,
        // so only a reference could settle these.
        let mut by_uid = history_row("14203938783", "Sukses", "2026-10-01 08:00:00");
        by_uid.insert("uid".into(), json!("eyJpdiI6IlUifQ=="));
        let mut crossed = history_row("14203938783", "Sukses", "2026-10-01 08:00:00");
        crossed.insert("uid".into(), json!("eyJpdiI6IkEifQ=="));
        let mut other_customer = history_row("00000000000", "Sukses", "2026-10-01 08:00:00");
        other_customer.insert("advice_id".into(), json!("eyJpdiI6IkEifQ=="));

        for row in [by_uid, crossed, other_customer] {
            reconcile_with_rows(&conn, std::slice::from_ref(&row), None)
                .await
                .unwrap();
            assert_eq!(
                ppob_status_of(&conn, item.id).await.as_deref(),
                Some(PPOB_STATUS_UNCERTAIN),
                "{row:?}"
            );
        }
    }

    /// Item 3 and the second audit: a strong match still pending, or the
    /// same account-wide `uid` on every row, does not stop the other matches.
    #[tokio::test]
    async fn a_pending_or_shared_reference_falls_through_to_the_payment_code() {
        let conn = setup_test_db().await;
        let item = advice_line(
            &conn,
            "14203938783",
            Some(r#"{"advice_id":"eyJpdiI6IkEifQ==","uid":"eyJpdiI6IlUifQ=="}"#),
        )
        .await;
        let mut pending = history_row("14203938783", "PENDING", "2026-09-28 10:10:10");
        pending.insert("advice_id".into(), json!("eyJpdiI6IkEifQ=="));
        pending.insert("uid".into(), json!("eyJpdiI6IlUifQ=="));
        pending.insert("trxid".into(), json!("ADVICE-ROW"));
        let mut settled = coded_row(
            "14203938783",
            "SUKSES",
            "2026-09-28 10:10:20",
            "260928101020",
        );
        settled.insert("uid".into(), json!("eyJpdiI6IlUifQ=="));

        reconcile_with_rows(&conn, &[pending, settled], None)
            .await
            .unwrap();

        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_SUCCESS)
        );
    }

    /// Second audit: a pulsa number the cashier typed `08…` matches a row
    /// that writes it `62…`, in the payment code and in any field.
    #[tokio::test]
    async fn a_phone_number_matches_in_either_spelling() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        exec(
            &conn,
            "UPDATE transaction_items SET service_ref = '0812-3456-789',
                 created_at = '2026-09-28 03:10:00' WHERE id = $1",
            vec![item.id.into()],
        )
        .await;
        let row = |code: Option<&str>, number: &str| {
            let mut row = json!({
                "trxid": format!("P-{number}"),
                "status": "SUKSES",
                "created_at": "2026-09-28 10:10:40",
                "type": "PULSA",
                "amount": 10000,
                "raw_paymentcode": number,
            })
            .as_object()
            .unwrap()
            .clone();
            if let Some(code) = code {
                row.insert("payment_code".into(), json!(code));
            }
            row
        };

        let item = line(&conn, item.id).await;
        let claimed = HashMap::new();
        for rows in [
            vec![row(Some("P628123456789-101-260928101040"), "628123456789")],
            vec![row(None, "628123456789")],
            vec![row(None, "+628123456789")],
        ] {
            let parsed: Vec<Row> = rows.iter().map(Row::new).collect();
            assert!(
                matches!(verdict(&item, &parsed, &[], &claimed), Verdict::Success(_)),
                "{rows:?}"
            );
        }
        let other = row(None, "628123456780");
        assert!(matches!(
            verdict(&item, &[Row::new(&other)], &[], &claimed),
            Verdict::Unknown(_)
        ));
        // A PLN meter is not a phone number: no `62` spelling for it.
        assert_eq!(canonical_ref("62123456789", false), "62123456789");
        assert_eq!(canonical_ref("+62 812-3456-789", true), "08123456789");
    }

    /// A line settled by hand between the read and the write is not touched.
    #[tokio::test]
    async fn only_uncertain_lines_are_settled() {
        let conn = setup_test_db().await;
        let item = advice_line(&conn, "14203938783", None).await;
        crate::services::transactions::resolve_uncertain_ppob(
            &conn,
            &admin(),
            item.id,
            false,
            None,
        )
        .await
        .unwrap();

        let rows = vec![history_row("14203938783", "SUKSES", "2026-09-28 10:11:00")];
        let results = reconcile_with_rows(&conn, &rows, None).await.unwrap();
        assert!(results.is_empty());
        assert!(!settle(
            &conn,
            item.id,
            &Verdict::Success(&Row::new(&rows[0])),
            CheckOrigin::Auto
        )
        .await
        .unwrap());
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_FAILED)
        );
    }

    /// Item 9: the message says whether the background loop or the cashier's
    /// "Cek status" settled the line.
    #[tokio::test]
    async fn the_settle_message_names_who_checked() {
        let conn = setup_test_db().await;
        let raw = history_row("14203938783", "SUKSES", "2026-09-28 10:11:05");
        let row = Row::new(&raw);
        for (origin, note) in [
            (CheckOrigin::Auto, "dicek otomatis"),
            (CheckOrigin::Manual, "dicek lewat tombol Cek status"),
        ] {
            let item = advice_line(&conn, "14203938783", None).await;
            assert!(settle(&conn, item.id, &Verdict::Success(&row), origin)
                .await
                .unwrap());
            let message = line(&conn, item.id).await.ppob_message.unwrap();
            assert!(message.contains(note), "{message}");
            // Free the row for the next line.
            exec(
                &conn,
                "UPDATE transaction_items SET ppob_history_trx_id = NULL WHERE id = $1",
                vec![item.id.into()],
            )
            .await;
        }
    }

    /// While a line waits on ADVICE it can be neither retried nor refunded.
    #[tokio::test]
    async fn an_advice_line_is_neither_retryable_nor_refundable() {
        use crate::domain::refunds::{CreateRefundInput, RefundItemInput};

        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, super::super::PPOB_STATUS_PENDING).await;
        update_ppob_item_status(
            &conn,
            item.id,
            PpobOutcome::from_result(Err(AppError::UpstreamAdvice(None))),
        )
        .await
        .unwrap();
        let stored = line(&conn, item.id).await;
        assert_eq!(stored.ppob_status.as_deref(), Some(PPOB_STATUS_UNCERTAIN));

        assert!(!super::super::is_refundable_line(&stored));
        let refund = crate::services::refunds::create(
            &conn,
            &admin(),
            CreateRefundInput {
                transaction_id: item.transaction_id,
                reason: None,
                items: vec![RefundItemInput {
                    transaction_item_id: item.id,
                    quantity: item.quantity,
                    condition: "good".into(),
                }],
                exchange_items: None,
            },
        )
        .await;
        assert!(refund.is_err(), "an ADVICE line must not be refundable");

        let retry = crate::services::transactions::retry_ppob_fulfillment(
            &conn,
            &Arc::new(Mutex::new(MitraClient::new())),
            item.id,
            Some("654321".into()),
        )
        .await;
        assert!(
            matches!(&retry, Err(AppError::Validation(msg)) if msg.contains("belum pasti")),
            "{retry:?}"
        );
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );
    }

    /// Item 5: only lines whose last attempt is under a week old are checked
    /// automatically; older ones get "Cek status" advice instead of a fetch.
    #[test]
    fn only_young_lines_are_checked_automatically() {
        let now = at("2026-10-10 00:00:00");
        let aged = |created: &str, retried: Option<&str>| transaction_items::Model {
            created_at: Some(created.into()),
            ppob_last_attempt_at: retried.map(str::to_string),
            ..blank_line()
        };

        assert!(auto_checkable(&aged("2026-10-05 00:00:00", None), now));
        assert!(!auto_checkable(&aged("2026-10-01 00:00:00", None), now));
        // An old sale retried yesterday counts from the retry.
        assert!(auto_checkable(
            &aged("2026-08-01 00:00:00", Some("2026-10-09 00:00:00")),
            now
        ));
        assert!(!auto_checkable(&aged("bukan tanggal", None), now));

        assert_eq!(
            manual_only_message(&aged("2026-10-05 00:00:00", None), now),
            None
        );
        assert!(manual_only_message(&aged("2026-10-01 00:00:00", None), now)
            .unwrap()
            .contains("lebih dari 7 hari"));
        assert!(manual_only_message(&aged("2026-06-01 00:00:00", None), now)
            .unwrap()
            .contains("riwayat 90 hari"));
    }

    /// The SQL cutoff keeps the same lines as [`auto_checkable`]: young ones,
    /// and an old sale retried recently.
    #[tokio::test]
    async fn only_young_lines_are_loaded_for_the_automatic_check() {
        let conn = setup_test_db().await;
        let young = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        let old = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        let retried = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        let settled = seed_ppob_sale(&conn, PPOB_STATUS_SUCCESS).await;
        exec(
            &conn,
            "UPDATE transaction_items SET created_at = '2026-10-08 00:00:00' WHERE id IN ($1, $2)",
            vec![young.id.into(), settled.id.into()],
        )
        .await;
        exec(
            &conn,
            "UPDATE transaction_items SET created_at = '2026-08-01 00:00:00' WHERE id IN ($1, $2)",
            vec![old.id.into(), retried.id.into()],
        )
        .await;
        exec(
            &conn,
            "UPDATE transaction_items SET ppob_last_attempt_at = '2026-10-09 00:00:00' WHERE id = $1",
            vec![retried.id.into()],
        )
        .await;

        let mut ids: Vec<i64> = load_auto_checkable(&conn, at("2026-10-10 00:00:00"))
            .await
            .unwrap()
            .iter()
            .map(|line| line.id)
            .collect();
        ids.sort_unstable();
        assert_eq!(ids, vec![young.id, retried.id]);
    }

    fn blank_line() -> transaction_items::Model {
        transaction_items::Model {
            id: 0,
            transaction_id: 0,
            product_id: None,
            product_name: String::new(),
            product_price: 0.0,
            buy_price: None,
            quantity: 1,
            subtotal: 0.0,
            item_discount: 0.0,
            net_subtotal: 0.0,
            service_type: Some("pln".into()),
            service_ref: None,
            ppob_product_id: None,
            ppob_product_code: None,
            ppob_inquiry_id: None,
            ppob_payment_code: None,
            ppob_flag_id: None,
            ppob_status: Some(PPOB_STATUS_UNCERTAIN.into()),
            ppob_message: None,
            ppob_serial_number: None,
            created_at: None,
            ppob_advice: None,
            ppob_last_attempt_at: None,
            ppob_history_trx_id: None,
        }
    }

    /// Item 5: the history is fetched from the earliest attempt's day, not
    /// for ninety days.
    #[test]
    fn the_fetch_covers_only_the_days_needed() {
        let now = at("2026-10-10 03:00:00");
        let lines = vec![
            transaction_items::Model {
                created_at: Some("2026-10-08 17:05:00".into()),
                ..blank_line()
            },
            transaction_items::Model {
                created_at: Some("2026-10-09 10:00:00".into()),
                ..blank_line()
            },
        ];
        let (start, end) = fetch_range(&lines, now);
        // 17:05 UTC less ten minutes is 23:55 WIB on the 8th.
        assert_eq!(start.to_string(), "2026-10-08");
        assert_eq!(end.to_string(), "2026-10-11");
    }

    /// Item 5: 10 → 30 → 60 minutes while nothing settles, back to 10 after a
    /// settlement or when a new uncertain line appears.
    #[test]
    fn the_loop_backs_off_and_resets() {
        let start = Instant::now();
        let minutes = |m: u64| std::time::Duration::from_secs(m * 60);
        let ids = |list: &[i64]| list.iter().copied().collect::<BTreeSet<i64>>();
        let mut backoff = Backoff::new(start);

        backoff.observe(&ids(&[1]), start);
        assert!(backoff.is_due(start), "the first check runs at startup");

        backoff.after_run(false, start);
        assert!(!backoff.is_due(start + minutes(9)));
        assert!(backoff.is_due(start + minutes(10)));

        let t1 = start + minutes(10);
        backoff.after_run(false, t1);
        assert!(!backoff.is_due(t1 + minutes(29)));
        assert!(backoff.is_due(t1 + minutes(30)));

        let t2 = t1 + minutes(30);
        backoff.after_run(false, t2);
        assert!(!backoff.is_due(t2 + minutes(59)));
        let t3 = t2 + minutes(60);
        backoff.after_run(false, t3);
        assert!(!backoff.is_due(t3 + minutes(59)), "60 repeats");
        assert!(backoff.is_due(t3 + minutes(60)));

        // A new line: due ten minutes from now, not an hour.
        let t4 = t3 + minutes(5);
        backoff.observe(&ids(&[1, 2]), t4);
        assert!(backoff.is_due(t4 + minutes(10)));
        // The same lines seen again change nothing.
        backoff.observe(&ids(&[1, 2]), t4 + minutes(1));
        assert!(!backoff.is_due(t4 + minutes(9)));

        // A run that settles starts over at ten.
        let t5 = t4 + minutes(10);
        backoff.after_run(false, t5);
        backoff.after_run(true, t5);
        assert!(backoff.is_due(t5 + minutes(10)));

        // Nothing left to check: nothing due.
        backoff.observe(&ids(&[]), t5);
        assert!(!backoff.is_due(t5 + minutes(600)));
    }

    /// Item 5/6: PPOB configured but no saved session — the loop leaves Mitra
    /// alone (no password login, no request at all) and the line as it was.
    #[tokio::test]
    async fn the_loop_skips_without_a_reusable_session() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        let mitra = Arc::new(Mutex::new(MitraClient::new()));
        let mut backoff = Backoff::new(Instant::now());
        let mut last_error = None;

        tick(&conn, &mitra, &mut backoff, &mut last_error).await;

        assert!(last_error.is_none());
        assert!(!mitra.lock().await.is_authenticated());
        assert!(
            backoff.is_due(Instant::now()),
            "still due once a session exists"
        );
        assert_eq!(
            ppob_status_of(&conn, item.id).await.as_deref(),
            Some(PPOB_STATUS_UNCERTAIN)
        );
    }

    /// Second audit: "Cek status" on a settled line answers its status (200).
    /// A check whose fetch failed leaves no cooldown behind, so the next click
    /// asks again instead of "Baru saja dicek" for 45 seconds.
    #[tokio::test]
    async fn cek_status_answers_settled_lines_and_cools_down() {
        let conn = setup_test_db().await;
        let mitra = Arc::new(Mutex::new(MitraClient::new()));
        let cooldown = CheckCooldown::new();
        let now = Utc::now();

        let done = seed_ppob_sale(&conn, PPOB_STATUS_SUCCESS).await;
        let result = check_with(
            &conn,
            &mitra,
            done.id,
            &cooldown,
            LoginPolicy::StoredSessionOnly,
            now,
        )
        .await
        .unwrap();
        assert_eq!(result.status, PPOB_STATUS_SUCCESS);

        let open = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        // The first check goes for the history; with no saved session (and no
        // password login allowed here) it fails before any request is sent.
        let first = check_with(
            &conn,
            &mitra,
            open.id,
            &cooldown,
            LoginPolicy::StoredSessionOnly,
            now,
        )
        .await;
        assert!(first.is_err(), "{first:?}");
        // The failed fetch released the cooldown: the retry goes for the
        // history again (and fails the same way), not "Baru saja dicek".
        let second = check_with(
            &conn,
            &mitra,
            open.id,
            &cooldown,
            LoginPolicy::StoredSessionOnly,
            now,
        )
        .await;
        assert!(second.is_err(), "{second:?}");

        // A check that is still running (or succeeded) keeps the cooldown.
        cooldown
            .try_begin(open.id, Instant::now())
            .expect("no cooldown left behind by the failures");
        let third = check_with(
            &conn,
            &mitra,
            open.id,
            &cooldown,
            LoginPolicy::StoredSessionOnly,
            now,
        )
        .await
        .unwrap();
        assert_eq!(third.status, PPOB_STATUS_UNCERTAIN);
        assert!(
            third.message.contains("Baru saja dicek"),
            "{}",
            third.message
        );

        // A line too old for the automatic check is sent to the Mitra app.
        let old = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;
        exec(
            &conn,
            "UPDATE transaction_items SET created_at = datetime('now', '-10 days') WHERE id = $1",
            vec![old.id.into()],
        )
        .await;
        let result = check_with(
            &conn,
            &mitra,
            old.id,
            &cooldown,
            LoginPolicy::StoredSessionOnly,
            now,
        )
        .await
        .unwrap();
        assert!(result.message.contains("cek manual"), "{}", result.message);
    }

    /// Releasing forgets only the check it began; a newer one stays.
    #[test]
    fn a_released_check_frees_the_line_but_not_a_newer_check() {
        let cooldown = CheckCooldown::new();
        let start = Instant::now();
        assert!(cooldown.try_begin(1, start).is_ok());
        cooldown.release(1, start);
        let later = start + std::time::Duration::from_secs(1);
        assert!(cooldown.try_begin(1, later).is_ok());
        // A stale release (the earlier check) does not drop the newer entry.
        cooldown.release(1, start);
        assert!(cooldown
            .try_begin(1, later + std::time::Duration::from_secs(1))
            .is_err());
    }

    #[test]
    fn the_cooldown_is_per_line_and_expires() {
        let cooldown = CheckCooldown::new();
        let start = Instant::now();
        assert!(cooldown.try_begin(1, start).is_ok());
        assert!(cooldown.try_begin(2, start).is_ok());
        assert_eq!(
            cooldown.try_begin(1, start + std::time::Duration::from_secs(40)),
            Err(5)
        );
        assert!(cooldown
            .try_begin(
                1,
                start + CHECK_COOLDOWN + std::time::Duration::from_secs(1)
            )
            .is_ok());
    }

    #[test]
    fn an_unmatched_row_shape_is_logged_once() {
        let row = json!({ "zz_reconcile_test_key": 1, "status": "PENDING" })
            .as_object()
            .unwrap()
            .clone();
        assert!(log_row_shape_once(&row));
        assert!(!log_row_shape_once(&row));
    }

    /// Migration 031, replayed from the shipped file (its UPDATEs; the column
    /// is already there): a line an older build stored `failed` over an ADVICE
    /// goes back to `uncertain` so it can be reconciled. A refunded line, a
    /// voided sale and a real refusal stay as they were; an ADVICE line older
    /// than the 90-day history stays failed, with a note to check by hand.
    #[tokio::test]
    async fn migration_031_turns_failed_advice_lines_back_to_uncertain() {
        use crate::domain::refunds::{CreateRefundInput, RefundItemInput};
        use crate::domain::transactions::DeleteTransactionInput;

        const MIGRATION_031: &str = include_str!("../../../migrations/031_ppob_advice.sql");
        let reclassify = &MIGRATION_031[MIGRATION_031
            .find("UPDATE transaction_items")
            .expect("the migration re-classifies")..];

        let conn = setup_test_db().await;
        let failed_with = |message: &'static str| {
            let conn = conn.clone();
            async move {
                let item = seed_ppob_sale(&conn, PPOB_STATUS_FAILED).await;
                exec(
                    &conn,
                    "UPDATE transaction_items SET ppob_message = $1 WHERE id = $2",
                    vec![message.into(), item.id.into()],
                )
                .await;
                item
            }
        };
        let current = failed_with("Mitra: ADVICE").await;
        let older = failed_with("Mitra API error: ADVICE").await;
        let refusal = failed_with("Mitra: Saldo tidak cukup").await;
        let ancient = failed_with("Mitra: ADVICE").await;
        exec(
            &conn,
            "UPDATE transaction_items SET created_at = datetime('now', '-120 days') WHERE id = $1",
            vec![ancient.id.into()],
        )
        .await;
        let refunded = failed_with("Mitra: ADVICE").await;
        crate::services::refunds::create(
            &conn,
            &admin(),
            CreateRefundInput {
                transaction_id: refunded.transaction_id,
                reason: None,
                items: vec![RefundItemInput {
                    transaction_item_id: refunded.id,
                    quantity: refunded.quantity,
                    condition: "good".into(),
                }],
                exchange_items: None,
            },
        )
        .await
        .unwrap();
        let voided = failed_with("Mitra: ADVICE").await;
        crate::services::transactions::void(
            &conn,
            &admin(),
            DeleteTransactionInput {
                transaction_id: voided.transaction_id,
                reason: "Pelanggan batal".into(),
            },
        )
        .await
        .unwrap();

        conn.execute_unprepared(reclassify).await.expect("replay");

        for item in [&current, &older] {
            let stored = line(&conn, item.id).await;
            assert_eq!(stored.ppob_status.as_deref(), Some(PPOB_STATUS_UNCERTAIN));
            assert_eq!(stored.ppob_advice.as_deref(), Some("{}"));
            assert!(stored.ppob_message.unwrap().contains("ADVICE"));
        }
        for item in [&refusal, &refunded, &voided, &ancient] {
            let stored = line(&conn, item.id).await;
            assert_eq!(stored.ppob_status.as_deref(), Some(PPOB_STATUS_FAILED));
            assert!(stored.ppob_advice.is_none());
        }
        let note = line(&conn, ancient.id).await.ppob_message.unwrap();
        assert!(note.contains("cek manual di Mitra"), "{note}");
        assert!(!line(&conn, refusal.id)
            .await
            .ppob_message
            .unwrap()
            .contains("cek manual"));
    }

    #[test]
    fn vendor_times_are_read_as_wib() {
        let at = parse_vendor_time("2026-09-28 10:11:05").unwrap();
        assert_eq!(
            at.format(TIMESTAMP_FORMAT).to_string(),
            "2026-09-28 03:11:05"
        );
        let at = parse_vendor_time("28-09-2026 10:11").unwrap();
        assert_eq!(
            at.format(TIMESTAMP_FORMAT).to_string(),
            "2026-09-28 03:11:00"
        );
        let at = parse_vendor_time("2026-09-28T03:11:05Z").unwrap();
        assert_eq!(
            at.format(TIMESTAMP_FORMAT).to_string(),
            "2026-09-28 03:11:05"
        );
        assert!(parse_vendor_time("kemarin").is_none());
    }

    #[test]
    fn a_customer_number_only_counts_whole() {
        assert!(contains_whole("NO METER : 14203938783\r\n", "14203938783"));
        assert!(contains_whole("14203938783", "14203938783"));
        assert!(!contains_whole("914203938783", "14203938783"));
        assert!(!contains_whole("142039387830", "14203938783"));
        // Which is why the payment code is parsed, not searched.
        assert!(!contains_whole(
            "L14203938783-1-260928101020",
            "14203938783"
        ));
    }

    #[test]
    fn service_names_read_as_families() {
        assert_eq!(service_family("PLN"), Some("pln"));
        assert_eq!(service_family("PAKET DATA"), Some("pulsa"));
        assert_eq!(service_family("pulsa"), Some("pulsa"));
        assert_eq!(service_family("PAYMENT POINT"), Some("pp"));
        assert_eq!(service_family("E-Money"), Some("emoney"));
        assert_eq!(service_family("BPJS Kesehatan"), Some("bpjs"));
        assert_eq!(service_family("TIKET"), None);
    }
}
