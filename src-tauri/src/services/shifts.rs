//! Shift open/close and the cash drawer movements recorded against a shift.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, Order, QueryFilter, QueryOrder, Set, Statement,
};

use crate::domain::shifts::{
    CashFlowResponse, CloseShiftInput, CreateCashFlowInput, OpenShiftInput, PaymentBreakdown,
    ShiftResponse, ShiftSummaryResponse,
};
use crate::domain::Actor;
use crate::entity::{cash_flows, shifts, users};
use crate::utils::AppError;

async fn get_user_name(db: &DatabaseConnection, user_id: i64) -> String {
    users::Entity::find_by_id(user_id)
        .one(db)
        .await
        .ok()
        .flatten()
        .map(|u| u.full_name)
        .unwrap_or_default()
}

/// Open a shift for the actor, or hand back the one they already have open.
pub async fn open(
    db: &DatabaseConnection,
    actor: &Actor,
    input: OpenShiftInput,
) -> Result<ShiftResponse, AppError> {
    let existing = shifts::Entity::find()
        .filter(shifts::Column::UserId.eq(actor.user_id))
        .filter(shifts::Column::Status.eq("open"))
        .one(db)
        .await?;

    if let Some(existing_shift) = existing {
        let name = get_user_name(db, existing_shift.user_id).await;
        return Ok(ShiftResponse::from_model(&existing_shift, name));
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let shift = shifts::ActiveModel {
        id: NotSet,
        user_id: Set(actor.user_id),
        opening_cash: Set(input.opening_cash.unwrap_or(0.0)),
        closing_cash: Set(None),
        opened_at: Set(now),
        closed_at: Set(None),
        notes: Set(None),
        status: Set("open".to_string()),
    };

    let result = shift.insert(db).await?;
    let name = get_user_name(db, result.user_id).await;
    Ok(ShiftResponse::from_model(&result, name))
}

pub async fn active_for(
    db: &DatabaseConnection,
    actor: &Actor,
) -> Result<Option<ShiftResponse>, AppError> {
    let shift = shifts::Entity::find()
        .filter(shifts::Column::UserId.eq(actor.user_id))
        .filter(shifts::Column::Status.eq("open"))
        .one(db)
        .await?;

    match shift {
        Some(s) => {
            let name = get_user_name(db, s.user_id).await;
            Ok(Some(ShiftResponse::from_model(&s, name)))
        }
        None => Ok(None),
    }
}

pub async fn close(
    db: &DatabaseConnection,
    input: CloseShiftInput,
) -> Result<ShiftSummaryResponse, AppError> {
    let shift = shifts::Entity::find_by_id(input.shift_id)
        .one(db)
        .await?
        .ok_or(AppError::NotFound("Shift tidak ditemukan".into()))?;

    if shift.status == "closed" {
        return Err(AppError::Validation("Shift sudah ditutup".into()));
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut active_shift: shifts::ActiveModel = shift.into();
    active_shift.status = Set("closed".to_string());
    active_shift.closed_at = Set(Some(now));
    active_shift.closing_cash = Set(input.closing_cash);
    active_shift.notes = Set(input.notes);
    let updated_shift = active_shift.update(db).await?;

    build_summary(db, &updated_shift).await
}

pub async fn summary(
    db: &DatabaseConnection,
    shift_id: i64,
) -> Result<ShiftSummaryResponse, AppError> {
    let shift = shifts::Entity::find_by_id(shift_id)
        .one(db)
        .await?
        .ok_or(AppError::NotFound("Shift tidak ditemukan".into()))?;

    build_summary(db, &shift).await
}

/// Cash the drawer should hold: opening float, plus the cash actually taken in
/// over the shift, plus manual cash in, minus manual cash out.
async fn build_summary(
    db: &DatabaseConnection,
    shift: &shifts::Model,
) -> Result<ShiftSummaryResponse, AppError> {
    // Total sales (cash only for cash tracking)
    let sales_result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as cnt
             FROM transactions
             WHERE shift_id = $1 AND status IN ('completed', 'partial_refund')",
            vec![shift.id.into()],
        ))
        .await?;

    let (total_sales, total_transactions) = match sales_result {
        Some(row) => {
            let total: f64 = row.try_get("", "total").unwrap_or(0.0);
            let cnt: i64 = row.try_get("", "cnt").unwrap_or(0);
            (total, cnt)
        }
        None => (0.0, 0),
    };

    // Cash sales kept in drawer
    let cash_sales_result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "WITH cash_rows AS (
                SELECT tp.amount as amount
                FROM transaction_payments tp
                JOIN transactions t ON t.id = tp.transaction_id
                WHERE t.shift_id = $1 AND t.status IN ('completed', 'partial_refund')
                AND tp.payment_method = 'cash'
                UNION ALL
                SELECT t.total_amount as amount
                FROM transactions t
                WHERE t.shift_id = $1 AND t.status IN ('completed', 'partial_refund')
                AND t.payment_method = 'cash'
                AND NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = t.id)
             )
             SELECT COALESCE(SUM(amount), 0) as total FROM cash_rows",
            vec![shift.id.into()],
        ))
        .await?;

    let cash_sales: f64 = match cash_sales_result {
        Some(row) => row.try_get("", "total").unwrap_or(0.0),
        None => 0.0,
    };

    // Cash flows
    let flows = cash_flows::Entity::find()
        .filter(cash_flows::Column::ShiftId.eq(shift.id))
        .order_by(cash_flows::Column::CreatedAt, Order::Asc)
        .all(db)
        .await?;

    let mut cash_in = 0.0;
    let mut cash_out = 0.0;
    let flow_responses: Vec<CashFlowResponse> = flows
        .into_iter()
        .map(|f| {
            if f.flow_type == "in" {
                cash_in += f.amount;
            } else {
                cash_out += f.amount;
            }
            CashFlowResponse::from(f)
        })
        .collect();

    let expected_cash = shift.opening_cash + cash_sales + cash_in - cash_out;

    // Payment method breakdown
    let payment_rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "WITH payment_method_rows AS (
                SELECT tp.payment_method as payment_method, tp.amount as amount, tp.transaction_id as transaction_id
                FROM transaction_payments tp
                JOIN transactions t ON t.id = tp.transaction_id
                WHERE t.shift_id = $1 AND t.status IN ('completed', 'partial_refund')
                UNION ALL
                SELECT t.payment_method as payment_method, t.total_amount as amount, t.id as transaction_id
                FROM transactions t
                WHERE t.shift_id = $1 AND t.status IN ('completed', 'partial_refund')
                AND NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = t.id)
             )
             SELECT payment_method, COUNT(DISTINCT transaction_id) as cnt, COALESCE(SUM(amount), 0) as total
             FROM payment_method_rows
             GROUP BY payment_method
             ORDER BY total DESC",
            vec![shift.id.into()],
        ))
        .await?;

    let payment_breakdown: Vec<PaymentBreakdown> = payment_rows
        .iter()
        .filter_map(|row| {
            let method: String = row.try_get("", "payment_method").ok()?;
            let count: i64 = row.try_get("", "cnt").unwrap_or(0);
            let total: f64 = row.try_get("", "total").unwrap_or(0.0);
            Some(PaymentBreakdown {
                method,
                count,
                total,
            })
        })
        .collect();

    let user_name = get_user_name(db, shift.user_id).await;

    Ok(ShiftSummaryResponse {
        shift: ShiftResponse::from_model(shift, user_name),
        total_sales,
        total_transactions,
        cash_in,
        cash_out,
        expected_cash,
        cash_flows: flow_responses,
        payment_breakdown,
    })
}

