//! WhatsApp receipt sending: settings shape and the send-history record.
//!
//! The connection state machine itself (`Off | Starting | QrPending | Ready |
//! Disconnected`) is not a business type — it belongs to the process manager
//! that owns it, [`crate::whatsapp::WhatsappPhase`], the same way `UpdatePhase`
//! belongs to `updater` rather than to this module.

use serde::{Deserialize, Serialize};

/// Filled into a caption template in place of `{store}`.
pub const CAPTION_STORE_PLACEHOLDER: &str = "{store}";

pub const DEFAULT_CAPTION_TEMPLATE: &str =
    "Terima kasih sudah belanja di {store}. Berikut struk Anda.";

/// WhatsApp settings as stored in `store_info.additional_info["whatsapp"]`.
/// `enabled` is written by `enable`/`disable`, not by
/// [`UpdateWhatsappSettingsInput`] — it survives a restart so the manager
/// knows whether to reconnect the sidecar on launch, but a person only ever
/// flips it through the dedicated endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WhatsappSettings {
    pub enabled: bool,
    pub caption_template: String,
}

impl Default for WhatsappSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            caption_template: DEFAULT_CAPTION_TEMPLATE.to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateWhatsappSettingsInput {
    pub caption_template: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WhatsappSettingsResponse {
    pub caption_template: String,
}

impl From<WhatsappSettings> for WhatsappSettingsResponse {
    fn from(settings: WhatsappSettings) -> Self {
        Self {
            caption_template: settings.caption_template,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SendReceiptInput {
    pub transaction_id: i64,
    pub phone: String,
}

/// One row of `whatsapp_sends`, for the transaction history to show "Terkirim
/// ke 0812...".
#[derive(Debug, Clone, Serialize)]
pub struct WhatsappSendRecord {
    pub phone: String,
    /// `"sent"` or `"failed"`.
    pub status: String,
    pub error: Option<String>,
    pub sent_at: Option<String>,
}

impl From<crate::entity::whatsapp_sends::Model> for WhatsappSendRecord {
    fn from(row: crate::entity::whatsapp_sends::Model) -> Self {
        Self {
            phone: row.phone,
            status: row.status,
            error: row.error,
            sent_at: row.sent_at,
        }
    }
}

/// Fill `{store}` in the caption template with the shop's name. A template
/// without the placeholder is left as-is — nothing forces a caption to
/// mention the store at all.
pub fn render_caption(template: &str, store_name: &str) -> String {
    template.replace(CAPTION_STORE_PLACEHOLDER, store_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_settings_are_disabled_with_the_stock_caption() {
        let settings = WhatsappSettings::default();
        assert!(!settings.enabled);
        assert_eq!(settings.caption_template, DEFAULT_CAPTION_TEMPLATE);
    }

    #[test]
    fn render_caption_fills_in_the_store_name() {
        assert_eq!(
            render_caption("Terima kasih di {store}!", "Toko Sembako Rejeki"),
            "Terima kasih di Toko Sembako Rejeki!"
        );
    }

    #[test]
    fn render_caption_is_a_no_op_without_the_placeholder() {
        assert_eq!(render_caption("Terima kasih!", "Toko"), "Terima kasih!");
    }
}
