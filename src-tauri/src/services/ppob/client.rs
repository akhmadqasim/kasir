use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use reqwest::Client;
use serde_json::{json, Value};

use crate::services::ppob::history::{classify_status_word, StatusWord};
use crate::services::ppob::parsers::{find_string, parse_string, response_objects};
use crate::utils::{logging, AppError};

const BASE_URL: &str = "https://v2.mitraindogrosir.co.id/api";

/// The access token Mitra last answered "Unauthenticated" to. Shared between
/// the client and every request context it hands out, so a token that dies
/// mid-shift is noticed by the next session lookup and replaced, instead of
/// being handed out again until the app restarts.
type RejectedToken = Arc<Mutex<Option<String>>>;

#[derive(Clone)]
pub struct MitraRequestContext {
    http: Client,
    token: String,
    device_id: String,
    rejected: RejectedToken,
}

pub struct MitraClient {
    http: Client,
    pub(crate) token: Option<String>,
    pub(crate) refresh_token: Option<String>,
    pub(crate) device_id: String,
    /// The Mitra account the token belongs to, checked against the settings
    /// before the token is handed out.
    pub(crate) phone_number: String,
    rejected: RejectedToken,
}

impl MitraClient {
    pub fn new() -> Self {
        // Build the HTTP client without panicking: a reqwest build failure here
        // must not abort app startup (this is called from setup in lib.rs).
        // Fall back to a default client and log, rather than `.expect()`.
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|e| {
                eprintln!(
                    "[ppob] Gagal membuat HTTP client dengan timeout, memakai default: {}",
                    e
                );
                Client::new()
            });

        Self {
            http,
            token: None,
            refresh_token: None,
            device_id: String::new(),
            phone_number: String::new(),
            rejected: RejectedToken::default(),
        }
    }

    pub async fn login(
        &mut self,
        phone: &str,
        password: &str,
        device_id: &str,
    ) -> Result<(), AppError> {
        self.device_id = device_id.to_string();
        self.phone_number = phone.to_string();

        let resp = self
            .http
            .post(format!("{}/login", BASE_URL))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&json!({
                "phone_number": phone,
                "password": password
            }))
            .send()
            .await
            .map_err(|e| transport_failure("login", "koneksi", &e))?;

        let status = resp.status();
        let body: Value = resp.json().await.map_err(|e| {
            transport_failure("login", &format!("parsing respons (HTTP {status})"), &e)
        })?;

        if !is_ok(&body) {
            let err_msg = body["errorMessage"].as_str().unwrap_or("Login gagal");
            return Err(AppError::Upstream(format!(
                "Login Mitra gagal: {}",
                err_msg
            )));
        }

        self.token = body["access_token"].as_str().map(String::from);
        self.refresh_token = body["refresh_token"].as_str().map(String::from);

        Ok(())
    }

    /// Try refreshing the token using the refresh_token
    pub async fn try_refresh(&mut self) -> Result<bool, AppError> {
        let refresh = match &self.refresh_token {
            Some(t) => t.clone(),
            None => return Ok(false),
        };

        let resp = self
            .http
            .post(format!("{}/refresh-token", BASE_URL))
            .header("Authorization", format!("Bearer {}", refresh))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&json!({"device_id": self.device_id}))
            .send()
            .await;

        match resp {
            Ok(r) => {
                let status = r.status();
                let body: Value = r.json().await.map_err(|e| {
                    transport_failure(
                        "refresh-token",
                        &format!("parsing respons (HTTP {status})"),
                        &e,
                    )
                })?;

                if is_ok(&body) && body["access_token"].is_string() {
                    self.token = body["access_token"].as_str().map(String::from);
                    if let Some(new_refresh) = body["refresh_token"].as_str() {
                        self.refresh_token = Some(new_refresh.to_string());
                    }
                    return Ok(true);
                }
                Ok(false)
            }
            // No answer is not a refusal: the refresh token may still be good,
            // so the caller must not treat this as "log in from scratch".
            Err(e) => Err(transport_failure("refresh-token", "koneksi", &e)),
        }
    }

    pub fn is_authenticated(&self) -> bool {
        self.token.is_some()
    }

    /// Whether Mitra has answered "Unauthenticated" to the token held now.
    pub fn token_was_rejected(&self) -> bool {
        self.token.is_some()
            && self
                .rejected
                .lock()
                .is_ok_and(|rejected| *rejected == self.token)
    }

    pub fn request_context(&self) -> Result<MitraRequestContext, AppError> {
        let token = self.token.clone().ok_or_else(|| {
            AppError::Upstream("Belum login ke Mitra. Atur kredensial di Pengaturan PPOB".into())
        })?;

        Ok(MitraRequestContext {
            http: self.http.clone(),
            token,
            device_id: self.device_id.clone(),
            rejected: Arc::clone(&self.rejected),
        })
    }

    pub fn clear_auth(&mut self) {
        self.token = None;
        self.refresh_token = None;
    }
}

impl MitraRequestContext {
    /// Remember this context's token as dead if Mitra said so.
    fn note_rejection(&self, result: &Value) {
        if is_unauthenticated(result) {
            if let Ok(mut rejected) = self.rejected.lock() {
                *rejected = Some(self.token.clone());
            }
        }
    }

    pub async fn post(&self, path: &str, extra_body: Value) -> Result<Value, AppError> {
        let mut body = extra_body.as_object().cloned().unwrap_or_default();
        body.insert("device_id".to_string(), json!(self.device_id));

        let resp = self
            .http
            .post(format!("{}/{}", BASE_URL, path))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                let error = transport_failure(path, "koneksi", &e);
                // Only a failed connect proves Mitra never saw the request. A
                // timeout or a reset after that may have come after Mitra acted.
                if e.is_connect() {
                    error
                } else {
                    uncertain(error)
                }
            })?;

        let status = resp.status();
        let result: Value = resp.json().await.map_err(|e| {
            uncertain(transport_failure(
                path,
                &format!("parsing respons (HTTP {status})"),
                &e,
            ))
        })?;

        self.note_rejection(&result);
        classify_post_response(path, status, result)
    }

    pub async fn get(&self, path: &str) -> Result<Value, AppError> {
        let resp = self
            .http
            .get(format!("{}/{}", BASE_URL, path))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| transport_failure(path, "koneksi", &e))?;

        let status = resp.status();
        let result: Value = resp.json().await.map_err(|e| {
            transport_failure(path, &format!("parsing respons (HTTP {status})"), &e)
        })?;

        self.note_rejection(&result);
        validate_mitra_response(path, result)
    }
}

