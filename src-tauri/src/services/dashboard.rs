//! Dashboard aggregates: today against yesterday, the last seven days, and the
//! lists the home screen shows.

use chrono::Local;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, Value};

use crate::domain::dashboard::{
    DailyRevenue, DashboardSummary, LowStockProduct, PaymentMethodStat, RecentTransaction,
    TopProduct, WeeklyStats,
};
use crate::utils::AppError;

/// Converts a local calendar date (taken at 00:00:00 local time) into the UTC
/// `"YYYY-MM-DD HH:MM:SS"` string used to compare against the raw `created_at`
/// column. `created_at` is stored as a UTC timestamp string, so filtering on
/// the raw column keeps `idx_transactions_date` usable (sargable), unlike
/// `date(created_at,'localtime')` which forces a full scan.
///
/// This mirrors the boundary logic in `services/transactions.rs` (`list`) and
/// `services/refunds.rs` (`list`), so the results are identical to the previous
/// `date(created_at,'localtime')` filters. Using half-open ranges
/// (`>= start AND < next_day_start`) makes the translation exact regardless of
/// timestamp sub-second precision.
fn local_date_start_to_utc(date: chrono::NaiveDate) -> String {
    let offset_secs = chrono::Local::now().offset().local_minus_utc() as i64;
    let local_start = date.and_hms_opt(0, 0, 0).unwrap();
    (local_start - chrono::Duration::seconds(offset_secs))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

pub async fn summary(db: &DatabaseConnection) -> Result<DashboardSummary, AppError> {
    // Precompute UTC day boundaries (local day -> UTC) so the date filters stay
    // sargable on idx_transactions_date. Half-open ranges reproduce the old
    // `date(created_at,'localtime') = date('now','localtime')` semantics exactly.
    let today = Local::now().date_naive();
    let yesterday_start = local_date_start_to_utc(today - chrono::Duration::days(1));
    let today_start = local_date_start_to_utc(today);
    let tomorrow_start = local_date_start_to_utc(today + chrono::Duration::days(1));

    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "WITH today_sales AS ( \
               SELECT COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as cnt \
               FROM transactions \
               WHERE created_at >= $2 AND created_at < $3 \
               AND status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted') \
             ), \
             today_refunds AS ( \
               SELECT COUNT(*) as cnt, COALESCE(SUM(total_refund_amount), 0) as amt \
               FROM refunds \
               WHERE created_at >= $2 AND created_at < $3 \
             ), \
             yesterday AS ( \
               SELECT COALESCE(SUM(total_amount), 0) as revenue \
               FROM transactions \
               WHERE created_at >= $1 AND created_at < $2 \
               AND status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted') \
             ), \
             product_counts AS ( \
               SELECT \
                 COUNT(*) as total, \
                 SUM(CASE WHEN min_stock IS NOT NULL AND min_stock > 0 AND stock <= COALESCE(min_stock, 0) THEN 1 ELSE 0 END) as low_stock \
               FROM products WHERE is_active = 1 \
             ), \
             today_profit AS ( \
               SELECT COALESCE(SUM(ti.subtotal - (COALESCE(ti.buy_price, p.buy_price, 0) * ti.quantity)), 0) as profit \
               FROM transaction_items ti \
               JOIN transactions t ON ti.transaction_id = t.id \
               JOIN products p ON ti.product_id = p.id \
               WHERE t.created_at >= $2 AND t.created_at < $3 \
               AND t.status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted') \
             ) \
             SELECT \
               ts.revenue, ts.cnt, \
               tr.cnt, tr.amt, \
               y.revenue, \
               pc.total, pc.low_stock, \
               tp.profit \
             FROM today_sales ts, today_refunds tr, yesterday y, product_counts pc, today_profit tp",
            vec![
                yesterday_start.into(),
                today_start.into(),
                tomorrow_start.into(),
            ],
        ))
        .await?;

    let (
        today_revenue,
        today_transactions,
        today_refunds,
        today_refund_amount,
        yesterday_revenue,
        total_products,
        low_stock_count,
        today_gross_profit,
    ) = match &row {
        Some(r) => (
            r.try_get_by_index::<f64>(0).unwrap_or(0.0),
            r.try_get_by_index::<i64>(1).unwrap_or(0),
            r.try_get_by_index::<i64>(2).unwrap_or(0),
            r.try_get_by_index::<f64>(3).unwrap_or(0.0),
            r.try_get_by_index::<f64>(4).unwrap_or(0.0),
            r.try_get_by_index::<i64>(5).unwrap_or(0),
            r.try_get_by_index::<i64>(6).unwrap_or(0),
            r.try_get_by_index::<f64>(7).unwrap_or(0.0),
        ),
        None => (0.0, 0, 0, 0.0, 0.0, 0, 0, 0.0),
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

pub async fn daily_revenue(
    db: &DatabaseConnection,
    days: Option<i64>,
) -> Result<Vec<DailyRevenue>, AppError> {
    let days = days.unwrap_or(7).clamp(1, 365);

    // The result covers `today-(days-1)..today` inclusive, so the query window
    // starts at `today-(days-1)` — not `today-days`, which pulled an extra
    // calendar day the caller then dropped. Keep date(...) in the
    // SELECT/GROUP BY (grouping by local day), but filter on the raw column via
    // precomputed UTC boundaries so the index stays usable.
    let today = Local::now().date_naive();
    let start_utc = local_date_start_to_utc(today - chrono::Duration::days(days - 1));
    let end_utc = local_date_start_to_utc(today + chrono::Duration::days(1));
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT date(created_at, 'localtime') as d, \
             COALESCE(SUM(total_amount), 0) as revenue, \
             COUNT(*) as transactions \
             FROM transactions \
             WHERE created_at >= $1 AND created_at < $2 \
             AND status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted') \
             GROUP BY date(created_at, 'localtime') \
             ORDER BY d ASC",
            vec![start_utc.into(), end_utc.into()],
        ))
        .await?;

    let mut revenue_map = std::collections::HashMap::new();
    for row in &rows {
        let date: String = row.try_get_by_index(0).unwrap_or_default();
        let revenue: f64 = row.try_get_by_index(1).unwrap_or(0.0);
        let transactions: i64 = row.try_get_by_index(2).unwrap_or(0);
        revenue_map.insert(date, (revenue, transactions));
    }

    // Fill in missing dates with zero values
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

