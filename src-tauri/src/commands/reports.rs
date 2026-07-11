use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde::Serialize;
use tauri::State;

use crate::utils::AppError;

// --- Date boundary helpers ---
//
// `created_at` columns are stored as UTC `"YYYY-MM-DD HH:MM:SS"` strings, so
// filtering with `date(created_at,'localtime')` wraps the column and defeats the
// date indexes. These helpers convert an inclusive local date range into raw
// UTC boundaries, mirroring the proven approach in `commands/transactions.rs`
// (`list_transactions`) and `commands/refunds.rs` (`list_refunds`). Comparing
// the raw column against `>= start AND < end_exclusive` is sargable and
// reproduces the previous `date(created_at,'localtime') BETWEEN` semantics
// exactly, independent of timestamp sub-second precision.

/// UTC boundary for 00:00:00 local of `date_str` (the inclusive lower bound).
fn local_date_start_to_utc(date_str: &str) -> String {
    let offset_secs = chrono::Local::now().offset().local_minus_utc() as i64;
    match chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        Ok(d) => (d.and_hms_opt(0, 0, 0).unwrap() - chrono::Duration::seconds(offset_secs))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
        Err(_) => format!("{} 00:00:00", date_str),
    }
}

/// UTC boundary for 00:00:00 local of the day AFTER `date_str` (the exclusive
/// upper bound). `created_at < this` reproduces `date(...) <= date_str`.
fn local_date_end_exclusive_to_utc(date_str: &str) -> String {
    let offset_secs = chrono::Local::now().offset().local_minus_utc() as i64;
    match chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        Ok(d) => ((d + chrono::Duration::days(1)).and_hms_opt(0, 0, 0).unwrap()
            - chrono::Duration::seconds(offset_secs))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string(),
        Err(_) => format!("{} 23:59:59", date_str),
    }
}

