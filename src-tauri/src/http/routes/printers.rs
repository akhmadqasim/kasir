//! The thermal printer.
//!
//! These are the routes that are honestly machine-bound. The printer is plugged
//! into the till the server runs on, so `POST /printers/test` and
//! `POST /transactions/{id}/print` produce paper *there*, whichever tablet on the
//! LAN pressed the button. That is the intended behaviour for a single-counter
//! shop and it is written down in `deploy/README.md`, because it is the kind of
//! thing that is obvious once stated and baffling until it is.
//!
//! Reading the settings is a session route because the cashier screen needs to
//! know the paper width. Changing them is an admin route — `update_printer_settings`
//! is the second of the two commands the contract audit found had no role check
//! at all, and the group is where it gets one.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::Router;

use crate::domain::receipt::{
    PrinterInfoItem, PrinterSettingsResponse, UpdatePrinterSettingsInput,
};
use crate::http::error::ApiResult;
use crate::http::extract::Json;
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/printers", get(list))
        .route("/printers/settings", get(settings))
        .route("/printers/test", post(test_print))
        .route("/transactions/{id}/print", post(print_receipt))
        .route("/transaction-items/{id}/ppob/print", post(print_ppob_struk))
}

pub fn admin() -> Router<AppState> {
    Router::new().route("/printers/settings", put(update_settings))
}

/// Printers visible to the till's operating system.
async fn list() -> ApiResult<axum::Json<Vec<PrinterInfoItem>>> {
    Ok(axum::Json(services::receipt::list_printers().await?))
}

async fn settings(State(state): State<AppState>) -> ApiResult<axum::Json<PrinterSettingsResponse>> {
    Ok(axum::Json(
        services::receipt::printer_settings(&state.db).await?,
    ))
}

async fn update_settings(
    State(state): State<AppState>,
    Json(input): Json<UpdatePrinterSettingsInput>,
) -> ApiResult<StatusCode> {
    services::receipt::update_printer_settings(&state.db, input).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn test_print(State(state): State<AppState>) -> ApiResult<StatusCode> {
    services::receipt::test_print(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Print a receipt for a sale. The response says the job was handed to the
/// printer, not that paper came out — nothing in the ESC/POS path can tell the
/// difference.
async fn print_receipt(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<StatusCode> {
    services::receipt::print(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Reprint the struk for one fulfilled PPOB line.
///
/// The id is a `transaction_items` id, not a transaction's, because the struk
/// belongs to the line: a cart can hold two PPOB purchases and the customer may
/// only have lost one of them. Printing the sale receipt already prints these
/// alongside it, so this route exists for the reprint.
async fn print_ppob_struk(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<StatusCode> {
    services::receipt::print_ppob_item(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
