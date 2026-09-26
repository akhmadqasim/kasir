//! Stock written off in the period: every approved write-off and the total per
//! reason.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::{day_end_exclusive_utc, day_start_utc};
use crate::domain::reports::{LossRow, LossSummary, ReasonBreakdown};
use crate::utils::AppError;

/// Only `approved` write-offs are real losses. A `rejected` write-off has had
/// its stock restored by `reject_stock_writeoff`, and a `pending` one is not
/// confirmed yet — counting either inflated the loss total.
pub async fn losses(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<LossSummary, AppError> {
    let start_utc = day_start_utc(&start_date)?;
    let end_utc = day_end_exclusive_utc(&end_date)?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        date_str, insert_product, insert_writeoff, setup_test_db, today, utc_at_local_noon,
        WriteoffSpec,
    };

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
        let summary = losses(&conn, day.clone(), day).await.expect("query");

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
}