pub async fn payment_method_stats(
    db: &DatabaseConnection,
) -> Result<Vec<PaymentMethodStat>, AppError> {
    let today = Local::now().date_naive();
    let today_start = local_date_start_to_utc(today);
    let tomorrow_start = local_date_start_to_utc(today + chrono::Duration::days(1));

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "WITH payment_method_rows AS ( \
               SELECT tp.payment_method as payment_method, tp.amount as amount, tp.transaction_id as transaction_id \
               FROM transaction_payments tp \
               JOIN transactions t ON t.id = tp.transaction_id \
               WHERE t.created_at >= $1 AND t.created_at < $2 AND t.status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted') \
               UNION ALL \
               SELECT t.payment_method as payment_method, t.total_amount as amount, t.id as transaction_id \
               FROM transactions t \
               WHERE t.created_at >= $1 AND t.created_at < $2 AND t.status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted') \
                 AND NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = t.id) \
             ) \
             SELECT payment_method, COUNT(DISTINCT transaction_id) as cnt, COALESCE(SUM(amount), 0) as total \
             FROM payment_method_rows \
             GROUP BY payment_method",
            vec![today_start.into(), tomorrow_start.into()],
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

pub async fn top_products(
    db: &DatabaseConnection,
    limit: Option<i64>,
) -> Result<Vec<TopProduct>, AppError> {
    let limit = limit.unwrap_or(10).max(1).min(100);

    // `date('now','localtime','-30 days')` == local date (today - 30 days).
    let start_utc = local_date_start_to_utc(Local::now().date_naive() - chrono::Duration::days(30));
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT ti.product_id, ti.product_name, \
             SUM(ti.quantity) as total_qty, \
             SUM(ti.subtotal) as total_revenue \
             FROM transaction_items ti \
             JOIN transactions t ON ti.transaction_id = t.id \
             WHERE t.created_at >= $1 \
               AND t.status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted') \
               AND ti.product_id IS NOT NULL \
             GROUP BY ti.product_id, ti.product_name \
             ORDER BY total_qty DESC \
             LIMIT $2",
            vec![start_utc.into(), Value::BigInt(Some(limit))],
        ))
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

pub async fn low_stock_products(db: &DatabaseConnection) -> Result<Vec<LowStockProduct>, AppError> {
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

/// The only transaction query in this file that used to omit the status filter
/// every other one applies, so voided (`deleted`) and unfulfilled PPOB
/// transactions showed up in "Transaksi Terbaru" at full value.
pub async fn recent_transactions(
    db: &DatabaseConnection,
) -> Result<Vec<RecentTransaction>, AppError> {
    let today = Local::now().date_naive();
    let today_start = local_date_start_to_utc(today);
    let tomorrow_start = local_date_start_to_utc(today + chrono::Duration::days(1));

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT t.id, t.receipt_number, t.total_amount, t.payment_method, \
             t.status, u.full_name as cashier_name, t.created_at, \
             COALESCE(SUM(ti.quantity), 0) as total_items \
             FROM transactions t \
             JOIN users u ON t.user_id = u.id \
             LEFT JOIN transaction_items ti ON ti.transaction_id = t.id \
             WHERE t.created_at >= $1 AND t.created_at < $2 \
             AND t.status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted') \
             GROUP BY t.id \
             ORDER BY t.created_at DESC \
             LIMIT 10",
            vec![today_start.into(), tomorrow_start.into()],
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
            total_items: row.try_get_by_index(7).unwrap_or(0),
        })
        .collect();

    Ok(result)
}