/// A request that never got a usable answer: no connection, or a body that
/// is not JSON (Mitra's maintenance page, a proxy's HTML). `Upstream`, so the
/// cashier reads what actually happened instead of "kesalahan pada server",
/// and logged with the endpoint because the toast does not name it.
fn transport_failure(path: &str, stage: &str, err: &dyn std::fmt::Display) -> AppError {
    log_transport_failure(path, &format!("[mitra] {path}: gagal {stage}: {err}"));
    AppError::UpstreamUnreachable {
        message: format!("Gagal {stage} ke Mitra ({path}): {err}"),
        maybe_sent: false,
    }
}

/// How long a non-purchase endpoint's transport failures share one log line.
const TRANSPORT_LOG_WINDOW: Duration = Duration::from_secs(30 * 60);

/// Per path, when its last transport failure was logged and how many were
/// left out since. A shop that is offline all day would otherwise write a
/// line for every background poll (~144 a day from the history loop alone).
#[derive(Default)]
struct TransportLogThrottle {
    paths: HashMap<String, (Instant, u32)>,
}

impl TransportLogThrottle {
    /// `Some(n)` when this failure should be logged, `n` being how many were
    /// left out since the last line for `path`; `None` to stay quiet.
    fn admit(&mut self, path: &str, now: Instant) -> Option<u32> {
        match self.paths.get_mut(path) {
            Some((last, skipped)) if now.duration_since(*last) < TRANSPORT_LOG_WINDOW => {
                *skipped += 1;
                None
            }
            Some((last, skipped)) => {
                let count = *skipped;
                *last = now;
                *skipped = 0;
                Some(count)
            }
            None => {
                self.paths.insert(path.to_string(), (now, 0));
                Some(0)
            }
        }
    }
}

static TRANSPORT_LOG: LazyLock<Mutex<TransportLogThrottle>> =
    LazyLock::new(|| Mutex::new(TransportLogThrottle::default()));

/// error.log for a transport failure. A purchase is always logged: each one
/// is money that may have moved. Any other path is logged once per
/// [`TRANSPORT_LOG_WINDOW`], with the count of the failures left out.
fn log_transport_failure(path: &str, line: &str) {
    if is_purchase_path(path) {
        logging::log_error(line);
        return;
    }
    let admitted = TRANSPORT_LOG
        .lock()
        .map(|mut throttle| throttle.admit(path, Instant::now()))
        // A poisoned lock must not cost the line.
        .unwrap_or(Some(0));
    match admitted {
        Some(0) => logging::log_error(line),
        Some(skipped) => logging::log_error(&format!(
            "{line} (+{skipped} kegagalan serupa tidak dicatat dalam 30 menit terakhir)"
        )),
        None => {}
    }
}

/// Whether `error` means Mitra never gave a usable answer (no connection, a
/// timeout, a non-JSON body) rather than answering and refusing. Decided by the
/// variant ([`AppError::UpstreamUnreachable`], built only by
/// [`transport_failure`]), never by the message: a JSON error body on an HTTP
/// 5xx is `UpstreamUncertain` ([`classify_post_response`]), yet it is an answer.
pub fn is_transport_failure(error: &AppError) -> bool {
    matches!(error, AppError::UpstreamUnreachable { .. })
}

/// A POST whose request left this machine but whose answer never arrived
/// intact, so Mitra may or may not have acted on it.
fn uncertain(error: AppError) -> AppError {
    match error {
        AppError::Upstream(message) => AppError::UpstreamUncertain(message),
        AppError::UpstreamUnreachable { message, .. } => AppError::UpstreamUnreachable {
            message,
            maybe_sent: true,
        },
        other => other,
    }
}

/// Mitra's own error text for a non-OK body.
fn error_message(result: &Value) -> &str {
    result["errorMessage"]
        .as_str()
        .or_else(|| result["message"].as_str())
        .unwrap_or("Unknown error")
}

/// A non-OK body saying the access token itself is no longer accepted.
fn is_unauthenticated(result: &Value) -> bool {
    if is_ok(result) {
        return false;
    }
    let err_msg = error_message(result);
    err_msg.contains("Unauthenticated") || err_msg.contains("unauthenticated")
}

/// A POST's answer, sorted into success, a definite refusal, or "nobody knows".
///
/// A non-OK body is not always Mitra's verdict on the request. An HTTP 5xx or
/// 408, or a body that reads like a gateway or timeout error, can come from a
/// proxy in front of Mitra or from Mitra failing part-way — after the supplier
/// may already have been paid. Calling that a failure lets the line be retried
/// and the supplier paid twice, so it is [`AppError::UpstreamUncertain`]
/// instead. A clear rejection (a 4xx with Mitra's reason, "Saldo tidak cukup",
/// an expired token) stays a plain failure. A purchase is held to a stricter
/// reading still: see [`classify_purchase_answer`].
fn classify_post_response(
    path: &str,
    status: reqwest::StatusCode,
    result: Value,
) -> Result<Value, AppError> {
    if is_purchase_path(path) {
        return classify_purchase_answer(path, status, result);
    }
    let inconclusive = answer_is_inconclusive(status, &result);
    validate_mitra_response(path, result).map_err(|error| {
        if inconclusive {
            logging::log_warning(&format!("[mitra] {path}: HTTP {status}, hasil tidak pasti"));
            uncertain(error)
        } else {
            error
        }
    })
}

