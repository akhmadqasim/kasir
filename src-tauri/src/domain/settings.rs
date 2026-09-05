//! App settings as they are stored in `store_info.additional_info`.
//!
//! Everything here is pure: the types, the obfuscation of the PPOB credentials,
//! and the tolerant parse that turns the free-form JSON blob into them. It sits
//! in `domain` rather than `services` because both the settings service and the
//! PPOB session need it, and because it touches nothing but the string it is
//! handed.

use serde::{Deserialize, Serialize};

use crate::domain::backup::BackupSettings;

// Simple obfuscation for sensitive fields stored in DB
// Prevents plaintext credential exposure in database files
const OBFUSCATION_KEY: &[u8] = b"kasir-pos-2025-secure";

pub fn obfuscate(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }
    let bytes: Vec<u8> = input
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect();
    format!(
        "OBF:{}",
        bytes
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>()
    )
}

/// Decode an even-length ASCII hex string, or `None` if it is not one.
///
/// The caller used to index `&hex[i..i + 2]` for every `i` in
/// `(0..hex.len()).step_by(2)`, which panics on the last pair of an odd-length
/// payload and on any non-ASCII byte that a 2-byte window splits. Checking the
/// shape up front makes both impossible.
fn hex_to_bytes(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) || !hex.is_ascii() {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

/// Reverse [`obfuscate`]. Values without the marker are legacy plaintext and are
/// returned unchanged.
///
/// A corrupt `OBF:` payload yields an empty string rather than a panic.
/// [`parse_app_settings`] is on the path of `get_app_settings`,
/// `update_app_settings`, `services/ppob/executor.rs` and
/// `commands/ppob/inquiry.rs`, so a single truncated character in
/// `store_info.additional_info` used to take out PPOB and the entire Settings
/// page. Empty (rather than the raw ciphertext) is returned so the admin sees a
/// blank field to re-enter instead of garbage they might save back and
/// obfuscate a second time.
pub fn deobfuscate(input: &str) -> String {
    let Some(hex) = input.strip_prefix("OBF:") else {
        // Not obfuscated (legacy data) — return as-is
        return input.to_string();
    };

    let Some(bytes) = hex_to_bytes(hex) else {
        return String::new();
    };

    let plain: Vec<u8> = bytes
        .into_iter()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect();

    String::from_utf8(plain).unwrap_or_default()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SalesSettings {
    pub allow_negative_stock: bool,
    pub default_payment_method: String,
}

impl Default for SalesSettings {
    fn default() -> Self {
        Self {
            allow_negative_stock: true,
            default_payment_method: "cash".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SecuritySettings {
    pub session_timeout_minutes: i32,
}

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            session_timeout_minutes: 30,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PpobMarkupConfig {
    #[serde(rename = "type")]
    pub markup_type: String, // "fixed" or "percentage"
    pub value: f64,
}

impl Default for PpobMarkupConfig {
    fn default() -> Self {
        Self {
            markup_type: "fixed".to_string(),
            value: 0.0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PpobMarkup {
    #[serde(default)]
    pub pulsa: PpobMarkupConfig,
    #[serde(default)]
    pub data: PpobMarkupConfig,
    #[serde(default)]
    pub pln: PpobMarkupConfig,
    #[serde(default)]
    pub pdam: PpobMarkupConfig,
    #[serde(default)]
    pub bpjs: PpobMarkupConfig,
    #[serde(default)]
    pub emoney: PpobMarkupConfig,
    #[serde(default)]
    pub custom_prices: std::collections::HashMap<String, f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PpobSettings {
    pub enabled: bool,
    pub phone_number: String,
    pub password: String,
    pub device_id: String,
    pub pin: String,
    #[serde(default)]
    pub markup: PpobMarkup,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    pub sales: SalesSettings,
    pub security: SecuritySettings,
    pub ppob: PpobSettings,
    pub backup: BackupSettings,
}

#[derive(Debug, Serialize)]
pub struct DatabaseInfo {
    pub size_bytes: u64,
    pub path: String,
}

/// Read the settings blob, falling back to the defaults for every section that
/// is missing or unreadable. A corrupt block never takes the others with it.
pub fn parse_app_settings(additional_info: &Option<String>) -> AppSettings {
    let json: serde_json::Value = additional_info
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));

    let sales = json
        .get("sales")
        .and_then(|v| serde_json::from_value::<SalesSettings>(v.clone()).ok())
        .unwrap_or_default();

    let security = json
        .get("security")
        .and_then(|v| serde_json::from_value::<SecuritySettings>(v.clone()).ok())
        .unwrap_or_default();

    let ppob = json
        .get("ppob")
        .and_then(|v| serde_json::from_value::<PpobSettings>(v.clone()).ok())
        .map(|mut p| {
            // Deobfuscate sensitive fields when reading from DB
            p.password = deobfuscate(&p.password);
            p.pin = deobfuscate(&p.pin);
            p
        })
        .unwrap_or_default();

    let backup = json
        .get("backup")
        .and_then(|v| serde_json::from_value::<BackupSettings>(v.clone()).ok())
        .unwrap_or_default();

    AppSettings {
        sales,
        security,
        ppob,
        backup,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obfuscation_round_trips() {
        for value in [
            "",
            "0812345678",
            "rahasia123",
            "p@ssw0rd!",
            "081-\u{e9}\u{2014}",
        ] {
            assert_eq!(deobfuscate(&obfuscate(value)), value);
        }
    }

    /// An odd number of hex characters made `&hex[i..i + 2]` run past the end of
    /// the string. [`parse_app_settings`] is called from `get_app_settings`,
    /// `update_app_settings`, `services/ppob/executor.rs` and
    /// `commands/ppob/inquiry.rs`, so this panic disabled PPOB and the whole
    /// Settings page at once.
    #[test]
    fn deobfuscate_survives_an_odd_length_payload() {
        assert_eq!(deobfuscate("OBF:1b2c3"), "");
        assert_eq!(deobfuscate("OBF:a"), "");
    }

    #[test]
    fn deobfuscate_survives_junk_payloads() {
        assert_eq!(deobfuscate("OBF:zzzz"), "");
        assert_eq!(deobfuscate("OBF:\u{e9}\u{e9}"), "");
        assert_eq!(deobfuscate("OBF:"), "");
    }

    /// Values stored before obfuscation existed have no marker and must come
    /// back untouched.
    #[test]
    fn deobfuscate_passes_legacy_plaintext_through() {
        assert_eq!(deobfuscate("rahasia123"), "rahasia123");
        assert_eq!(deobfuscate(""), "");
    }

    /// A corrupt PPOB block must not take the rest of the settings with it.
    #[test]
    fn parse_app_settings_survives_a_corrupt_credential() {
        let json = serde_json::json!({
            "sales": { "allow_negative_stock": false, "default_payment_method": "qris" },
            "ppob": {
                "enabled": true,
                "phone_number": "0812",
                "password": "OBF:1b2c3",
                "device_id": "dev",
                "pin": "OBF:zzz"
            },
            "backup": { "interval_hours": 6, "retention_days": 30 }
        })
        .to_string();

        let settings = parse_app_settings(&Some(json));
        assert_eq!(settings.sales.default_payment_method, "qris");
        assert!(!settings.sales.allow_negative_stock);
        assert_eq!(settings.backup.interval_hours, 6);
        assert_eq!(settings.ppob.phone_number, "0812");
        assert_eq!(settings.ppob.password, "");
        assert_eq!(settings.ppob.pin, "");
    }

    #[test]
    fn hex_to_bytes_only_accepts_even_length_ascii_hex() {
        assert_eq!(hex_to_bytes("0a1b"), Some(vec![0x0a, 0x1b]));
        assert_eq!(hex_to_bytes(""), Some(vec![]));
        assert_eq!(hex_to_bytes("0a1"), None);
        assert_eq!(hex_to_bytes("0g"), None);
        assert_eq!(hex_to_bytes("\u{e9}\u{e9}"), None);
    }
}