// --- Types ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailySalesRow {
    pub date: String,
    pub transaction_count: i64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub gross_profit: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlySalesRow {
    pub month: String,
    pub transaction_count: i64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub gross_profit: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodSalesSummary {
    pub total_transactions: i64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub gross_profit: f64,
    pub avg_per_transaction: f64,
    pub daily_breakdown: Vec<DailySalesRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptRow {
    pub id: i64,
    pub receipt_number: String,
    pub cashier_name: String,
    pub total_amount: f64,
    pub payment_method: String,
    pub status: String,
    pub item_count: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodRow {
    pub payment_method: String,
    pub transaction_count: i64,
    pub total_amount: f64,
    pub percentage: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSalesRow {
    pub product_id: i64,
    pub product_name: String,
    pub barcode: Option<String>,
    pub category_name: Option<String>,
    pub qty_sold: i64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub profit: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopularProductRow {
    pub rank: i64,
    pub product_id: i64,
    pub product_name: String,
    pub category_name: Option<String>,
    pub qty_sold: i64,
    pub total_revenue: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReturnRow {
    pub id: i64,
    pub refund_number: String,
    pub transaction_receipt: String,
    pub cashier_name: String,
    #[serde(rename = "type")]
    pub refund_type: String,
    pub total_refund_amount: f64,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentStockRow {
    pub product_id: i64,
    pub barcode: Option<String>,
    pub product_name: String,
    pub category_name: Option<String>,
    pub stock: i64,
    pub min_stock: i64,
    pub unit: String,
    pub buy_price: f64,
    pub sell_price: f64,
    pub stock_value: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LossRow {
    pub id: i64,
    pub writeoff_number: String,
    pub product_name: String,
    pub cashier_name: String,
    pub quantity: i64,
    pub reason: String,
    pub loss_value: f64,
    pub notes: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonBreakdown {
    pub reason: String,
    pub count: i64,
    pub total_value: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LossSummary {
    pub total_writeoffs: i64,
    pub total_quantity: i64,
    pub total_loss_value: f64,
    pub by_reason: Vec<ReasonBreakdown>,
    pub items: Vec<LossRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashFlowReportRow {
    pub id: i64,
    pub shift_id: i64,
    pub cashier_name: String,
    pub flow_type: String,
    pub amount: f64,
    pub description: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashFlowReportSummary {
    pub total_in: f64,
    pub total_out: f64,
    pub net_total: f64,
    pub items: Vec<CashFlowReportRow>,
}

// --- Helpers ---

async fn query_daily_sales(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<DailySalesRow>, AppError> {
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                date(t.created_at, 'localtime') as sale_date,
                COUNT(DISTINCT t.id) as transaction_count,
                COALESCE(SUM(t.total_amount), 0) as total_revenue,
                COALESCE(SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)), 0) as total_cost,
                COALESCE(SUM(t.total_amount), 0) - COALESCE(SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)), 0) as gross_profit
            FROM transactions t
            LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
            LEFT JOIN products p ON p.id = ti.product_id
            WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded', 'deleted')
            AND t.created_at >= $1 AND t.created_at < $2
            GROUP BY sale_date
            ORDER BY sale_date DESC",
            vec![
                local_date_start_to_utc(start_date).into(),
                local_date_end_exclusive_to_utc(end_date).into(),
            ],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| DailySalesRow {
            date: row.try_get_by_index(0).unwrap_or_default(),
            transaction_count: row.try_get_by_index(1).unwrap_or(0),
            total_revenue: row.try_get_by_index(2).unwrap_or(0.0),
            total_cost: row.try_get_by_index(3).unwrap_or(0.0),
            gross_profit: row.try_get_by_index(4).unwrap_or(0.0),
        })
        .collect())
}

// --- Commands ---

#[tauri::command]
pub async fn report_sales_daily(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<Vec<DailySalesRow>, AppError> {
    query_daily_sales(db.inner(), &start_date, &end_date).await
}

#[tauri::command]
pub async fn report_sales_monthly(
    db: State<'_, DatabaseConnection>,
    year: i32,
) -> Result<Vec<MonthlySalesRow>, AppError> {
    let db = db.inner();
    // `strftime('%Y', created_at,'localtime') = year` == local year is `year`,
    // i.e. created_at in [year-01-01 00:00 local, (year+1)-01-01 00:00 local).
    let year_start = local_date_start_to_utc(&format!("{:04}-01-01", year));
    let year_end = local_date_start_to_utc(&format!("{:04}-01-01", year + 1));

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                strftime('%Y-%m', t.created_at, 'localtime') as sale_month,
                COUNT(DISTINCT t.id) as transaction_count,
                COALESCE(SUM(t.total_amount), 0) as total_revenue,
                COALESCE(SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)), 0) as total_cost,
                COALESCE(SUM(t.total_amount), 0) - COALESCE(SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)), 0) as gross_profit
            FROM transactions t
            LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
            LEFT JOIN products p ON p.id = ti.product_id
            WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded', 'deleted')
            AND t.created_at >= $1 AND t.created_at < $2
            GROUP BY sale_month
            ORDER BY sale_month DESC",
            vec![year_start.into(), year_end.into()],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| MonthlySalesRow {
            month: row.try_get_by_index(0).unwrap_or_default(),
            transaction_count: row.try_get_by_index(1).unwrap_or(0),
            total_revenue: row.try_get_by_index(2).unwrap_or(0.0),
            total_cost: row.try_get_by_index(3).unwrap_or(0.0),
            gross_profit: row.try_get_by_index(4).unwrap_or(0.0),
        })
        .collect())
}

#[tauri::command]
pub async fn report_sales_period(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<PeriodSalesSummary, AppError> {
    let daily = query_daily_sales(db.inner(), &start_date, &end_date).await?;

    let total_transactions: i64 = daily.iter().map(|r| r.transaction_count).sum();
    let total_revenue: f64 = daily.iter().map(|r| r.total_revenue).sum();
    let total_cost: f64 = daily.iter().map(|r| r.total_cost).sum();
    let gross_profit = total_revenue - total_cost;
    let avg = if total_transactions > 0 {
        total_revenue / total_transactions as f64
    } else {
        0.0
    };

    Ok(PeriodSalesSummary {
        total_transactions,
        total_revenue,
        total_cost,
        gross_profit,
        avg_per_transaction: avg,
        daily_breakdown: daily,
    })
}

#[tauri::command]
pub async fn report_sales_receipt(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
    search: String,
) -> Result<Vec<ReceiptRow>, AppError> {
    let db = db.inner();

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                t.id,
                t.receipt_number,
                COALESCE(u.full_name, '-') as cashier_name,
                t.total_amount,
                t.payment_method,
                t.status,
                (SELECT COUNT(*) FROM transaction_items WHERE transaction_id = t.id) as item_count,
                t.created_at
            FROM transactions t
            LEFT JOIN users u ON u.id = t.user_id
            WHERE t.created_at >= $1 AND t.created_at < $2
            AND ($3 = '' OR t.receipt_number LIKE '%' || $3 || '%')
            ORDER BY t.created_at DESC
            LIMIT 500",
            vec![
                local_date_start_to_utc(&start_date).into(),
                local_date_end_exclusive_to_utc(&end_date).into(),
                search.into(),
            ],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| ReceiptRow {
            id: row.try_get_by_index(0).unwrap_or(0),
            receipt_number: row.try_get_by_index(1).unwrap_or_default(),
            cashier_name: row.try_get_by_index(2).unwrap_or_default(),
            total_amount: row.try_get_by_index(3).unwrap_or(0.0),
            payment_method: row.try_get_by_index(4).unwrap_or_default(),
            status: row.try_get_by_index(5).unwrap_or_default(),
            item_count: row.try_get_by_index(6).unwrap_or(0),
            created_at: row.try_get_by_index(7).unwrap_or_default(),
        })
        .collect())
}

#[tauri::command]
pub async fn report_payment_methods(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<Vec<PaymentMethodRow>, AppError> {
    let db = db.inner();

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "WITH payment_method_rows AS (
                SELECT
                    tp.payment_method as payment_method,
                    tp.amount as amount,
                    tp.transaction_id as transaction_id
                FROM transaction_payments tp
                JOIN transactions t ON t.id = tp.transaction_id
                WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded', 'deleted')
                AND t.created_at >= $1 AND t.created_at < $2
                UNION ALL
                SELECT
                    t.payment_method as payment_method,
                    t.total_amount as amount,
                    t.id as transaction_id
                FROM transactions t
                WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded', 'deleted')
                AND t.created_at >= $1 AND t.created_at < $2
                AND NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = t.id)
            )
            SELECT
                payment_method,
                COUNT(DISTINCT transaction_id) as transaction_count,
                COALESCE(SUM(amount), 0) as total_amount
            FROM payment_method_rows
            GROUP BY payment_method
            ORDER BY total_amount DESC",
            vec![
                local_date_start_to_utc(&start_date).into(),
                local_date_end_exclusive_to_utc(&end_date).into(),
            ],
        ))
        .await?;

    let mut result: Vec<PaymentMethodRow> = rows
        .iter()
        .map(|row| PaymentMethodRow {
            payment_method: row.try_get_by_index(0).unwrap_or_default(),
            transaction_count: row.try_get_by_index(1).unwrap_or(0),
            total_amount: row.try_get_by_index(2).unwrap_or(0.0),
            percentage: 0.0,
        })
        .collect();

    let total: f64 = result.iter().map(|r| r.total_amount).sum();
    if total > 0.0 {
        for row in &mut result {
            row.percentage = (row.total_amount / total) * 100.0;
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn report_product_sales(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<Vec<ProductSalesRow>, AppError> {
    let db = db.inner();

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                ti.product_id,
                ti.product_name,
                p.barcode,
                c.name as category_name,
                SUM(ti.quantity) as qty_sold,
                SUM(ti.subtotal) as total_revenue,
                SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)) as total_cost,
                SUM(ti.subtotal) - SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)) as profit
            FROM transaction_items ti
            JOIN transactions t ON t.id = ti.transaction_id
            LEFT JOIN products p ON p.id = ti.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded', 'deleted')
            AND t.created_at >= $1 AND t.created_at < $2
            GROUP BY ti.product_id
            ORDER BY qty_sold DESC",
            vec![
                local_date_start_to_utc(&start_date).into(),
                local_date_end_exclusive_to_utc(&end_date).into(),
            ],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| ProductSalesRow {
            product_id: row.try_get_by_index(0).unwrap_or(0),
            product_name: row.try_get_by_index(1).unwrap_or_default(),
            barcode: row.try_get_by_index(2).ok(),
            category_name: row.try_get_by_index(3).ok(),
            qty_sold: row.try_get_by_index(4).unwrap_or(0),
            total_revenue: row.try_get_by_index(5).unwrap_or(0.0),
            total_cost: row.try_get_by_index(6).unwrap_or(0.0),
            profit: row.try_get_by_index(7).unwrap_or(0.0),
        })
        .collect())
}

