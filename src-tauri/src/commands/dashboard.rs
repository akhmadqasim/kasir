use chrono::Local;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde::Serialize;
use tauri::State;

use crate::utils::AppError;

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
pub struct WeeklyStats {
    pub total_revenue: f64,
    pub gross_profit: f64,
    pub total_transactions: i64,
    pub avg_items_per_transaction: f64,
    pub avg_value_per_transaction: f64,
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
}

#[tauri::command]
pub async fn get_dashboard_summary(
    db: State<'_, DatabaseConnection>,
) -> Result<DashboardSummary, AppError> {
    let db = db.inner();

    // Today's revenue and transaction count
    let today_sales = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as cnt \
             FROM transactions \
             WHERE date(created_at, 'localtime') = date('now', 'localtime') AND status != 'refunded'"
                .to_owned(),
        ))
        .await?;

    let (today_revenue, today_transactions) = match &today_sales {
        Some(row) => (
            row.try_get_by_index::<f64>(0).unwrap_or(0.0),
            row.try_get_by_index::<i64>(1).unwrap_or(0),
        ),
        None => (0.0, 0),
    };

    // Today's refunds
    let today_refund_row = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) as cnt, COALESCE(SUM(total_refund_amount), 0) as amt \
             FROM refunds \
             WHERE date(created_at, 'localtime') = date('now', 'localtime')"
                .to_owned(),
        ))
        .await?;

    let (today_refunds, today_refund_amount) = match &today_refund_row {
        Some(row) => (
            row.try_get_by_index::<i64>(0).unwrap_or(0),
            row.try_get_by_index::<f64>(1).unwrap_or(0.0),
        ),
        None => (0, 0.0),
    };

    // Yesterday's revenue
    let yesterday_row = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(total_amount), 0) as revenue \
             FROM transactions \
             WHERE date(created_at, 'localtime') = date('now', 'localtime', '-1 day') AND status != 'refunded'"
                .to_owned(),
        ))
        .await?;

    let yesterday_revenue = match &yesterday_row {
        Some(row) => row.try_get_by_index::<f64>(0).unwrap_or(0.0),
        None => 0.0,
    };

    // Total active products
    let products_row = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) FROM products WHERE is_active = 1".to_owned(),
        ))
        .await?;

    let total_products = match &products_row {
        Some(row) => row.try_get_by_index::<i64>(0).unwrap_or(0),
        None => 0,
    };

    // Low stock count
    let low_stock_row = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) FROM products \
             WHERE is_active = 1 \
             AND min_stock IS NOT NULL AND min_stock > 0 \
             AND stock <= COALESCE(min_stock, 0)"
                .to_owned(),
        ))
        .await?;

    let low_stock_count = match &low_stock_row {
        Some(row) => row.try_get_by_index::<i64>(0).unwrap_or(0),
        None => 0,
    };

    // Today's gross profit (revenue - cost)
    let profit_row = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(ti.subtotal - (p.buy_price * ti.quantity)), 0) \
             FROM transaction_items ti \
             JOIN transactions t ON ti.transaction_id = t.id \
             JOIN products p ON ti.product_id = p.id \
             WHERE date(t.created_at, 'localtime') = date('now', 'localtime') AND t.status != 'refunded'"
                .to_owned(),
        ))
        .await?;

    let today_gross_profit = match &profit_row {
        Some(row) => row.try_get_by_index::<f64>(0).unwrap_or(0.0),
        None => 0.0,
    };

    let today_avg_per_transaction = if today_transactions > 0 {
        today_revenue / today_transactions as f64
    } else {
        0.0
    };

    Ok(DashboardSummary {
        today_revenue,
        today_transactions,
        today_refunds,
        today_refund_amount,
        yesterday_revenue,
        total_products,
        low_stock_count,
        today_gross_profit,
        today_avg_per_transaction,
    })
}

