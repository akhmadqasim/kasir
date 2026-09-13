//! PPOB: bills, top-ups and the upstream catalogue behind them.
//!
//! Everything reaches a third party over the network, and the upstream session
//! that makes that possible lives in the one `MitraClient` on [`AppState`] —
//! shared with the Tauri layer, because two clients would mean two upstream
//! sessions and logging one in logs the other out.
//!
//! Three groups of route, and the shape of each says what it is:
//!
//! * `GET /ppob/catalog/*` — what the provider sells. Reads, cacheable, boring.
//! * `POST /ppob/inquiries/*` — "what does this customer owe?". Reads upstream,
//!   POSTs here because they carry a body and because the provider bills for
//!   them. Repeating one costs a query, not money.
//! * `POST /ppob/payments` and `POST /ppob/topups` — money. Both take an
//!   `Idempotency-Key`, for the same reason checkout does: a lost response on
//!   shop wifi is indistinguishable from a request that never arrived, and the
//!   retry would buy a second voucher.
//!
//! `POST /ppob/session` is admin-only: it authenticates the shop's own account
//! upstream, which is an act of configuration rather than of selling.
//!
//! [`AppState`]: crate::http::AppState

use axum::extract::{Extension, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use chrono::Utc;
use serde::Deserialize;

use crate::domain::ppob::{
    EmoneyDenom, HistoryPaymentItem, InquiryResult, MutasiItem, NotificationListResult,
    PdamProduct, PlnDenom, PpSubMenuItem, PpobMenuGroup, PpobSaldoResponse, PulsaDetailsResponse,
    PulsaProduct, PulsaProvider, TransferChannelGroup, VoucherGroup,
};
use crate::domain::receipt::ReceiptLineResponse;
use crate::domain::Actor;
use crate::http::error::{ApiError, ApiResult};
use crate::http::extract::{json_from_slice, Json, Query};
use crate::http::idempotency::{self, Claim};
use crate::http::AppState;
use crate::services;
use crate::services::ppob::inquiry::{BpjsInquiryInput, TransferInquiryInput};
use crate::services::ppob::payment::ConfirmPaymentInput;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/ppob/balance", get(balance))
        .route("/ppob/menu", get(menu))
        // Catalogue
        .route("/ppob/catalog/providers", get(providers))
        .route("/ppob/catalog/pulsa/details", get(pulsa_details))
        .route("/ppob/catalog/pulsa/prices", get(pulsa_prices))
        .route("/ppob/catalog/data/prices", get(data_prices))
        .route("/ppob/catalog/pln/denominations", get(pln_denominations))
        .route("/ppob/catalog/pdam/products", get(pdam_products))
        .route(
            "/ppob/catalog/emoney/denominations",
            get(emoney_denominations),
        )
        .route(
            "/ppob/catalog/payment-points/{id}/sub-menu",
            get(payment_point_sub_menu),
        )
        .route("/ppob/catalog/transfer/channels", get(transfer_channels))
        .route("/ppob/catalog/vouchers/groups", get(voucher_groups))
        // Inquiries
        .route("/ppob/inquiries/pln", post(pln_inquiry))
        .route("/ppob/inquiries/pdam", post(pdam_inquiry))
        .route("/ppob/inquiries/bpjs", post(bpjs_inquiry))
        .route("/ppob/inquiries/pp", post(pp_inquiry))
        .route("/ppob/inquiries/transfer", post(transfer_inquiry))
        .route("/ppob/inquiries/emoney", post(emoney_inquiry))
        // Money
        .route("/ppob/payments", post(pay))
        .route("/ppob/topups", post(topup))
        // History
        .route("/ppob/history", get(history))
        .route("/ppob/history/{trx_id}", get(history_detail))
        .route("/ppob/history/{trx_id}/receipt", get(history_receipt))
        .route("/ppob/history/{trx_id}/print", post(history_print))
        .route("/ppob/mutasi", get(mutasi))
        // Notifications
        .route("/ppob/notifications", get(notifications))
        .route("/ppob/notifications/read-all", post(mark_all_read))
        .route("/ppob/notifications/{inbox_id}/read", post(mark_read))
}

pub fn admin() -> Router<AppState> {
    Router::new().route("/ppob/session", post(open_session))
}

