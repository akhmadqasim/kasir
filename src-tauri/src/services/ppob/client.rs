use reqwest::Client;
use serde_json::{json, Value};

use crate::domain::ppob::PpobSaldoResponse;
use crate::utils::{logging, AppError};

const BASE_URL: &str = "https://v2.mitraindogrosir.co.id/api";

#[derive(Clone)]
pub struct MitraRequestContext {
    http: Client,
    token: String,
    device_id: String,
}

pub struct MitraClient {
    http: Client,
    pub(crate) token: Option<String>,
    pub(crate) refresh_token: Option<String>,
    pub(crate) device_id: String,
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
        }
    }

    pub async fn login(
        &mut self,
        phone: &str,
        password: &str,
        device_id: &str,
    ) -> Result<PpobSaldoResponse, AppError> {
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
            .map_err(|e| AppError::Internal(format!("Gagal koneksi ke Mitra: {}", e)))?;

        let body: Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Gagal parsing response Mitra: {}", e)))?;

        if body["message"].as_str() != Some("OK") {
            let err_msg = body["errorMessage"].as_str().unwrap_or("Login gagal");
            return Err(AppError::Upstream(format!(
                "Login Mitra gagal: {}",
                err_msg
            )));
        }

        self.token = body["access_token"].as_str().map(String::from);
        self.refresh_token = body["refresh_token"].as_str().map(String::from);

        Ok(PpobSaldoResponse {
            saldo: 0.0,
            username: body["detail_member"]["username"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            store_name: body["detail_member"]["store_name"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            flag_member: body["flag_member"].as_str().unwrap_or("").to_string(),
        })
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
                let body: Value = r.json().await.map_err(|e| {
                    AppError::Internal(format!("Gagal parsing refresh response: {}", e))
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
            Err(_) => Ok(false),
        }
    }

    pub fn is_authenticated(&self) -> bool {
        self.token.is_some()
    }

    pub fn request_context(&self) -> Result<MitraRequestContext, AppError> {
        let token = self.token.clone().ok_or_else(|| {
            AppError::Upstream("Belum login ke Mitra. Atur kredensial di Pengaturan PPOB".into())
        })?;

        Ok(MitraRequestContext {
            http: self.http.clone(),
            token,
            device_id: self.device_id.clone(),
        })
    }

    pub fn clear_auth(&mut self) {
        self.token = None;
        self.refresh_token = None;
    }
}

impl MitraRequestContext {
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
            .map_err(|e| transport_failure(path, "koneksi", &e))?;

        let status = resp.status();
        let result: Value = resp.json().await.map_err(|e| {
            transport_failure(path, &format!("parsing respons (HTTP {status})"), &e)
        })?;

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

        validate_mitra_response(path, result)
    }
}

/// A request that never got a usable answer: no connection, or a body that
/// is not JSON (Mitra's maintenance page, a proxy's HTML). `Upstream`, so the
/// cashier reads what actually happened instead of "kesalahan pada server",
/// and logged with the endpoint because the toast does not name it.
fn transport_failure(path: &str, stage: &str, err: &dyn std::fmt::Display) -> AppError {
    logging::log_error(&format!("[mitra] {path}: gagal {stage}: {err}"));
    AppError::Upstream(format!("Gagal {stage} ke Mitra ({path}): {err}"))
}

/// Every non-OK Mitra body goes to warning.log with its endpoint, code and
/// message before it becomes an error — the toast the cashier sees is gone in
/// seconds, the log is what gets read afterwards. Error bodies carry no
/// customer data, so they are logged whole.
fn validate_mitra_response(path: &str, result: Value) -> Result<Value, AppError> {
    if result["message"].as_str() != Some("OK") {
        let err_msg = result["errorMessage"]
            .as_str()
            .or_else(|| result["message"].as_str())
            .unwrap_or("Unknown error");

        logging::log_warning(&format!(
            "[mitra] {path} -> {} {}: {}",
            result["errorCode"].as_str().unwrap_or("-"),
            err_msg,
            result
        ));

        if err_msg.contains("Unauthenticated") || err_msg.contains("unauthenticated") {
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

    #[test]
    fn an_ok_response_passes_through_unchanged() {
        let body = json!({ "message": "OK", "data": 1 });
        let result = validate_mitra_response("pln/inquiry", body.clone()).expect("OK must pass");
        assert_eq!(result, body);
    }
}
