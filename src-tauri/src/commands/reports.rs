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
        Ok(d) => ((d + chrono::Duration::days(1))
            .and_hms_opt(0, 0, 0)
            .unwrap()
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
            // Revenue is per transaction, cost is per line item, so the two are
            // aggregated separately and joined on the day. Summing
            // `t.total_amount` over a join against `transaction_items` counted
            // each transaction once per item, inflating revenue by the item
            // count.
            "WITH tx AS (
                SELECT
                    t.id as id,
                    date(t.created_at, 'localtime') as sale_date,
                    t.total_amount as total_amount
                FROM transactions t
                WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded', 'deleted')
                AND t.created_at >= $1 AND t.created_at < $2
            ),
            revenue AS (
                SELECT
                    sale_date,
                    COUNT(*) as transaction_count,
                    COALESCE(SUM(total_amount), 0) as total_revenue
                FROM tx
                GROUP BY sale_date
            ),
            cost AS (
                SELECT
                    tx.sale_date as sale_date,
                    COALESCE(SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)), 0) as total_cost
                FROM tx
                JOIN transaction_items ti ON ti.transaction_id = tx.id
                LEFT JOIN products p ON p.id = ti.product_id
                GROUP BY tx.sale_date
            )
            SELECT
                r.sale_date,
                r.transaction_count,
                r.total_revenue,
                COALESCE(c.total_cost, 0) as total_cost,
                r.total_revenue - COALESCE(c.total_cost, 0) as gross_profit
            FROM revenue r
            LEFT JOIN cost c ON c.sale_date = r.sale_date
            ORDER BY r.sale_date DESC",
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
    query_monthly_sales(db.inner(), year).await
}

async fn query_monthly_sales(
    db: &DatabaseConnection,
    year: i32,
) -> Result<Vec<MonthlySalesRow>, AppError> {
    // `strftime('%Y', created_at,'localtime') = year` == local year is `year`,
    // i.e. created_at in [year-01-01 00:00 local, (year+1)-01-01 00:00 local).
    let year_start = local_date_start_to_utc(&format!("{:04}-01-01", year));
    let year_end = local_date_start_to_utc(&format!("{:04}-01-01", year + 1));

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            // Same per-transaction / per-item split as `query_daily_sales`.
            "WITH tx AS (
                SELECT
                    t.id as id,
                    strftime('%Y-%m', t.created_at, 'localtime') as sale_month,
                    t.total_amount as total_amount
                FROM transactions t
                WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded', 'deleted')
                AND t.created_at >= $1 AND t.created_at < $2
            ),
            revenue AS (
                SELECT
                    sale_month,
                    COUNT(*) as transaction_count,
                    COALESCE(SUM(total_amount), 0) as total_revenue
                FROM tx
                GROUP BY sale_month
            ),
            cost AS (
                SELECT
                    tx.sale_month as sale_month,
                    COALESCE(SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)), 0) as total_cost
                FROM tx
                JOIN transaction_items ti ON ti.transaction_id = tx.id
                LEFT JOIN products p ON p.id = ti.product_id
                GROUP BY tx.sale_month
            )
            SELECT
                r.sale_month,
                r.transaction_count,
                r.total_revenue,
                COALESCE(c.total_cost, 0) as total_cost,
                r.total_revenue - COALESCE(c.total_cost, 0) as gross_profit
            FROM revenue r
            LEFT JOIN cost c ON c.sale_month = r.sale_month
            ORDER BY r.sale_month DESC",
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
    query_sales_period(db.inner(), &start_date, &end_date).await
}

async fn query_sales_period(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
) -> Result<PeriodSalesSummary, AppError> {
    let daily = query_daily_sales(db, start_date, end_date).await?;

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
    query_sales_receipts(db.inner(), &start_date, &end_date, &search).await
}

