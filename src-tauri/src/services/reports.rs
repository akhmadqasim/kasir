//! The eleven reports: sales by day, month and period, per receipt, per payment
//! method, per product, returns, current stock, losses and cash flow.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use crate::domain::reports::*;
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

/// Row cap for the two reports that return raw rows instead of aggregates.
/// The cap is reported back through `total_count` so the caller can tell the
/// list was cut short instead of silently deriving totals from a partial array.
const REPORT_ROW_LIMIT: i64 = 500;

// --- Net revenue ---
//
// Every sales figure in this file and in `services/dashboard.rs` is NET: what
// stayed in the till after returns. Gross takings are counted on the day the
// sale was rung up, and a return is subtracted on the day the money went back
// over the counter. See [`refund_adjust_cte`] for why that date, and
// [`SALE_FILTER`] for why a fully refunded sale is still counted gross.

/// Sales-side status filter, written for a `transactions` aliased as `t`.
///
/// A `pending_ppob`/`ppob_failed` sale never delivered anything and a `deleted`
/// one was voided — neither ever became money. `refunded` is deliberately NOT in
/// the list: a fully returned sale really did take the customer's money on the
/// day it was rung up, and [`refund_adjust_cte`] takes it back out on the day of
/// the return. Excluding the sale as well would subtract it twice, and would
/// also rewrite a closed day's revenue the moment a late return landed.
///
/// The channel belongs here for the same reason: a `ppob`-channel sale is a bill
/// paid on the PPOB page, not goods sold, so it is left out of every sales figure
/// (the shift's drawer totals still include it).
pub(crate) const SALE_FILTER: &str =
    "t.status NOT IN ('pending_ppob', 'ppob_failed', 'deleted') AND t.channel = 'sales'";

/// The `refund_adjust` CTE: how much of a period's takings went back out.
///
/// WHICH DAY A REFUND LANDS ON
/// The refund's own day (`refunds.created_at`), not the sale's. A sale on the
/// 1st returned on the 5th put Rp 300.000 in the till on the 1st and took
/// Rp 200.000 back out on the 5th, and that is what the owner asked to see. It
/// also means a day's revenue never changes after the fact: the 1st keeps
/// reading Rp 300.000 forever, however late the return arrives. Dating the
/// deduction to the sale instead would silently rewrite reports that have
/// already been printed and reconciled. `reports::returns` and the dashboard's
/// refund counters already group refunds by their own date, so this is also the
/// only choice that agrees with the rest of the app.
///
/// WHAT AN EXCHANGE DOES
/// Returned lines subtract; replacement goods add straight back. An exchange is
/// a return plus a sale that never got written into `transaction_items`, so the
/// two halves are unioned with opposite signs and the net effect on revenue is
/// exactly `difference_amount` — the money that actually changed hands. A
/// like-for-like swap nets to zero, and a customer who upgrades and pays the
/// difference increases revenue.
///
/// SHAPE
/// One pass over `refund_items` and one over `exchange_items`, grouped once and
/// joined once by the caller. Deliberately not a correlated subquery per sale
/// row, which would re-scan the refund tables for every transaction in the
/// period.
///
/// `refund_bucket` and `exchange_bucket` are the grouping keys for the two
/// halves — the same expression for a calendar bucket, different columns when
/// grouping by product. `start`/`end` are the placeholders holding the period's
/// UTC boundaries.
pub(crate) fn refund_adjust_cte(
    refund_bucket: &str,
    exchange_bucket: &str,
    start: &str,
    end: &str,
) -> String {
    format!(
        "refund_adjust AS (
            SELECT bucket,
                   COALESCE(SUM(revenue), 0) as revenue,
                   COALESCE(SUM(cost), 0) as cost,
                   COALESCE(SUM(qty), 0) as qty
            FROM (
                SELECT {refund_bucket} as bucket,
                       ri.subtotal as revenue,
                       ri.quantity * COALESCE(ti.buy_price, p.buy_price, 0) as cost,
                       ri.quantity as qty
                FROM refunds r
                JOIN transactions t ON t.id = r.transaction_id
                JOIN refund_items ri ON ri.refund_id = r.id
                JOIN transaction_items ti ON ti.id = ri.transaction_item_id
                LEFT JOIN products p ON p.id = ti.product_id
                WHERE r.created_at >= {start} AND r.created_at < {end}
                AND {SALE_FILTER}
                UNION ALL
                SELECT {exchange_bucket} as bucket,
                       -ei.subtotal as revenue,
                       -(ei.quantity * COALESCE(p.buy_price, 0)) as cost,
                       -ei.quantity as qty
                FROM refunds r
                JOIN transactions t ON t.id = r.transaction_id
                JOIN exchange_items ei ON ei.refund_id = r.id
                LEFT JOIN products p ON p.id = ei.product_id
                WHERE r.created_at >= {start} AND r.created_at < {end}
                AND {SALE_FILTER}
            )
            GROUP BY bucket
        )"
    )
}