#[tauri::command]
pub async fn report_popular_products(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
    limit: i32,
) -> Result<Vec<PopularProductRow>, AppError> {
    let db = db.inner();
    let limit = limit.max(1).min(500);

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                ROW_NUMBER() OVER (ORDER BY SUM(ti.quantity) DESC) as rank,
                ti.product_id,
                ti.product_name,
                c.name as category_name,
                SUM(ti.quantity) as qty_sold,
                SUM(ti.subtotal) as total_revenue
            FROM transaction_items ti
            JOIN transactions t ON t.id = ti.transaction_id
            LEFT JOIN products p ON p.id = ti.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded', 'deleted')
            AND t.created_at >= $1 AND t.created_at < $2
            GROUP BY ti.product_id
            ORDER BY qty_sold DESC
            LIMIT $3",
            vec![
                local_date_start_to_utc(&start_date).into(),
                local_date_end_exclusive_to_utc(&end_date).into(),
                limit.into(),
            ],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| PopularProductRow {
            rank: row.try_get_by_index(0).unwrap_or(0),
            product_id: row.try_get_by_index(1).unwrap_or(0),
            product_name: row.try_get_by_index(2).unwrap_or_default(),
            category_name: row.try_get_by_index(3).ok(),
            qty_sold: row.try_get_by_index(4).unwrap_or(0),
            total_revenue: row.try_get_by_index(5).unwrap_or(0.0),
        })
        .collect())
}

