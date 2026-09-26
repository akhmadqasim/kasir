//! Sales by calendar bucket: the daily and monthly reports, and the period
//! summary built on the daily rows.

use chrono::NaiveDate;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::net_revenue::{refund_adjust_cte, SALE_FILTER};
use super::{day_end_exclusive_utc, day_start_utc};
use crate::domain::reports::{DailySalesRow, MonthlySalesRow, PeriodSalesSummary};
use crate::utils::time::{invalid_date, local_date_start_to_utc};
use crate::utils::AppError;

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

pub async fn daily_sales(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<Vec<DailySalesRow>, AppError> {
    let buckets = query_sales_buckets(
        db,
        "date(t.created_at, 'localtime')",
        "date(r.created_at, 'localtime')",
        day_start_utc(&start_date)?,
        day_end_exclusive_utc(&end_date)?,
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

pub async fn monthly_sales(
    db: &DatabaseConnection,
    year: i32,
) -> Result<Vec<MonthlySalesRow>, AppError> {
    // `strftime('%Y', created_at,'localtime') = year` == local year is `year`,
    // i.e. created_at in [year-01-01 00:00 local, (year+1)-01-01 00:00 local).
    // `year` comes straight off the query string: a year outside the calendar
    // chrono can represent, or one whose boundary would leave it, is a
    // validation error rather than an overflow or a lexicographic comparison
    // against a made-up string.
    let year_boundary = |year: i32| {
        NaiveDate::from_ymd_opt(year, 1, 1)
            .and_then(local_date_start_to_utc)
            .ok_or_else(invalid_date)
    };
    let year_start = year_boundary(year)?;
    let year_end = year_boundary(year.checked_add(1).ok_or_else(invalid_date)?)?;

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

/// The period's totals, derived from its daily rows so the summary is always
/// exactly the sum of its days.
pub async fn sales_period(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<PeriodSalesSummary, AppError> {
    let daily = daily_sales(db, start_date, end_date).await?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::reports::fixtures::{return_lines, three_item_sale};
    use crate::test_support::{
        date_str, insert_product, insert_transaction, insert_transaction_item, setup_test_db,
        today, utc_at_local_noon,
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

        let rows = daily_sales(&conn, day.clone(), day).await.expect("query");

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
        let rows = monthly_sales(&conn, year).await.expect("query");

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

    fn assert_invalid_date<T: std::fmt::Debug>(result: Result<T, AppError>) {
        match result {
            Err(AppError::Validation(message)) => {
                assert_eq!(message, crate::utils::time::INVALID_DATE)
            }
            other => panic!("expected a Validation error, got {:?}", other),
        }
    }

    /// `year` arrives unchecked from the query string; the largest `i32` used
    /// to overflow computing the next year's boundary, and a year beyond the
    /// calendar was compared as a made-up string. Both are a 400 now.
    #[tokio::test]
    async fn monthly_sales_reject_a_year_outside_the_calendar() {
        let conn = setup_test_db().await;

        assert_invalid_date(monthly_sales(&conn, i32::MAX).await);
        assert_invalid_date(monthly_sales(&conn, i32::MIN).await);
        assert_invalid_date(monthly_sales(&conn, chrono::NaiveDate::MAX.year()).await);
    }

    /// A year past 9999 has no boundary that sorts against the stored
    /// timestamps (chrono writes it `+10000-...`), so it is a 400 rather than
    /// a range compared as a made-up string. The last four-digit year the
    /// offset keeps inside the calendar still answers.
    #[tokio::test]
    async fn monthly_sales_reject_a_five_digit_year() {
        let conn = setup_test_db().await;

        assert_invalid_date(monthly_sales(&conn, 10_000).await);
        assert_invalid_date(monthly_sales(&conn, -1).await);
        let rows = monthly_sales(&conn, 9_998).await.expect("query");
        assert!(rows.is_empty());
    }

    /// The last day of the calendar has no next day to end the range on; it
    /// used to panic, and now it is a validation error.
    #[tokio::test]
    async fn reports_reject_the_last_day_of_the_calendar() {
        let conn = setup_test_db().await;
        let last = chrono::NaiveDate::MAX.format("%Y-%m-%d").to_string();
        let day = date_str(today());

        assert_invalid_date(daily_sales(&conn, day, last.clone()).await);
        assert_invalid_date(sales_period(&conn, last.clone(), last).await);
    }

    /// Anything but a `YYYY-MM-DD` calendar date is a 400. It used to be
    /// passed through as `"<input> 00:00:00"` and compared as a string.
    #[tokio::test]
    async fn reports_reject_malformed_dates() {
        let conn = setup_test_db().await;
        let day = date_str(today());

        for bad in [
            "",
            "kemarin",
            "2026-02-30",
            "2026-13-01",
            "05/09/2026",
            "2026-9-5x",
        ] {
            assert_invalid_date(daily_sales(&conn, bad.to_string(), day.clone()).await);
            assert_invalid_date(daily_sales(&conn, day.clone(), bad.to_string()).await);
        }
    }

    #[tokio::test]
    async fn period_summary_average_uses_per_transaction_revenue() {
        let conn = setup_test_db().await;
        seed_two_sales_today(&conn).await;
        let day = date_str(today());

        let summary = sales_period(&conn, day.clone(), day).await.expect("query");

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

        let rows = daily_sales(&conn, day.clone(), day).await.expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].transaction_count, 1);
        assert_eq!(rows[0].total_revenue, 25_000.0);
        assert_eq!(rows[0].total_cost, 0.0);
        assert_eq!(rows[0].gross_profit, 25_000.0);
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
        let summary = sales_period(&conn, day.clone(), day).await.expect("query");

        assert_eq!(summary.total_revenue, 50_000.0);
        assert_eq!(summary.total_transactions, 1);
    }

    // --- Net revenue ---

    #[tokio::test]
    async fn daily_sales_subtract_what_was_handed_back() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "cash", &lines[..2], 100_000.0).await;

        let day = date_str(today());
        let rows = daily_sales(&conn, day.clone(), day).await.expect("query");

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

        let sale_only = daily_sales(&conn, sale.clone(), sale.clone())
            .await
            .expect("query");
        assert_eq!(sale_only.len(), 1);
        assert_eq!(sale_only[0].total_revenue, 300_000.0);

        let refund_only = daily_sales(&conn, refund.clone(), refund.clone())
            .await
            .expect("query");
        assert_eq!(refund_only.len(), 1, "the payout day still gets a row");
        assert_eq!(refund_only[0].total_revenue, -200_000.0);
        assert_eq!(refund_only[0].transaction_count, 0);

        let whole = sales_period(&conn, sale, refund).await.expect("query");
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

        let summary = sales_period(&conn, date_str(sale_day), date_str(today()))
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
        let daily = daily_sales(&conn, day.clone(), day).await.expect("query");
        let year: i32 = sale_day.format("%Y").to_string().parse().expect("year");
        let monthly = monthly_sales(&conn, year).await.expect("query");

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
        let rows = daily_sales(&conn, day.clone(), day).await.expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].total_revenue, 0.0);
        assert_eq!(rows[0].total_cost, 0.0);
        assert_eq!(rows[0].gross_profit, 0.0);
    }
}
