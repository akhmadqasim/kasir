use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde::Serialize;
use tauri::State;

use crate::utils::AppError;

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
                COALESCE(SUM(ti.quantity * COALESCE(p.buy_price, 0)), 0) as total_cost,
                COALESCE(SUM(t.total_amount), 0) - COALESCE(SUM(ti.quantity * COALESCE(p.buy_price, 0)), 0) as gross_profit
            FROM transactions t
            LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
            LEFT JOIN products p ON p.id = ti.product_id
            WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded')
            AND date(t.created_at, 'localtime') BETWEEN $1 AND $2
            GROUP BY sale_date
            ORDER BY sale_date DESC",
            vec![start_date.into(), end_date.into()],
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
    let year_str = year.to_string();

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT
                strftime('%Y-%m', t.created_at, 'localtime') as sale_month,
                COUNT(DISTINCT t.id) as transaction_count,
                COALESCE(SUM(t.total_amount), 0) as total_revenue,
                COALESCE(SUM(ti.quantity * COALESCE(p.buy_price, 0)), 0) as total_cost,
                COALESCE(SUM(t.total_amount), 0) - COALESCE(SUM(ti.quantity * COALESCE(p.buy_price, 0)), 0) as gross_profit
            FROM transactions t
            LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
            LEFT JOIN products p ON p.id = ti.product_id
            WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded')
            AND strftime('%Y', t.created_at, 'localtime') = $1
            GROUP BY sale_month
            ORDER BY sale_month DESC",
            vec![year_str.into()],
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
            WHERE date(t.created_at, 'localtime') BETWEEN $1 AND $2
            AND ($3 = '' OR t.receipt_number LIKE '%' || $3 || '%')
            ORDER BY t.created_at DESC
            LIMIT 500",
            vec![start_date.into(), end_date.into(), search.into()],
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
            "SELECT
                payment_method,
                COUNT(*) as transaction_count,
                COALESCE(SUM(total_amount), 0) as total_amount
            FROM transactions
            WHERE status NOT IN ('pending_ppob', 'ppob_failed', 'refunded')
            AND date(created_at, 'localtime') BETWEEN $1 AND $2
            GROUP BY payment_method
            ORDER BY total_amount DESC",
            vec![start_date.into(), end_date.into()],
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
                SUM(ti.quantity * COALESCE(p.buy_price, 0)) as total_cost,
                SUM(ti.subtotal) - SUM(ti.quantity * COALESCE(p.buy_price, 0)) as profit
            FROM transaction_items ti
            JOIN transactions t ON t.id = ti.transaction_id
            LEFT JOIN products p ON p.id = ti.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded')
            AND date(t.created_at, 'localtime') BETWEEN $1 AND $2
            GROUP BY ti.product_id
            ORDER BY qty_sold DESC",
            vec![start_date.into(), end_date.into()],
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
            WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'refunded')
            AND date(t.created_at, 'localtime') BETWEEN $1 AND $2
            GROUP BY ti.product_id
            ORDER BY qty_sold DESC
            LIMIT $3",
            vec![start_date.into(), end_date.into(), limit.into()],
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
            WHERE date(r.created_at, 'localtime') BETWEEN $1 AND $2
            ORDER BY r.created_at DESC",
            vec![start_date.into(), end_date.into()],
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
            WHERE date(sw.created_at, 'localtime') BETWEEN $1 AND $2
            ORDER BY sw.created_at DESC",
            vec![start_date.clone().into(), end_date.clone().into()],
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
            WHERE date(created_at, 'localtime') BETWEEN $1 AND $2
            GROUP BY reason
            ORDER BY total_value DESC",
            vec![start_date.into(), end_date.into()],
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
