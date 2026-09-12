//! The six panels of the home screen.
//!
//! All reads, all session-level, all thin: each one forwards to a dashboard
//! service that clamps its own limits. Nothing here decides anything.

use axum::extract::State;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

use crate::domain::dashboard::{
    DailyRevenue, DashboardSummary, LowStockProduct, PaymentMethodDaily, PaymentMethodStat,
    RecentTransaction, TopProduct,
};
use crate::http::error::ApiResult;
use crate::http::extract::Query;
use crate::http::AppState;
use crate::services;

pub fn session() -> Router<AppState> {
    Router::new()
        .route("/dashboard/summary", get(summary))
        .route("/dashboard/revenue/daily", get(daily_revenue))
        .route("/dashboard/payment-methods", get(payment_methods))
        .route(
            "/dashboard/payment-methods/daily",
            get(payment_methods_daily),
        )
        .route("/dashboard/products/top", get(top_products))
        .route("/dashboard/products/low-stock", get(low_stock))
        .route("/dashboard/transactions/recent", get(recent_transactions))
}

async fn summary(State(state): State<AppState>) -> ApiResult<axum::Json<DashboardSummary>> {
    Ok(axum::Json(services::dashboard::summary(&state.db).await?))
}

#[derive(Debug, Deserialize)]
struct DaysParam {
    days: Option<i64>,
}

async fn daily_revenue(
    State(state): State<AppState>,
    Query(params): Query<DaysParam>,
) -> ApiResult<axum::Json<Vec<DailyRevenue>>> {
    Ok(axum::Json(
        services::dashboard::daily_revenue(&state.db, params.days).await?,
    ))
}

async fn payment_methods(
    State(state): State<AppState>,
) -> ApiResult<axum::Json<Vec<PaymentMethodStat>>> {
    Ok(axum::Json(
        services::dashboard::payment_method_stats(&state.db).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct LimitParam {
    limit: Option<i64>,
}

async fn payment_methods_daily(
    State(state): State<AppState>,
    Query(params): Query<DaysParam>,
) -> ApiResult<axum::Json<Vec<PaymentMethodDaily>>> {
    Ok(axum::Json(
        services::dashboard::payment_method_daily(&state.db, params.days).await?,
    ))
}

async fn top_products(
    State(state): State<AppState>,
    Query(params): Query<LimitParam>,
) -> ApiResult<axum::Json<Vec<TopProduct>>> {
    Ok(axum::Json(
        services::dashboard::top_products(&state.db, params.limit).await?,
    ))
}

async fn low_stock(State(state): State<AppState>) -> ApiResult<axum::Json<Vec<LowStockProduct>>> {
    Ok(axum::Json(
        services::dashboard::low_stock_products(&state.db).await?,
    ))
}

async fn recent_transactions(
    State(state): State<AppState>,
) -> ApiResult<axum::Json<Vec<RecentTransaction>>> {
    Ok(axum::Json(
        services::dashboard::recent_transactions(&state.db).await?,
    ))
}