/// Per-receipt drill-down of the same period the summary reports cover, so it
/// applies the same status filter as `query_daily_sales`. Without it, this was
/// the only sales report that counted voided (`deleted`) and unfulfilled PPOB
/// transactions at full value, and the receipt list never summed to the period
/// total shown above it. `status` stays on the row so `partial_refund` remains
/// visible.
async fn query_sales_receipts(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
    search: &str,
) -> Result<Vec<ReceiptRow>, AppError> {
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
            WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded', 'deleted')
            AND t.created_at >= $1 AND t.created_at < $2
            AND ($3 = '' OR t.receipt_number LIKE '%' || $3 || '%')
            ORDER BY t.created_at DESC
            LIMIT 500",
            vec![
                local_date_start_to_utc(start_date).into(),
                local_date_end_exclusive_to_utc(end_date).into(),
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
    query_product_sales(db.inner(), &start_date, &end_date).await
}

/// `transaction_items.product_id` is NULL for PPOB lines, so they are excluded
/// here (as `get_top_products` in `commands/dashboard.rs` already does).
/// Grouping over the NULL key produced one fabricated `productId: 0` row
/// carrying an arbitrary PPOB name and every PPOB sale's qty and revenue.
async fn query_product_sales(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<ProductSalesRow>, AppError> {
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
            AND ti.product_id IS NOT NULL
            GROUP BY ti.product_id
            ORDER BY qty_sold DESC",
            vec![
                local_date_start_to_utc(start_date).into(),
                local_date_end_exclusive_to_utc(end_date).into(),
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
    query_popular_products(db.inner(), &start_date, &end_date, limit).await
}

/// See `query_product_sales` for why PPOB lines (NULL `product_id`) are skipped.
async fn query_popular_products(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
    limit: i32,
) -> Result<Vec<PopularProductRow>, AppError> {
    let limit = limit.clamp(1, 500);

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
            AND ti.product_id IS NOT NULL
            GROUP BY ti.product_id
            ORDER BY qty_sold DESC
            LIMIT $3",
            vec![
                local_date_start_to_utc(start_date).into(),
                local_date_end_exclusive_to_utc(end_date).into(),
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
    query_losses(db.inner(), &start_date, &end_date).await
}

/// Only `approved` write-offs are real losses. A `rejected` write-off has had
/// its stock restored by `reject_stock_writeoff`, and a `pending` one is not
/// confirmed yet — counting either inflated the loss total.
async fn query_losses(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
) -> Result<LossSummary, AppError> {
    let start_utc = local_date_start_to_utc(start_date);
    let end_utc = local_date_end_exclusive_to_utc(end_date);

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
            AND sw.status = 'approved'
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
            AND status = 'approved'
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        date_str, insert_product, insert_transaction, insert_transaction_item, insert_writeoff,
        setup_test_db, today, utc_at_local_noon, WriteoffSpec,
    };

    /// One Rp 100.000 sale with three line items plus one Rp 50.000 sale with a
    /// single line item. Revenue must stay per-transaction (Rp 150.000); the
    /// fan-out bug reported Rp 350.000 because `SUM(t.total_amount)` was
    /// aggregated over the joined line items.
    async fn seed_two_sales_today(conn: &DatabaseConnection) {
        let created_at = utc_at_local_noon(today());

        let beras = insert_product(conn, "Beras 5kg", 30_000.0, 50_000.0, 100).await;
        let gula = insert_product(conn, "Gula 1kg", 20_000.0, 30_000.0, 100).await;
        let minyak = insert_product(conn, "Minyak 1L", 10_000.0, 20_000.0, 100).await;

        let txn = insert_transaction(conn, 1, 100_000.0, "completed", &created_at).await;
        insert_transaction_item(
            conn,
            txn.id,
            Some(beras.id),
            "Beras 5kg",
            50_000.0,
            30_000.0,
            1,
        )
        .await;
        insert_transaction_item(
            conn,
            txn.id,
            Some(gula.id),
            "Gula 1kg",
            30_000.0,
            20_000.0,
            1,
        )
        .await;
        insert_transaction_item(
            conn,
            txn.id,
            Some(minyak.id),
            "Minyak 1L",
            20_000.0,
            10_000.0,
            1,
        )
        .await;

        let txn2 = insert_transaction(conn, 1, 50_000.0, "completed", &created_at).await;
        insert_transaction_item(
            conn,
            txn2.id,
            Some(beras.id),
            "Beras 5kg",
            50_000.0,
            20_000.0,
            1,
        )
        .await;
    }

    #[tokio::test]
    async fn daily_sales_revenue_counts_each_transaction_once() {
        let conn = setup_test_db().await;
        seed_two_sales_today(&conn).await;
        let day = date_str(today());

        let rows = query_daily_sales(&conn, &day, &day).await.expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].transaction_count, 2);
        assert_eq!(rows[0].total_revenue, 150_000.0);
        assert_eq!(rows[0].total_cost, 80_000.0);
        assert_eq!(rows[0].gross_profit, 70_000.0);
    }

    #[tokio::test]
    async fn monthly_sales_revenue_counts_each_transaction_once() {
        let conn = setup_test_db().await;
        seed_two_sales_today(&conn).await;
        let now = today();

        let year: i32 = now.format("%Y").to_string().parse().expect("year");
        let rows = query_monthly_sales(&conn, year).await.expect("query");

        let month = now.format("%Y-%m").to_string();
        let row = rows
            .iter()
            .find(|r| r.month == month)
            .expect("current month present");
        assert_eq!(row.transaction_count, 2);
        assert_eq!(row.total_revenue, 150_000.0);
        assert_eq!(row.total_cost, 80_000.0);
        assert_eq!(row.gross_profit, 70_000.0);
    }

    #[tokio::test]
    async fn period_summary_average_uses_per_transaction_revenue() {
        let conn = setup_test_db().await;
        seed_two_sales_today(&conn).await;
        let day = date_str(today());

        let summary = query_sales_period(&conn, &day, &day).await.expect("query");

        assert_eq!(summary.total_transactions, 2);
        assert_eq!(summary.total_revenue, 150_000.0);
        assert_eq!(summary.total_cost, 80_000.0);
        assert_eq!(summary.gross_profit, 70_000.0);
        assert_eq!(summary.avg_per_transaction, 75_000.0);
    }

    /// The cost aggregate is an inner join now, so a sale without line items
    /// must still contribute its revenue.
    #[tokio::test]
    async fn daily_sales_include_transaction_without_items() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        insert_transaction(&conn, 1, 25_000.0, "completed", &created_at).await;
        let day = date_str(today());

        let rows = query_daily_sales(&conn, &day, &day).await.expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].transaction_count, 1);
        assert_eq!(rows[0].total_revenue, 25_000.0);
        assert_eq!(rows[0].total_cost, 0.0);
        assert_eq!(rows[0].gross_profit, 25_000.0);
    }

    #[tokio::test]
    async fn losses_count_only_approved_writeoffs() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let product = insert_product(&conn, "Telur", 10_000.0, 14_000.0, 100).await;

        insert_writeoff(
            &conn,
            WriteoffSpec {
                product_id: product.id,
                user_id: 1,
                quantity: 2,
                reason: "damaged",
                loss_value: 20_000.0,
                status: "approved",
                created_at: &created_at,
            },
        )
        .await;
        // Rejected: `reject_stock_writeoff` already restored the stock, so this
        // is not a loss.
        insert_writeoff(
            &conn,
            WriteoffSpec {
                product_id: product.id,
                user_id: 1,
                quantity: 5,
                reason: "lost",
                loss_value: 50_000.0,
                status: "rejected",
                created_at: &created_at,
            },
        )
        .await;
        // Pending: not confirmed as a loss yet.
        insert_writeoff(
            &conn,
            WriteoffSpec {
                product_id: product.id,
                user_id: 1,
                quantity: 3,
                reason: "expired",
                loss_value: 30_000.0,
                status: "pending",
                created_at: &created_at,
            },
        )
        .await;

        let day = date_str(today());
        let summary = query_losses(&conn, &day, &day).await.expect("query");

        assert_eq!(summary.total_writeoffs, 1);
        assert_eq!(summary.total_quantity, 2);
        assert_eq!(summary.total_loss_value, 20_000.0);
        assert_eq!(summary.items.len(), 1);
        assert_eq!(summary.items[0].status, "approved");
        assert_eq!(summary.by_reason.len(), 1);
        assert_eq!(summary.by_reason[0].reason, "damaged");
        assert_eq!(summary.by_reason[0].count, 1);
        assert_eq!(summary.by_reason[0].total_value, 20_000.0);
    }

    /// PPOB line items carry `product_id = NULL`. Grouping over them produced a
    /// single fabricated `productId: 0` row holding every PPOB sale.
    async fn seed_sale_with_ppob_items(conn: &DatabaseConnection) -> i64 {
        let created_at = utc_at_local_noon(today());
        let beras = insert_product(conn, "Beras 5kg", 30_000.0, 50_000.0, 100).await;
        let txn = insert_transaction(conn, 1, 84_000.0, "completed", &created_at).await;
        insert_transaction_item(
            conn,
            txn.id,
            Some(beras.id),
            "Beras 5kg",
            50_000.0,
            30_000.0,
            1,
        )
        .await;
        insert_transaction_item(conn, txn.id, None, "Token PLN 20rb", 22_000.0, 20_000.0, 1).await;
        insert_transaction_item(conn, txn.id, None, "Pulsa 10rb", 12_000.0, 10_000.0, 1).await;
        beras.id
    }

    #[tokio::test]
    async fn product_sales_skip_items_without_product_id() {
        let conn = setup_test_db().await;
        let beras_id = seed_sale_with_ppob_items(&conn).await;
        let day = date_str(today());

        let rows = query_product_sales(&conn, &day, &day).await.expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].product_id, beras_id);
        assert_eq!(rows[0].product_name, "Beras 5kg");
        assert_eq!(rows[0].total_revenue, 50_000.0);
    }

    #[tokio::test]
    async fn popular_products_skip_items_without_product_id() {
        let conn = setup_test_db().await;
        let beras_id = seed_sale_with_ppob_items(&conn).await;
        let day = date_str(today());

        let rows = query_popular_products(&conn, &day, &day, 10)
            .await
            .expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].product_id, beras_id);
        assert_eq!(rows[0].qty_sold, 1);
    }

    #[tokio::test]
    async fn sales_receipts_exclude_non_sale_statuses() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        insert_transaction(&conn, 1, 100_000.0, "completed", &created_at).await;
        insert_transaction(&conn, 1, 30_000.0, "partial_refund", &created_at).await;
        insert_transaction(&conn, 1, 999_000.0, "deleted", &created_at).await;
        insert_transaction(&conn, 1, 50_000.0, "pending_ppob", &created_at).await;
        insert_transaction(&conn, 1, 40_000.0, "ppob_failed", &created_at).await;
        insert_transaction(&conn, 1, 70_000.0, "refunded", &created_at).await;

        let day = date_str(today());
        let rows = query_sales_receipts(&conn, &day, &day, "")
            .await
            .expect("query");

        let mut statuses: Vec<&str> = rows.iter().map(|r| r.status.as_str()).collect();
        statuses.sort_unstable();
        assert_eq!(statuses, vec!["completed", "partial_refund"]);

        // The receipt list must sum to the same revenue as the period summary.
        let receipts_total: f64 = rows.iter().map(|r| r.total_amount).sum();
        let summary = query_sales_period(&conn, &day, &day).await.expect("query");
        assert_eq!(receipts_total, 130_000.0);
        assert_eq!(receipts_total, summary.total_revenue);
    }
}
