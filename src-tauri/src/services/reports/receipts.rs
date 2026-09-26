//! The per-receipt drill-down under the sales summary.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::net_revenue::SALE_FILTER;
use super::{day_end_exclusive_utc, day_start_utc, REPORT_ROW_LIMIT};
use crate::domain::reports::{ReceiptReport, ReceiptRow};
use crate::utils::AppError;

pub async fn sales_receipts(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
    search: String,
) -> Result<ReceiptReport, AppError> {
    query_sales_receipts(db, &start_date, &end_date, &search, REPORT_ROW_LIMIT).await
}

/// Per-receipt drill-down of the same period the summary reports cover, so it
/// applies the same status filter as the daily report. Without it, this was
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
/// (see [`refund_adjust_cte`](super::refund_adjust_cte)), this list dates them
/// to the receipt.
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
                day_start_utc(start_date)?.into(),
                day_end_exclusive_utc(end_date)?.into(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::reports::fixtures::{return_lines, three_item_sale};
    use crate::services::reports::sales_period;
    use crate::test_support::{
        date_str, insert_transaction, setup_test_db, today, utc_at_local_noon,
    };

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
        let summary = sales_period(&conn, day.clone(), day).await.expect("query");
        assert_eq!(receipts_total, 200_000.0);
        assert_eq!(receipts_total, summary.total_revenue);
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

        let summary = sales_period(&conn, day.clone(), day).await.expect("query");
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
}
