//! Shapes the dashboard cards, charts and lists render.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub today_revenue: f64,
    pub today_transactions: i64,
    pub today_refunds: i64,
    pub today_refund_amount: f64,
    pub yesterday_revenue: f64,
    pub total_products: i64,
    pub low_stock_count: i64,
    pub today_gross_profit: f64,
    pub today_avg_per_transaction: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyRevenue {
    pub date: String,
    pub revenue: f64,
    pub transactions: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodStat {
    pub method: String,
    pub count: i64,
    pub total: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopProduct {
    pub product_id: i64,
    pub product_name: String,
    pub total_qty: i64,
    pub total_revenue: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LowStockProduct {
    pub id: i64,
    pub name: String,
    pub stock: i64,
    pub min_stock: i64,
    pub unit: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentTransaction {
    pub id: i64,
    pub receipt_number: String,
    pub total_amount: f64,
    pub payment_method: String,
    pub status: String,
    pub cashier_name: String,
    pub created_at: String,
    pub total_items: i64,
}