/// The answer to a request that spends the outlet's balance. Only two
/// readings let the line settle on its own:
///
/// - **success:** `message` is `OK` and the `status`/`trx_status` values, at
///   the root and in every wrapper, are success words
///   ([`classify_status_word`]: sukses, success, berhasil, done, completed)
///   or success codes ([`SUCCESS_CODES`]: 00, 0, 200). An OK whose statuses
///   are absent, numeric or unknown is success too, but only when it carries
///   a delivery proof ([`has_delivery_proof`]: a token, a serial, receipt
///   data); without one it is uncertain;
/// - **failed (retryable):** a non-OK body that is a clear rejection
///   ([`is_clear_rejection`]), so Mitra turned it away before paying.
///
/// Everything else may hide a payment and is never retryable. An OK with a
/// pending status (or an `advice_id`), and any non-OK body [`is_advice`]
/// recognises, is [`AppError::UpstreamAdvice`]. An OK with a failure word
/// ("gagal") is [`AppError::UpstreamUncertain`] (Mitra said OK, so it is
/// never read as a refusal), as is every unrecognised non-OK body.
fn classify_purchase_answer(
    path: &str,
    status: reqwest::StatusCode,
    result: Value,
) -> Result<Value, AppError> {
    if is_ok(&result) {
        return classify_ok_purchase_answer(path, status, result);
    }
    if is_advice(&result) {
        // Not a refusal: the biller has the payment and has not answered yet.
        // Logged whole: the body is Mitra's opaque references and a status
        // word, which is what reconciling it later needs.
        logging::log_warning(&format!(
            "[mitra] {path}: HTTP {status}, ADVICE (hasil belum pasti): {result}"
        ));
        return Err(AppError::UpstreamAdvice(advice_reference(&result)));
    }
    if is_clear_rejection(status, &result) {
        return validate_mitra_response(path, result);
    }
    logging::log_warning(&format!(
        "[mitra] {path}: HTTP {status}, jawaban tidak dikenal (hasil tidak pasti)"
    ));
    validate_mitra_response(path, result).map_err(uncertain)
}

/// An endpoint that spends the outlet's balance: every `*/payment`, plus the
/// direct pulsa/data top-up and `confirm-payment`.
pub(crate) fn is_purchase_path(path: &str) -> bool {
    path.ends_with("/payment") || path == "pulsa/v2/topup" || path == "confirm-payment"
}

fn is_ok(result: &Value) -> bool {
    result["message"].as_str() == Some("OK")
}

/// The keys a payment answer states its own outcome in.
const STATUS_KEYS: &[&str] = &["status", "trx_status"];

/// Numeric status codes that mean the purchase went through: the ISO 8583
/// approval codes `00`/`0` and an HTTP-style `200`.
const SUCCESS_CODES: &[&str] = &["00", "0", "200"];

/// Keys whose non-blank value proves the purchase was delivered: the PLN
/// token, the provider's serial or reference number.
const DELIVERY_PROOF_KEYS: &[&str] = &["token_number", "token", "serial_number", "sn", "no_ref"];

/// How one `status`/`trx_status` value on an OK purchase answer reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PurchaseStatus {
    /// A success word or a [`SUCCESS_CODES`] code.
    Success,
    Pending,
    Failed,
    /// Any other number or word: proves nothing either way.
    Unknown,
}

fn purchase_status(word: &str) -> PurchaseStatus {
    if SUCCESS_CODES.contains(&word) {
        return PurchaseStatus::Success;
    }
    match classify_status_word(word) {
        StatusWord::Success => PurchaseStatus::Success,
        StatusWord::Failed => PurchaseStatus::Failed,
        StatusWord::Pending => PurchaseStatus::Pending,
        StatusWord::Other if is_pending_text(word) => PurchaseStatus::Pending,
        StatusWord::Other => PurchaseStatus::Unknown,
    }
}

/// Every non-blank `status`/`trx_status` on an answer, at the root and in
/// any wrapper. Empty when there is none (the `*/payment` answers seen live
/// carry none).
fn status_words(result: &Value) -> Vec<String> {
    response_objects(result)
        .flat_map(|obj| {
            STATUS_KEYS
                .iter()
                .filter_map(|key| parse_string(obj.get(*key)))
        })
        .map(|word| word.trim().to_string())
        .filter(|word| !word.is_empty())
        .collect()
}

/// The answer carries something only a delivered purchase has: a token, a
/// serial or reference number, or a non-empty `receipt_data` object.
fn has_delivery_proof(result: &Value) -> bool {
    find_string(result, DELIVERY_PROOF_KEYS).is_some()
        || result["receipt_data"]
            .as_object()
            .is_some_and(|receipt| !receipt.is_empty())
}

/// An OK answer to a purchase. A pending status (or an `advice_id`) is
/// ADVICE; a failure word is uncertain, never failed (Mitra said OK); only
/// success words and codes settle it on their own. Anything else (no status,
/// a numeric code, an unknown word) settles only with a delivery proof.
fn classify_ok_purchase_answer(
    path: &str,
    status: reqwest::StatusCode,
    result: Value,
) -> Result<Value, AppError> {
    let words = status_words(&result);
    let readings: Vec<PurchaseStatus> = words.iter().map(|w| purchase_status(w)).collect();
    let described = words.join(", ");

    if readings.contains(&PurchaseStatus::Pending) {
        logging::log_warning(&format!(
            "[mitra] {path}: HTTP {status}, OK dengan status \"{described}\" (hasil belum pasti): {result}"
        ));
        return Err(AppError::UpstreamAdvice(advice_reference(&result)));
    }
    if readings.contains(&PurchaseStatus::Failed) {
        logging::log_warning(&format!(
            "[mitra] {path}: HTTP {status}, OK dengan status \"{described}\" (hasil belum pasti): {result}"
        ));
        return Err(AppError::UpstreamUncertain(format!(
            "Mitra menjawab OK dengan status \"{described}\""
        )));
    }
    if !readings.is_empty() && readings.iter().all(|r| *r == PurchaseStatus::Success) {
        return Ok(result);
    }
    if has_advice_id(&result) {
        logging::log_warning(&format!(
            "[mitra] {path}: HTTP {status}, OK dengan advice_id (hasil belum pasti): {result}"
        ));
        return Err(AppError::UpstreamAdvice(advice_reference(&result)));
    }
    if has_delivery_proof(&result) {
        return Ok(result);
    }
    let shown = if words.is_empty() {
        "tanpa status".to_string()
    } else {
        format!("dengan status \"{described}\"")
    };
    logging::log_warning(&format!(
        "[mitra] {path}: HTTP {status}, OK {shown} dan tanpa bukti terkirim (hasil belum pasti): {result}"
    ));
    Err(AppError::UpstreamUncertain(format!(
        "Mitra menjawab OK {shown} dan tanpa token/SN"
    )))
}