#[tauri::command]
pub async fn get_daily_revenue(
    db: State<'_, DatabaseConnection>,
    days: Option<i64>,
) -> Result<Vec<DailyRevenue>, AppError> {
    let db = db.inner();
    let days = days.unwrap_or(7);

    let sql = format!(
        "SELECT date(created_at, 'localtime') as d, \
         COALESCE(SUM(total_amount), 0) as revenue, \
         COUNT(*) as transactions \
         FROM transactions \
         WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-{} days') AND status != 'refunded' \
         GROUP BY date(created_at, 'localtime') \
         ORDER BY d ASC",
        days
    );

    let rows = db
        .query_all(Statement::from_string(DbBackend::Sqlite, sql))
        .await?;

    let mut revenue_map = std::collections::HashMap::new();
    for row in &rows {
        let date: String = row.try_get_by_index(0).unwrap_or_default();
        let revenue: f64 = row.try_get_by_index(1).unwrap_or(0.0);
        let transactions: i64 = row.try_get_by_index(2).unwrap_or(0);
        revenue_map.insert(date, (revenue, transactions));
    }

    // Fill in missing dates with zero values
    let today = Local::now().date_naive();
    let mut result = Vec::with_capacity(days as usize);
    for i in (0..days).rev() {
        let date = today - chrono::Duration::days(i);
        let date_str = date.format("%Y-%m-%d").to_string();
        let (revenue, transactions) = revenue_map.get(&date_str).copied().unwrap_or((0.0, 0));
        result.push(DailyRevenue {
            date: date_str,
            revenue,
            transactions,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_payment_method_stats(
    db: State<'_, DatabaseConnection>,
) -> Result<Vec<PaymentMethodStat>, AppError> {
    let db = db.inner();

    let rows = db
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT payment_method, COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as total \
             FROM transactions \
             WHERE date(created_at, 'localtime') = date('now', 'localtime') AND status != 'refunded' \
             GROUP BY payment_method"
                .to_owned(),
        ))
        .await?;

    let result = rows
        .iter()
        .map(|row| PaymentMethodStat {
            method: row.try_get_by_index(0).unwrap_or_default(),
            count: row.try_get_by_index(1).unwrap_or(0),
            total: row.try_get_by_index(2).unwrap_or(0.0),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_top_products(
    db: State<'_, DatabaseConnection>,
    limit: Option<i64>,
) -> Result<Vec<TopProduct>, AppError> {
    let db = db.inner();
    let limit = limit.unwrap_or(10);

    let sql = format!(
        "SELECT ti.product_id, ti.product_name, \
         SUM(ti.quantity) as total_qty, \
         SUM(ti.subtotal) as total_revenue \
         FROM transaction_items ti \
         JOIN transactions t ON ti.transaction_id = t.id \
         WHERE date(t.created_at, 'localtime') >= date('now', 'localtime', '-30 days') AND t.status != 'refunded' \
         GROUP BY ti.product_id, ti.product_name \
         ORDER BY total_qty DESC \
         LIMIT {}",
        limit
    );

    let rows = db
        .query_all(Statement::from_string(DbBackend::Sqlite, sql))
        .await?;

    let result = rows
        .iter()
        .map(|row| TopProduct {
            product_id: row.try_get_by_index(0).unwrap_or(0),
            product_name: row.try_get_by_index(1).unwrap_or_default(),
            total_qty: row.try_get_by_index(2).unwrap_or(0),
            total_revenue: row.try_get_by_index(3).unwrap_or(0.0),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_low_stock_products(
    db: State<'_, DatabaseConnection>,
) -> Result<Vec<LowStockProduct>, AppError> {
    let db = db.inner();

    let rows = db
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT id, name, stock, min_stock, unit \
             FROM products \
             WHERE is_active = 1 \
             AND min_stock IS NOT NULL AND min_stock > 0 \
             AND stock <= min_stock \
             ORDER BY (stock - min_stock) ASC \
             LIMIT 20"
                .to_owned(),
        ))
        .await?;

    let result = rows
        .iter()
        .map(|row| LowStockProduct {
            id: row.try_get_by_index(0).unwrap_or(0),
            name: row.try_get_by_index(1).unwrap_or_default(),
            stock: row.try_get_by_index(2).unwrap_or(0),
            min_stock: row.try_get_by_index(3).unwrap_or(0),
            unit: row.try_get_by_index(4).unwrap_or_default(),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_recent_transactions(
    db: State<'_, DatabaseConnection>,
) -> Result<Vec<RecentTransaction>, AppError> {
    let db = db.inner();

    let rows = db
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT t.id, t.receipt_number, t.total_amount, t.payment_method, \
             t.status, u.full_name as cashier_name, t.created_at \
             FROM transactions t \
             JOIN users u ON t.user_id = u.id \
             WHERE date(t.created_at, 'localtime') = date('now', 'localtime') \
             ORDER BY t.created_at DESC \
             LIMIT 10"
                .to_owned(),
        ))
        .await?;

    let result = rows
        .iter()
        .map(|row| RecentTransaction {
            id: row.try_get_by_index(0).unwrap_or(0),
            receipt_number: row.try_get_by_index(1).unwrap_or_default(),
            total_amount: row.try_get_by_index(2).unwrap_or(0.0),
            payment_method: row.try_get_by_index(3).unwrap_or_default(),
            status: row.try_get_by_index(4).unwrap_or_default(),
            cashier_name: row.try_get_by_index(5).unwrap_or_default(),
            created_at: row.try_get_by_index(6).unwrap_or_default(),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_weekly_stats(db: State<'_, DatabaseConnection>) -> Result<WeeklyStats, AppError> {
    let db = db.inner();

    let sales_row = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(total_amount), 0), COUNT(*) \
             FROM transactions \
             WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-7 days') AND status != 'refunded'"
                .to_owned(),
        ))
        .await?;

    let (total_revenue, total_transactions) = match &sales_row {
        Some(row) => (
            row.try_get_by_index::<f64>(0).unwrap_or(0.0),
            row.try_get_by_index::<i64>(1).unwrap_or(0),
        ),
        None => (0.0, 0),
    };

    let profit_row = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(ti.subtotal - (p.buy_price * ti.quantity)), 0) \
             FROM transaction_items ti \
             JOIN transactions t ON ti.transaction_id = t.id \
             JOIN products p ON ti.product_id = p.id \
             WHERE date(t.created_at, 'localtime') >= date('now', 'localtime', '-7 days') AND t.status != 'refunded'"
                .to_owned(),
        ))
        .await?;

    let gross_profit = match &profit_row {
        Some(row) => row.try_get_by_index::<f64>(0).unwrap_or(0.0),
        None => 0.0,
    };

    let avg_items_row = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COALESCE(AVG(item_count), 0) FROM ( \
               SELECT COUNT(*) as item_count \
               FROM transaction_items ti \
               JOIN transactions t ON ti.transaction_id = t.id \
               WHERE date(t.created_at, 'localtime') >= date('now', 'localtime', '-7 days') AND t.status != 'refunded' \
               GROUP BY ti.transaction_id \
             )"
                .to_owned(),
        ))
        .await?;

    let avg_items_per_transaction = match &avg_items_row {
        Some(row) => row.try_get_by_index::<f64>(0).unwrap_or(0.0),
        None => 0.0,
    };

    let avg_value_per_transaction = if total_transactions > 0 {
        total_revenue / total_transactions as f64
    } else {
        0.0
    };

    Ok(WeeklyStats {
        total_revenue,
        gross_profit,
        total_transactions,
        avg_items_per_transaction,
        avg_value_per_transaction,
    })
}
