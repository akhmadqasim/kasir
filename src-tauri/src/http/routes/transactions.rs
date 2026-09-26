//! Sales: the list, one sale, and the act of making one.
//!
//! Everything here is in the `session` group, including the two operations only
//! an admin may perform — voiding a sale and correcting its payment method. The
//! router does not enforce that; `services::transactions::admin` does, with
//! `guard::require_admin`. Putting them in the admin group as well would be
//! belt and braces, but it would also put the route table
//! and the service at risk of disagreeing about who counts as an admin, and only
//! one of the two can be the answer.
//!
//! `POST /transactions` is the one route in the application with a header it
//! refuses to work without. See [`crate::http::idempotency`] for why.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get, patch, post};
use axum::{Extension, Router};
use serde::Deserialize;

use crate::domain::receipt::{ReceiptDataResponse, ReceiptLineResponse};
use crate::domain::transactions::{
    CheckoutTransactionInput, DeleteTransactionInput, ListTransactionsInput, PaginatedTransactions,
    TransactionDetail, UpdatePaymentMethodInput,
};
use crate::domain::Actor;
use crate::entity::transactions;
use crate::http::error::ApiResult;
use crate::http::extract::{json_from_slice, Json, Query};
use crate::http::idempotency;
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/transactions", get(list).post(checkout))
        .route(
            "/transactions/next-receipt-number",
            get(next_receipt_number),
        )
        .route("/transactions/{id}", get(detail))
        .route("/transactions/{id}", delete(void))
        .route("/transactions/{id}/payment-method", patch(payment_method))
        .route("/transactions/{id}/receipt", get(receipt))
        .route("/transactions/{id}/receipt/lines", get(receipt_lines))
        .route("/transaction-items/{id}/ppob/retry", post(retry_ppob))
        .route("/transaction-items/{id}/ppob/resolve", post(resolve_ppob))
}

async fn list(
    State(state): State<AppState>,
    Query(input): Query<ListTransactionsInput>,
) -> ApiResult<axum::Json<PaginatedTransactions>> {
    Ok(axum::Json(
        services::transactions::list(&state.db, input).await?,
    ))
}

async fn next_receipt_number(State(state): State<AppState>) -> ApiResult<axum::Json<String>> {
    Ok(axum::Json(
        services::transactions::next_receipt_number(&state.db).await?,
    ))
}

async fn detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<TransactionDetail>> {
    Ok(axum::Json(
        services::transactions::detail(&state.db, id).await?,
    ))
}

/// Ring up a sale, at most once per `Idempotency-Key`.
///
/// The body is taken as bytes rather than through `Json<T>` because the key's
/// promise is about *this* request: the digest of what the client sent is what
/// distinguishes a retry from a different sale that happens to reuse a key.
///
/// The order is parse, then claim, then work. Parsing first means a malformed
/// body is rejected without consuming the key, so the client can fix it and
/// retry with the same one — which is what a client that generated one key per
/// cart will do. A sale that did not happen releases the key for the corrected
/// retry.
async fn checkout(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let key = idempotency::key_from_headers(&headers)?;
    let input: CheckoutTransactionInput = json_from_slice(&body)?;

    let user_id = actor.user_id;
    let (db, mitra) = (state.db.clone(), state.mitra.clone());
    idempotency::run(
        &state.db,
        idempotency::SCOPE_CHECKOUT,
        user_id,
        &key,
        &body,
        async move { services::transactions::checkout(&db, &mitra, &actor, input).await },
    )
    .await
}

#[derive(Debug, Deserialize)]
struct VoidBody {
    reason: String,
}

/// Void a sale. Admin-only, enforced by the service.
async fn void(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
    Json(body): Json<VoidBody>,
) -> ApiResult<StatusCode> {
    services::transactions::void(
        &state.db,
        &actor,
        DeleteTransactionInput {
            transaction_id: id,
            reason: body.reason,
        },
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct PaymentMethodBody {
    payment_method: String,
    reason: String,
}

/// Correct the payment method on a completed sale. Admin-only, enforced by the
/// service, and audited by the `reason` it insists on.
async fn payment_method(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
    Json(body): Json<PaymentMethodBody>,
) -> ApiResult<axum::Json<transactions::Model>> {
    Ok(axum::Json(
        services::transactions::update_payment_method(
            &state.db,
            &actor,
            UpdatePaymentMethodInput {
                transaction_id: id,
                payment_method: body.payment_method,
                reason: body.reason,
            },
        )
        .await?,
    ))
}

/// Everything a receipt needs, for the browser to render or the printer route to
/// send.
async fn receipt(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<ReceiptDataResponse>> {
    Ok(axum::Json(
        services::receipt::receipt_data(&state.db, id).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct ReceiptLinesParams {
    /// Paper width in mm (58 or 80). Missing = whatever the printer settings
    /// say, the same width `print` would use.
    paper: Option<u8>,
}

/// The lines the printer would be handed for this sale, so the success dialog
/// can show a struk preview before anything is printed. Same data as
/// [`receipt`], run through the exact same formatter the printer uses
/// ([`crate::printing::receipt::format_receipt_text`]), so the preview cannot
/// drift from the paper.
async fn receipt_lines(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(params): Query<ReceiptLinesParams>,
) -> ApiResult<axum::Json<Vec<ReceiptLineResponse>>> {
    Ok(axum::Json(
        services::receipt::sale_receipt_lines(&state.db, id, params.paper).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct RetryPpobBody {
    /// The cashier's Mitra transaction PIN, typed again for this retry — the
    /// original one was never kept. See
    /// `crate::services::ppob::executor::validate_pin`.
    #[serde(default)]
    pin: Option<String>,
}

/// Re-run a PPOB line whose upstream fulfilment failed after the sale committed.
///
/// Not idempotency-guarded, and it does not need to be: the service claims the
/// item row before it calls upstream, so a second retry of an item already in
/// flight finds nothing to claim.
async fn retry_ppob(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<RetryPpobBody>,
) -> ApiResult<axum::Json<String>> {
    Ok(axum::Json(
        services::transactions::retry_ppob_fulfillment(&state.db, &state.mitra, id, body.pin)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
struct ResolvePpobBody {
    /// What the Mitra history says happened to this purchase.
    success: bool,
    /// The serial number / token read off the Mitra history, if any.
    #[serde(default)]
    serial_number: Option<String>,
}

/// Settle a PPOB line whose provider answer never arrived. The acting user is
/// written into the line's message, so the Riwayat shows who decided.
async fn resolve_ppob(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
    Json(body): Json<ResolvePpobBody>,
) -> ApiResult<axum::Json<String>> {
    Ok(axum::Json(
        services::transactions::resolve_uncertain_ppob(
            &state.db,
            &actor,
            id,
            body.success,
            body.serial_number,
        )
        .await?,
    ))
}
