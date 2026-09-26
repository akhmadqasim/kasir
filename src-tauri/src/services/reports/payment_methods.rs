//! Takings per payment method, net of what went back out on each.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::net_revenue::{payment_refund_adjust_cte, SALE_FILTER};
use super::{day_end_exclusive_utc, day_start_utc};
use crate::domain::reports::{PaymentMethodReport, PaymentMethodRow};
use crate::utils::AppError;

pub async fn payment_methods(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<PaymentMethodReport, AppError> {
    let start_utc = day_start_utc(&start_date)?;
    let end_utc = day_end_exclusive_utc(&end_date)?;
    let rows = query_payment_methods(db, start_utc.clone(), end_utc.clone()).await?;
    let total_transactions = query_sale_count(db, start_utc, end_utc).await?;

    let mut result: Vec<PaymentMethodRow> = rows
        .into_iter()
        .map(
            |(payment_method, transaction_count, total_amount)| PaymentMethodRow {
                payment_method,
                transaction_count,
                total_amount,
                percentage: 0.0,
            },
        )
        .collect();

    let total: f64 = result.iter().map(|r| r.total_amount).sum();
    if total > 0.0 {
        for row in &mut result {
            row.percentage = (row.total_amount / total) * 100.0;
        }
    }

    Ok(PaymentMethodReport {
        rows: result,
        total_transactions,
    })
}

/// `(method, transactions, net total)` per payment method between two UTC
/// boundaries, largest total first. The payment-method report and the
/// dashboard's card for today both read this one query.
pub(crate) async fn query_payment_methods(
    db: &DatabaseConnection,
    start_utc: String,
    end_utc: String,
) -> Result<Vec<(String, i64, f64)>, AppError> {
    // A return is deducted from the method(s) the money went back on — see
    // `payment_refund_adjust_cte`. A split sale has one row per split here, so
    // its count lands under each method it used; the report's total counts
    // distinct sales separately (`query_sale_count`). A method whose only
    // activity in the period was a return still gets a row — with zero
    // transactions, because a return is not a sale.
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
        refund_adjust = payment_refund_adjust_cte(str::to_string),
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
            )
        })
        .collect())
}

/// Distinct sales between two UTC boundaries. The payment-method report's total
/// row needs this rather than the sum of its per-method counts: a split sale
/// is counted once under each method it was paid with.
async fn query_sale_count(
    db: &DatabaseConnection,
    start_utc: String,
    end_utc: String,
) -> Result<i64, AppError> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            format!(
                "SELECT COUNT(*) FROM transactions t
                 WHERE {SALE_FILTER}
                 AND t.created_at >= $1 AND t.created_at < $2"
            ),
            vec![start_utc.into(), end_utc.into()],
        ))
        .await?;
    Ok(row
        .and_then(|row| row.try_get_by_index(0).ok())
        .unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::reports::fixtures::{return_lines, three_item_sale};
    use crate::services::reports::sales_period;
    use crate::test_support::{date_str, setup_test_db, today, utc_at_local_noon};

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
            .expect("query")
            .rows;

        let cash = rows
            .iter()
            .find(|r| r.payment_method == "cash")
            .expect("cash row");
        assert_eq!(cash.total_amount, 100_000.0);
        assert_eq!(cash.transaction_count, 1);

        let summary = sales_period(&conn, day.clone(), day).await.expect("query");
        let by_method: f64 = rows.iter().map(|r| r.total_amount).sum();
        assert_eq!(by_method, summary.total_revenue);
    }

    /// Turns the Rp 300.000 [`three_item_sale`] into a split sale: Rp 180.000
    /// cash + Rp 120.000 QRIS, the way checkout records one.
    async fn make_split_sale(conn: &DatabaseConnection, txn_id: i64, created_at: &str) {
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transactions SET payment_method = 'mixed' WHERE id = $1",
            vec![txn_id.into()],
        ))
        .await
        .expect("mark mixed");
        for (method, amount) in [("cash", 180_000.0), ("qris", 120_000.0)] {
            conn.execute(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO transaction_payments (transaction_id, payment_method, amount, created_at)
                 VALUES ($1, $2, $3, $4)",
                vec![
                    txn_id.into(),
                    method.into(),
                    amount.into(),
                    created_at.into(),
                ],
            ))
            .await
            .expect("insert split");
        }
    }

    fn method_total(rows: &[PaymentMethodRow], method: &str) -> f64 {
        rows.iter()
            .find(|r| r.payment_method == method)
            .unwrap_or_else(|| panic!("{method} row"))
            .total_amount
    }

    /// A refund on a split sale that names its method comes off that method
    /// only — never off a phantom `mixed` bucket.
    #[tokio::test]
    async fn payment_methods_split_sale_refund_comes_off_the_named_method() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        make_split_sale(&conn, txn_id, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "qris", &lines[..1], 100_000.0).await;

        let day = date_str(today());
        let report = payment_methods(&conn, day.clone(), day.clone())
            .await
            .expect("query");

        assert!(report.rows.iter().all(|r| r.payment_method != "mixed"));
        assert_eq!(report.rows.len(), 2);
        assert_eq!(method_total(&report.rows, "cash"), 180_000.0);
        assert_eq!(method_total(&report.rows, "qris"), 20_000.0);

        let summary = sales_period(&conn, day.clone(), day).await.expect("query");
        let by_method: f64 = report.rows.iter().map(|r| r.total_amount).sum();
        assert_eq!(by_method, summary.total_revenue);
    }

    /// A refund with no method is spread over the sale's splits in proportion
    /// to their amounts (60% cash, 40% QRIS here).
    #[tokio::test]
    async fn payment_methods_split_sale_refund_without_method_is_prorated() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        make_split_sale(&conn, txn_id, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "cash", &lines[..1], 100_000.0).await;
        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE refunds SET payment_method = NULL",
        ))
        .await
        .expect("clear refund method");

        let day = date_str(today());
        let rows = payment_methods(&conn, day.clone(), day.clone())
            .await
            .expect("query")
            .rows;

        assert!(rows.iter().all(|r| r.payment_method != "mixed"));
        assert_eq!(rows.len(), 2);
        assert_eq!(method_total(&rows, "cash"), 120_000.0);
        assert_eq!(method_total(&rows, "qris"), 80_000.0);
    }

    /// The per-method counts list a split sale under each method, but the
    /// report's total counts it once.
    #[tokio::test]
    async fn payment_methods_total_counts_a_split_sale_once() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, _) = three_item_sale(&conn, &created_at).await;
        make_split_sale(&conn, txn_id, &created_at).await;

        let day = date_str(today());
        let report = payment_methods(&conn, day.clone(), day.clone())
            .await
            .expect("query");

        assert_eq!(report.rows.len(), 2);
        assert!(report.rows.iter().all(|r| r.transaction_count == 1));
        assert_eq!(report.total_transactions, 1);
    }
}
