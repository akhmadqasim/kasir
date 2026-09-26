//! The eleven reports: sales by day, month and period, per receipt, per payment
//! method, per product, returns, current stock, losses and cash flow.
//!
//! [`net_revenue`] holds the SQL building blocks every sales figure is made of
//! (here and in `services::dashboard`); each other submodule is one report, or
//! a family of reports over the same aggregate. What they all share — the date
//! boundaries and the row cap — lives here.

#[cfg(test)]
pub(crate) mod fixtures;

mod cash_flows;
mod current_stock;
mod losses;
mod net_revenue;
mod payment_methods;
mod products;
mod receipts;
mod returns;
mod sales;

pub use cash_flows::cash_flows;
pub use current_stock::current_stock;
pub use losses::losses;
pub use payment_methods::payment_methods;
pub use products::{popular_products, product_sales};
pub use receipts::sales_receipts;
pub use returns::returns;
pub use sales::{daily_sales, monthly_sales, sales_period};

pub(crate) use net_revenue::{payment_refund_adjust_cte, refund_adjust_cte, SALE_FILTER};
pub(crate) use payment_methods::query_payment_methods;
pub(crate) use products::net_product_sales_ctes;

use crate::utils::time::{
    invalid_date, local_date_end_exclusive_to_utc, local_date_start_to_utc, parse_date,
};
use crate::utils::AppError;

// --- Date boundaries ---
//
// Every report takes an inclusive local date range and compares the raw UTC
// `created_at` against `>= start AND < end_exclusive` (see `utils::time`), which
// keeps the date indexes usable. A date that does not parse, or that sits so
// close to the edge of the calendar that its boundary cannot be computed, is a
// `Validation` error (HTTP 400). It used to be passed through as a raw string,
// which compared lexicographically against the timestamps and quietly returned
// a wrong (usually empty) report, or panicked on the calendar's last day.

/// UTC boundary for 00:00:00 local of `date_str` (the inclusive lower bound).
fn day_start_utc(date_str: &str) -> Result<String, AppError> {
    parse_date(date_str)
        .and_then(local_date_start_to_utc)
        .ok_or_else(invalid_date)
}

/// UTC boundary for 00:00:00 local of the day AFTER `date_str` (the exclusive
/// upper bound).
fn day_end_exclusive_utc(date_str: &str) -> Result<String, AppError> {
    parse_date(date_str)
        .and_then(local_date_end_exclusive_to_utc)
        .ok_or_else(invalid_date)
}

/// Row cap for the two reports that return raw rows instead of aggregates.
/// The cap is reported back through `total_count` so the caller can tell the
/// list was cut short instead of silently deriving totals from a partial array.
const REPORT_ROW_LIMIT: i64 = 500;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{date_str, setup_test_db, today};
    use crate::utils::time::INVALID_DATE;

    fn is_invalid_date<T>(result: &Result<T, AppError>) -> bool {
        matches!(result, Err(AppError::Validation(message)) if message == INVALID_DATE)
    }

    #[test]
    fn day_boundaries_reject_malformed_and_edge_dates() {
        let last = chrono::NaiveDate::MAX.format("%Y-%m-%d").to_string();
        for bad in [
            "",
            " ",
            "2026-02-30",
            "2026-00-10",
            "abc",
            "2026-09-05 00:00:00",
        ] {
            assert!(is_invalid_date(&day_start_utc(bad)), "start {bad:?}");
            assert!(is_invalid_date(&day_end_exclusive_utc(bad)), "end {bad:?}");
        }
        assert!(is_invalid_date(&day_end_exclusive_utc(&last)));
        assert!(day_start_utc("2026-09-05").is_ok());
        assert!(day_end_exclusive_utc("2026-09-05").is_ok());
    }

    /// Every dated report answers a malformed or out-of-range date with the
    /// same 400, instead of an empty report or a panic.
    #[tokio::test]
    async fn every_dated_report_rejects_an_invalid_date() {
        let conn = setup_test_db().await;
        let day = date_str(today());
        let last = chrono::NaiveDate::MAX.format("%Y-%m-%d").to_string();

        for bad in [
            "bukan-tanggal".to_string(),
            "+10000-06-15".to_string(),
            last,
        ] {
            let (ok, bad) = (day.clone(), bad.clone());
            assert!(is_invalid_date(
                &daily_sales(&conn, ok.clone(), bad.clone()).await
            ));
            assert!(is_invalid_date(
                &sales_period(&conn, ok.clone(), bad.clone()).await
            ));
            assert!(is_invalid_date(
                &sales_receipts(&conn, ok.clone(), bad.clone(), String::new()).await
            ));
            assert!(is_invalid_date(
                &payment_methods(&conn, ok.clone(), bad.clone()).await
            ));
            assert!(is_invalid_date(
                &product_sales(&conn, ok.clone(), bad.clone()).await
            ));
            assert!(is_invalid_date(
                &popular_products(&conn, ok.clone(), bad.clone(), 10).await
            ));
            assert!(is_invalid_date(
                &returns(&conn, ok.clone(), bad.clone()).await
            ));
            assert!(is_invalid_date(
                &losses(&conn, ok.clone(), bad.clone()).await
            ));
            assert!(is_invalid_date(
                &cash_flows(&conn, ok.clone(), bad.clone()).await
            ));
            // The start date is checked just as strictly as the end date.
            assert!(is_invalid_date(
                &losses(&conn, bad.clone(), ok.clone()).await
            ));
            assert!(is_invalid_date(
                &returns(&conn, bad.clone(), ok.clone()).await
            ));
        }
    }
}