/// One row of [`query_sales_buckets`]: `(bucket, transactions, revenue, cost,
/// profit)`, all four figures already net of returns.
type SalesBucket = (String, i64, f64, f64, f64);

/// Sales aggregated into whatever calendar bucket the two expressions name — a
/// day for the daily report, a month for the monthly one. `sale_bucket` reads
/// the bucket off `transactions t`, `refund_bucket` off `refunds r`; they must
/// name the same calendar unit or the two sides will not line up.
///
/// Revenue is per transaction and cost is per line item, so the two are
/// aggregated separately and joined on the bucket. Summing `t.total_amount`
/// over a join against `transaction_items` counted each transaction once per
/// item, inflating revenue by the item count.
///
/// Returns are subtracted through [`refund_adjust_cte`] on the bucket the refund
/// itself falls in, which is why the bucket list is the UNION of the two sides:
/// a day whose only activity was a return still has a row, showing the money
/// that left.
async fn query_sales_buckets(
    db: &DatabaseConnection,
    sale_bucket: &str,
    refund_bucket: &str,
    start_utc: String,
    end_utc: String,
) -> Result<Vec<SalesBucket>, AppError> {
    let sql = format!(
        "WITH tx AS (
            SELECT
                t.id as id,
                {sale_bucket} as bucket,
                t.total_amount as total_amount
            FROM transactions t
            WHERE {SALE_FILTER}
            AND t.created_at >= $1 AND t.created_at < $2
        ),
        revenue AS (
            SELECT
                bucket,
                COUNT(*) as transaction_count,
                COALESCE(SUM(total_amount), 0) as total_revenue
            FROM tx
            GROUP BY bucket
        ),
        cost AS (
            SELECT
                tx.bucket as bucket,
                COALESCE(SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)), 0) as total_cost
            FROM tx
            JOIN transaction_items ti ON ti.transaction_id = tx.id
            LEFT JOIN products p ON p.id = ti.product_id
            GROUP BY tx.bucket
        ),
        {refund_adjust},
        buckets AS (
            SELECT bucket FROM revenue
            UNION
            SELECT bucket FROM refund_adjust
        )
        SELECT
            b.bucket,
            COALESCE(r.transaction_count, 0) as transaction_count,
            COALESCE(r.total_revenue, 0) - COALESCE(ra.revenue, 0) as total_revenue,
            COALESCE(c.total_cost, 0) - COALESCE(ra.cost, 0) as total_cost,
            (COALESCE(r.total_revenue, 0) - COALESCE(ra.revenue, 0))
                - (COALESCE(c.total_cost, 0) - COALESCE(ra.cost, 0)) as gross_profit
        FROM buckets b
        LEFT JOIN revenue r ON r.bucket = b.bucket
        LEFT JOIN cost c ON c.bucket = b.bucket
        LEFT JOIN refund_adjust ra ON ra.bucket = b.bucket
        ORDER BY b.bucket DESC",
        refund_adjust = refund_adjust_cte(refund_bucket, refund_bucket, "$1", "$2"),
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
            vec![start_utc.into(), end_utc.into()],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| {
            (
                row.try_get_by_index(0).unwrap_or_default(),
                row.try_get_by_index(1).unwrap_or(0),
                row.try_get_by_index(2).unwrap_or(0.0),
                row.try_get_by_index(3).unwrap_or(0.0),
                row.try_get_by_index(4).unwrap_or(0.0),
            )
        })
        .collect())
}