pub async fn create_cash_flow(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateCashFlowInput,
) -> Result<CashFlowResponse, AppError> {
    if input.flow_type != "in" && input.flow_type != "out" {
        return Err(AppError::Validation("Jenis harus 'in' atau 'out'".into()));
    }
    if input.amount <= 0.0 {
        return Err(AppError::Validation("Nominal harus lebih dari 0".into()));
    }
    if input.description.trim().is_empty() {
        return Err(AppError::Validation("Keterangan tidak boleh kosong".into()));
    }

    // Verify shift is open
    let shift = shifts::Entity::find_by_id(input.shift_id)
        .one(db)
        .await?
        .ok_or(AppError::NotFound("Shift tidak ditemukan".into()))?;

    if shift.status != "open" {
        return Err(AppError::Validation("Shift sudah ditutup".into()));
    }

    let flow = cash_flows::ActiveModel {
        id: NotSet,
        shift_id: Set(input.shift_id),
        user_id: Set(actor.user_id),
        flow_type: Set(input.flow_type),
        amount: Set(input.amount),
        description: Set(input.description.trim().to_string()),
        created_at: NotSet,
    };

    let result = flow.insert(db).await?;
    Ok(CashFlowResponse::from(result))
}

pub async fn list_cash_flows(
    db: &DatabaseConnection,
    shift_id: i64,
) -> Result<Vec<CashFlowResponse>, AppError> {
    let flows = cash_flows::Entity::find()
        .filter(cash_flows::Column::ShiftId.eq(shift_id))
        .order_by(cash_flows::Column::CreatedAt, Order::Desc)
        .all(db)
        .await?;

    Ok(flows.into_iter().map(CashFlowResponse::from).collect())
}

