use reqwest::Client;
use serde_json::{json, Value};

use super::models::PpobSaldoResponse;
use crate::utils::AppError;

const BASE_URL: &str = "https://v2.mitraindogrosir.co.id/api";

pub struct MitraClient {
    http: Client,
    pub(crate) token: Option<String>,
    pub(crate) refresh_token: Option<String>,
    pub(crate) device_id: String,
}

impl MitraClient {
    pub fn new() -> Self {
        Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("Failed to create HTTP client"),
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
            return Err(AppError::Auth(format!("Login Mitra gagal: {}", err_msg)));
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
            Err(e) => {
                Ok(false)
            }
        }
    }

    pub fn is_authenticated(&self) -> bool {
        self.token.is_some()
    }

    pub fn clear_auth(&mut self) {
        self.token = None;
        self.refresh_token = None;
    }

    async fn ensure_auth(&self) -> Result<&str, AppError> {
        self.token.as_deref().ok_or_else(|| {
            AppError::Auth("Belum login ke Mitra. Atur kredensial di Pengaturan PPOB".into())
        })
    }

    pub async fn post(&self, path: &str, extra_body: Value) -> Result<Value, AppError> {
        let token = self.ensure_auth().await?;

        let mut body = extra_body.as_object().cloned().unwrap_or_default();
        body.insert("device_id".to_string(), json!(self.device_id));

        let resp = self
            .http
            .post(format!("{}/{}", BASE_URL, path))
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Gagal koneksi ke Mitra: {}", e)))?;

        let result: Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Gagal parsing response: {}", e)))?;

        if result["message"].as_str() != Some("OK") {
            let err_msg = result["errorMessage"]
                .as_str()
                .or_else(|| result["message"].as_str())
                .unwrap_or("Unknown error");
            // Detect auth errors specifically
            if err_msg.contains("Unauthenticated") || err_msg.contains("unauthenticated") {
                return Err(AppError::Auth(format!(
                    "Sesi Mitra expired. Silakan coba lagi."
                )));
            }
            return Err(AppError::Internal(format!("Mitra API error: {}", err_msg)));
        }

        Ok(result)
    }

    pub async fn get(&self, path: &str) -> Result<Value, AppError> {
        let token = self.ensure_auth().await?;

        let resp = self
            .http
            .get(format!("{}/{}", BASE_URL, path))
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Gagal koneksi ke Mitra: {}", e)))?;

        let result: Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Gagal parsing response: {}", e)))?;

        if result["message"].as_str() != Some("OK") {
            let err_msg = result["errorMessage"]
                .as_str()
                .or_else(|| result["message"].as_str())
                .unwrap_or("Unknown error");
            if err_msg.contains("Unauthenticated") || err_msg.contains("unauthenticated") {
                return Err(AppError::Auth(format!(
                    "Sesi Mitra expired. Silakan coba lagi."
                )));
            }
            return Err(AppError::Internal(format!("Mitra API error: {}", err_msg)));
        }

        Ok(result)
    }
}