#[tauri::command]
pub async fn report_returns(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<Vec<ReturnRow>, AppError> {
    let db = db.inner();

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                r.id,
                r.refund_number,
                t.receipt_number,
                COALESCE(u.full_name, '-') as cashier_name,
                r.type,
                r.total_refund_amount,
                r.reason,
                r.created_at
            FROM refunds r
            JOIN transactions t ON t.id = r.transaction_id
            LEFT JOIN users u ON u.id = r.user_id
            WHERE r.created_at >= $1 AND r.created_at < $2
            ORDER BY r.created_at DESC",
            vec![
                local_date_start_to_utc(&start_date).into(),
                local_date_end_exclusive_to_utc(&end_date).into(),
            ],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| ReturnRow {
            id: row.try_get_by_index(0).unwrap_or(0),
            refund_number: row.try_get_by_index(1).unwrap_or_default(),
            transaction_receipt: row.try_get_by_index(2).unwrap_or_default(),
            cashier_name: row.try_get_by_index(3).unwrap_or_default(),
            refund_type: row.try_get_by_index(4).unwrap_or_default(),
            total_refund_amount: row.try_get_by_index(5).unwrap_or(0.0),
            reason: row.try_get_by_index(6).ok(),
            created_at: row.try_get_by_index(7).unwrap_or_default(),
        })
        .collect())
}

#[tauri::command]
pub async fn report_current_stock(
    db: State<'_, DatabaseConnection>,
    search: String,
    filter: String,
) -> Result<Vec<CurrentStockRow>, AppError> {
    let db = db.inner();

    let low_stock_clause = if filter == "low" {
        "AND p.stock <= p.min_stock AND p.min_stock > 0"
    } else if filter == "all" || filter.is_empty() {
        ""
    } else {
        "" // Ignore unknown filters
    };

    let sql = format!(
        "SELECT
            p.id,
            p.barcode,
            p.name,
            c.name as category_name,
            p.stock,
            p.min_stock,
            p.unit,
            p.buy_price,
            p.sell_price,
            p.buy_price * p.stock as stock_value
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1
        AND ($1 = '' OR p.name LIKE '%' || $1 || '%' OR p.barcode LIKE '%' || $1 || '%')
        {}
        ORDER BY p.name
        LIMIT 500",
        low_stock_clause
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
            vec![search.into()],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| CurrentStockRow {
            product_id: row.try_get_by_index(0).unwrap_or(0),
            barcode: row.try_get_by_index(1).ok(),
            product_name: row.try_get_by_index(2).unwrap_or_default(),
            category_name: row.try_get_by_index(3).ok(),
            stock: row.try_get_by_index(4).unwrap_or(0),
            min_stock: row.try_get_by_index(5).unwrap_or(0),
            unit: row.try_get_by_index(6).unwrap_or_default(),
            buy_price: row.try_get_by_index(7).unwrap_or(0.0),
            sell_price: row.try_get_by_index(8).unwrap_or(0.0),
            stock_value: row.try_get_by_index(9).unwrap_or(0.0),
        })
        .collect())
}