/// Authenticate the shop's account upstream and report the balance it came back
/// with. Admin because it acts on the credentials, not on a sale.
async fn open_session(State(state): State<AppState>) -> ApiResult<axum::Json<PpobSaldoResponse>> {
    Ok(axum::Json(
        services::ppob::menu::saldo(&state.db, &state.mitra).await?,
    ))
}

async fn balance(State(state): State<AppState>) -> ApiResult<axum::Json<PpobSaldoResponse>> {
    Ok(axum::Json(
        services::ppob::menu::saldo(&state.db, &state.mitra).await?,
    ))
}

async fn menu(State(state): State<AppState>) -> ApiResult<axum::Json<Vec<PpobMenuGroup>>> {
    Ok(axum::Json(
        services::ppob::menu::menu(&state.db, &state.mitra).await?,
    ))
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

async fn providers(State(state): State<AppState>) -> ApiResult<axum::Json<Vec<PulsaProvider>>> {
    Ok(axum::Json(
        services::ppob::menu::providers(&state.db, &state.mitra).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PhoneParam {
    phone_number: String,
}

/// A read as far as this API is concerned, even though the provider wants a
/// POST: it asks which products suit a number and changes nothing.
async fn pulsa_details(
    State(state): State<AppState>,
    Query(params): Query<PhoneParam>,
) -> ApiResult<axum::Json<PulsaDetailsResponse>> {
    Ok(axum::Json(
        services::ppob::menu::pulsa_details(&state.db, &state.mitra, params.phone_number).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderParam {
    provider_uid: String,
}

async fn pulsa_prices(
    State(state): State<AppState>,
    Query(params): Query<ProviderParam>,
) -> ApiResult<axum::Json<Vec<PulsaProduct>>> {
    Ok(axum::Json(
        services::ppob::menu::pulsa_price_list(&state.db, &state.mitra, params.provider_uid)
            .await?,
    ))
}

async fn data_prices(
    State(state): State<AppState>,
    Query(params): Query<ProviderParam>,
) -> ApiResult<axum::Json<Vec<PulsaProduct>>> {
    Ok(axum::Json(
        services::ppob::menu::data_price_list(&state.db, &state.mitra, params.provider_uid).await?,
    ))
}

async fn pln_denominations(State(state): State<AppState>) -> ApiResult<axum::Json<Vec<PlnDenom>>> {
    Ok(axum::Json(
        services::ppob::menu::pln_denom(&state.db, &state.mitra).await?,
    ))
}

async fn pdam_products(State(state): State<AppState>) -> ApiResult<axum::Json<Vec<PdamProduct>>> {
    Ok(axum::Json(
        services::ppob::menu::pdam_products(&state.db, &state.mitra).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductIdParam {
    product_id: i64,
}

async fn emoney_denominations(
    State(state): State<AppState>,
    Query(params): Query<ProductIdParam>,
) -> ApiResult<axum::Json<Vec<EmoneyDenom>>> {
    Ok(axum::Json(
        services::ppob::menu::emoney_denom(&state.db, &state.mitra, params.product_id).await?,
    ))
}

async fn payment_point_sub_menu(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<axum::Json<Vec<PpSubMenuItem>>> {
    Ok(axum::Json(
        services::ppob::menu::pp_sub_menu(&state.db, &state.mitra, id).await?,
    ))
}

async fn transfer_channels(
    State(state): State<AppState>,
) -> ApiResult<axum::Json<Vec<TransferChannelGroup>>> {
    Ok(axum::Json(
        services::ppob::menu::transfer_channels(&state.db, &state.mitra).await?,
    ))
}

async fn voucher_groups(State(state): State<AppState>) -> ApiResult<axum::Json<Vec<VoucherGroup>>> {
    Ok(axum::Json(
        services::ppob::menu::voucher_groups(&state.db, &state.mitra).await?,
    ))
}

// ---------------------------------------------------------------------------
// Inquiries
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlnInquiryBody {
    customer_id: String,
    payment_code: String,
    flag_id: String,
    amount: f64,
}

async fn pln_inquiry(
    State(state): State<AppState>,
    Json(body): Json<PlnInquiryBody>,
) -> ApiResult<axum::Json<InquiryResult>> {
    Ok(axum::Json(
        services::ppob::inquiry::pln(
            &state.db,
            &state.mitra,
            body.customer_id,
            body.payment_code,
            body.flag_id,
            body.amount,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdamInquiryBody {
    customer_id: String,
    product_id: i64,
    payment_code: String,
}

async fn pdam_inquiry(
    State(state): State<AppState>,
    Json(body): Json<PdamInquiryBody>,
) -> ApiResult<axum::Json<InquiryResult>> {
    Ok(axum::Json(
        services::ppob::inquiry::pdam(
            &state.db,
            &state.mitra,
            body.customer_id,
            body.product_id,
            body.payment_code,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BpjsInquiryBody {
    customer_id: String,
    phone_number: String,
    payment_code: String,
    bpjs_type: String,
    period: String,
}

async fn bpjs_inquiry(
    State(state): State<AppState>,
    Json(body): Json<BpjsInquiryBody>,
) -> ApiResult<axum::Json<InquiryResult>> {
    Ok(axum::Json(
        services::ppob::inquiry::bpjs(
            &state.db,
            &state.mitra,
            BpjsInquiryInput {
                customer_id: body.customer_id,
                phone_number: body.phone_number,
                payment_code: body.payment_code,
                bpjs_type: body.bpjs_type,
                period: body.period,
            },
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PpInquiryBody {
    customer_id: String,
    payment_point_group_id: i64,
    product_code: Option<String>,
}

async fn pp_inquiry(
    State(state): State<AppState>,
    Json(body): Json<PpInquiryBody>,
) -> ApiResult<axum::Json<InquiryResult>> {
    Ok(axum::Json(
        services::ppob::inquiry::payment_point(
            &state.db,
            &state.mitra,
            body.customer_id,
            body.payment_point_group_id,
            body.product_code,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferInquiryBody {
    channel_id: String,
    nomor_rekening: String,
    amount: f64,
    channel_name: String,
    deskripsi: String,
    nama_pengirim: String,
    notelp_pengirim: String,
}

async fn transfer_inquiry(
    State(state): State<AppState>,
    Json(body): Json<TransferInquiryBody>,
) -> ApiResult<axum::Json<InquiryResult>> {
    Ok(axum::Json(
        services::ppob::inquiry::transfer(
            &state.db,
            &state.mitra,
            TransferInquiryInput {
                channel_id: body.channel_id,
                nomor_rekening: body.nomor_rekening,
                amount: body.amount,
                channel_name: body.channel_name,
                deskripsi: body.deskripsi,
                nama_pengirim: body.nama_pengirim,
                notelp_pengirim: body.notelp_pengirim,
            },
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmoneyInquiryBody {
    customer_id: String,
    product_code: String,
}

async fn emoney_inquiry(
    State(state): State<AppState>,
    Json(body): Json<EmoneyInquiryBody>,
) -> ApiResult<axum::Json<InquiryResult>> {
    Ok(axum::Json(
        services::ppob::inquiry::emoney(
            &state.db,
            &state.mitra,
            body.customer_id,
            body.product_code,
        )
        .await?,
    ))
}

// ---------------------------------------------------------------------------
// The two that spend money
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentBody {
    service_type: String,
    inquiry_id: String,
    customer_id: Option<String>,
    product_code: Option<String>,
    payment_code: Option<String>,
    flag_id: Option<String>,
    phone_number: Option<String>,
    amount: Option<f64>,
}

/// Complete an inquiry into a purchase.
///
/// Same shape as checkout: parse, claim the key, then act. A failure releases
/// the key, because a bill that was not paid must stay payable with the key the
/// cashier's screen already generated.
async fn pay(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let key = idempotency::key_from_headers(&headers)?;
    let input: PaymentBody = json_from_slice(&body)?;

    let guard = match idempotency::claim(
        &state.db,
        idempotency::SCOPE_PPOB_PAYMENT,
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

    let result = services::ppob::payment::confirm(
        &state.db,
        &state.mitra,
        ConfirmPaymentInput {
            service_type: input.service_type,
            inquiry_id: input.inquiry_id,
            customer_id: input.customer_id,
            product_code: input.product_code,
            payment_code: input.payment_code,
            flag_id: input.flag_id,
            phone_number: input.phone_number,
            amount: input.amount,
        },
    )
    .await;

    match result {
        Ok(payment) => Ok(guard.complete(&state.db, &payment).await),
        Err(e) => {
            guard.release(&state.db).await;
            Err(e.into())
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TopupBody {
    phone_number: String,
    product_code: String,
    product_id: i64,
    product_type: String,
}

/// Buy airtime or a data package outright — no inquiry step, so the request
/// itself is the purchase and the key is the only thing standing between a lost
/// response and a second voucher.
async fn topup(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let key = idempotency::key_from_headers(&headers)?;
    let input: TopupBody = json_from_slice(&body)?;

    let guard = match idempotency::claim(
        &state.db,
        idempotency::SCOPE_PPOB_TOPUP,
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

    let result = services::ppob::inquiry::pulsa_purchase(
        &state.db,
        &state.mitra,
        input.phone_number,
        input.product_code,
        input.product_id,
        input.product_type,
    )
    .await;

    match result {
        Ok(payment) => Ok(guard.complete(&state.db, &payment).await),
        Err(e) => {
            guard.release(&state.db).await;
            Err(e.into())
        }
    }
}

// ---------------------------------------------------------------------------
// History and notifications
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryRange {
    #[serde(default)]
    start_date: String,
    #[serde(default)]
    end_date: String,
}

async fn history(
    State(state): State<AppState>,
    Query(range): Query<HistoryRange>,
) -> ApiResult<axum::Json<Vec<HistoryPaymentItem>>> {
    Ok(axum::Json(
        services::ppob::history::list(&state.db, &state.mitra, range.start_date, range.end_date)
            .await?,
    ))
}

async fn history_detail(
    State(state): State<AppState>,
    Path(trx_id): Path<String>,
) -> ApiResult<axum::Json<HistoryPaymentItem>> {
    Ok(axum::Json(
        services::ppob::history::detail(&state.db, &state.mitra, trx_id).await?,
    ))
}

/// The sell price a history struk is printed at — the Mitra app's "Harga
/// Jual", which becomes the struk's `Grand Total`. Chosen per print, so it
/// travels with the request rather than living in the settings.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SellPrice {
    sell_price: f64,
}

impl SellPrice {
    /// A negative price is a malformed request, not a business rule: nothing
    /// downstream can do anything with it, so it stops here as a 400.
    fn checked(self) -> Result<f64, ApiError> {
        if !self.sell_price.is_finite() || self.sell_price < 0.0 {
            return Err(ApiError::bad_request("Harga jual tidak boleh negatif"));
        }
        Ok(self.sell_price)
    }
}

/// The lines the printer would be handed for this transaction at this sell
/// price, so the screen can show the struk before it is printed.
async fn history_receipt(
    State(state): State<AppState>,
    Path(trx_id): Path<String>,
    Query(price): Query<SellPrice>,
) -> ApiResult<axum::Json<Vec<ReceiptLineResponse>>> {
    let sell_price = price.checked()?;
    Ok(axum::Json(
        services::receipt::ppob_history_receipt(&state.db, &state.mitra, trx_id, sell_price)
            .await?,
    ))
}

/// Print a struk for a transaction in Mitra's history. Like the other print
/// routes, the paper comes out of the till the server runs on, and the
/// response says the job was handed over, not that paper appeared.
async fn history_print(
    State(state): State<AppState>,
    Path(trx_id): Path<String>,
    Json(price): Json<SellPrice>,
) -> ApiResult<StatusCode> {
    let sell_price = price.checked()?;
    services::receipt::print_ppob_history(&state.db, &state.mitra, trx_id, sell_price).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn mutasi(
    State(state): State<AppState>,
    Query(range): Query<HistoryRange>,
) -> ApiResult<axum::Json<Vec<MutasiItem>>> {
    Ok(axum::Json(
        services::ppob::history::mutasi(&state.db, &state.mitra, range.start_date, range.end_date)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationParams {
    page: Option<i64>,
    per_page: Option<i64>,
    force_refresh: Option<bool>,
}

async fn notifications(
    State(state): State<AppState>,
    Query(params): Query<NotificationParams>,
) -> ApiResult<axum::Json<NotificationListResult>> {
    Ok(axum::Json(
        services::ppob::notifications::list(
            &state.db,
            &state.mitra,
            params.page,
            params.per_page,
            params.force_refresh,
        )
        .await?,
    ))
}

async fn mark_all_read(State(state): State<AppState>) -> ApiResult<StatusCode> {
    services::ppob::notifications::mark_all_read(&state.db, &state.mitra).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn mark_read(
    State(state): State<AppState>,
    Path(inbox_id): Path<String>,
) -> ApiResult<StatusCode> {
    services::ppob::notifications::mark_read(&state.db, &state.mitra, inbox_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