async fn query_daily_sales(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<DailySalesRow>, AppError> {
    let buckets = query_sales_buckets(
        db,
        "date(t.created_at, 'localtime')",
        "date(r.created_at, 'localtime')",
        local_date_start_to_utc(start_date),
        local_date_end_exclusive_to_utc(end_date),
    )
    .await?;

    Ok(buckets
        .into_iter()
        .map(
            |(date, transaction_count, total_revenue, total_cost, gross_profit)| DailySalesRow {
                date,
                transaction_count,
                total_revenue,
                total_cost,
                gross_profit,
            },
        )
        .collect())
}

// --- Report entry points ---

pub async fn daily_sales(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<Vec<DailySalesRow>, AppError> {
    query_daily_sales(db, &start_date, &end_date).await
}

pub async fn monthly_sales(
    db: &DatabaseConnection,
    year: i32,
) -> Result<Vec<MonthlySalesRow>, AppError> {
    query_monthly_sales(db, year).await
}

async fn query_monthly_sales(
    db: &DatabaseConnection,
    year: i32,
) -> Result<Vec<MonthlySalesRow>, AppError> {
    // `strftime('%Y', created_at,'localtime') = year` == local year is `year`,
    // i.e. created_at in [year-01-01 00:00 local, (year+1)-01-01 00:00 local).
    let year_start = local_date_start_to_utc(&format!("{:04}-01-01", year));
    let year_end = local_date_start_to_utc(&format!("{:04}-01-01", year + 1));

    // Same aggregate as the daily report, bucketed a month at a time, so the
    // twelve months of a year sum to the same figure the daily rows do.
    let buckets = query_sales_buckets(
        db,
        "strftime('%Y-%m', t.created_at, 'localtime')",
        "strftime('%Y-%m', r.created_at, 'localtime')",
        year_start,
        year_end,
    )
    .await?;

    Ok(buckets
        .into_iter()
        .map(
            |(month, transaction_count, total_revenue, total_cost, gross_profit)| MonthlySalesRow {
                month,
                transaction_count,
                total_revenue,
                total_cost,
                gross_profit,
            },
        )
        .collect())
}

pub async fn sales_period(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<PeriodSalesSummary, AppError> {
    query_sales_period(db, &start_date, &end_date).await
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

pub async fn sales_receipts(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
    search: String,
) -> Result<ReceiptReport, AppError> {
    query_sales_receipts(db, &start_date, &end_date, &search, REPORT_ROW_LIMIT).await
}

/// Per-receipt drill-down of the same period the summary reports cover, so it
/// applies the same status filter as `query_daily_sales`. Without it, this was
/// the only sales report that counted voided (`deleted`) and unfulfilled PPOB
/// transactions at full value, and the receipt list never summed to the period
/// total shown above it. `status` stays on the row so `partial_refund` and
/// `refunded` remain visible.
///
/// `refund_amount` is EVERY return ever booked against that receipt, not just
/// the ones inside the queried window: this is a per-receipt view, and a
/// cashier looking up a receipt wants its final state rather than a figure that
/// changes with the date filter. `net_amount` is what the customer ended up
/// paying for it. The consequence is that `SUM(net_amount)` here equals the
/// period summary's revenue only when every return happened in the same period
/// as its sale — the summary dates returns to the day the money went back
/// (see [`refund_adjust_cte`]), this list dates them to the receipt.
async fn query_sales_receipts(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
    search: &str,
    limit: i64,
) -> Result<ReceiptReport, AppError> {
    // `COUNT(*) OVER ()` is evaluated over the full result set before LIMIT, so
    // it reports how many receipts matched even when only `limit` are returned.
    //
    // The refund totals are one grouped pass over the receipts in the window,
    // joined once — not a subquery re-run per receipt row.
    let sql = format!(
        "WITH tx AS (
            SELECT
                t.id as id,
                t.receipt_number as receipt_number,
                t.user_id as user_id,
                t.total_amount as total_amount,
                t.payment_method as payment_method,
                t.status as status,
                t.created_at as created_at
            FROM transactions t
            WHERE {SALE_FILTER}
            AND t.created_at >= $1 AND t.created_at < $2
            AND ($3 = '' OR t.receipt_number LIKE '%' || $3 || '%')
        ),
        refund_totals AS (
            SELECT transaction_id, COALESCE(SUM(amount), 0) as amount
            FROM (
                SELECT r.transaction_id as transaction_id, ri.subtotal as amount
                FROM refunds r
                JOIN refund_items ri ON ri.refund_id = r.id
                WHERE r.transaction_id IN (SELECT id FROM tx)
                UNION ALL
                SELECT r.transaction_id as transaction_id, -ei.subtotal as amount
                FROM refunds r
                JOIN exchange_items ei ON ei.refund_id = r.id
                WHERE r.transaction_id IN (SELECT id FROM tx)
            )
            GROUP BY transaction_id
        )
        SELECT
            tx.id,
            tx.receipt_number,
            COALESCE(u.full_name, '-') as cashier_name,
            tx.total_amount,
            tx.payment_method,
            tx.status,
            (SELECT COUNT(*) FROM transaction_items WHERE transaction_id = tx.id) as item_count,
            tx.created_at,
            COALESCE(rt.amount, 0) as refund_amount,
            tx.total_amount - COALESCE(rt.amount, 0) as net_amount,
            COUNT(*) OVER () as total_count
        FROM tx
        LEFT JOIN users u ON u.id = tx.user_id
        LEFT JOIN refund_totals rt ON rt.transaction_id = tx.id
        ORDER BY tx.created_at DESC
        LIMIT $4"
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
            vec![
                local_date_start_to_utc(start_date).into(),
                local_date_end_exclusive_to_utc(end_date).into(),
                search.into(),
                limit.into(),
            ],
        ))
        .await?;

    let total_count = rows
        .first()
        .and_then(|row| row.try_get_by_index::<i64>(10).ok())
        .unwrap_or(0);

    let items = rows
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
            refund_amount: row.try_get_by_index(8).unwrap_or(0.0),
            net_amount: row.try_get_by_index(9).unwrap_or(0.0),
        })
        .collect();

    Ok(ReceiptReport { items, total_count })
}