#[tauri::command]
pub async fn report_losses(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<LossSummary, AppError> {
    let db = db.inner();

    let start_utc = local_date_start_to_utc(&start_date);
    let end_utc = local_date_end_exclusive_to_utc(&end_date);

    // Get items
    let item_rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                sw.id,
                sw.writeoff_number,
                COALESCE(p.name, '-') as product_name,
                COALESCE(u.full_name, '-') as cashier_name,
                sw.quantity,
                sw.reason,
                sw.loss_value,
                sw.notes,
                sw.status,
                sw.created_at
            FROM stock_writeoffs sw
            LEFT JOIN products p ON p.id = sw.product_id
            LEFT JOIN users u ON u.id = sw.user_id
            WHERE sw.created_at >= $1 AND sw.created_at < $2
            ORDER BY sw.created_at DESC",
            vec![start_utc.clone().into(), end_utc.clone().into()],
        ))
        .await?;

    let items: Vec<LossRow> = item_rows
        .iter()
        .map(|row| LossRow {
            id: row.try_get_by_index(0).unwrap_or(0),
            writeoff_number: row.try_get_by_index(1).unwrap_or_default(),
            product_name: row.try_get_by_index(2).unwrap_or_default(),
            cashier_name: row.try_get_by_index(3).unwrap_or_default(),
            quantity: row.try_get_by_index(4).unwrap_or(0),
            reason: row.try_get_by_index(5).unwrap_or_default(),
            loss_value: row.try_get_by_index(6).unwrap_or(0.0),
            notes: row.try_get_by_index(7).ok(),
            status: row.try_get_by_index(8).unwrap_or_default(),
            created_at: row.try_get_by_index(9).unwrap_or_default(),
        })
        .collect();

    // Get reason breakdown
    let reason_rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                reason,
                COUNT(*) as count,
                COALESCE(SUM(loss_value), 0) as total_value
            FROM stock_writeoffs
            WHERE created_at >= $1 AND created_at < $2
            GROUP BY reason
            ORDER BY total_value DESC",
            vec![start_utc.into(), end_utc.into()],
        ))
        .await?;

    let by_reason: Vec<ReasonBreakdown> = reason_rows
        .iter()
        .map(|row| ReasonBreakdown {
            reason: row.try_get_by_index(0).unwrap_or_default(),
            count: row.try_get_by_index(1).unwrap_or(0),
            total_value: row.try_get_by_index(2).unwrap_or(0.0),
        })
        .collect();

    let total_writeoffs = items.len() as i64;
    let total_quantity: i64 = items.iter().map(|i| i.quantity).sum();
    let total_loss_value: f64 = items.iter().map(|i| i.loss_value).sum();

    Ok(LossSummary {
        total_writeoffs,
        total_quantity,
        total_loss_value,
        by_reason,
        items,
    })
}

#[tauri::command]
pub async fn report_cash_flows(
    db: State<'_, DatabaseConnection>,
    start_date: String,
    end_date: String,
) -> Result<CashFlowReportSummary, AppError> {
    let db = db.inner();

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                cf.id,
                cf.shift_id,
                COALESCE(u.full_name, '-') as cashier_name,
                cf.type as flow_type,
                cf.amount,
                cf.description,
                cf.created_at
            FROM cash_flows cf
            LEFT JOIN users u ON u.id = cf.user_id
            WHERE cf.created_at >= $1 AND cf.created_at < $2
            ORDER BY cf.created_at DESC",
            vec![
                local_date_start_to_utc(&start_date).into(),
                local_date_end_exclusive_to_utc(&end_date).into(),
            ],
        ))
        .await?;

    let items: Vec<CashFlowReportRow> = rows
        .iter()
        .map(|row| CashFlowReportRow {
            id: row.try_get_by_index(0).unwrap_or(0),
            shift_id: row.try_get_by_index(1).unwrap_or(0),
            cashier_name: row.try_get_by_index(2).unwrap_or_default(),
            flow_type: row.try_get_by_index(3).unwrap_or_default(),
            amount: row.try_get_by_index(4).unwrap_or(0.0),
            description: row.try_get_by_index(5).unwrap_or_default(),
            created_at: row.try_get_by_index(6).unwrap_or_default(),
        })
        .collect();

    let total_in = items
        .iter()
        .filter(|item| item.flow_type == "in")
        .map(|item| item.amount)
        .sum();
    let total_out = items
        .iter()
        .filter(|item| item.flow_type == "out")
        .map(|item| item.amount)
        .sum();

    Ok(CashFlowReportSummary {
        total_in,
        total_out,
        net_total: total_in - total_out,
        items,
    })
}
