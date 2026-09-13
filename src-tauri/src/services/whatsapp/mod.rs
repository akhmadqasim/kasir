//! WhatsApp receipt sending: business logic and persistence.
//!
//! The live connection itself — the sidecar process, its state machine —
//! lives in [`crate::whatsapp`] instead, kept out of here because it has to
//! import `tauri`; see that module's doc comment. Everything in this module
//! is plain DB/business logic, taking the manager as an opaque `&Arc<...>`
//! parameter where a function needs to reach the live connection.

pub mod history;
pub mod receipt_image;
pub mod settings;

use std::sync::Arc;

use base64::Engine;
use sea_orm::DatabaseConnection;

use crate::domain::whatsapp::{render_caption, SendReceiptInput};
use crate::utils::AppError;
use crate::whatsapp::{WhatsappManager, WhatsappStatus};

/// Turn the feature on: persist the setting, then hand off to the manager —
/// see `crate::whatsapp`'s module doc for why the manager itself never
/// touches the database.
pub async fn enable(
    manager: &Arc<WhatsappManager>,
    db: &DatabaseConnection,
) -> Result<WhatsappStatus, AppError> {
    self::settings::set_enabled(db, true).await?;
    manager.enable().await
}

pub async fn disable(
    manager: &Arc<WhatsappManager>,
    db: &DatabaseConnection,
) -> Result<WhatsappStatus, AppError> {
    self::settings::set_enabled(db, false).await?;
    manager.disable().await
}

/// Render the struk, send it, and record the attempt either way.
///
/// The record is written even when the send failed: a wrong number typed by
/// the cashier is exactly the kind of attempt the history should carry, so a
/// second try is not typed blind.
pub async fn send_receipt(
    manager: &Arc<WhatsappManager>,
    db: &DatabaseConnection,
    input: SendReceiptInput,
) -> Result<(), AppError> {
    // Fetched once and threaded through both the caption and the render: each
    // otherwise reads `store_info` (and re-parses its `additional_info` JSON)
    // on its own for the same row.
    let store = crate::services::settings::get_store_info(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;
    let whatsapp_settings = self::settings::whatsapp_settings_of(&store);
    let caption = render_caption(&whatsapp_settings.caption_template, &store.name);

    let png = receipt_image::render_receipt_png(db, &store, input.transaction_id).await?;
    let image_b64 = base64::engine::general_purpose::STANDARD.encode(png);

    let result = manager
        .send(&input.phone, Some(caption), Some(image_b64))
        .await;

    let recorded = match &result {
        Ok(()) => Ok(()),
        Err(err) => Err(err.to_string()),
    };
    self::history::record_send(db, input.transaction_id, &input.phone, &recorded).await?;

    result
}