/// Response codes that mean pending at the biller. `68` is the ISO 8583
/// "response received too late" code PPOB aggregators use for a suspect
/// transaction.
const PENDING_CODES: &[&str] = &["68"];

/// A pending word ([`classify_status_word`]) in `text`. Matched as whole
/// words, so "memproses" inside an error sentence does not count, and never
/// next to a failure word ("gagal diproses" is not pending).
fn is_pending_text(text: &str) -> bool {
    let words: Vec<StatusWord> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(classify_status_word)
        .collect();
    words.contains(&StatusWord::Pending) && !words.contains(&StatusWord::Failed)
}

fn has_advice_id(result: &Value) -> bool {
    find_string(result, &["advice_id"]).is_some()
}

/// A non-OK answer saying the payment went to the biller and its result is
/// still open. `{"message":"ADVICE","advice_id":…,"uid":…}` is the one seen
/// live (every store `pln/payment` so far). Read leniently, at the root and
/// in every wrapper: a pending word ([`classify_status_word`]: ADVICE,
/// PENDING, SUSPECT, proses/diproses, …) in `message`, `errorMessage`, `status` or
/// `trx_status`; a pending code ([`PENDING_CODES`], or a pending word) in
/// `rc`, `errorCode` or `response_code`; or an `advice_id` anywhere.
pub(crate) fn is_advice(result: &Value) -> bool {
    if is_ok(result) {
        return false;
    }
    let says_pending = response_objects(result).any(|obj| {
        ["message", "errorMessage", "status", "trx_status"]
            .iter()
            .filter_map(|key| parse_string(obj.get(*key)))
            .any(|text| is_pending_text(&text))
            || ["rc", "errorCode", "response_code"]
                .iter()
                .filter_map(|key| parse_string(obj.get(*key)))
                .any(|code| PENDING_CODES.contains(&code.trim()) || is_pending_text(&code))
    });
    says_pending || has_advice_id(result)
}

/// Mitra's references on an unsettled answer (`advice_id`, `uid`, `trx_id`),
/// found at the root or in any wrapper, as compact JSON text; `None` when it
/// carried none.
pub(crate) fn advice_reference(result: &Value) -> Option<String> {
    let mut reference = serde_json::Map::new();
    for key in ["advice_id", "uid", "trx_id"] {
        if let Some(value) = find_string(result, &[key]) {
            reference.insert(key.to_string(), json!(value));
        }
    }
    (!reference.is_empty()).then(|| Value::Object(reference).to_string())
}

/// Phrases in a non-OK purchase answer that mean Mitra refused it before any
/// money moved (lower case, matched as substrings of `message` +
/// `errorMessage`).
const REJECTION_PHRASES: &[&str] = &[
    // Balance.
    "saldo tidak cukup",
    "saldo anda tidak cukup",
    "saldo tidak mencukupi",
    "saldo kurang",
    "insufficient",
    // Transaction PIN.
    "pin salah",
    "pin anda salah",
    "pin tidak sesuai",
    "pin tidak valid",
    "pin transaksi salah",
    "pin terblokir",
    "invalid pin",
    "pin invalid",
    // Customer number.
    "nomor tidak valid",
    "nomor tidak ditemukan",
    "nomor salah",
    "tidak terdaftar",
    "idpel salah",
    "id pelanggan salah",
    "id pelanggan tidak ditemukan",
    "nomor meter salah",
    // Request shape, and the inquiry it quotes.
    "inputan tidak sesuai",
    "inquiry gagal",
    "inquiry tidak ditemukan",
    "inquiry expired",
    "inquiry kadaluarsa",
    "inquiry kedaluwarsa",
    // Product not on sale right now.
    "produk tidak tersedia",
    "produk tidak ditemukan",
    "sedang gangguan",
    "cut off",
    "cutoff",
];

/// A non-OK purchase answer that is a clear refusal, so the line may be
/// retried. A dead token always is. Otherwise never on a 5xx/408 or a
/// gateway/timeout body; then a validation answer (`errorCode` `VL…` such as
/// VL001, or a non-empty `errors` map), an HTTP 401/403/404/405/422/429, or
/// one of [`REJECTION_PHRASES`].
fn is_clear_rejection(status: reqwest::StatusCode, result: &Value) -> bool {
    use reqwest::StatusCode;

    if is_unauthenticated(result) {
        return true;
    }
    if looks_inconclusive(status, result) {
        return false;
    }
    let is_validation_code = result["errorCode"]
        .as_str()
        .is_some_and(|code| code.trim().to_uppercase().starts_with("VL"));
    let has_field_errors = result["errors"]
        .as_object()
        .is_some_and(|errors| !errors.is_empty());
    let refused_by_status = matches!(
        status,
        StatusCode::UNAUTHORIZED
            | StatusCode::FORBIDDEN
            | StatusCode::NOT_FOUND
            | StatusCode::METHOD_NOT_ALLOWED
            | StatusCode::UNPROCESSABLE_ENTITY
            | StatusCode::TOO_MANY_REQUESTS
    );
    let text = answer_text(result);
    is_validation_code
        || has_field_errors
        || refused_by_status
        || REJECTION_PHRASES.iter().any(|phrase| text.contains(phrase))
}

