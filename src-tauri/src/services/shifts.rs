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
/// over the shift, plus manual cash in, minus manual cash out, minus the cash
/// handed back for returns and exchange differences.
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

    // Cash paid back out over this shift (B23).
    //
    // A return hands over the whole refunded amount; an exchange only hands over
    // the difference, and `difference_amount` is signed
    // (`total_refund_amount - total_exchange_amount`), so a customer who topped
    // up for a dearer replacement contributes a negative value and correctly
    // puts money back into the drawer.
    //
    // `refunds.payment_method` is copied from the original sale, which is the
    // only record of how the money moved: a return of a QRIS sale is assumed to
    // have gone back over QRIS and does not touch the drawer. `mixed` is
    // deliberately not counted — how much of a split payment came back in cash
    // is not recorded anywhere, and guessing would put a made-up number on the
    // closing report.
    let refund_result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(
                CASE WHEN r.type = 'exchange'
                     THEN COALESCE(r.difference_amount, 0)
                     ELSE r.total_refund_amount END
             ), 0) as total
             FROM refunds r
             WHERE r.shift_id = $1 AND r.payment_method = 'cash'",
            vec![shift.id.into()],
        ))
        .await?;

    let cash_refunds: f64 = match refund_result {
        Some(row) => row.try_get("", "total").unwrap_or(0.0),
        None => 0.0,
    };

    let expected_cash = shift.opening_cash + cash_sales + cash_in - cash_out - cash_refunds;

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
        cash_refunds,
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
    use crate::test_support::{
        insert_refund, insert_transaction, insert_user, now_ts, setup_test_db, RefundSpec,
    };

    /// Records a return of `amount` against a fresh sale, paid back over
    /// `payment_method` and booked to `shift_id`.
    async fn refund_against_a_sale(
        db: &DatabaseConnection,
        shift_id: i64,
        user_id: i64,
        payment_method: &str,
        amount: f64,
    ) {
        let txn = insert_transaction(db, user_id, amount, "refunded", &now_ts()).await;
        insert_refund(
            db,
            RefundSpec {
                transaction_id: txn.id,
                user_id,
                refund_type: "refund",
                total_refund_amount: amount,
                total_exchange_amount: 0.0,
                difference_amount: amount,
                payment_method,
                shift_id: Some(shift_id),
                created_at: &now_ts(),
            },
        )
        .await;
    }

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

    /// B23: the drawer is short by exactly what the cashier handed back, so the
    /// closing report has to expect it. It used to accuse an honest till of a
    /// shortfall.
    #[tokio::test]
    async fn expected_cash_subtracts_a_cash_refund() {
        let conn = setup_test_db().await;
        let actor = Actor::new(1, "admin");
        let shift = open(
            &conn,
            &actor,
            OpenShiftInput {
                opening_cash: Some(500_000.0),
            },
        )
        .await
        .expect("shift opens");

        refund_against_a_sale(&conn, shift.id, 1, "cash", 50_000.0).await;

        let report = summary(&conn, shift.id).await.expect("summary");
        assert_eq!(report.cash_refunds, 50_000.0);
        assert_eq!(report.expected_cash, 450_000.0);
    }

    /// A QRIS sale reversed over QRIS never touches the drawer.
    #[tokio::test]
    async fn a_non_cash_refund_leaves_the_drawer_alone() {
        let conn = setup_test_db().await;
        let actor = Actor::new(1, "admin");
        let shift = open(
            &conn,
            &actor,
            OpenShiftInput {
                opening_cash: Some(500_000.0),
            },
        )
        .await
        .expect("shift opens");

        refund_against_a_sale(&conn, shift.id, 1, "qris", 50_000.0).await;

        let report = summary(&conn, shift.id).await.expect("summary");
        assert_eq!(report.cash_refunds, 0.0);
        assert_eq!(report.expected_cash, 500_000.0);
    }

    /// Only the difference moves through the drawer on an exchange, and it moves
    /// in the direction the sign says: a customer who takes a dearer replacement
    /// pays the shop, so the drawer ends up fuller, not emptier.
    #[tokio::test]
    async fn an_exchange_moves_only_its_difference_through_the_drawer() {
        let conn = setup_test_db().await;
        let actor = Actor::new(1, "admin");
        let shift = open(
            &conn,
            &actor,
            OpenShiftInput {
                opening_cash: Some(500_000.0),
            },
        )
        .await
        .expect("shift opens");

        // Returned Rp 60.000 of goods, took Rp 45.000 back: the shop pays 15.000.
        let paid_out = insert_transaction(&conn, 1, 60_000.0, "refunded", &now_ts()).await;
        insert_refund(
            &conn,
            RefundSpec {
                transaction_id: paid_out.id,
                user_id: 1,
                refund_type: "exchange",
                total_refund_amount: 60_000.0,
                total_exchange_amount: 45_000.0,
                difference_amount: 15_000.0,
                payment_method: "cash",
                shift_id: Some(shift.id),
                created_at: &now_ts(),
            },
        )
        .await;

        // Returned Rp 40.000 of goods, took Rp 70.000: the customer pays 30.000.
        let topped_up = insert_transaction(&conn, 1, 40_000.0, "refunded", &now_ts()).await;
        insert_refund(
            &conn,
            RefundSpec {
                transaction_id: topped_up.id,
                user_id: 1,
                refund_type: "exchange",
                total_refund_amount: 40_000.0,
                total_exchange_amount: 70_000.0,
                difference_amount: -30_000.0,
                payment_method: "cash",
                shift_id: Some(shift.id),
                created_at: &now_ts(),
            },
        )
        .await;

        let report = summary(&conn, shift.id).await.expect("summary");
        assert_eq!(report.cash_refunds, -15_000.0);
        assert_eq!(report.expected_cash, 515_000.0);
    }

    /// A refund booked to somebody else's shift is not this shift's problem.
    #[tokio::test]
    async fn a_refund_from_another_shift_does_not_count() {
        let conn = setup_test_db().await;
        let other = insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await;

        let mine = open(
            &conn,
            &Actor::new(1, "admin"),
            OpenShiftInput {
                opening_cash: Some(500_000.0),
            },
        )
        .await
        .expect("shift opens");
        let theirs = open(
            &conn,
            &Actor::from(&other),
            OpenShiftInput {
                opening_cash: Some(100_000.0),
            },
        )
        .await
        .expect("shift opens");

        refund_against_a_sale(&conn, theirs.id, other.id, "cash", 50_000.0).await;

        let report = summary(&conn, mine.id).await.expect("summary");
        assert_eq!(report.cash_refunds, 0.0);
        assert_eq!(report.expected_cash, 500_000.0);
    }

    /// Migration 022's backfill, run against the exact SQL that ships. A refund
    /// taken inside a cashier's shift is recovered; one taken with no shift open
    /// stays unattributed, which is the documented limit.
    #[tokio::test]
    async fn migration_022_backfills_refunds_into_the_shift_that_was_open() {
        const MIGRATION_022: &str = include_str!("../../migrations/022_refund_shift.sql");

        let conn = setup_test_db().await;
        let shift = open(
            &conn,
            &Actor::new(1, "admin"),
            OpenShiftInput {
                opening_cash: Some(0.0),
            },
        )
        .await
        .expect("shift opens");

        // The migration has already run as part of `setup_test_db`, so undo the
        // column's contents and re-run the backfill over rows that predate it.
        let during = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let before = (chrono::Utc::now() - chrono::Duration::days(3))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();

        let inside = insert_transaction(&conn, 1, 10_000.0, "refunded", &during).await;
        let outside = insert_transaction(&conn, 1, 10_000.0, "refunded", &before).await;
        for (txn_id, created_at) in [(inside.id, &during), (outside.id, &before)] {
            insert_refund(
                &conn,
                RefundSpec {
                    transaction_id: txn_id,
                    user_id: 1,
                    refund_type: "refund",
                    total_refund_amount: 10_000.0,
                    total_exchange_amount: 0.0,
                    difference_amount: 10_000.0,
                    payment_method: "cash",
                    shift_id: None,
                    created_at,
                },
            )
            .await;
        }

        // The whole migration already ran as part of `setup_test_db`, and the
        // ALTER cannot run twice — but the backfill is idempotent, so the test
        // replays that half straight out of the shipped file rather than a copy
        // of it.
        let backfill = MIGRATION_022
            .split_once("UPDATE refunds")
            .map(|(_, rest)| format!("UPDATE refunds{}", rest))
            .expect("migration 022 ends with its backfill UPDATE");
        conn.execute_unprepared(&backfill)
            .await
            .expect("the backfill runs");

        let placed = crate::entity::refunds::Entity::find()
            .filter(crate::entity::refunds::Column::TransactionId.eq(inside.id))
            .one(&conn)
            .await
            .expect("query")
            .expect("refund row");
        assert_eq!(placed.shift_id, Some(shift.id));

        let unplaced = crate::entity::refunds::Entity::find()
            .filter(crate::entity::refunds::Column::TransactionId.eq(outside.id))
            .one(&conn)
            .await
            .expect("query")
            .expect("refund row");
        assert_eq!(
            unplaced.shift_id, None,
            "a refund from before the shift opened belongs to no drawer"
        );
    }
}
