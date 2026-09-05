use sea_orm::DatabaseConnection;
use tauri::State;

use crate::domain::dashboard::{
    DailyRevenue, DashboardSummary, LowStockProduct, PaymentMethodStat, RecentTransaction,
    TopProduct, WeeklyStats,
};
use crate::services;
use crate::utils::AppError;

#[tauri::command]
pub async fn get_dashboard_summary(
    db: State<'_, DatabaseConnection>,
) -> Result<DashboardSummary, AppError> {
    services::dashboard::summary(db.inner()).await
}

#[tauri::command]
pub async fn get_daily_revenue(
    db: State<'_, DatabaseConnection>,
    days: Option<i64>,
) -> Result<Vec<DailyRevenue>, AppError> {
    services::dashboard::daily_revenue(db.inner(), days).await
}

#[tauri::command]
pub async fn get_payment_method_stats(
    db: State<'_, DatabaseConnection>,
) -> Result<Vec<PaymentMethodStat>, AppError> {
    services::dashboard::payment_method_stats(db.inner()).await
}

#[tauri::command]
pub async fn get_top_products(
    db: State<'_, DatabaseConnection>,
    limit: Option<i64>,
) -> Result<Vec<TopProduct>, AppError> {
    services::dashboard::top_products(db.inner(), limit).await
}

#[tauri::command]
pub async fn get_low_stock_products(
    db: State<'_, DatabaseConnection>,
) -> Result<Vec<LowStockProduct>, AppError> {
    services::dashboard::low_stock_products(db.inner()).await
}

#[tauri::command]
pub async fn get_recent_transactions(
    db: State<'_, DatabaseConnection>,
) -> Result<Vec<RecentTransaction>, AppError> {
    services::dashboard::recent_transactions(db.inner()).await
}

#[tauri::command]
pub async fn get_weekly_stats(db: State<'_, DatabaseConnection>) -> Result<WeeklyStats, AppError> {
    services::dashboard::weekly_stats(db.inner()).await
}
