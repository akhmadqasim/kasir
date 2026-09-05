//! Dashboard aggregates: today against yesterday, the last seven days, and the
//! lists the home screen shows.

use chrono::Local;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, Value};

use crate::domain::dashboard::{
    DailyRevenue, DashboardSummary, LowStockProduct, PaymentMethodStat, RecentTransaction,
    TopProduct, WeeklyStats,
};
use crate::services::reports::{refund_adjust_cte, SALE_STATUSES};
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

    // Revenue and profit are NET of returns, on the day the money went back over
    // the counter — the same rule the reports follow, so the dashboard card and
    // the sales report never show different numbers for the same day. See
    // `reports::refund_adjust_cte`.
    //
    // Cost is now the same aggregate the reports use (every line, `products`
    // LEFT JOINed) rather than an inner join that silently dropped PPOB lines
    // and lines whose product row was deleted, which made the dashboard's profit
    // disagree with the report's for the same day.
    let sql = format!(
        "WITH today_sales AS ( \
           SELECT COALESCE(SUM(t.total_amount), 0) as revenue, COUNT(*) as cnt \
           FROM transactions t \
           WHERE t.created_at >= $2 AND t.created_at < $3 \
           AND {SALE_STATUSES} \
         ), \
         today_refunds AS ( \
           SELECT COUNT(*) as cnt, COALESCE(SUM(total_refund_amount), 0) as amt \
           FROM refunds \
           WHERE created_at >= $2 AND created_at < $3 \
         ), \
         yesterday AS ( \
           SELECT COALESCE(SUM(t.total_amount), 0) as revenue \
           FROM transactions t \
           WHERE t.created_at >= $1 AND t.created_at < $2 \
           AND {SALE_STATUSES} \
         ), \
         product_counts AS ( \
           SELECT \
             COUNT(*) as total, \
             SUM(CASE WHEN {LOW_STOCK_SQL} THEN 1 ELSE 0 END) as low_stock \
           FROM products WHERE is_active = 1 \
         ), \
         today_cost AS ( \
           SELECT COALESCE(SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)), 0) as cost \
           FROM transaction_items ti \
           JOIN transactions t ON ti.transaction_id = t.id \
           LEFT JOIN products p ON p.id = ti.product_id \
           WHERE t.created_at >= $2 AND t.created_at < $3 \
           AND {SALE_STATUSES} \
         ), \
         {refund_adjust}, \
         today_adjust AS ( \
           SELECT COALESCE(SUM(revenue), 0) as revenue, COALESCE(SUM(cost), 0) as cost \
           FROM refund_adjust WHERE bucket = date($2, 'localtime') \
         ), \
         yesterday_adjust AS ( \
           SELECT COALESCE(SUM(revenue), 0) as revenue \
           FROM refund_adjust WHERE bucket = date($1, 'localtime') \
         ) \
         SELECT \
           ts.revenue - ta.revenue, ts.cnt, \
           tr.cnt, tr.amt, \
           y.revenue - ya.revenue, \
           pc.total, pc.low_stock, \
           (ts.revenue - ta.revenue) - (tc.cost - ta.cost) \
         FROM today_sales ts, today_refunds tr, yesterday y, product_counts pc, \
              today_cost tc, today_adjust ta, yesterday_adjust ya",
        LOW_STOCK_SQL = crate::services::products::LOW_STOCK_SQL,
        refund_adjust = refund_adjust_cte(
            "date(r.created_at, 'localtime')",
            "date(r.created_at, 'localtime')",
            "$1",
            "$3",
        ),
    );

    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
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
    // Net of returns, dated to the day the money went back — the same rule the
    // sales reports use, so the chart and `weekly_stats` agree with them and
    // with each other.
    let sql = format!(
        "WITH sales AS ( \
           SELECT date(t.created_at, 'localtime') as d, \
                  COALESCE(SUM(t.total_amount), 0) as revenue, \
                  COUNT(*) as transactions \
           FROM transactions t \
           WHERE t.created_at >= $1 AND t.created_at < $2 \
           AND {SALE_STATUSES} \
           GROUP BY d \
         ), \
         {refund_adjust}, \
         days AS (SELECT d FROM sales UNION SELECT bucket as d FROM refund_adjust) \
         SELECT days.d, \
                COALESCE(sales.revenue, 0) - COALESCE(refund_adjust.revenue, 0) as revenue, \
                COALESCE(sales.transactions, 0) as transactions \
         FROM days \
         LEFT JOIN sales ON sales.d = days.d \
         LEFT JOIN refund_adjust ON refund_adjust.bucket = days.d \
         ORDER BY days.d ASC",
        refund_adjust = refund_adjust_cte(
            "date(r.created_at, 'localtime')",
            "date(r.created_at, 'localtime')",
            "$1",
            "$2",
        ),
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
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

    // Mirrors `reports::payment_methods` exactly, over today's window: a return
    // is deducted from the method it was paid back on.
    let sql = format!(
        "WITH payment_method_rows AS ( \
           SELECT tp.payment_method as payment_method, tp.amount as amount, tp.transaction_id as transaction_id \
           FROM transaction_payments tp \
           JOIN transactions t ON t.id = tp.transaction_id \
           WHERE t.created_at >= $1 AND t.created_at < $2 AND {SALE_STATUSES} \
           UNION ALL \
           SELECT t.payment_method as payment_method, t.total_amount as amount, t.id as transaction_id \
           FROM transactions t \
           WHERE t.created_at >= $1 AND t.created_at < $2 AND {SALE_STATUSES} \
             AND NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = t.id) \
         ), \
         sales AS ( \
           SELECT payment_method, COUNT(DISTINCT transaction_id) as cnt, COALESCE(SUM(amount), 0) as total \
           FROM payment_method_rows \
           GROUP BY payment_method \
         ), \
         {refund_adjust}, \
         methods AS (SELECT payment_method as method FROM sales UNION SELECT bucket as method FROM refund_adjust) \
         SELECT methods.method, \
                COALESCE(sales.cnt, 0) as cnt, \
                COALESCE(sales.total, 0) - COALESCE(refund_adjust.revenue, 0) as total \
         FROM methods \
         LEFT JOIN sales ON sales.payment_method = methods.method \
         LEFT JOIN refund_adjust ON refund_adjust.bucket = methods.method",
        refund_adjust = refund_adjust_cte(
            "COALESCE(r.payment_method, t.payment_method)",
            "COALESCE(r.payment_method, t.payment_method)",
            "$1",
            "$2",
        ),
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
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
    let limit = limit.unwrap_or(10).clamp(1, 100);

    // `date('now','localtime','-30 days')` == local date (today - 30 days). The
    // window is closed at the top so the refund side covers exactly the same
    // span as the sales side (and so a row dated in the future by a wrong clock
    // no longer leaks in).
    let today = Local::now().date_naive();
    let start_utc = local_date_start_to_utc(today - chrono::Duration::days(30));
    let end_utc = local_date_start_to_utc(today + chrono::Duration::days(1));

    // Net quantities and net revenue: units handed back come off the product
    // they were sold as, units handed over as exchange replacements are added to
    // the product that went out. Revenue is `net_subtotal` for the same reason
    // `reports::PRODUCT_SOLD_CTE` uses it — it is the money the line actually
    // brought in.
    let sql = format!(
        "WITH sold AS ( \
           SELECT ti.product_id as product_id, \
                  MAX(ti.product_name) as product_name, \
                  SUM(ti.quantity) as qty, \
                  SUM(ti.net_subtotal) as revenue \
           FROM transaction_items ti \
           JOIN transactions t ON ti.transaction_id = t.id \
           WHERE t.created_at >= $1 AND t.created_at < $2 \
             AND {SALE_STATUSES} \
             AND ti.product_id IS NOT NULL \
           GROUP BY ti.product_id \
         ), \
         {refund_adjust}, \
         ids AS (SELECT product_id FROM sold UNION SELECT bucket as product_id FROM refund_adjust) \
         SELECT ids.product_id, \
                COALESCE(sold.product_name, p.name, '(dihapus)') as product_name, \
                COALESCE(sold.qty, 0) - COALESCE(refund_adjust.qty, 0) as total_qty, \
                COALESCE(sold.revenue, 0) - COALESCE(refund_adjust.revenue, 0) as total_revenue \
         FROM ids \
         LEFT JOIN sold ON sold.product_id = ids.product_id \
         LEFT JOIN refund_adjust ON refund_adjust.bucket = ids.product_id \
         LEFT JOIN products p ON p.id = ids.product_id \
         ORDER BY total_qty DESC \
         LIMIT $3",
        refund_adjust = refund_adjust_cte("ri.product_id", "ei.product_id", "$1", "$2"),
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
            vec![start_utc.into(), end_utc.into(), Value::BigInt(Some(limit))],
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

/// The twenty products most in need of restocking, by the one shared definition
/// of low stock (`products::LOW_STOCK_SQL`). The list and the count on the
/// summary card used to be built from the same predicate as each other but a
/// different one from the products screen's quick filter; they are all one now.
pub async fn low_stock_products(db: &DatabaseConnection) -> Result<Vec<LowStockProduct>, AppError> {
    let rows = db
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT id, name, stock, min_stock, unit \
                 FROM products \
                 WHERE is_active = 1 \
                 AND {} \
                 ORDER BY (stock - COALESCE(min_stock, 0)) ASC, id ASC \
                 LIMIT 20",
                crate::services::products::LOW_STOCK_SQL
            ),
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

    // Revenue and profit net of the week's returns, computed exactly as
    // `reports::query_sales_buckets` does over the same window, so the card
    // agrees with the chart beside it and with the sales report behind it.
    let sales_sql = format!(
        "WITH sales AS ( \
           SELECT COALESCE(SUM(t.total_amount), 0) as revenue, COUNT(*) as cnt \
           FROM transactions t \
           WHERE t.created_at >= $1 AND t.created_at < $2 \
           AND {SALE_STATUSES} \
         ), \
         cost AS ( \
           SELECT COALESCE(SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)), 0) as cost \
           FROM transaction_items ti \
           JOIN transactions t ON ti.transaction_id = t.id \
           LEFT JOIN products p ON p.id = ti.product_id \
           WHERE t.created_at >= $1 AND t.created_at < $2 \
           AND {SALE_STATUSES} \
         ), \
         {refund_adjust}, \
         adjust AS ( \
           SELECT COALESCE(SUM(revenue), 0) as revenue, COALESCE(SUM(cost), 0) as cost \
           FROM refund_adjust \
         ) \
         SELECT sales.revenue - adjust.revenue, \
                sales.cnt, \
                (sales.revenue - adjust.revenue) - (cost.cost - adjust.cost) \
         FROM sales, cost, adjust",
        refund_adjust = refund_adjust_cte("1", "1", "$1", "$2"),
    );

    let sales_row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sales_sql,
            vec![start_utc.clone().into(), end_utc.clone().into()],
        ))
        .await?;

    let (total_revenue, total_transactions, gross_profit) = match &sales_row {
        Some(row) => (
            row.try_get_by_index::<f64>(0).unwrap_or(0.0),
            row.try_get_by_index::<i64>(1).unwrap_or(0),
            row.try_get_by_index::<f64>(2).unwrap_or(0.0),
        ),
        None => (0.0, 0, 0.0),
    };

    let avg_items_sql = format!(
        "SELECT COALESCE(AVG(item_count), 0) FROM ( \
           SELECT COUNT(*) as item_count \
           FROM transaction_items ti \
           JOIN transactions t ON ti.transaction_id = t.id \
           WHERE t.created_at >= $1 AND t.created_at < $2 \
           AND {SALE_STATUSES} \
           GROUP BY ti.transaction_id \
         )"
    );

    let avg_items_row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &avg_items_sql,
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
    use crate::services::reports;
    use crate::test_support::{
        insert_product, insert_refund, insert_refund_item, insert_transaction,
        insert_transaction_item, setup_test_db, utc_at_local_noon, RefundSpec,
    };

    /// A Rp 300.000 sale of three Rp 100.000 items (cost Rp 60.000 each), with
    /// `returned` of them handed straight back the same day.
    async fn sale_with_return(db: &DatabaseConnection, returned: usize) {
        let created_at = utc_at_local_noon(Local::now().date_naive());
        let txn = insert_transaction(db, 1, 300_000.0, "completed", &created_at).await;

        let mut lines = Vec::new();
        for name in ["Beras 5kg", "Gula 1kg", "Minyak 1L"] {
            let product = insert_product(db, name, 60_000.0, 100_000.0, 100).await;
            let item =
                insert_transaction_item(db, txn.id, Some(product.id), name, 100_000.0, 60_000.0, 1)
                    .await;
            lines.push((item.id, product.id));
        }

        if returned == 0 {
            return;
        }

        let refund = insert_refund(
            db,
            RefundSpec {
                transaction_id: txn.id,
                user_id: 1,
                refund_type: "refund",
                total_refund_amount: 100_000.0 * returned as f64,
                total_exchange_amount: 0.0,
                difference_amount: 100_000.0 * returned as f64,
                payment_method: "cash",
                shift_id: None,
                created_at: &created_at,
            },
        )
        .await;
        for (item_id, product_id) in lines.iter().take(returned) {
            insert_refund_item(db, refund.id, *item_id, *product_id, 1, 100_000.0).await;
        }
    }

    /// The card at the top of the home screen and the sales report behind it are
    /// two queries over the same day. They have to produce the same rupiah.
    #[tokio::test]
    async fn the_summary_card_agrees_with_the_daily_sales_report() {
        let conn = setup_test_db().await;
        sale_with_return(&conn, 2).await;

        let card = summary(&conn).await.expect("summary");
        let day = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let report = reports::daily_sales(&conn, day.clone(), day)
            .await
            .expect("report");

        assert_eq!(card.today_revenue, 100_000.0);
        assert_eq!(card.today_gross_profit, 40_000.0);
        assert_eq!(card.today_revenue, report[0].total_revenue);
        assert_eq!(card.today_gross_profit, report[0].gross_profit);
    }

    /// Yesterday's figure is netted the same way, so the "vs kemarin" comparison
    /// is not gross against net.
    #[tokio::test]
    async fn yesterday_revenue_is_net_too() {
        let conn = setup_test_db().await;
        let yesterday = Local::now().date_naive() - chrono::Duration::days(1);
        let created_at = utc_at_local_noon(yesterday);

        let product = insert_product(&conn, "Beras 5kg", 60_000.0, 100_000.0, 100).await;
        let txn = insert_transaction(&conn, 1, 200_000.0, "completed", &created_at).await;
        let line = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Beras 5kg",
            100_000.0,
            60_000.0,
            2,
        )
        .await;
        let refund = insert_refund(
            &conn,
            RefundSpec {
                transaction_id: txn.id,
                user_id: 1,
                refund_type: "refund",
                total_refund_amount: 100_000.0,
                total_exchange_amount: 0.0,
                difference_amount: 100_000.0,
                payment_method: "cash",
                shift_id: None,
                created_at: &created_at,
            },
        )
        .await;
        insert_refund_item(&conn, refund.id, line.id, product.id, 1, 100_000.0).await;

        let card = summary(&conn).await.expect("summary");
        assert_eq!(card.yesterday_revenue, 100_000.0);
        assert_eq!(card.today_revenue, 0.0);
    }

    #[tokio::test]
    async fn the_revenue_chart_and_the_weekly_card_are_net_and_agree() {
        let conn = setup_test_db().await;
        sale_with_return(&conn, 2).await;

        let chart = daily_revenue(&conn, Some(7)).await.expect("chart");
        let stats = weekly_stats(&conn).await.expect("weekly stats");

        let chart_revenue: f64 = chart.iter().map(|d| d.revenue).sum();
        assert_eq!(chart_revenue, 100_000.0);
        assert_eq!(stats.total_revenue, chart_revenue);
        assert_eq!(stats.gross_profit, 40_000.0);
    }

    #[tokio::test]
    async fn top_products_drop_the_units_that_came_back() {
        let conn = setup_test_db().await;
        sale_with_return(&conn, 2).await;

        let rows = top_products(&conn, Some(10)).await.expect("top products");

        let total_qty: i64 = rows.iter().map(|r| r.total_qty).sum();
        let total_revenue: f64 = rows.iter().map(|r| r.total_revenue).sum();
        assert_eq!(total_qty, 1);
        assert_eq!(total_revenue, 100_000.0);
    }

    /// The count on the card and the list under it are the same predicate, and
    /// so is the products screen's quick filter — `products::LOW_STOCK_SQL`.
    #[tokio::test]
    async fn the_low_stock_count_matches_the_low_stock_list() {
        let conn = setup_test_db().await;
        // Out of stock with no threshold ever set: the old dashboard rule
        // ignored these entirely, which is most of a freshly imported catalogue.
        insert_product(&conn, "Habis", 1_000.0, 2_000.0, 0).await;
        insert_product(&conn, "Aman", 1_000.0, 2_000.0, 50).await;

        let card = summary(&conn).await.expect("summary");
        let list = low_stock_products(&conn).await.expect("list");

        assert_eq!(card.low_stock_count, 1);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Habis");
    }

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
