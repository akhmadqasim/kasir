//! Shift open/close and the cash drawer movements recorded against a shift.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, Order, QueryFilter, QueryOrder, Set, SqlErr, Statement,
};

use crate::domain::shifts::{
    CashFlowResponse, CloseShiftInput, CreateCashFlowInput, OpenShiftInput, PaymentBreakdown,
    ShiftResponse, ShiftSummaryResponse,
};
use crate::domain::Actor;
use crate::entity::{cash_flows, shifts, users};
use crate::utils::time::now_ts;
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

/// The actor's open shift, if they have one. A user has at most one.
async fn find_open_shift<C: ConnectionTrait>(
    db: &C,
    actor: &Actor,
) -> Result<Option<shifts::Model>, AppError> {
    Ok(shifts::Entity::find()
        .filter(shifts::Column::UserId.eq(actor.user_id))
        .filter(shifts::Column::Status.eq("open"))
        .one(db)
        .await?)
}

/// The shift with this id, open or closed, or `NotFound`.
async fn require_shift(db: &DatabaseConnection, shift_id: i64) -> Result<shifts::Model, AppError> {
    shifts::Entity::find_by_id(shift_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Shift tidak ditemukan".into()))
}

/// Open a shift for the actor, or hand back the one they already have open.
pub async fn open(
    db: &DatabaseConnection,
    actor: &Actor,
    input: OpenShiftInput,
) -> Result<ShiftResponse, AppError> {
    // Serialises the look-then-insert below. Without it two opens in flight at
    // once (a double click, or the same cashier on two devices) both found no
    // open shift and both inserted one; sales then landed on whichever the
    // lookup happened to return, and the other stayed open for good.
    static OPENING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _opening = OPENING.lock().await;

    if let Some(existing_shift) = find_open_shift(db, actor).await? {
        let name = get_user_name(db, existing_shift.user_id).await;
        return Ok(ShiftResponse::from_model(&existing_shift, name));
    }

    let result = insert_open_shift(db, actor, input.opening_cash.unwrap_or(0.0)).await?;
    let name = get_user_name(db, result.user_id).await;
    Ok(ShiftResponse::from_model(&result, name))
}

/// Insert a new open shift for the actor.
///
/// The mutex in [`open`] only serialises this process. Migration 026's partial
/// UNIQUE index is what actually holds the one-open-shift rule, and a write
/// that trips it (another process on the same database got there first) is
/// reported as the rule it is, not as a raw `UNIQUE constraint failed`.
async fn insert_open_shift(
    db: &DatabaseConnection,
    actor: &Actor,
    opening_cash: f64,
) -> Result<shifts::Model, AppError> {
    let shift = shifts::ActiveModel {
        id: NotSet,
        user_id: Set(actor.user_id),
        opening_cash: Set(opening_cash),
        closing_cash: Set(None),
        opened_at: Set(now_ts()),
        closed_at: Set(None),
        notes: Set(None),
        status: Set("open".to_string()),
    };

    shift.insert(db).await.map_err(|err| match err.sql_err() {
        Some(SqlErr::UniqueConstraintViolation(_)) => AppError::Validation(
            "Anda sudah punya shift yang terbuka. Muat ulang halaman untuk melanjutkannya.".into(),
        ),
        _ => err.into(),
    })
}

/// The id of the actor's open shift, if they have one. Sales and refunds are
/// booked to it, so the drawer a sale or payout lands in is always the actor's
/// own: neither takes a shift id from the request. `None` when no shift is
/// open — shifts are optional.
pub(crate) async fn open_shift_id<C: ConnectionTrait>(
    db: &C,
    actor: &Actor,
) -> Result<Option<i64>, AppError> {
    Ok(find_open_shift(db, actor).await?.map(|s| s.id))
}

/// A shift's drawer is its owner's; only they or an admin may close it or book
/// cash against it.
fn ensure_shift_owner(actor: &Actor, shift: &shifts::Model, denied: &str) -> Result<(), AppError> {
    if shift.user_id != actor.user_id && !actor.is_admin() {
        return Err(AppError::Forbidden(denied.into()));
    }
    Ok(())
}

pub async fn active_for(
    db: &DatabaseConnection,
    actor: &Actor,
) -> Result<Option<ShiftResponse>, AppError> {
    match find_open_shift(db, actor).await? {
        Some(s) => {
            let name = get_user_name(db, s.user_id).await;
            Ok(Some(ShiftResponse::from_model(&s, name)))
        }
        None => Ok(None),
    }
}

pub async fn close(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CloseShiftInput,
) -> Result<ShiftSummaryResponse, AppError> {
    let shift = require_shift(db, input.shift_id).await?;

    ensure_shift_owner(
        actor,
        &shift,
        "Hanya admin atau pemilik shift yang dapat menutup shift ini.",
    )?;

    if shift.status == "closed" {
        return Err(AppError::Validation("Shift sudah ditutup".into()));
    }

    let now = now_ts();

    let mut active_shift: shifts::ActiveModel = shift.into();
    active_shift.status = Set("closed".to_string());
    active_shift.closed_at = Set(Some(now));
    active_shift.closing_cash = Set(input.closing_cash);
    active_shift.notes = Set(input.notes);
    let updated_shift = active_shift.update(db).await?;

    build_summary(db, &updated_shift).await
}

/// A shift's figures: the drawer it expects, the sales and the cash moved.
/// Only its owner or an admin may read them, like closing it.
pub async fn summary(
    db: &DatabaseConnection,
    actor: &Actor,
    shift_id: i64,
) -> Result<ShiftSummaryResponse, AppError> {
    let shift = require_shift(db, shift_id).await?;
    ensure_shift_owner(
        actor,
        &shift,
        "Hanya admin atau pemilik shift yang dapat melihat ringkasan shift ini.",
    )?;
    build_summary(db, &shift).await
}

/// Cash the drawer should hold: opening float, plus the cash actually taken in
/// over the shift, plus manual cash in, minus manual cash out, minus the cash
/// handed back for returns and exchange differences.
async fn build_summary(
    db: &DatabaseConnection,
    shift: &shifts::Model,
) -> Result<ShiftSummaryResponse, AppError> {
    // Every sale the shift rang up, including those refunded in full since: the
    // cash still came into the drawer, and what went back out is subtracted
    // once, through `cash_refunds` below. Dropping a `refunded` sale here as
    // well took a full cash refund off the drawer twice, and quietly rewrote
    // the figures of a shift already closed. A voided sale (`deleted`) never
    // counts.
    let sales_result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as cnt
             FROM transactions
             WHERE shift_id = $1 AND status IN ('completed', 'partial_refund', 'refunded')",
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

    // Payment method breakdown, over the same sales. Its `cash` row is the cash
    // taken in, which is what the drawer is reckoned from.
    let payment_rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "WITH payment_method_rows AS (
                SELECT tp.payment_method as payment_method, tp.amount as amount, tp.transaction_id as transaction_id
                FROM transaction_payments tp
                JOIN transactions t ON t.id = tp.transaction_id
                WHERE t.shift_id = $1 AND t.status IN ('completed', 'partial_refund', 'refunded')
                UNION ALL
                SELECT t.payment_method as payment_method, t.total_amount as amount, t.id as transaction_id
                FROM transactions t
                WHERE t.shift_id = $1 AND t.status IN ('completed', 'partial_refund', 'refunded')
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

    let cash_sales = payment_breakdown
        .iter()
        .find(|b| b.method == "cash")
        .map_or(0.0, |b| b.total);

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
    let shift = require_shift(db, input.shift_id).await?;

    if shift.status != "open" {
        return Err(AppError::Validation("Shift sudah ditutup".into()));
    }

    ensure_shift_owner(
        actor,
        &shift,
        "Hanya admin atau pemilik shift yang dapat mencatat arus kas di shift ini.",
    )?;

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

/// The cash moved in and out of a shift's drawer, newest first. Same rule as
/// [`summary`]: its owner or an admin.
pub async fn list_cash_flows(
    db: &DatabaseConnection,
    actor: &Actor,
    shift_id: i64,
) -> Result<Vec<CashFlowResponse>, AppError> {
    let shift = require_shift(db, shift_id).await?;
    ensure_shift_owner(
        actor,
        &shift,
        "Hanya admin atau pemilik shift yang dapat melihat arus kas shift ini.",
    )?;

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

    let shift = require_shift(db, flow.shift_id).await?;

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
        insert_refund, insert_transaction, insert_user, setup_test_db, RefundSpec,
    };
    use crate::utils::time::format_ts;

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

    /// Two opens in flight at once (a double-clicked button, or the same
    /// cashier on two devices) must still leave one open shift: both used to
    /// look, find nothing, and insert, and the stray second shift stayed open
    /// forever next to the one sales were booked to.
    #[tokio::test]
    async fn concurrent_opens_start_only_one_shift() {
        let conn = setup_test_db().await;
        let actor = Actor::new(1, "admin");

        let (first, second) =
            tokio::join!(open_shift_for(&conn, &actor), open_shift_for(&conn, &actor));

        assert_eq!(first.id, second.id);
        let open_shifts = shifts::Entity::find()
            .filter(shifts::Column::Status.eq("open"))
            .all(&conn)
            .await
            .expect("query");
        assert_eq!(open_shifts.len(), 1);
    }

    /// The database itself refuses a second open shift for the same user —
    /// the in-process mutex cannot see another process — and the refusal
    /// reaches the caller as a readable rule, not `UNIQUE constraint failed`.
    #[tokio::test]
    async fn a_second_open_shift_row_is_a_validation_error() {
        let conn = setup_test_db().await;
        let actor = Actor::new(1, "admin");

        insert_open_shift(&conn, &actor, 0.0)
            .await
            .expect("first open shift");
        match insert_open_shift(&conn, &actor, 0.0).await {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("shift yang terbuka"),
                "message should name the rule, got: {msg}"
            ),
            other => panic!("expected Validation, got {:?}", other),
        }

        // A closed shift does not count against the rule.
        let other = insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await;
        let other = Actor::from(&other);
        let first = open_shift_for(&conn, &other).await;
        close(
            &conn,
            &other,
            CloseShiftInput {
                shift_id: first.id,
                closing_cash: Some(0.0),
                notes: None,
            },
        )
        .await
        .expect("closes");
        insert_open_shift(&conn, &other, 0.0)
            .await
            .expect("a new shift after closing the last one");
    }

    /// Migration 026, replayed from the shipped file over duplicates an older
    /// install could hold. Per user, the open shift with the latest activity
    /// stays open (else the newest); the rest are closed with a note, nothing is
    /// deleted, and the unique index goes in.
    #[tokio::test]
    async fn migration_026_closes_duplicate_open_shifts_without_losing_them() {
        const MIGRATION_026: &str =
            include_str!("../../migrations/026_one_open_shift_per_user.sql");

        let conn = setup_test_db().await;
        conn.execute_unprepared("DROP INDEX idx_shifts_one_open_per_user")
            .await
            .expect("drop the index to stage duplicates");

        let kasir = insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await;
        let hours_ago = |h: i64| format_ts(chrono::Utc::now() - chrono::Duration::hours(h));
        let raw_open = |user_id: i64, opened_at: String| shifts::ActiveModel {
            id: NotSet,
            user_id: Set(user_id),
            opening_cash: Set(0.0),
            closing_cash: Set(None),
            opened_at: Set(opened_at),
            closed_at: Set(None),
            notes: Set(Some("catatan kasir".into())),
            status: Set("open".into()),
        };

        // Admin: the older shift is the one the till kept booking to.
        let admin_busy = raw_open(1, hours_ago(3))
            .insert(&conn)
            .await
            .expect("insert");
        let admin_idle = raw_open(1, hours_ago(2))
            .insert(&conn)
            .await
            .expect("insert");
        cash_flows::ActiveModel {
            id: NotSet,
            shift_id: Set(admin_busy.id),
            user_id: Set(1),
            flow_type: Set("in".into()),
            amount: Set(10_000.0),
            description: Set("Modal tambahan".into()),
            created_at: NotSet,
        }
        .insert(&conn)
        .await
        .expect("cash flow");

        // Kasir: no activity anywhere, so the newer shift stays.
        let kasir_old = raw_open(kasir.id, hours_ago(5))
            .insert(&conn)
            .await
            .expect("insert");
        let kasir_new = raw_open(kasir.id, hours_ago(4))
            .insert(&conn)
            .await
            .expect("insert");

        // Kasir two: the older shift has a sale rung up after the newer one
        // opened, so the sale decides, not the opening time.
        let kasir_two = insert_user(&conn, "kasir2", "Kasir Dua", "kasir").await;
        let kasir_two_selling = raw_open(kasir_two.id, hours_ago(6))
            .insert(&conn)
            .await
            .expect("insert");
        let kasir_two_stray = raw_open(kasir_two.id, hours_ago(5))
            .insert(&conn)
            .await
            .expect("insert");
        let sale =
            insert_transaction(&conn, kasir_two.id, 5_000.0, "completed", &hours_ago(1)).await;
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transactions SET shift_id = $1 WHERE id = $2",
            vec![kasir_two_selling.id.into(), sale.id.into()],
        ))
        .await
        .expect("book the sale to the older shift");

        conn.execute_unprepared(MIGRATION_026)
            .await
            .expect("the migration runs over duplicates");

        let reload = |id: i64| {
            let conn = &conn;
            async move {
                shifts::Entity::find_by_id(id)
                    .one(conn)
                    .await
                    .expect("query")
                    .expect("the shift still exists")
            }
        };
        assert_eq!(reload(admin_busy.id).await.status, "open");
        assert_eq!(reload(kasir_new.id).await.status, "open");
        assert_eq!(reload(kasir_two_selling.id).await.status, "open");
        for closed_id in [admin_idle.id, kasir_old.id, kasir_two_stray.id] {
            let closed = reload(closed_id).await;
            assert_eq!(closed.status, "closed");
            assert!(closed.closed_at.is_some());
            assert_eq!(closed.closing_cash, None, "nobody counted that drawer");
            let notes = closed.notes.expect("notes");
            assert!(notes.starts_with("catatan kasir\n"), "keeps the old note");
            assert!(notes.contains("Ditutup otomatis"));
        }

        let still_open = insert_open_shift(&conn, &Actor::new(1, "admin"), 0.0).await;
        assert!(
            matches!(still_open, Err(AppError::Validation(_))),
            "the index is in place after the cleanup"
        );
    }

    /// Reading a shift's figures follows the same rule as closing it.
    #[tokio::test]
    async fn a_cashier_cannot_read_another_cashiers_shift() {
        let conn = setup_test_db().await;
        let owner = Actor::from(&insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await);
        let other = Actor::from(&insert_user(&conn, "kasir2", "Kasir Dua", "kasir").await);
        let shift = open_shift_for(&conn, &owner).await;

        assert!(matches!(
            summary(&conn, &other, shift.id).await,
            Err(AppError::Forbidden(_))
        ));
        assert!(matches!(
            list_cash_flows(&conn, &other, shift.id).await,
            Err(AppError::Forbidden(_))
        ));

        summary(&conn, &owner, shift.id)
            .await
            .expect("the owner reads");
        list_cash_flows(&conn, &Actor::new(1, "admin"), shift.id)
            .await
            .expect("an admin reads");
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

        let report = summary(&conn, &actor, shift.id).await.expect("summary");
        assert_eq!(report.cash_refunds, 50_000.0);
        assert_eq!(report.expected_cash, 450_000.0);
    }

    /// A cash sale refunded in full within the same shift nets to nothing: the
    /// money came in and went back out. The summary used to drop the refunded
    /// sale *and* subtract the payout, reporting an honest drawer short.
    #[tokio::test]
    async fn a_sale_refunded_in_full_in_the_same_shift_nets_to_zero() {
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

        let sale = insert_transaction(&conn, 1, 10_000.0, "refunded", &now_ts()).await;
        let mut booked: crate::entity::transactions::ActiveModel = sale.clone().into();
        booked.shift_id = Set(Some(shift.id));
        booked
            .update(&conn)
            .await
            .expect("sale booked to the shift");
        insert_refund(
            &conn,
            RefundSpec {
                transaction_id: sale.id,
                user_id: 1,
                refund_type: "refund",
                total_refund_amount: 10_000.0,
                total_exchange_amount: 0.0,
                difference_amount: 10_000.0,
                payment_method: "cash",
                shift_id: Some(shift.id),
                created_at: &now_ts(),
            },
        )
        .await;

        let report = summary(&conn, &actor, shift.id).await.expect("summary");
        assert_eq!(report.total_sales, 10_000.0);
        assert_eq!(report.cash_refunds, 10_000.0);
        assert_eq!(report.expected_cash, 500_000.0);
    }

    /// Only the owner or an admin may close a shift or book cash against it.
    #[tokio::test]
    async fn a_cashier_cannot_close_or_book_cash_on_another_cashiers_shift() {
        let conn = setup_test_db().await;
        let owner = insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await;
        let other = Actor::from(&insert_user(&conn, "kasir2", "Kasir Dua", "kasir").await);
        let shift = open_shift_for(&conn, &Actor::from(&owner)).await;

        let booked = create_cash_flow(
            &conn,
            &other,
            CreateCashFlowInput {
                shift_id: shift.id,
                flow_type: "out".into(),
                amount: 500_000.0,
                description: "Ambil kas".into(),
            },
        )
        .await;
        assert!(matches!(booked, Err(AppError::Forbidden(_))));

        let closed = close(
            &conn,
            &other,
            CloseShiftInput {
                shift_id: shift.id,
                closing_cash: Some(0.0),
                notes: None,
            },
        )
        .await;
        assert!(matches!(closed, Err(AppError::Forbidden(_))));

        close(
            &conn,
            &Actor::new(1, "admin"),
            CloseShiftInput {
                shift_id: shift.id,
                closing_cash: Some(0.0),
                notes: None,
            },
        )
        .await
        .expect("an admin may close anyone's shift");
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

        let report = summary(&conn, &actor, shift.id).await.expect("summary");
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

        let report = summary(&conn, &actor, shift.id).await.expect("summary");
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

        let report = summary(&conn, &Actor::new(1, "admin"), mine.id)
            .await
            .expect("summary");
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
        let during = now_ts();
        let before = format_ts(chrono::Utc::now() - chrono::Duration::days(3));

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
