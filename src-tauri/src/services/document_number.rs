//! Human-facing document numbers: `TRX-`, `RFD-` and `WO-YYYYMMDD-XXXX`.
//!
//! Each number is its prefix, the day, and a four-digit sequence that restarts
//! every day. The next sequence is one past the highest already stored for that
//! day, so callers must generate it inside the same database transaction that
//! inserts the row.

use chrono::{Local, NaiveDate, Utc};
use sea_orm::{ConnectionTrait, DbBackend, Statement};

use crate::utils::AppError;

/// The next `{prefix}-{day:YYYYMMDD}-{seq:04}` in `table.column`.
///
/// `table` and `column` are spliced into the SQL, so they must be fixed
/// identifiers, never input.
pub(crate) async fn next_document_number<C: ConnectionTrait>(
    db: &C,
    table: &'static str,
    column: &'static str,
    prefix: &str,
    day: NaiveDate,
) -> Result<String, AppError> {
    let day_prefix = format!("{}-{}-", prefix, day.format("%Y%m%d"));

    let result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            format!(
                "SELECT MAX(CAST(SUBSTR({column}, LENGTH($1) + 1) AS INTEGER)) as max_num \
                 FROM {table} WHERE {column} LIKE $2"
            ),
            vec![day_prefix.clone().into(), format!("{}%", day_prefix).into()],
        ))
        .await?;

    let max_num: i64 = result
        .map(|r| r.try_get::<i64>("", "max_num").unwrap_or(0))
        .unwrap_or(0);

    Ok(format!("{}{:04}", day_prefix, max_num + 1))
}

/// `TRX-YYYYMMDD-XXXX`, dated in UTC — the same basis as the sale's
/// `created_at`, so a late-night local sale's receipt date matches the date
/// recorded with it and the per-day sequence resets on the same day.
pub(crate) async fn next_receipt_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    next_document_number(
        db,
        "transactions",
        "receipt_number",
        "TRX",
        Utc::now().date_naive(),
    )
    .await
}

/// `RFD-YYYYMMDD-XXXX`, deliberately dated in local time: a document number
/// keyed to the shop's business day, not an instant.
pub(crate) async fn next_refund_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    next_document_number(
        db,
        "refunds",
        "refund_number",
        "RFD",
        Local::now().date_naive(),
    )
    .await
}

/// `WO-YYYYMMDD-XXXX`, local like [`next_refund_number`]. Used by manual
/// write-offs and by the automatic ones a damaged return creates.
pub(crate) async fn next_writeoff_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    next_document_number(
        db,
        "stock_writeoffs",
        "writeoff_number",
        "WO",
        Local::now().date_naive(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{insert_transaction, setup_test_db};
    use crate::utils::time::now_ts;

    #[tokio::test]
    async fn the_sequence_is_per_prefix_and_per_day() {
        let conn = setup_test_db().await;
        let day = NaiveDate::from_ymd_opt(2026, 9, 5).unwrap();

        let first = next_document_number(&conn, "transactions", "receipt_number", "TRX", day)
            .await
            .unwrap();
        assert_eq!(first, "TRX-20260905-0001");

        let txn = insert_transaction(&conn, 1, 10_000.0, "completed", &now_ts()).await;
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transactions SET receipt_number = $1 WHERE id = $2",
            vec!["TRX-20260905-0041".into(), txn.id.into()],
        ))
        .await
        .unwrap();

        let next = next_document_number(&conn, "transactions", "receipt_number", "TRX", day)
            .await
            .unwrap();
        assert_eq!(next, "TRX-20260905-0042");

        let next_day = next_document_number(
            &conn,
            "transactions",
            "receipt_number",
            "TRX",
            day.succ_opt().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(next_day, "TRX-20260906-0001");
    }
}