pub async fn payment_methods(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<Vec<PaymentMethodRow>, AppError> {
    // A return goes back the way it was paid, so it is deducted from its own
    // method: `refunds.payment_method`, which the refund copies from the sale.
    // A method whose only activity in the period was a return still gets a row
    // — with zero transactions, because a return is not a sale.
    let sql = format!(
        "WITH payment_method_rows AS (
            SELECT
                tp.payment_method as payment_method,
                tp.amount as amount,
                tp.transaction_id as transaction_id
            FROM transaction_payments tp
            JOIN transactions t ON t.id = tp.transaction_id
            WHERE {SALE_FILTER}
            AND t.created_at >= $1 AND t.created_at < $2
            UNION ALL
            SELECT
                t.payment_method as payment_method,
                t.total_amount as amount,
                t.id as transaction_id
            FROM transactions t
            WHERE {SALE_FILTER}
            AND t.created_at >= $1 AND t.created_at < $2
            AND NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = t.id)
        ),
        sales AS (
            SELECT
                payment_method,
                COUNT(DISTINCT transaction_id) as transaction_count,
                COALESCE(SUM(amount), 0) as total_amount
            FROM payment_method_rows
            GROUP BY payment_method
        ),
        {refund_adjust},
        methods AS (
            SELECT payment_method as method FROM sales
            UNION
            SELECT bucket as method FROM refund_adjust
        )
        SELECT
            m.method,
            COALESCE(s.transaction_count, 0) as transaction_count,
            COALESCE(s.total_amount, 0) - COALESCE(ra.revenue, 0) as total_amount
        FROM methods m
        LEFT JOIN sales s ON s.payment_method = m.method
        LEFT JOIN refund_adjust ra ON ra.bucket = m.method
        ORDER BY total_amount DESC",
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

pub async fn product_sales(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<Vec<ProductSalesRow>, AppError> {
    query_product_sales(db, &start_date, &end_date).await
}

/// The `sold` CTE both product reports build on: per-product quantity, revenue
/// and cost over the period, before returns.
///
/// Revenue is `net_subtotal` — the rupiah the line actually brought in, with
/// its own discount and its share of the transaction discount already taken off
/// (migration 018). `SUM(ti.subtotal)` was the list price, so on any discounted
/// sale the product report claimed more revenue than the transaction reports
/// did, and deducting a (net) refund from it would have compared two different
/// currencies.
///
/// `transaction_items.product_id` is NULL for PPOB lines, so they are excluded
/// (as `dashboard::top_products` already does). Grouping over the NULL key
/// produced one fabricated `productId: 0` row carrying an arbitrary PPOB name
/// and every PPOB sale's qty and revenue.
const PRODUCT_SOLD_CTE: &str = "sold AS (
    SELECT
        ti.product_id as product_id,
        MAX(ti.product_name) as product_name,
        SUM(ti.quantity) as qty,
        SUM(ti.net_subtotal) as revenue,
        SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)) as cost
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    LEFT JOIN products p ON p.id = ti.product_id
    WHERE t.status NOT IN ('pending_ppob', 'ppob_failed', 'deleted')
      AND t.channel = 'sales'
    AND t.created_at >= $1 AND t.created_at < $2
    AND ti.product_id IS NOT NULL
    GROUP BY ti.product_id
)";

