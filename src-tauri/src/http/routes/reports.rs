//! Reports. Eleven reads, no writes, no roles beyond "logged in".
//!
//! Every one of them is a date range or a search string over data the till
//! already shows, so there is nothing here for an admin to guard that a cashier
//! cannot see on their own screen. The contract keeps them in the session group
//! for that reason.
//!
//! The services take their arguments as plain `String`s because that is the
//! shape the Tauri commands handed them. Query strings arrive the same way, so
//! the only work in this module is supplying the defaults an omitted parameter
//! needs — a missing search box is an empty search, not a 400.

use axum::extract::State;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

use crate::domain::reports::{
    CashFlowReportSummary, CurrentStockReport, DailySalesRow, LossSummary, MonthlySalesRow,
    PaymentMethodRow, PeriodSalesSummary, PopularProductRow, ProductSalesRow, ReceiptReport,
    ReturnRow,
};
use crate::http::error::ApiResult;
use crate::http::extract::Query;
use crate::http::AppState;
use crate::services;

/// How many rows `products/popular` returns when the caller does not say.
const DEFAULT_POPULAR_LIMIT: i32 = 10;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/reports/sales/daily", get(sales_daily))
        .route("/reports/sales/monthly", get(sales_monthly))
        .route("/reports/sales/period", get(sales_period))
        .route("/reports/sales/receipts", get(sales_receipts))
        .route("/reports/payment-methods", get(payment_methods))
        .route("/reports/products/sales", get(product_sales))
        .route("/reports/products/popular", get(popular_products))
        .route("/reports/returns", get(returns))
        .route("/reports/stock/current", get(current_stock))
        .route("/reports/losses", get(losses))
        .route("/reports/cash-flows", get(cash_flows))
}

/// The window nine of the eleven reports take. Both halves are `YYYY-MM-DD`
/// local dates; the services convert to UTC boundaries themselves.
#[derive(Debug, Deserialize)]
struct DateRange {
    #[serde(default)]
    start_date: String,
    #[serde(default)]
    end_date: String,
}

async fn sales_daily(
    State(state): State<AppState>,
    Query(range): Query<DateRange>,
) -> ApiResult<axum::Json<Vec<DailySalesRow>>> {
    Ok(axum::Json(
        services::reports::daily_sales(&state.db, range.start_date, range.end_date).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct YearParam {
    year: i32,
}

async fn sales_monthly(
    State(state): State<AppState>,
    Query(params): Query<YearParam>,
) -> ApiResult<axum::Json<Vec<MonthlySalesRow>>> {
    Ok(axum::Json(
        services::reports::monthly_sales(&state.db, params.year).await?,
    ))
}

async fn sales_period(
    State(state): State<AppState>,
    Query(range): Query<DateRange>,
) -> ApiResult<axum::Json<PeriodSalesSummary>> {
    Ok(axum::Json(
        services::reports::sales_period(&state.db, range.start_date, range.end_date).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct ReceiptSearch {
    #[serde(default)]
    start_date: String,
    #[serde(default)]
    end_date: String,
    #[serde(default)]
    search: String,
}

async fn sales_receipts(
    State(state): State<AppState>,
    Query(params): Query<ReceiptSearch>,
) -> ApiResult<axum::Json<ReceiptReport>> {
    Ok(axum::Json(
        services::reports::sales_receipts(
            &state.db,
            params.start_date,
            params.end_date,
            params.search,
        )
        .await?,
    ))
}

async fn payment_methods(
    State(state): State<AppState>,
    Query(range): Query<DateRange>,
) -> ApiResult<axum::Json<Vec<PaymentMethodRow>>> {
    Ok(axum::Json(
        services::reports::payment_methods(&state.db, range.start_date, range.end_date).await?,
    ))
}

async fn product_sales(
    State(state): State<AppState>,
    Query(range): Query<DateRange>,
) -> ApiResult<axum::Json<Vec<ProductSalesRow>>> {
    Ok(axum::Json(
        services::reports::product_sales(&state.db, range.start_date, range.end_date).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct PopularParams {
    #[serde(default)]
    start_date: String,
    #[serde(default)]
    end_date: String,
    limit: Option<i32>,
}

async fn popular_products(
    State(state): State<AppState>,
    Query(params): Query<PopularParams>,
) -> ApiResult<axum::Json<Vec<PopularProductRow>>> {
    Ok(axum::Json(
        services::reports::popular_products(
            &state.db,
            params.start_date,
            params.end_date,
            params.limit.unwrap_or(DEFAULT_POPULAR_LIMIT),
        )
        .await?,
    ))
}

async fn returns(
    State(state): State<AppState>,
    Query(range): Query<DateRange>,
) -> ApiResult<axum::Json<Vec<ReturnRow>>> {
    Ok(axum::Json(
        services::reports::returns(&state.db, range.start_date, range.end_date).await?,
    ))
}

/// `filter` is one of the stock buckets the report understands; an empty string
/// means "no filter", which is what the service already treats it as.
#[derive(Debug, Deserialize)]
struct StockParams {
    #[serde(default)]
    search: String,
    #[serde(default)]
    filter: String,
}

async fn current_stock(
    State(state): State<AppState>,
    Query(params): Query<StockParams>,
) -> ApiResult<axum::Json<CurrentStockReport>> {
    Ok(axum::Json(
        services::reports::current_stock(&state.db, params.search, params.filter).await?,
    ))
}

async fn losses(
    State(state): State<AppState>,
    Query(range): Query<DateRange>,
) -> ApiResult<axum::Json<LossSummary>> {
    Ok(axum::Json(
        services::reports::losses(&state.db, range.start_date, range.end_date).await?,
    ))
}

async fn cash_flows(
    State(state): State<AppState>,
    Query(range): Query<DateRange>,
) -> ApiResult<axum::Json<CashFlowReportSummary>> {
    Ok(axum::Json(
        services::reports::cash_flows(&state.db, range.start_date, range.end_date).await?,
    ))
}