/// A cash-flow entry may only be removed while its shift is still open, and only
/// by its author or an admin.
pub async fn delete_cash_flow(
    db: &DatabaseConnection,
    actor: &Actor,
    cash_flow_id: i64,
) -> Result<(), AppError> {
    let flow = cash_flows::Entity::find_by_id(cash_flow_id)
        .one(db)
        .await?
        .ok_or(AppError::NotFound("Arus kas tidak ditemukan".into()))?;

    let shift = shifts::Entity::find_by_id(flow.shift_id)
        .one(db)
        .await?
        .ok_or(AppError::NotFound("Shift tidak ditemukan".into()))?;

    if shift.status != "open" {
        return Err(AppError::Validation(
            "Arus kas hanya bisa dihapus saat shift masih terbuka".into(),
        ));
    }

    if !actor.is_admin() && flow.user_id != actor.user_id {
        return Err(AppError::Forbidden(
            "Hanya admin atau pembuat entri yang dapat menghapus arus kas ini.".into(),
        ));
    }

    let active: cash_flows::ActiveModel = flow.into();
    active.delete(db).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{insert_user, setup_test_db};

    async fn open_shift_for(db: &DatabaseConnection, actor: &Actor) -> ShiftResponse {
        open(db, actor, OpenShiftInput { opening_cash: None })
            .await
            .expect("shift opens")
    }

    /// A second open for the same cashier returns the shift already running
    /// rather than starting a competing one.
    #[tokio::test]
    async fn opening_twice_returns_the_same_shift() {
        let conn = setup_test_db().await;
        let actor = Actor::new(1, "admin");

        let first = open(
            &conn,
            &actor,
            OpenShiftInput {
                opening_cash: Some(100_000.0),
            },
        )
        .await
        .expect("first open");
        let second = open_shift_for(&conn, &actor).await;

        assert_eq!(first.id, second.id);
        assert_eq!(second.opening_cash, 100_000.0);
    }

    #[tokio::test]
    async fn a_cashier_cannot_delete_another_cashiers_cash_flow() {
        let conn = setup_test_db().await;
        let owner = insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await;
        let other = insert_user(&conn, "kasir2", "Kasir Dua", "kasir").await;
        let owner_actor = Actor::from(&owner);

        let shift = open_shift_for(&conn, &owner_actor).await;
        let flow = create_cash_flow(
            &conn,
            &owner_actor,
            CreateCashFlowInput {
                shift_id: shift.id,
                flow_type: "out".into(),
                amount: 5_000.0,
                description: "Beli kantong plastik".into(),
            },
        )
        .await
        .expect("cash flow recorded");

        assert_eq!(flow.user_id, owner.id, "the author is the actor");

        let denied = delete_cash_flow(&conn, &Actor::from(&other), flow.id).await;
        match denied.unwrap_err() {
            AppError::Forbidden(_) => {}
            other => panic!("expected Forbidden, got {:?}", other),
        }

        delete_cash_flow(&conn, &Actor::new(1, "admin"), flow.id)
            .await
            .expect("an admin may delete anyone's entry");
    }
}