async fn query_product_sales(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<ProductSalesRow>, AppError> {
    // Returned units come off the product they were sold as; exchange
    // replacements are added to the product that went out instead, which is why
    // the id list is the union of both sides — a product handed over purely as
    // a replacement still sold.
    let sql = format!(
        "WITH {PRODUCT_SOLD_CTE},
        {refund_adjust},
        ids AS (
            SELECT product_id FROM sold
            UNION
            SELECT bucket as product_id FROM refund_adjust
        )
        SELECT
            i.product_id,
            COALESCE(s.product_name, p.name, '(dihapus)') as product_name,
            p.barcode,
            c.name as category_name,
            COALESCE(s.qty, 0) - COALESCE(ra.qty, 0) as qty_sold,
            COALESCE(s.revenue, 0) - COALESCE(ra.revenue, 0) as total_revenue,
            COALESCE(s.cost, 0) - COALESCE(ra.cost, 0) as total_cost,
            (COALESCE(s.revenue, 0) - COALESCE(ra.revenue, 0))
                - (COALESCE(s.cost, 0) - COALESCE(ra.cost, 0)) as profit
        FROM ids i
        LEFT JOIN sold s ON s.product_id = i.product_id
        LEFT JOIN refund_adjust ra ON ra.bucket = i.product_id
        LEFT JOIN products p ON p.id = i.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        ORDER BY qty_sold DESC",
        refund_adjust = refund_adjust_cte("ri.product_id", "ei.product_id", "$1", "$2"),
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
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

pub async fn popular_products(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
    limit: i32,
) -> Result<Vec<PopularProductRow>, AppError> {
    query_popular_products(db, &start_date, &end_date, limit).await
}

/// Same aggregate as [`query_product_sales`], ranked and capped, so the two
/// reports never disagree about how much of a product sold.
///
/// See [`PRODUCT_SOLD_CTE`] for why PPOB lines (NULL `product_id`) are skipped
/// and why revenue is `net_subtotal`. Ranking is on the NET quantity, so a
/// product that was mostly returned drops down the list instead of staying on
/// top on the strength of a sale that was handed straight back.
async fn query_popular_products(
    db: &DatabaseConnection,
    start_date: &str,
    end_date: &str,
    limit: i32,
) -> Result<Vec<PopularProductRow>, AppError> {
    let limit = limit.clamp(1, 500);

    let sql = format!(
        "WITH {PRODUCT_SOLD_CTE},
        {refund_adjust},
        ids AS (
            SELECT product_id FROM sold
            UNION
            SELECT bucket as product_id FROM refund_adjust
        ),
        net AS (
            SELECT
                i.product_id as product_id,
                COALESCE(s.product_name, p.name, '(dihapus)') as product_name,
                c.name as category_name,
                COALESCE(s.qty, 0) - COALESCE(ra.qty, 0) as qty_sold,
                COALESCE(s.revenue, 0) - COALESCE(ra.revenue, 0) as total_revenue
            FROM ids i
            LEFT JOIN sold s ON s.product_id = i.product_id
            LEFT JOIN refund_adjust ra ON ra.bucket = i.product_id
            LEFT JOIN products p ON p.id = i.product_id
            LEFT JOIN categories c ON c.id = p.category_id
        )
        SELECT
            ROW_NUMBER() OVER (ORDER BY qty_sold DESC) as rank,
            product_id,
            product_name,
            category_name,
            qty_sold,
            total_revenue
        FROM net
        ORDER BY qty_sold DESC
        LIMIT $3",
        refund_adjust = refund_adjust_cte("ri.product_id", "ei.product_id", "$1", "$2"),
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
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

pub async fn returns(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<Vec<ReturnRow>, AppError> {
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

pub async fn current_stock(
    db: &DatabaseConnection,
    search: String,
    filter: String,
) -> Result<CurrentStockReport, AppError> {
    query_current_stock(db, &search, &filter, REPORT_ROW_LIMIT).await
}

async fn query_current_stock(
    db: &DatabaseConnection,
    search: &str,
    filter: &str,
    limit: i64,
) -> Result<CurrentStockReport, AppError> {
    // One shared definition of "low stock" — see `products::LOW_STOCK_SQL`.
    let low_stock_clause = if filter == "low" {
        format!("AND {}", crate::services::products::LOW_STOCK_SQL)
    } else {
        // "all", empty, and anything unrecognised: no extra filter.
        String::new()
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
            p.buy_price * p.stock as stock_value,
            COUNT(*) OVER () as total_count
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1
        AND ($1 = '' OR p.name LIKE '%' || $1 || '%' OR p.barcode LIKE '%' || $1 || '%')
        {}
        ORDER BY p.name
        LIMIT $2",
        low_stock_clause
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
            vec![search.into(), limit.into()],
        ))
        .await?;

    let total_count = rows
        .first()
        .and_then(|row| row.try_get_by_index::<i64>(10).ok())
        .unwrap_or(0);

    let items = rows
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
        .collect();

    Ok(CurrentStockReport { items, total_count })
}

pub async fn losses(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<LossSummary, AppError> {
    query_losses(db, &start_date, &end_date).await
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

pub async fn cash_flows(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<CashFlowReportSummary, AppError> {
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
        date_str, insert_exchange_item, insert_product, insert_refund, insert_refund_item,
        insert_transaction, insert_transaction_item, insert_writeoff, setup_test_db, today,
        utc_at_local_noon, RefundSpec, WriteoffSpec,
    };
    use chrono::{Datelike, Duration};

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
        let report = query_sales_receipts(&conn, &day, &day, "", REPORT_ROW_LIMIT)
            .await
            .expect("query");

        // `refunded` belongs here now: the money really was taken that day, and
        // the return is what takes it back out (see `SALE_FILTER`). `deleted`
        // and the two unfulfilled PPOB states never were money.
        let mut statuses: Vec<&str> = report.items.iter().map(|r| r.status.as_str()).collect();
        statuses.sort_unstable();
        assert_eq!(statuses, vec!["completed", "partial_refund", "refunded"]);

        // With no refund rows recorded, the receipt list still sums to the
        // period summary.
        let receipts_total: f64 = report.items.iter().map(|r| r.net_amount).sum();
        let summary = query_sales_period(&conn, &day, &day).await.expect("query");
        assert_eq!(receipts_total, 200_000.0);
        assert_eq!(receipts_total, summary.total_revenue);
    }

    /// A bill paid on the PPOB page is money in the drawer, but it is not goods
    /// sold, so the shop's sales figures leave it out.
    #[tokio::test]
    async fn a_ppob_page_sale_is_left_out_of_the_sales_summary() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        insert_transaction(&conn, 1, 50_000.0, "completed", &created_at).await;
        crate::test_support::insert_transaction_in_channel(
            &conn,
            1,
            40_000.0,
            "completed",
            &created_at,
            "ppob",
        )
        .await;

        let day = date_str(today());
        let summary = query_sales_period(&conn, &day, &day).await.expect("query");

        assert_eq!(summary.total_revenue, 50_000.0);
        assert_eq!(summary.total_transactions, 1);
    }

    // --- Net revenue ---

    /// The scenario the owner described: one Rp 300.000 sale of three items, two
    /// of them handed back. Returns `(transaction, [line ids])`.
    async fn three_item_sale(
        conn: &DatabaseConnection,
        created_at: &str,
    ) -> (i64, Vec<(i64, i64)>) {
        let beras = insert_product(conn, "Beras 5kg", 60_000.0, 100_000.0, 100).await;
        let gula = insert_product(conn, "Gula 1kg", 60_000.0, 100_000.0, 100).await;
        let minyak = insert_product(conn, "Minyak 1L", 60_000.0, 100_000.0, 100).await;

        let txn = insert_transaction(conn, 1, 300_000.0, "completed", created_at).await;
        let mut lines = Vec::new();
        for product in [&beras, &gula, &minyak] {
            let item = insert_transaction_item(
                conn,
                txn.id,
                Some(product.id),
                &product.name,
                100_000.0,
                60_000.0,
                1,
            )
            .await;
            lines.push((item.id, product.id));
        }
        (txn.id, lines)
    }

    /// Books a plain (non-exchange) return of `lines`, each one unit at
    /// `unit_price`.
    async fn return_lines(
        conn: &DatabaseConnection,
        txn_id: i64,
        created_at: &str,
        payment_method: &str,
        lines: &[(i64, i64)],
        unit_price: f64,
    ) {
        let refund = insert_refund(
            conn,
            RefundSpec {
                transaction_id: txn_id,
                user_id: 1,
                refund_type: "refund",
                total_refund_amount: unit_price * lines.len() as f64,
                total_exchange_amount: 0.0,
                difference_amount: unit_price * lines.len() as f64,
                payment_method,
                shift_id: None,
                created_at,
            },
        )
        .await;
        for (item_id, product_id) in lines {
            insert_refund_item(conn, refund.id, *item_id, *product_id, 1, unit_price).await;
        }
    }

    #[tokio::test]
    async fn daily_sales_subtract_what_was_handed_back() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "cash", &lines[..2], 100_000.0).await;

        let day = date_str(today());
        let rows = query_daily_sales(&conn, &day, &day).await.expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].total_revenue, 100_000.0,
            "only one item stayed sold"
        );
        assert_eq!(rows[0].total_cost, 60_000.0, "the returned stock came back");
        assert_eq!(rows[0].gross_profit, 40_000.0);
        assert_eq!(
            rows[0].transaction_count, 1,
            "a return is not a second transaction"
        );
    }

    /// A sale on the 1st returned on the 5th: the 1st keeps the full takings
    /// and the 5th carries the payout, so a report already printed for the 1st
    /// never changes under the owner's feet.
    #[tokio::test]
    async fn a_return_is_deducted_on_its_own_day_not_the_sales_day() {
        let conn = setup_test_db().await;
        let sale_day = today() - Duration::days(4);
        let refund_day = today();

        let (txn_id, lines) = three_item_sale(&conn, &utc_at_local_noon(sale_day)).await;
        return_lines(
            &conn,
            txn_id,
            &utc_at_local_noon(refund_day),
            "cash",
            &lines[..2],
            100_000.0,
        )
        .await;

        let sale = date_str(sale_day);
        let refund = date_str(refund_day);

        let sale_only = query_daily_sales(&conn, &sale, &sale).await.expect("query");
        assert_eq!(sale_only.len(), 1);
        assert_eq!(sale_only[0].total_revenue, 300_000.0);

        let refund_only = query_daily_sales(&conn, &refund, &refund)
            .await
            .expect("query");
        assert_eq!(refund_only.len(), 1, "the payout day still gets a row");
        assert_eq!(refund_only[0].total_revenue, -200_000.0);
        assert_eq!(refund_only[0].transaction_count, 0);

        let whole = query_sales_period(&conn, &sale, &refund)
            .await
            .expect("query");
        assert_eq!(whole.total_revenue, 100_000.0);
    }

    /// The stated contract: a period summary is the sum of its days, whatever
    /// the returns did.
    #[tokio::test]
    async fn period_summary_equals_the_sum_of_its_days() {
        let conn = setup_test_db().await;
        let sale_day = today() - Duration::days(3);
        let (txn_id, lines) = three_item_sale(&conn, &utc_at_local_noon(sale_day)).await;
        return_lines(
            &conn,
            txn_id,
            &utc_at_local_noon(today() - Duration::days(1)),
            "cash",
            &lines[..2],
            100_000.0,
        )
        .await;

        let summary = query_sales_period(&conn, &date_str(sale_day), &date_str(today()))
            .await
            .expect("query");

        let day_revenue: f64 = summary
            .daily_breakdown
            .iter()
            .map(|d| d.total_revenue)
            .sum();
        let day_cost: f64 = summary.daily_breakdown.iter().map(|d| d.total_cost).sum();
        assert_eq!(summary.total_revenue, day_revenue);
        assert_eq!(summary.total_cost, day_cost);
        assert_eq!(summary.gross_profit, day_revenue - day_cost);
        assert_eq!(summary.total_revenue, 100_000.0);
    }

    /// The monthly report has to reach the same answer as the daily one it sits
    /// next to.
    #[tokio::test]
    async fn monthly_sales_agree_with_the_daily_report() {
        let conn = setup_test_db().await;
        // Anchored mid-month so the sale and the return cannot straddle two
        // months and make the comparison meaningless.
        let sale_day = today()
            .with_day(10)
            .expect("the 10th exists in every month");
        let created_at = utc_at_local_noon(sale_day);
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "cash", &lines[..2], 100_000.0).await;

        let day = date_str(sale_day);
        let daily = query_daily_sales(&conn, &day, &day).await.expect("query");
        let year: i32 = sale_day.format("%Y").to_string().parse().expect("year");
        let monthly = query_monthly_sales(&conn, year).await.expect("query");

        let month = sale_day.format("%Y-%m").to_string();
        let row = monthly
            .iter()
            .find(|r| r.month == month)
            .expect("the month is present");
        assert_eq!(row.total_revenue, daily[0].total_revenue);
        assert_eq!(row.total_cost, daily[0].total_cost);
        assert_eq!(row.gross_profit, daily[0].gross_profit);
    }

    /// A sale returned in full nets to zero. It used to disappear from the
    /// reports entirely the moment its status flipped to `refunded`, which meant
    /// the same query answered differently depending on when it was run.
    #[tokio::test]
    async fn a_fully_returned_sale_nets_to_zero() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "cash", &lines, 100_000.0).await;
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transactions SET status = 'refunded' WHERE id = $1",
            vec![txn_id.into()],
        ))
        .await
        .expect("status update");

        let day = date_str(today());
        let rows = query_daily_sales(&conn, &day, &day).await.expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].total_revenue, 0.0);
        assert_eq!(rows[0].total_cost, 0.0);
        assert_eq!(rows[0].gross_profit, 0.0);
    }

    /// An exchange is a return plus a sale, so only the difference moves. The
    /// units follow the goods: off the product that came back, on to the product
    /// that went out.
    #[tokio::test]
    async fn an_exchange_moves_only_the_difference() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());

        let sarung = insert_product(&conn, "Sarung", 40_000.0, 60_000.0, 10).await;
        let peci = insert_product(&conn, "Peci", 25_000.0, 45_000.0, 10).await;
        let txn = insert_transaction(&conn, 1, 60_000.0, "completed", &created_at).await;
        let line = insert_transaction_item(
            &conn,
            txn.id,
            Some(sarung.id),
            "Sarung",
            60_000.0,
            40_000.0,
            1,
        )
        .await;

        let refund = insert_refund(
            &conn,
            RefundSpec {
                transaction_id: txn.id,
                user_id: 1,
                refund_type: "exchange",
                total_refund_amount: 60_000.0,
                total_exchange_amount: 45_000.0,
                difference_amount: 15_000.0,
                payment_method: "cash",
                shift_id: None,
                created_at: &created_at,
            },
        )
        .await;
        insert_refund_item(&conn, refund.id, line.id, sarung.id, 1, 60_000.0).await;
        insert_exchange_item(&conn, refund.id, peci.id, "Peci", 45_000.0, 1).await;

        let day = date_str(today());
        let rows = query_daily_sales(&conn, &day, &day).await.expect("query");
        assert_eq!(
            rows[0].total_revenue, 45_000.0,
            "60.000 taken, 15.000 given back — the customer kept 45.000 of goods"
        );
        assert_eq!(
            rows[0].total_cost, 25_000.0,
            "the peci's cost, not the sarung's"
        );

        let products = query_product_sales(&conn, &day, &day).await.expect("query");
        let sarung_row = products
            .iter()
            .find(|r| r.product_id == sarung.id)
            .expect("sarung row");
        let peci_row = products
            .iter()
            .find(|r| r.product_id == peci.id)
            .expect("the replacement counts as sold even though it was never rung up");
        assert_eq!(sarung_row.qty_sold, 0);
        assert_eq!(sarung_row.total_revenue, 0.0);
        assert_eq!(peci_row.qty_sold, 1);
        assert_eq!(peci_row.total_revenue, 45_000.0);
    }

    #[tokio::test]
    async fn product_sales_subtract_returned_units() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "cash", &lines[..2], 100_000.0).await;

        let day = date_str(today());
        let rows = query_product_sales(&conn, &day, &day).await.expect("query");

        let total_qty: i64 = rows.iter().map(|r| r.qty_sold).sum();
        let total_revenue: f64 = rows.iter().map(|r| r.total_revenue).sum();
        assert_eq!(total_qty, 1, "three units sold, two handed back");
        assert_eq!(total_revenue, 100_000.0);

        // And the product-level revenue reconciles with the period summary.
        let summary = query_sales_period(&conn, &day, &day).await.expect("query");
        assert_eq!(total_revenue, summary.total_revenue);
    }

    #[tokio::test]
    async fn popular_products_rank_on_net_quantity() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        // The first product sold twice as much but every unit came straight
        // back; the third kept its single sale.
        let extra = insert_transaction(&conn, 1, 100_000.0, "completed", &created_at).await;
        let extra_line = insert_transaction_item(
            &conn,
            extra.id,
            Some(lines[0].1),
            "Beras 5kg",
            100_000.0,
            60_000.0,
            1,
        )
        .await;
        return_lines(
            &conn,
            txn_id,
            &created_at,
            "cash",
            &[lines[0], (extra_line.id, lines[0].1)],
            100_000.0,
        )
        .await;

        let day = date_str(today());
        let rows = query_popular_products(&conn, &day, &day, 10)
            .await
            .expect("query");

        let beras = rows
            .iter()
            .find(|r| r.product_id == lines[0].1)
            .expect("beras row");
        assert_eq!(beras.qty_sold, 0);
        assert_eq!(beras.total_revenue, 0.0);
        assert_ne!(rows[0].product_id, lines[0].1, "it is not the top seller");

        // The two reports over the same window must not disagree.
        let sales = query_product_sales(&conn, &day, &day).await.expect("query");
        for row in &rows {
            let other = sales
                .iter()
                .find(|s| s.product_id == row.product_id)
                .expect("present in both reports");
            assert_eq!(row.qty_sold, other.qty_sold);
            assert_eq!(row.total_revenue, other.total_revenue);
        }
    }

    /// The money goes back the way it came, so it comes off that method's total
    /// and no other.
    #[tokio::test]
    async fn payment_methods_subtract_refunds_from_their_own_method() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "cash", &lines[..2], 100_000.0).await;

        let day = date_str(today());
        let rows = payment_methods(&conn, day.clone(), day.clone())
            .await
            .expect("query");

        let cash = rows
            .iter()
            .find(|r| r.payment_method == "cash")
            .expect("cash row");
        assert_eq!(cash.total_amount, 100_000.0);
        assert_eq!(cash.transaction_count, 1);

        let summary = query_sales_period(&conn, &day, &day).await.expect("query");
        let by_method: f64 = rows.iter().map(|r| r.total_amount).sum();
        assert_eq!(by_method, summary.total_revenue);
    }

    /// The receipt drill-down carries the receipt's own final state, so a
    /// partially returned sale is not shown at its gross value.
    #[tokio::test]
    async fn sales_receipts_show_what_each_receipt_kept() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "cash", &lines[..2], 100_000.0).await;

        let day = date_str(today());
        let report = query_sales_receipts(&conn, &day, &day, "", REPORT_ROW_LIMIT)
            .await
            .expect("query");

        assert_eq!(report.items.len(), 1);
        assert_eq!(report.items[0].total_amount, 300_000.0);
        assert_eq!(report.items[0].refund_amount, 200_000.0);
        assert_eq!(report.items[0].net_amount, 100_000.0);

        let summary = query_sales_period(&conn, &day, &day).await.expect("query");
        assert_eq!(report.items[0].net_amount, summary.total_revenue);
    }

    #[tokio::test]
    async fn sales_receipts_report_total_count_when_truncated() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        for _ in 0..3 {
            insert_transaction(&conn, 1, 10_000.0, "completed", &created_at).await;
        }

        let day = date_str(today());
        let report = query_sales_receipts(&conn, &day, &day, "", 2)
            .await
            .expect("query");

        assert_eq!(report.items.len(), 2);
        assert_eq!(report.total_count, 3);
    }

    #[tokio::test]
    async fn current_stock_reports_total_count_when_truncated() {
        let conn = setup_test_db().await;
        insert_product(&conn, "Beras", 30_000.0, 50_000.0, 10).await;
        insert_product(&conn, "Gula", 20_000.0, 30_000.0, 10).await;
        insert_product(&conn, "Minyak", 10_000.0, 20_000.0, 10).await;

        let report = query_current_stock(&conn, "", "all", 2)
            .await
            .expect("query");

        assert_eq!(report.items.len(), 2);
        assert_eq!(report.total_count, 3);
    }

    #[tokio::test]
    async fn current_stock_total_count_matches_items_when_not_truncated() {
        let conn = setup_test_db().await;
        insert_product(&conn, "Beras", 30_000.0, 50_000.0, 10).await;
        insert_product(&conn, "Gula", 20_000.0, 30_000.0, 10).await;

        let report = query_current_stock(&conn, "", "all", REPORT_ROW_LIMIT)
            .await
            .expect("query");

        assert_eq!(report.items.len(), 2);
        assert_eq!(report.total_count, 2);
    }
}
