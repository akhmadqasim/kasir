use std::sync::{Arc, Mutex};

use reqwest::Client;
use serde_json::{json, Value};

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

        if body["message"].as_str() != Some("OK") {
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

                if body["message"].as_str() == Some("OK") && body["access_token"].is_string() {
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
        validate_mitra_response(path, result)
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
    logging::log_error(&format!("[mitra] {path}: gagal {stage}: {err}"));
    AppError::Upstream(format!(
        "Gagal {stage}{TRANSPORT_FAILURE_MARKER}{path}): {err}"
    ))
}

/// Sits in every [`transport_failure`] message and in no message built from
/// a Mitra response body, which is what lets [`is_transport_failure`] tell
/// the two apart.
const TRANSPORT_FAILURE_MARKER: &str = " ke Mitra (";

/// Whether `error` means Mitra never gave a usable answer — no connection, a
/// timeout, a body that is not JSON — as opposed to Mitra answering and
/// refusing. Only a refusal says anything about the token that was sent.
pub fn is_transport_failure(error: &AppError) -> bool {
    match error {
        AppError::UpstreamUncertain(_) => true,
        AppError::Upstream(message) => {
            message.starts_with("Gagal ") && message.contains(TRANSPORT_FAILURE_MARKER)
        }
        _ => false,
    }
}

/// A POST whose request left this machine but whose answer never arrived
/// intact, so Mitra may or may not have acted on it.
fn uncertain(error: AppError) -> AppError {
    match error {
        AppError::Upstream(message) => AppError::UpstreamUncertain(message),
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
    if result["message"].as_str() == Some("OK") {
        return false;
    }
    let err_msg = error_message(result);
    err_msg.contains("Unauthenticated") || err_msg.contains("unauthenticated")
}

/// Every non-OK Mitra body goes to warning.log with its endpoint, code and
/// message before it becomes an error — the toast the cashier sees is gone in
/// seconds, the log is what gets read afterwards. Error bodies carry no
/// customer data, so they are logged whole.
fn validate_mitra_response(path: &str, result: Value) -> Result<Value, AppError> {
    if result["message"].as_str() != Some("OK") {
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
    #[test]
    fn transport_failures_are_told_apart_from_mitra_refusals() {
        let connect = transport_failure("get-menu-saldo", "koneksi", &"connection refused");
        assert!(is_transport_failure(&connect));
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

    #[test]
    fn an_ok_response_passes_through_unchanged() {
        let body = json!({ "message": "OK", "data": 1 });
        let result = validate_mitra_response("pln/inquiry", body.clone()).expect("OK must pass");
        assert_eq!(result, body);
    }
}
