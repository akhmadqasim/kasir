//! Cash put into and taken out of the drawer outside a sale.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::{day_end_exclusive_utc, day_start_utc};
use crate::domain::reports::{CashFlowReportRow, CashFlowReportSummary};
use crate::utils::AppError;

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
                day_start_utc(&start_date)?.into(),
                day_end_exclusive_utc(&end_date)?.into(),
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

    let total_of = |flow_type: &str| -> f64 {
        items
            .iter()
            .filter(|item| item.flow_type == flow_type)
            .map(|item| item.amount)
            .sum()
    };
    let total_in = total_of("in");
    let total_out = total_of("out");

    Ok(CashFlowReportSummary {
        total_in,
        total_out,
        net_total: total_in - total_out,
        items,
    })
}
