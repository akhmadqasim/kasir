//! Printer and paper configuration, stored in `store_info.additional_info`.

use sea_orm::DatabaseConnection;

use crate::domain::receipt::{
    PrinterSettings, PrinterSettingsResponse, UpdatePrinterSettingsInput,
};
use crate::entity::store_info;
use crate::printing::receipt::PrintMode;
use crate::services::settings::{get_store_info, merge_additional_info, require_store_info};
use crate::utils::AppError;

/// Get printer settings from store_info.additional_info JSON
pub(super) fn get_printer_settings(additional_info: &Option<String>) -> PrinterSettings {
    additional_info
        .as_ref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .map(|v| PrinterSettings {
            printer_id: v
                .get("printer_id")
                .and_then(|v| v.as_str())
                .map(String::from),
            paper_width: v
                .get("paper_width")
                .and_then(|v| v.as_u64())
                .map(|v| v as u8),
            auto_print: v.get("auto_print").and_then(|v| v.as_bool()),
            footer_text: v
                .get("footer_text")
                .and_then(|v| v.as_str())
                .map(String::from),
            print_mode: v
                .get("print_mode")
                .and_then(|v| v.as_str())
                .map(String::from),
        })
        .unwrap_or(PrinterSettings {
            printer_id: None,
            paper_width: None,
            auto_print: None,
            footer_text: None,
            print_mode: None,
        })
}

/// The struk's own layout settings — paper width, footer text — without
/// requiring a printer to be configured at all.
///
/// [`super::printer::print_target`] builds on this and adds the one thing only
/// printing needs: somewhere to send the bytes.
pub(super) struct ReceiptRenderSettings {
    pub(super) store: store_info::Model,
    pub(super) paper_width: u8,
    pub(super) footer_text: Option<String>,
}

pub(super) async fn receipt_render_settings(
    db: &DatabaseConnection,
) -> Result<ReceiptRenderSettings, AppError> {
    let store = require_store_info(db).await?;
    let settings = get_printer_settings(&store.additional_info);

    Ok(ReceiptRenderSettings {
        paper_width: settings.paper_width.unwrap_or(58),
        footer_text: settings.footer_text,
        store,
    })
}

pub async fn update_printer_settings(
    db: &DatabaseConnection,
    input: UpdatePrinterSettingsInput,
) -> Result<(), AppError> {
    merge_additional_info(db, |info| {
        if let Some(id) = &input.printer_id {
            info["printer_id"] = serde_json::json!(id);
        }
        if let Some(width) = &input.paper_width {
            info["paper_width"] = serde_json::json!(width);
        }
        if let Some(auto) = &input.auto_print {
            info["auto_print"] = serde_json::json!(auto);
        }
        if let Some(footer) = &input.footer_text {
            info["footer_text"] = serde_json::json!(footer);
        }
        if let Some(mode) = &input.print_mode {
            // Normalised on the way in, so an unknown value cannot sit in the
            // settings looking like it means something.
            info["print_mode"] =
                serde_json::json!(PrintMode::from_setting(Some(mode)).as_setting());
        }
        Ok(())
    })
    .await
}

pub async fn printer_settings(
    db: &DatabaseConnection,
) -> Result<PrinterSettingsResponse, AppError> {
    let store = get_store_info(db).await?;

    let settings = get_printer_settings(&store.and_then(|s| s.additional_info));

    Ok(PrinterSettingsResponse {
        printer_id: settings.printer_id,
        paper_width: settings.paper_width,
        auto_print: settings.auto_print,
        footer_text: settings.footer_text,
        // Absent means the default, and the screen should show which that is.
        print_mode: Some(
            PrintMode::from_setting(settings.print_mode.as_deref())
                .as_setting()
                .to_string(),
        ),
    })
}
