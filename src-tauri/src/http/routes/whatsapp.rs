//! Send a sales receipt to a customer's WhatsApp.
//!
//! `enable`/`disable`/`logout` are loopback-only, the same rule
//! `http::routes::window` applies to the zoom and the icon: they change what
//! runs on the till's own machine (a browser process, a linked phone session),
//! so a tablet on the shop LAN has no business calling them. `status` is open
//! to any session but strips the QR unless the caller is the till — a QR code
//! is only useful to whoever is standing in front of the till's screen with a
//! phone, and it is also the one piece of this response worth not handing to
//! anything that can merely reach the LAN. `send-receipt` is open to any
//! cashier session; it is not idempotency-guarded the way a sale or a PPOB
//! payment is (`http::idempotency`'s doc comment: "the three requests that
//! move money") because sending a message moves nothing — a duplicate send at
//! worst repeats a text, and every attempt is kept in `whatsapp_sends` for the
//! history to show regardless.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::Router;

use crate::domain::whatsapp::{
    SendReceiptInput, UpdateWhatsappSettingsInput, WhatsappSendRecord, WhatsappSettingsResponse,
};
use crate::http::error::{ApiError, ApiResult};
use crate::http::extract::{Json, Query};
use crate::http::middleware::ClientInfo;
use crate::http::AppState;
use crate::services;
use crate::whatsapp::WhatsappStatus;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/whatsapp/status", get(status))
        .route("/whatsapp/settings", get(get_settings))
        .route("/whatsapp/send-receipt", post(send_receipt))
        .route("/whatsapp/sends", get(sends_for_transaction))
}

pub fn admin() -> Router<AppState> {
    Router::new()
        .route("/whatsapp/enable", post(enable))
        .route("/whatsapp/disable", post(disable))
        .route("/whatsapp/logout", post(logout))
        .route("/whatsapp/settings", put(update_settings))
}

fn require_till(client: &ClientInfo) -> ApiResult<()> {
    if client.is_loopback() {
        Ok(())
    } else {
        Err(ApiError::conflict(
            "WhatsApp hanya bisa diaktifkan atau diputuskan dari jendela aplikasi di komputer kasir.",
        ))
    }
}

/// `enabled`/`state`/`number`/`reason` are visible to any session; `qr` is
/// stripped unless the caller is the till — see the module doc.
async fn status(
    State(state): State<AppState>,
    client: ClientInfo,
) -> ApiResult<axum::Json<serde_json::Value>> {
    // In-memory only — no database round trip — so a client polling every
    // couple of seconds while a QR is pending costs nothing.
    let status: WhatsappStatus = state.whatsapp.status();
    let mut value = serde_json::to_value(&status)
        .map_err(|e| crate::utils::AppError::Internal(format!("serialise status: {e}")))?;

    if !client.is_loopback() {
        if let Some(object) = value.as_object_mut() {
            object.remove("qr");
        }
    }

    Ok(axum::Json(value))
}

async fn enable(
    State(state): State<AppState>,
    client: ClientInfo,
) -> ApiResult<axum::Json<WhatsappStatus>> {
    require_till(&client)?;
    Ok(axum::Json(
        services::whatsapp::enable(&state.whatsapp, &state.db).await?,
    ))
}

async fn disable(
    State(state): State<AppState>,
    client: ClientInfo,
) -> ApiResult<axum::Json<WhatsappStatus>> {
    require_till(&client)?;
    Ok(axum::Json(
        services::whatsapp::disable(&state.whatsapp, &state.db).await?,
    ))
}

async fn logout(State(state): State<AppState>, client: ClientInfo) -> ApiResult<StatusCode> {
    require_till(&client)?;
    state.whatsapp.logout().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_settings(
    State(state): State<AppState>,
) -> ApiResult<axum::Json<WhatsappSettingsResponse>> {
    let settings = services::whatsapp::settings::get_whatsapp_settings(&state.db).await?;
    Ok(axum::Json(settings.into()))
}

async fn update_settings(
    State(state): State<AppState>,
    Json(input): Json<UpdateWhatsappSettingsInput>,
) -> ApiResult<StatusCode> {
    if input.caption_template.trim().is_empty() {
        return Err(ApiError::validation("Teks pengantar tidak boleh kosong."));
    }
    services::whatsapp::settings::save_caption_template(&state.db, input.caption_template).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn send_receipt(
    State(state): State<AppState>,
    Json(input): Json<SendReceiptInput>,
) -> ApiResult<StatusCode> {
    services::whatsapp::send_receipt(&state.whatsapp, &state.db, input).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, serde::Deserialize)]
struct SendsQuery {
    transaction_id: i64,
}

async fn sends_for_transaction(
    State(state): State<AppState>,
    Query(query): Query<SendsQuery>,
) -> ApiResult<axum::Json<Vec<WhatsappSendRecord>>> {
    let sends =
        services::whatsapp::history::sends_for_transaction(&state.db, query.transaction_id).await?;
    Ok(axum::Json(sends))
}