pub async fn weekly_stats(db: &DatabaseConnection) -> Result<WeeklyStats, AppError> {
    // `today - 7 days` with no upper bound spans 8 calendar days, while the
    // chart `get_daily_revenue` draws next to this card covers `today-6..today`.
    // Use the same closed 7-day window so the card total matches the chart.
    let today = Local::now().date_naive();
    let start_utc = local_date_start_to_utc(today - chrono::Duration::days(6));
    let end_utc = local_date_start_to_utc(today + chrono::Duration::days(1));

    let sales_row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(total_amount), 0), COUNT(*) \
             FROM transactions \
             WHERE created_at >= $1 AND created_at < $2 \
             AND status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted')",
            vec![start_utc.clone().into(), end_utc.clone().into()],
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
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(ti.subtotal - (COALESCE(ti.buy_price, p.buy_price, 0) * ti.quantity)), 0) \
             FROM transaction_items ti \
             JOIN transactions t ON ti.transaction_id = t.id \
             JOIN products p ON ti.product_id = p.id \
             WHERE t.created_at >= $1 AND t.created_at < $2 \
             AND t.status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted')",
            vec![start_utc.clone().into(), end_utc.clone().into()],
        ))
        .await?;

    let gross_profit = match &profit_row {
        Some(row) => row.try_get_by_index::<f64>(0).unwrap_or(0.0),
        None => 0.0,
    };

    let avg_items_row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COALESCE(AVG(item_count), 0) FROM ( \
               SELECT COUNT(*) as item_count \
               FROM transaction_items ti \
               JOIN transactions t ON ti.transaction_id = t.id \
               WHERE t.created_at >= $1 AND t.created_at < $2 \
               AND t.status NOT IN ('refunded', 'pending_ppob', 'ppob_failed', 'deleted') \
               GROUP BY ti.transaction_id \
             )",
            vec![start_utc.into(), end_utc.into()],
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{insert_transaction, setup_test_db, utc_at_local_noon};

    #[tokio::test]
    async fn recent_transactions_exclude_voided_and_unfulfilled() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(Local::now().date_naive());
        insert_transaction(&conn, 1, 100_000.0, "completed", &created_at).await;
        insert_transaction(&conn, 1, 30_000.0, "partial_refund", &created_at).await;
        insert_transaction(&conn, 1, 999_000.0, "deleted", &created_at).await;
        insert_transaction(&conn, 1, 50_000.0, "pending_ppob", &created_at).await;
        insert_transaction(&conn, 1, 40_000.0, "ppob_failed", &created_at).await;
        insert_transaction(&conn, 1, 70_000.0, "refunded", &created_at).await;

        let rows = recent_transactions(&conn).await.expect("query");

        let mut statuses: Vec<&str> = rows.iter().map(|r| r.status.as_str()).collect();
        statuses.sort_unstable();
        assert_eq!(statuses, vec!["completed", "partial_refund"]);
    }

    /// The weekly card and the 7-day chart must cover the same window. The card
    /// used to start at `today - 7` with no upper bound, so it counted 8
    /// calendar days and could never match the chart.
    #[tokio::test]
    async fn weekly_stats_cover_the_same_seven_days_as_the_chart() {
        let conn = setup_test_db().await;
        let today = Local::now().date_naive();

        // Outside the 7-day window the chart draws.
        insert_transaction(
            &conn,
            1,
            999_000.0,
            "completed",
            &utc_at_local_noon(today - chrono::Duration::days(7)),
        )
        .await;
        // First and last day of the window.
        insert_transaction(
            &conn,
            1,
            60_000.0,
            "completed",
            &utc_at_local_noon(today - chrono::Duration::days(6)),
        )
        .await;
        insert_transaction(&conn, 1, 40_000.0, "completed", &utc_at_local_noon(today)).await;

        let stats = weekly_stats(&conn).await.expect("weekly stats");
        assert_eq!(stats.total_transactions, 2);
        assert_eq!(stats.total_revenue, 100_000.0);

        let chart = daily_revenue(&conn, Some(7)).await.expect("chart");
        assert_eq!(chart.len(), 7);
        let chart_revenue: f64 = chart.iter().map(|d| d.revenue).sum();
        let chart_transactions: i64 = chart.iter().map(|d| d.transactions).sum();
        assert_eq!(chart_revenue, stats.total_revenue);
        assert_eq!(chart_transactions, stats.total_transactions);
    }
}
