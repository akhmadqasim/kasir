use sea_orm::DatabaseConnection;
use tauri::State;

use crate::domain::reports::*;
use crate::services;
use crate::utils::AppError;

#[tauri::command]
pub async fn report_sales_daily(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<Vec<DailySalesRow>, AppError> {
    services::reports::daily_sales(db.inner(), start_date, end_date).await
}

#[tauri::command]
pub async fn report_sales_monthly(
    db: State<'_, DatabaseConnection>,
    year: i32,
) -> Result<Vec<MonthlySalesRow>, AppError> {
    services::reports::monthly_sales(db.inner(), year).await
}

#[tauri::command]
pub async fn report_sales_period(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<PeriodSalesSummary, AppError> {
    services::reports::sales_period(db.inner(), start_date, end_date).await
}

#[tauri::command]
pub async fn report_sales_receipt(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
    search: String,
) -> Result<ReceiptReport, AppError> {
    services::reports::sales_receipts(db.inner(), start_date, end_date, search).await
}

#[tauri::command]
pub async fn report_payment_methods(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<Vec<PaymentMethodRow>, AppError> {
    services::reports::payment_methods(db.inner(), start_date, end_date).await
}

#[tauri::command]
pub async fn report_product_sales(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<Vec<ProductSalesRow>, AppError> {
    services::reports::product_sales(db.inner(), start_date, end_date).await
}

#[tauri::command]
pub async fn report_popular_products(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
    limit: i32,
) -> Result<Vec<PopularProductRow>, AppError> {
    services::reports::popular_products(db.inner(), start_date, end_date, limit).await
}

#[tauri::command]
pub async fn report_returns(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<Vec<ReturnRow>, AppError> {
    services::reports::returns(db.inner(), start_date, end_date).await
}

#[tauri::command]
pub async fn report_current_stock(
    db: State<'_, DatabaseConnection>,
    search: String,
    filter: String,
) -> Result<CurrentStockReport, AppError> {
    services::reports::current_stock(db.inner(), search, filter).await
}

#[tauri::command]
pub async fn report_losses(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<LossSummary, AppError> {
    services::reports::losses(db.inner(), start_date, end_date).await
}

#[tauri::command]
pub async fn report_cash_flows(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<CashFlowReportSummary, AppError> {
    services::reports::cash_flows(db.inner(), start_date, end_date).await
}
