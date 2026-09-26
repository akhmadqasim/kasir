//! Every refund and exchange booked in the period, dated to the day the money
//! went back.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::{day_end_exclusive_utc, day_start_utc};
use crate::domain::reports::ReturnRow;
use crate::utils::AppError;

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
                day_start_utc(&start_date)?.into(),
                day_end_exclusive_utc(&end_date)?.into(),
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
