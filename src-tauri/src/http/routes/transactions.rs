//! Sales: the list, one sale, and the act of making one.
//!
//! Everything here is in the `session` group, including the two operations only
//! an admin may perform — voiding a sale and correcting its payment method. The
//! router does not enforce that; `services::transactions::admin` does, with the
//! same `guard::require_admin` the Tauri path uses. Putting them in the admin
//! group as well would be belt and braces, but it would also put the route table
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
use chrono::Utc;

use crate::domain::receipt::ReceiptDataResponse;
use crate::domain::transactions::{
    CheckoutTransactionInput, DeleteTransactionInput, ListTransactionsInput, PaginatedTransactions,
    TransactionDetail, UpdatePaymentMethodInput,
};
use crate::domain::Actor;
use crate::entity::transactions;
use crate::http::error::ApiResult;
use crate::http::extract::{json_from_slice, Json, Query};
use crate::http::idempotency::{self, Claim};
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
        .route("/transaction-items/{id}/ppob/retry", post(retry_ppob))
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
/// cart will do.
async fn checkout(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let key = idempotency::key_from_headers(&headers)?;
    let input: CheckoutTransactionInput = json_from_slice(&body)?;

    let guard = match idempotency::claim(
        &state.db,
        idempotency::SCOPE_CHECKOUT,
        actor.user_id,
        &key,
        &body,
        Utc::now(),
    )
    .await?
    {
        Claim::Replay(response) => return Ok(response),
        Claim::Fresh(guard) => guard,
    };

    match services::transactions::checkout(&state.db, &state.mitra, &actor, input).await {
        Ok(result) => Ok(guard.complete(&state.db, &result).await),
        Err(e) => {
            // A sale that did not happen must not block the corrected retry.
            guard.release(&state.db).await;
            Err(e.into())
        }
    }
}

#[derive(Debug, serde::Deserialize)]
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

#[derive(Debug, serde::Deserialize)]
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

/// Re-run a PPOB line whose upstream fulfilment failed after the sale committed.
///
/// Not idempotency-guarded, and it does not need to be: the service claims the
/// item row before it calls upstream, so a second retry of an item already in
/// flight finds nothing to claim.
async fn retry_ppob(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<String>> {
    Ok(axum::Json(
        services::transactions::retry_ppob_fulfillment(&state.db, &state.mitra, id).await?,
    ))
}