/// `message` and `errorMessage` of an answer, lower case, for phrase checks.
fn answer_text(result: &Value) -> String {
    format!(
        "{} {}",
        result["message"].as_str().unwrap_or(""),
        result["errorMessage"].as_str().unwrap_or("")
    )
    .to_lowercase()
}

/// Whether a non-OK answer leaves it open whether Mitra acted.
fn answer_is_inconclusive(status: reqwest::StatusCode, result: &Value) -> bool {
    // An OK body is success whatever the status; a rejected token means Mitra
    // turned the request away before doing anything.
    !is_ok(result) && !is_unauthenticated(result) && looks_inconclusive(status, result)
}

/// The status or the text reads like a gateway or timeout error. The caller
/// rules out an OK body and a dead token first.
fn looks_inconclusive(status: reqwest::StatusCode, result: &Value) -> bool {
    if status.is_server_error() || status == reqwest::StatusCode::REQUEST_TIMEOUT {
        return true;
    }
    let text = answer_text(result);
    [
        "gateway",
        "timeout",
        "timed out",
        "time out",
        "service unavailable",
        "internal server error",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

/// Every non-OK Mitra body goes to warning.log with its endpoint, code and
/// message before it becomes an error — the toast the cashier sees is gone in
/// seconds, the log is what gets read afterwards. Error bodies carry no
/// customer data, so they are logged whole.
fn validate_mitra_response(path: &str, result: Value) -> Result<Value, AppError> {
    if !is_ok(&result) {
        let err_msg = error_message(&result);

        logging::log_warning(&format!(
            "[mitra] {path} -> {} {}: {}",
            result["errorCode"].as_str().unwrap_or("-"),
            err_msg,
            result
        ));

        if is_unauthenticated(&result) {
            return Err(AppError::Upstream(
                "Sesi Mitra expired. Silakan coba lagi.".into(),
            ));
        }

        let detail = if let Some(errors) = result["errors"].as_object() {
            let fields: Vec<String> = errors
                .iter()
                .filter_map(|(k, v)| {
                    v.as_array().and_then(|msgs| {
                        msgs.first()
                            .and_then(|m| m.as_str())
                            .map(|m| format!("{}: {}", k, m))
                    })
                })
                .collect();
            if fields.is_empty() {
                err_msg.to_string()
            } else {
                format!("{} ({})", err_msg, fields.join(", "))
            }
        } else {
            err_msg.to_string()
        };

        // `Upstream`, not `Internal`: this is Mitra's verdict on the request
        // ("Inquiry Gagal", "Saldo tidak cukup"), and the cashier needs to
        // read it. `Internal` would have hidden it behind a generic sentence.
        return Err(AppError::Upstream(format!("Mitra: {}", detail)));
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An "Unauthenticated" body is the upstream account's own session dying,
    /// not ours. It must become `Upstream` (the http layer maps that to 502),
    /// never `Auth` — `Auth` maps to 401, and the frontend treats every 401 as
    /// "our session is gone, log out", which would boot the cashier out of the
    /// whole app over a Mitra token expiring.
    #[test]
    fn an_unauthenticated_upstream_body_is_an_upstream_error_not_our_auth() {
        let body = json!({
            "message": "Unauthorized",
            "errorMessage": "Unauthenticated."
        });

        let err =
            validate_mitra_response("get-menu-saldo", body).expect_err("Unauthenticated must fail");
        assert!(
            matches!(err, AppError::Upstream(_)),
            "expected AppError::Upstream, got {err:?}"
        );
        assert!(!matches!(err, AppError::Auth(_)));
    }

    /// The lowercase form the API also uses must be classified the same way.
    #[test]
    fn a_lowercase_unauthenticated_body_is_also_upstream() {
        let body = json!({
            "message": "error",
            "errorMessage": "unauthenticated token"
        });

        let err =
            validate_mitra_response("get-menu-saldo", body).expect_err("unauthenticated must fail");
        assert!(matches!(err, AppError::Upstream(_)));
    }

    /// A validation-shaped failure from Mitra (not an auth problem at all)
    /// is `Upstream` too, and carries Mitra's own words plus the field
    /// detail — that is what the cashier reads in the toast.
    #[test]
    fn a_non_auth_mitra_error_is_upstream_with_its_message() {
        let body = json!({
            "message": "error",
            "errorMessage": "Nomor tidak valid",
            "errors": { "phone_number": ["Nomor tidak valid"] }
        });

        match validate_mitra_response("pulsa/v2/get-details", body)
            .expect_err("validation error must fail")
        {
            AppError::Upstream(message) => {
                assert_eq!(
                    message,
                    "Mitra: Nomor tidak valid (phone_number: Nomor tidak valid)"
                )
            }
            other => panic!("expected Upstream, got {other:?}"),
        }
    }

    /// A token Mitra rejected is recognised by the client that handed it
    /// out, and only while that client still holds it — a token replaced by a
    /// refresh or a new login is not dropped over its predecessor's rejection.
    #[test]
    fn a_rejected_token_is_noticed_until_it_is_replaced() {
        let mut client = MitraClient::new();
        client.token = Some("old".to_string());
        let context = client.request_context().expect("token is set");

        context.note_rejection(&json!({ "message": "OK" }));
        assert!(!client.token_was_rejected());

        context.note_rejection(&json!({
            "message": "Unauthorized",
            "errorMessage": "Unauthenticated."
        }));
        assert!(client.token_was_rejected());

        client.token = Some("new".to_string());
        assert!(!client.token_was_rejected());
    }

    /// A dropped connection or an unreadable body is a transport failure; any
    /// verdict Mitra itself returned, the expired-session one included, is not.
    /// Told apart by the variant, so Mitra text that happens to read like ours
    /// is still a refusal.
    #[test]
    fn transport_failures_are_told_apart_from_mitra_refusals() {
        let connect = transport_failure("get-menu-saldo", "koneksi", &"connection refused");
        assert!(is_transport_failure(&connect));
        assert!(matches!(
            connect,
            AppError::UpstreamUnreachable {
                maybe_sent: false,
                ..
            }
        ));
        // A timeout after sending may have reached Mitra.
        assert!(matches!(
            uncertain(transport_failure("pln/payment", "koneksi", &"timed out")),
            AppError::UpstreamUnreachable {
                maybe_sent: true,
                ..
            }
        ));
        assert!(!is_transport_failure(&AppError::Upstream(
            "Gagal koneksi ke Mitra (get-menu-saldo): refused".into()
        )));
        assert!(!is_transport_failure(&AppError::UpstreamUncertain(
            "Gagal parsing respons ke Mitra (pln/payment): x".into()
        )));
        assert!(is_transport_failure(&uncertain(transport_failure(
            "get-menu-saldo",
            "parsing respons (HTTP 502)",
            &"expected value",
        ))));

        let expired = validate_mitra_response(
            "get-menu-saldo",
            json!({ "message": "Unauthorized", "errorMessage": "Unauthenticated." }),
        )
        .expect_err("rejected token");
        assert!(!is_transport_failure(&expired));

        let refused = validate_mitra_response(
            "get-menu-saldo",
            json!({ "message": "Error", "errorMessage": "Gagal ke Mitra (x)" }),
        )
        .expect_err("mitra error");
        assert!(!is_transport_failure(&refused));

        assert!(!is_transport_failure(&AppError::Internal(
            "Gagal ke Mitra (x)".into()
        )));
    }

    /// A 5xx carrying a JSON error body is uncertain for a payment, but it is
    /// still an answer: restoring a saved session must go on to refresh or log
    /// in again, not stop as if the network were down.
    #[test]
    fn a_5xx_with_a_json_body_is_not_a_transport_failure() {
        let err = classify_post_response(
            "get-menu-saldo",
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "message": "error", "errorMessage": "Server Error" }),
        )
        .expect_err("not OK must fail");
        assert!(matches!(err, AppError::UpstreamUncertain(_)));
        assert!(!is_transport_failure(&err));

        let timeout = uncertain(transport_failure("get-menu-saldo", "koneksi", &"timed out"));
        assert!(is_transport_failure(&timeout));
    }

    /// A 5xx, a 408 or a gateway/timeout body on a POST may have come after
    /// Mitra paid the supplier: uncertain, never a retryable failure.
    #[test]
    fn a_server_or_gateway_error_on_a_post_is_uncertain() {
        use reqwest::StatusCode;

        let cases = [
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "message": "Server Error" }),
            ),
            (
                StatusCode::BAD_GATEWAY,
                json!({ "message": "error", "errorMessage": "Transaksi Gagal" }),
            ),
            (
                StatusCode::GATEWAY_TIMEOUT,
                json!({ "message": "Gateway Timeout" }),
            ),
            (StatusCode::REQUEST_TIMEOUT, json!({ "message": "error" })),
            // A proxy that answers 200 with its own error body.
            (
                StatusCode::OK,
                json!({ "message": "error", "errorMessage": "Request timed out" }),
            ),
        ];
        for (status, body) in cases {
            let err = classify_post_response("pln/payment", status, body.clone())
                .expect_err("not OK must fail");
            assert!(
                matches!(err, AppError::UpstreamUncertain(_)),
                "{status} {body}: expected UpstreamUncertain, got {err:?}"
            );
        }
    }

    /// Mitra's own clear rejections stay definite failures, so the cashier
    /// may fix the input and try again.
    #[test]
    fn a_clear_rejection_on_a_post_stays_a_failure() {
        use reqwest::StatusCode;

        let cases = [
            (
                StatusCode::OK,
                json!({ "message": "error", "errorMessage": "Saldo tidak cukup" }),
            ),
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({
                    "message": "error",
                    "errorMessage": "Nomor tidak valid",
                    "errors": { "phone_number": ["Nomor tidak valid"] }
                }),
            ),
            (
                StatusCode::BAD_REQUEST,
                json!({ "message": "error", "errorMessage": "Inquiry Gagal" }),
            ),
            // A dead token is turned away before anything is done, even when
            // the status says server error.
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "message": "Unauthorized", "errorMessage": "Unauthenticated." }),
            ),
        ];
        for (status, body) in cases {
            let err = classify_post_response("pln/payment", status, body.clone())
                .expect_err("not OK must fail");
            assert!(
                matches!(err, AppError::Upstream(_)),
                "{status} {body}: expected Upstream, got {err:?}"
            );
        }

        let ok = json!({ "message": "OK", "data": { "token_number": "1111 2222" } });
        assert_eq!(
            classify_post_response("pln/payment", StatusCode::BAD_GATEWAY, ok.clone())
                .expect("an OK body is success"),
            ok
        );
    }

    /// The exact reply the store PC logged from `pln/payment`: ADVICE means the
    /// biller has the payment and has not answered yet — never a failure a
    /// retry may pay again. Mitra's two references come along for reconciling.
    #[test]
    fn an_advice_reply_to_a_payment_is_advice_with_its_references() {
        use reqwest::StatusCode;

        let body: Value = serde_json::from_str(
            r#"{"advice_id":"eyJpdiI6IkFEVklDRSJ9","message":"ADVICE","uid":"eyJpdiI6IlVJRCJ9"}"#,
        )
        .unwrap();

        for path in [
            "pln/payment",
            "pdam/payment",
            "bpjs/payment",
            "pulsa/v2/topup",
        ] {
            match classify_post_response(path, StatusCode::OK, body.clone()) {
                Err(AppError::UpstreamAdvice(Some(reference))) => {
                    let reference: Value = serde_json::from_str(&reference).unwrap();
                    assert_eq!(reference["advice_id"], "eyJpdiI6IkFEVklDRSJ9");
                    assert_eq!(reference["uid"], "eyJpdiI6IlVJRCJ9");
                }
                other => panic!("{path}: expected UpstreamAdvice, got {other:?}"),
            }
        }

        // The word alone, with no references, is still ADVICE.
        assert!(matches!(
            classify_post_response(
                "pln/payment",
                StatusCode::OK,
                json!({ "message": "ADVICE" })
            ),
            Err(AppError::UpstreamAdvice(None))
        ));

        // An inquiry is not a purchase: nothing was spent, so it stays a
        // plain refusal there.
        assert!(matches!(
            classify_post_response("pln/inquiry", StatusCode::OK, body),
            Err(AppError::Upstream(_))
        ));
    }

    #[test]
    fn an_ok_response_passes_through_unchanged() {
        let body = json!({ "message": "OK", "data": 1 });
        let result = validate_mitra_response("pln/inquiry", body.clone()).expect("OK must pass");
        assert_eq!(result, body);
    }

    /// The reply every store `pln/payment` got, in the shape it arrived
    /// (HTTP 200, two Laravel-encrypted references): ADVICE, never failed.
    #[test]
    fn the_store_pln_payment_reply_is_advice() {
        let body: Value = serde_json::from_str(
            r#"{"advice_id":"eyJpdiI6Ik1yQ1N6b2VxWFdLZ0R3PT0iLCJ2YWx1ZSI6IkJ4In0=","message":"ADVICE","uid":"eyJpdiI6IlpYa0RyQ2N3PT0iLCJ2YWx1ZSI6IlV4In0="}"#,
        )
        .unwrap();
        match classify_post_response("pln/payment", reqwest::StatusCode::OK, body) {
            Err(AppError::UpstreamAdvice(Some(reference))) => {
                let reference: Value = serde_json::from_str(&reference).unwrap();
                assert!(reference["advice_id"]
                    .as_str()
                    .unwrap()
                    .starts_with("eyJpdiI6"));
                assert!(reference["uid"].as_str().unwrap().starts_with("eyJpdiI6"));
            }
            other => panic!("expected UpstreamAdvice, got {other:?}"),
        }
    }

    /// `message: OK` is not enough on a purchase. Success words and the
    /// success codes settle it; a pending word is ADVICE; a failure word is
    /// uncertain; anything else (no status, another code, an unknown word)
    /// settles only with a delivery proof.
    #[test]
    fn an_ok_purchase_answer_settles_by_status_and_delivery_proof() {
        use reqwest::StatusCode;

        // Settled by the status alone: success words and the numeric success
        // codes "00", "0" and "200", even with no token or SN.
        for body in [
            json!({ "message": "OK", "data": { "status": "SUKSES", "trx_id": "50151852" } }),
            json!({ "message": "OK", "status": "success", "history_payment": { "trx_status": "Berhasil" } }),
            json!({ "message": "OK", "status": "00" }),
            json!({ "message": "OK", "data": { "status": "0" } }),
            json!({ "message": "OK", "status": 200 }),
            json!({ "message": "OK", "status": 0, "history_payment": { "trx_status": "SUKSES" } }),
        ] {
            assert_eq!(
                classify_post_response("pln/payment", StatusCode::OK, body.clone())
                    .expect("success"),
                body,
                "{body}"
            );
        }

        // No status, another code or an unknown word: success with a
        // delivery proof (token, SN, provider reference, receipt data).
        for body in [
            json!({ "message": "OK", "token_number": "1111 2222 3333 4444 5555" }),
            json!({ "message": "OK", "data": { "status": "2", "sn": "SN-77" } }),
            json!({ "message": "OK", "status": "DELIVERED", "history_payment": { "no_ref": "REF-1" } }),
            json!({ "message": "OK", "receipt_data": { "customer_name": "BUDI" } }),
        ] {
            assert_eq!(
                classify_post_response("pulsa/v2/topup", StatusCode::OK, body.clone())
                    .expect("success with a delivery proof"),
                body,
                "{body}"
            );
        }

        // ...and uncertain without one. Blank proofs do not count.
        for body in [
            json!({ "message": "OK" }),
            json!({ "message": "OK", "data": 1 }),
            json!({ "message": "OK", "data": { "status": "2" } }),
            json!({ "message": "OK", "status": "DELIVERED", "sn": "", "receipt_data": {} }),
        ] {
            assert!(
                matches!(
                    classify_post_response("bpjs/payment", StatusCode::OK, body.clone()),
                    Err(AppError::UpstreamUncertain(_))
                ),
                "{body}"
            );
        }

        // Pending: ADVICE, with whatever reference the answer carried.
        let pulsa_pending = json!({
            "message": "OK",
            "history_payment": { "trx_id": "50151852", "status": "PENDING", "no_ref": "" }
        });
        match classify_post_response("pulsa/v2/topup", StatusCode::OK, pulsa_pending) {
            Err(AppError::UpstreamAdvice(Some(reference))) => {
                assert_eq!(reference, r#"{"trx_id":"50151852"}"#)
            }
            other => panic!("pulsa PENDING: expected UpstreamAdvice, got {other:?}"),
        }
        for body in [
            json!({ "message": "OK", "data": { "status": "Proses" } }),
            json!({ "message": "OK", "trx_status": "SUSPECT" }),
            json!({ "message": "OK", "status": "advice" }),
            json!({ "message": "OK", "data": { "status": "Menunggu", "advice_id": "eyJpdiI6IkEifQ==" } }),
            // A pending word wins over a success code next to it, and over a
            // serial that may be a placeholder.
            json!({ "message": "OK", "status": "00", "data": { "status": "PENDING", "sn": "SN-1" } }),
            // An unknown status with an advice_id is still waiting.
            json!({ "message": "OK", "status": "7", "advice_id": "A1" }),
        ] {
            assert!(
                matches!(
                    classify_post_response("pdam/payment", StatusCode::OK, body.clone()),
                    Err(AppError::UpstreamAdvice(_))
                ),
                "{body}"
            );
        }

        // A failure word on an OK answer: uncertain, never retryable, even
        // next to a success code or a serial.
        for body in [
            json!({ "message": "OK", "status": "GAGAL" }),
            json!({ "message": "OK", "status": "00", "data": { "trx_status": "Failed", "sn": "SN-1" } }),
        ] {
            assert!(
                matches!(
                    classify_post_response("bpjs/payment", StatusCode::OK, body.clone()),
                    Err(AppError::UpstreamUncertain(_))
                ),
                "{body}"
            );
        }

        // An inquiry's status is not a purchase outcome.
        let inquiry = json!({ "message": "OK", "data": { "status": "BELUM BAYAR" } });
        assert!(classify_post_response("pln/inquiry", StatusCode::OK, inquiry).is_ok());
    }

    /// Pending words and codes on a non-OK purchase answer are ADVICE, not a
    /// failure a retry could pay twice.
    #[test]
    fn a_non_ok_pending_answer_is_advice() {
        use reqwest::StatusCode;

        for body in [
            json!({ "message": "PENDING" }),
            json!({ "message": "SUSPECT", "errorMessage": "Transaksi suspect" }),
            json!({ "message": "ERROR", "errorMessage": "Transaksi sedang diproses" }),
            json!({ "message": "ERROR", "errorCode": "68", "errorMessage": "Belum ada respon biller" }),
            json!({ "message": "ERROR", "rc": 68 }),
            json!({ "message": "ERROR", "errorCode": "PENDING" }),
            json!({ "message": "ERROR", "status": "Pending" }),
            json!({ "message": "ERROR", "data": { "advice_id": "eyJpdiI6IkEifQ==" } }),
        ] {
            assert!(is_advice(&body), "{body}");
            assert!(
                matches!(
                    classify_post_response("pln/payment", StatusCode::OK, body.clone()),
                    Err(AppError::UpstreamAdvice(_))
                ),
                "{body}"
            );
        }

        // A nested advice_id is the reference kept.
        assert_eq!(
            advice_reference(&json!({ "message": "ERROR", "data": { "advice_id": "A1" } }))
                .as_deref(),
            Some(r#"{"advice_id":"A1"}"#)
        );

        // "memproses" in a sentence, or pending next to a failure word, is not.
        for body in [
            json!({ "message": "ERROR", "errorMessage": "Gagal memproses permintaan" }),
            json!({ "message": "ERROR", "errorMessage": "Transaksi gagal diproses" }),
            json!({ "message": "OK", "status": "PENDING" }),
        ] {
            assert!(!is_advice(&body), "{body}");
        }
    }

    /// A non-OK purchase answer that is not a clear rejection may hide a
    /// payment: uncertain. The clear ones stay retryable.
    #[test]
    fn an_unrecognised_purchase_refusal_is_uncertain_and_clear_ones_fail() {
        use reqwest::StatusCode;

        for (status, body) in [
            (
                StatusCode::OK,
                json!({ "message": "ERROR", "errorCode": "TR999", "errorMessage": "Transaksi Gagal" }),
            ),
            (StatusCode::OK, json!({ "message": "ERROR" })),
            (
                StatusCode::BAD_REQUEST,
                json!({ "message": "ERROR", "errorMessage": "Transaksi gagal diproses" }),
            ),
            // A phrase that would be a rejection does not count on a 5xx.
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "message": "ERROR", "errorMessage": "Saldo tidak cukup" }),
            ),
        ] {
            assert!(
                matches!(
                    classify_post_response("emoney/payment", status, body.clone()),
                    Err(AppError::UpstreamUncertain(_))
                ),
                "{status} {body}"
            );
        }

        for (status, body) in [
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({
                    "message": "ERROR",
                    "errorCode": "VL001",
                    "errorMessage": "Inputan tidak sesuai",
                    "errors": { "product_code": ["The product code field is required."] }
                }),
            ),
            (
                StatusCode::OK,
                json!({ "message": "ERROR", "errorCode": "VL001", "errorMessage": "Inputan tidak sesuai" }),
            ),
            (
                StatusCode::OK,
                json!({ "message": "ERROR", "errorCode": "TR001", "errorMessage": "Saldo Anda tidak cukup" }),
            ),
            (
                StatusCode::OK,
                json!({ "message": "ERROR", "errorCode": "PN001", "errorMessage": "PIN salah" }),
            ),
            (
                StatusCode::OK,
                json!({ "message": "ERROR", "errorMessage": "Nomor tidak valid" }),
            ),
            (
                StatusCode::OK,
                json!({ "message": "ERROR", "errorMessage": "Produk sedang gangguan" }),
            ),
            (
                StatusCode::TOO_MANY_REQUESTS,
                json!({ "message": "Too Many Attempts." }),
            ),
        ] {
            assert!(
                matches!(
                    classify_post_response("pulsa/v2/topup", status, body.clone()),
                    Err(AppError::Upstream(_))
                ),
                "{status} {body}"
            );
        }

        // Outside a purchase an unrecognised refusal is still a plain one.
        assert!(matches!(
            classify_post_response(
                "pdam/inquiry",
                StatusCode::OK,
                json!({ "message": "ERROR", "errorMessage": "Transaksi Gagal" })
            ),
            Err(AppError::Upstream(_))
        ));
    }

    /// One line per path per 30 minutes, the next one carrying the count of
    /// the failures left out; each path keeps its own clock.
    #[test]
    fn transport_failure_logging_is_rate_limited_per_path() {
        let mut throttle = TransportLogThrottle::default();
        let start = Instant::now();
        let minutes = |m: u64| start + Duration::from_secs(m * 60);

        assert_eq!(throttle.admit("history-payment", start), Some(0));
        assert_eq!(throttle.admit("history-payment", minutes(10)), None);
        assert_eq!(throttle.admit("history-payment", minutes(20)), None);
        assert_eq!(throttle.admit("get-menu-saldo", minutes(20)), Some(0));
        assert_eq!(throttle.admit("history-payment", minutes(31)), Some(2));
        assert_eq!(throttle.admit("history-payment", minutes(40)), None);
        assert_eq!(throttle.admit("history-payment", minutes(62)), Some(1));
    }
}
