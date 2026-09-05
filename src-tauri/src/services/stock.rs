//! Stock write-offs: damaged, expired, lost or otherwise unsellable units.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, QueryFilter, Set, Statement, TransactionTrait,
};

use crate::domain::stock::{
    CreateWriteoffInput, ListWriteoffsInput, ListWriteoffsResult, StockWriteoffResponse,
};
use crate::domain::Actor;
use crate::entity::{products, stock_writeoffs, users};
use crate::services::guard;
use crate::utils::AppError;

const VALID_REASONS: &[&str] = &["damaged", "expired", "lost", "other"];

/// Timestamp for every `created_at`/`updated_at` this module writes.
///
/// MUST stay UTC. Every reader of `stock_writeoffs.created_at`
/// ([`list`] below, `reports::query_losses`) converts a local calendar date into
/// a UTC boundary before comparing, and the refund path writes `Utc::now()` into
/// the same column. This used to be `Local::now()`, which put a WIB write-off
/// made after 17:00 into the next day's report; migration 019 shifts the rows
/// that were written that way.
fn now_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

async fn generate_writeoff_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    // Deliberately local: `WO-YYYYMMDD-XXXX` is a human-facing document number
    // keyed to the shop's business day, not an instant. `refunds.rs` numbers
    // `RFD-` the same way.
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let prefix = format!("WO-{}-", today);

    let result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT MAX(CAST(SUBSTR(writeoff_number, LENGTH(?) + 1) AS INTEGER)) as max_num FROM stock_writeoffs WHERE writeoff_number LIKE ?",
            vec![prefix.clone().into(), format!("{}%", prefix).into()],
        ))
        .await?;

    let max_num: i64 = result
        .map(|r| r.try_get::<i64>("", "max_num").unwrap_or(0))
        .unwrap_or(0);

    Ok(format!("{}{:04}", prefix, max_num + 1))
}

/// Display name for a user id. Used for the actor, whose row the transport layer
/// has just resolved, so the empty fallback is unreachable in practice.
async fn user_full_name(db: &DatabaseConnection, user_id: i64) -> Result<String, AppError> {
    Ok(users::Entity::find_by_id(user_id)
        .one(db)
        .await?
        .map(|u| u.full_name)
        .unwrap_or_default())
}

async fn product_name(db: &DatabaseConnection, product_id: i64) -> Result<String, AppError> {
    Ok(products::Entity::find_by_id(product_id)
        .one(db)
        .await?
        .map(|p| p.name)
        .unwrap_or_else(|| "(dihapus)".to_string()))
}

async fn cashier_name(db: &DatabaseConnection, user_id: i64) -> Result<String, AppError> {
    Ok(users::Entity::find_by_id(user_id)
        .one(db)
        .await?
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".to_string()))
}

pub async fn list(
    db: &DatabaseConnection,
    input: ListWriteoffsInput,
) -> Result<ListWriteoffsResult, AppError> {
    let page = input.page.unwrap_or(1).max(1);
    let per_page = input.per_page.unwrap_or(50).max(1);
    let offset = (page - 1) * per_page;

    let offset_secs = chrono::Local::now().offset().local_minus_utc() as i64;

    let mut conditions = String::from("WHERE 1=1");
    let mut params: Vec<sea_orm::Value> = Vec::new();

    if let Some(ref status) = input.status {
        if !status.is_empty() {
            conditions.push_str(" AND w.status = ?");
            params.push(status.clone().into());
        }
    }

    if let Some(ref reason) = input.reason {
        if !reason.is_empty() {
            conditions.push_str(" AND w.reason = ?");
            params.push(reason.clone().into());
        }
    }

    if let Some(ref date_from) = input.date_from {
        let local_start = format!("{} 00:00:00", date_from);
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&local_start, "%Y-%m-%d %H:%M:%S") {
            let utc_start = ndt - chrono::Duration::seconds(offset_secs);
            conditions.push_str(" AND w.created_at >= ?");
            params.push(utc_start.format("%Y-%m-%d %H:%M:%S").to_string().into());
        }
    }

    if let Some(ref date_to) = input.date_to {
        let local_end = format!("{} 23:59:59", date_to);
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&local_end, "%Y-%m-%d %H:%M:%S") {
            let utc_end = ndt - chrono::Duration::seconds(offset_secs);
            conditions.push_str(" AND w.created_at <= ?");
            params.push(utc_end.format("%Y-%m-%d %H:%M:%S").to_string().into());
        }
    }

    // Count query
    let count_sql = format!(
        "SELECT COUNT(*) as cnt FROM stock_writeoffs w {}",
        conditions
    );

    let count_result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &count_sql,
            params.clone(),
        ))
        .await?;

    let total: i64 = count_result
        .map(|r| r.try_get::<i64>("", "cnt").unwrap_or(0))
        .unwrap_or(0);

    let total_pages = if total == 0 {
        0
    } else {
        ((total as f64) / (per_page as f64)).ceil() as i64
    };

    // Data query with JOINs
    let data_sql = format!(
        "SELECT w.id, w.writeoff_number, w.product_id, w.user_id, w.quantity, \
         w.reason, w.loss_value, w.notes, w.approved_by, w.status, \
         w.refund_id, w.created_at, \
         p.name as product_name, \
         u.full_name as cashier_name, \
         a.full_name as approver_name \
         FROM stock_writeoffs w \
         LEFT JOIN products p ON w.product_id = p.id \
         LEFT JOIN users u ON w.user_id = u.id \
         LEFT JOIN users a ON w.approved_by = a.id \
         {} \
         ORDER BY w.created_at DESC \
         LIMIT ? OFFSET ?",
        conditions
    );

    params.push(per_page.into());
    params.push(offset.into());

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &data_sql,
            params,
        ))
        .await?;

    let mut items: Vec<StockWriteoffResponse> = Vec::new();
    for row in rows {
        items.push(StockWriteoffResponse {
            id: row.try_get::<i64>("", "id").unwrap_or(0),
            writeoff_number: row
                .try_get::<String>("", "writeoff_number")
                .unwrap_or_default(),
            product_id: row.try_get::<i64>("", "product_id").unwrap_or(0),
            product_name: row
                .try_get::<String>("", "product_name")
                .unwrap_or_else(|_| "(dihapus)".to_string()),
            user_id: row.try_get::<i64>("", "user_id").unwrap_or(0),
            cashier_name: row
                .try_get::<String>("", "cashier_name")
                .unwrap_or_default(),
            quantity: row.try_get::<i64>("", "quantity").unwrap_or(0),
            reason: row.try_get::<String>("", "reason").unwrap_or_default(),
            loss_value: row.try_get::<f64>("", "loss_value").unwrap_or(0.0),
            notes: row.try_get::<String>("", "notes").ok(),
            approved_by: row.try_get::<i64>("", "approved_by").ok(),
            approver_name: row.try_get::<String>("", "approver_name").ok(),
            status: row.try_get::<String>("", "status").unwrap_or_default(),
            refund_id: row.try_get::<i64>("", "refund_id").ok(),
            created_at: row.try_get::<String>("", "created_at").unwrap_or_default(),
        });
    }

    Ok(ListWriteoffsResult {
        items,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Record a write-off and deduct the units straight away.
///
/// APPROVAL FOLLOWS THE REASON, NOT THE ROLE
///
/// `CLAUDE.md` says a cashier may write off damaged or expired goods directly,
/// because the broken bottle is sitting in the storeroom for anyone to look at,
/// and that only `lost` — which has no physical evidence — needs an admin. The
/// code did the opposite: every cashier write-off was forced to `pending`
/// whatever the reason, while the stock was deducted immediately anyway. So the
/// shelf count moved, the loss report did not (it counts `approved` rows only),
/// and the cashier got a success toast for something that had not happened. The
/// approval step guarded nothing: the units were already gone, and rejecting the
/// row is what put them back.
///
/// So:
///   * `damaged`, `expired` — approved on creation, whoever the caller is.
///   * `lost` — admin only, and approved on creation like any other admin action.
///   * `other` — approved on creation for a cashier too, but it is the one reason
///     with no stated evidence rule, so it stays reviewable: it is recorded
///     against the cashier who raised it, `notes` carries their explanation, and
///     an admin can see it in the loss report next to everything else. Holding it
///     `pending` instead would reintroduce exactly the split this fixes — stock
///     down, loss unreported — for the vaguest category of all, which is the
///     worst place to hide a discrepancy.
///
/// Nothing lands `pending` from this path any more. `approve`/`reject` stay for
/// the rows already sitting in that state.
pub async fn create(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateWriteoffInput,
) -> Result<StockWriteoffResponse, AppError> {
    if !VALID_REASONS.contains(&input.reason.as_str()) {
        return Err(AppError::Validation(format!(
            "Alasan tidak valid: '{}'. Harus salah satu dari: damaged, expired, lost, other",
            input.reason
        )));
    }

    if input.quantity <= 0 {
        return Err(AppError::Validation(
            "Jumlah write-off harus lebih dari 0".into(),
        ));
    }

    if input.reason == "lost" && !actor.is_admin() {
        return Err(AppError::Forbidden(
            "Hanya admin yang dapat melakukan write-off barang hilang".into(),
        ));
    }

    let actor_name = user_full_name(db, actor.user_id).await?;

    let txn = db.begin().await?;

    // Validate product exists and is active
    let product = products::Entity::find_by_id(input.product_id)
        .filter(products::Column::IsActive.eq(true))
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan atau tidak aktif".into()))?;

    // Validate quantity does not exceed stock
    if input.quantity > product.stock {
        return Err(AppError::Validation(format!(
            "Jumlah write-off ({}) melebihi stok tersedia ({})",
            input.quantity, product.stock
        )));
    }

    let now = now_timestamp();
    let writeoff_number = generate_writeoff_number(&txn).await?;
    let loss_value = product.buy_price * input.quantity as f64;

    // Approved on the spot, by the actor who raised it. See the doc comment
    // above for why the reason, not the role, is what decides this.
    let (status, approved_by) = ("approved".to_string(), Some(actor.user_id));

    let new_writeoff = stock_writeoffs::ActiveModel {
        id: NotSet,
        writeoff_number: Set(writeoff_number),
        product_id: Set(input.product_id),
        user_id: Set(actor.user_id),
        quantity: Set(input.quantity),
        reason: Set(input.reason),
        loss_value: Set(loss_value),
        notes: Set(input.notes),
        approved_by: Set(approved_by),
        status: Set(status),
        refund_id: Set(None),
        created_at: Set(Some(now.clone())),
    };

    let writeoff = new_writeoff.insert(&txn).await?;

    // Reduce stock immediately
    txn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?",
        vec![
            input.quantity.into(),
            now.clone().into(),
            input.product_id.into(),
        ],
    ))
    .await?;

    txn.commit().await?;

    Ok(StockWriteoffResponse {
        id: writeoff.id,
        writeoff_number: writeoff.writeoff_number,
        product_id: writeoff.product_id,
        product_name: product.name,
        user_id: writeoff.user_id,
        cashier_name: actor_name.clone(),
        quantity: writeoff.quantity,
        reason: writeoff.reason,
        loss_value: writeoff.loss_value,
        notes: writeoff.notes,
        approved_by: writeoff.approved_by,
        approver_name: if writeoff.approved_by.is_some() {
            Some(actor_name)
        } else {
            None
        },
        status: writeoff.status,
        refund_id: writeoff.refund_id,
        created_at: writeoff.created_at.unwrap_or_default(),
    })
}

pub async fn approve(
    db: &DatabaseConnection,
    actor: &Actor,
    writeoff_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    guard::require_admin(actor)?;

    let writeoff = stock_writeoffs::Entity::find_by_id(writeoff_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Data write-off tidak ditemukan".into()))?;

    if writeoff.status != "pending" {
        return Err(AppError::Validation(format!(
            "Write-off tidak bisa disetujui karena statusnya '{}', bukan 'pending'",
            writeoff.status
        )));
    }

    let mut active: stock_writeoffs::ActiveModel = writeoff.into();
    active.status = Set("approved".to_string());
    active.approved_by = Set(Some(actor.user_id));
    let updated = active.update(db).await?;

    // Stock was already reduced at creation, so approving changes nothing else.

    Ok(StockWriteoffResponse {
        id: updated.id,
        writeoff_number: updated.writeoff_number,
        product_id: updated.product_id,
        product_name: product_name(db, updated.product_id).await?,
        user_id: updated.user_id,
        cashier_name: cashier_name(db, updated.user_id).await?,
        quantity: updated.quantity,
        reason: updated.reason,
        loss_value: updated.loss_value,
        notes: updated.notes,
        approved_by: updated.approved_by,
        approver_name: Some(user_full_name(db, actor.user_id).await?),
        status: updated.status,
        refund_id: updated.refund_id,
        created_at: updated.created_at.unwrap_or_default(),
    })
}

pub async fn reject(
    db: &DatabaseConnection,
    actor: &Actor,
    writeoff_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    guard::require_admin(actor)?;

    let writeoff = stock_writeoffs::Entity::find_by_id(writeoff_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Data write-off tidak ditemukan".into()))?;

    if writeoff.status != "pending" {
        return Err(AppError::Validation(format!(
            "Write-off tidak bisa ditolak karena statusnya '{}', bukan 'pending'",
            writeoff.status
        )));
    }

    let now = now_timestamp();
    let txn = db.begin().await?;

    let mut active: stock_writeoffs::ActiveModel = writeoff.clone().into();
    active.status = Set("rejected".to_string());
    active.approved_by = Set(Some(actor.user_id));
    let updated = active.update(&txn).await?;

    // Restore stock only for manual write-offs that actually deducted stock at
    // creation. Refund-originated write-offs (refund_id set) were inserted
    // WITHOUT deducting stock — the unit was already removed at sale time — so
    // restoring here would inflate stock. Mirrors `delete`'s guard.
    if writeoff.refund_id.is_none() {
        txn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?",
            vec![
                writeoff.quantity.into(),
                now.into(),
                writeoff.product_id.into(),
            ],
        ))
        .await?;
    }

    txn.commit().await?;

    Ok(StockWriteoffResponse {
        id: updated.id,
        writeoff_number: updated.writeoff_number,
        product_id: updated.product_id,
        product_name: product_name(db, updated.product_id).await?,
        user_id: updated.user_id,
        cashier_name: cashier_name(db, updated.user_id).await?,
        quantity: updated.quantity,
        reason: updated.reason,
        loss_value: updated.loss_value,
        notes: updated.notes,
        approved_by: updated.approved_by,
        approver_name: Some(user_full_name(db, actor.user_id).await?),
        status: updated.status,
        refund_id: updated.refund_id,
        created_at: updated.created_at.unwrap_or_default(),
    })
}

pub async fn delete(
    db: &DatabaseConnection,
    actor: &Actor,
    writeoff_id: i64,
) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    let writeoff = stock_writeoffs::Entity::find_by_id(writeoff_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Data write-off tidak ditemukan".into()))?;

    if writeoff.status != "pending" {
        return Err(AppError::Validation(
            "Hanya write-off dengan status 'pending' yang dapat dihapus".into(),
        ));
    }

    if writeoff.refund_id.is_some() {
        return Err(AppError::Validation(
            "Write-off yang berasal dari refund tidak dapat dihapus".into(),
        ));
    }

    let now = now_timestamp();
    let txn = db.begin().await?;

    // Restore stock before deleting
    txn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?",
        vec![
            writeoff.quantity.into(),
            now.into(),
            writeoff.product_id.into(),
        ],
    ))
    .await?;

    stock_writeoffs::Entity::delete_by_id(writeoff_id)
        .exec(&txn)
        .await?;

    txn.commit().await?;

    Ok(())
}

pub async fn detail(
    db: &DatabaseConnection,
    writeoff_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    let sql = r#"
        SELECT w.id, w.writeoff_number, w.product_id, w.user_id, w.quantity,
               w.reason, w.loss_value, w.notes, w.approved_by, w.status,
               w.refund_id, w.created_at,
               p.name as product_name,
               u.full_name as cashier_name,
               a.full_name as approver_name
        FROM stock_writeoffs w
        LEFT JOIN products p ON w.product_id = p.id
        LEFT JOIN users u ON w.user_id = u.id
        LEFT JOIN users a ON w.approved_by = a.id
        WHERE w.id = ?
    "#;

    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            sql,
            vec![writeoff_id.into()],
        ))
        .await?
        .ok_or_else(|| AppError::NotFound("Data write-off tidak ditemukan".into()))?;

    Ok(StockWriteoffResponse {
        id: row.try_get::<i64>("", "id").unwrap_or(0),
        writeoff_number: row
            .try_get::<String>("", "writeoff_number")
            .unwrap_or_default(),
        product_id: row.try_get::<i64>("", "product_id").unwrap_or(0),
        product_name: row
            .try_get::<String>("", "product_name")
            .unwrap_or_else(|_| "(dihapus)".to_string()),
        user_id: row.try_get::<i64>("", "user_id").unwrap_or(0),
        cashier_name: row
            .try_get::<String>("", "cashier_name")
            .unwrap_or_default(),
        quantity: row.try_get::<i64>("", "quantity").unwrap_or(0),
        reason: row.try_get::<String>("", "reason").unwrap_or_default(),
        loss_value: row.try_get::<f64>("", "loss_value").unwrap_or(0.0),
        notes: row.try_get::<String>("", "notes").ok(),
        approved_by: row.try_get::<i64>("", "approved_by").ok(),
        approver_name: row.try_get::<String>("", "approver_name").ok(),
        status: row.try_get::<String>("", "status").unwrap_or_default(),
        refund_id: row.try_get::<i64>("", "refund_id").ok(),
        created_at: row.try_get::<String>("", "created_at").unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        insert_product, insert_transaction, insert_user, insert_writeoff, now_ts, setup_test_db,
        WriteoffSpec,
    };
    use chrono::{Local, NaiveDateTime, TimeZone, Utc};

    /// The exact SQL shipped as migration 019, so the test exercises the file
    /// that actually runs on a user's database rather than a copy of it.
    const MIGRATION_019: &str =
        include_str!("../../migrations/019_stock_writeoff_created_at_utc.sql");

    /// B22: `stock_writeoffs.created_at` is filtered as UTC by [`list`] and
    /// `reports::query_losses`, and the refund path writes UTC into the same
    /// column, so the manual path must too.
    #[test]
    fn now_timestamp_is_utc() {
        let parsed = NaiveDateTime::parse_from_str(&now_timestamp(), "%Y-%m-%d %H:%M:%S")
            .expect("timestamp is in the stored format");
        let drift = (Utc::now().naive_utc() - parsed).num_seconds().abs();
        assert!(
            drift <= 5,
            "now_timestamp() drifted {}s from UTC — it is writing local time",
            drift
        );
    }

    /// Migration 019 must shift the rows the manual path wrote in local time and
    /// leave the refund-originated rows, which were always UTC, exactly as they
    /// are. Noon is used so the expectation is unambiguous even in a timezone
    /// with DST.
    #[tokio::test]
    async fn migration_019_shifts_manual_writeoffs_only() {
        let conn = setup_test_db().await;
        let product = insert_product(&conn, "Beras 5kg", 10_000.0, 12_000.0, 10).await;
        let txn = insert_transaction(&conn, 1, 12_000.0, "completed", &now_ts()).await;

        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO refunds (id, refund_number, transaction_id, user_id, type, \
             total_refund_amount, created_at) VALUES (1, 'RFD-TEST-019', $1, 1, 'refund', 12000, $2)",
            vec![txn.id.into(), now_ts().into()],
        ))
        .await
        .expect("refund insert");

        let stored = "2026-09-05 12:00:00";

        let manual = insert_writeoff(
            &conn,
            WriteoffSpec {
                product_id: product.id,
                user_id: 1,
                quantity: 1,
                reason: "damaged",
                loss_value: 10_000.0,
                status: "approved",
                created_at: stored,
            },
        )
        .await;

        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO stock_writeoffs (writeoff_number, product_id, user_id, quantity, reason, \
             loss_value, status, refund_id, created_at) \
             VALUES ('WO-TEST-019-R', $1, 1, 1, 'damaged', 10000, 'pending', 1, $2)",
            vec![product.id.into(), stored.into()],
        ))
        .await
        .expect("refund-originated writeoff insert");

        conn.execute_unprepared(MIGRATION_019)
            .await
            .expect("migration 019 runs");

        let naive = NaiveDateTime::parse_from_str(stored, "%Y-%m-%d %H:%M:%S").unwrap();
        let expected = Local
            .from_local_datetime(&naive)
            .single()
            .expect("noon is never ambiguous")
            .naive_utc()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();

        let shifted = stock_writeoffs::Entity::find_by_id(manual.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("manual row");
        assert_eq!(shifted.created_at.as_deref(), Some(expected.as_str()));

        let untouched = stock_writeoffs::Entity::find()
            .filter(stock_writeoffs::Column::RefundId.eq(1_i64))
            .one(&conn)
            .await
            .expect("query")
            .expect("refund row");
        assert_eq!(
            untouched.created_at.as_deref(),
            Some(stored),
            "refund-originated rows were already UTC and must not be shifted"
        );
    }

    /// A kasir has no physical evidence for a lost item, so only an admin may
    /// record one. The check runs before any row is touched.
    #[tokio::test]
    async fn kasir_cannot_write_off_a_lost_item() {
        let conn = setup_test_db().await;
        let product = insert_product(&conn, "Beras 5kg", 10_000.0, 12_000.0, 10).await;

        let result = create(
            &conn,
            &Actor::new(2, "kasir"),
            CreateWriteoffInput {
                product_id: product.id,
                quantity: 1,
                reason: "lost".into(),
                notes: None,
            },
        )
        .await;

        match result.unwrap_err() {
            AppError::Forbidden(msg) => assert!(msg.contains("admin")),
            other => panic!("expected Forbidden, got {:?}", other),
        }
    }

    /// `CLAUDE.md`: a cashier may write off damaged or expired goods directly,
    /// because the evidence is in the storeroom. The stock comes off at
    /// creation, so leaving the row `pending` only meant the loss report
    /// disagreed with the shelf until an admin got round to it.
    #[tokio::test]
    async fn a_kasir_writeoff_of_damaged_goods_is_approved_on_creation() {
        let conn = setup_test_db().await;
        let product = insert_product(&conn, "Beras 5kg", 10_000.0, 12_000.0, 10).await;
        let kasir = insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await;

        let by_kasir = create(
            &conn,
            &Actor::from(&kasir),
            CreateWriteoffInput {
                product_id: product.id,
                quantity: 2,
                reason: "damaged".into(),
                notes: None,
            },
        )
        .await
        .expect("kasir may write off damaged goods");
        assert_eq!(by_kasir.status, "approved");
        assert_eq!(by_kasir.approved_by, Some(kasir.id));
        assert_eq!(by_kasir.loss_value, 20_000.0);

        let by_admin = create(
            &conn,
            &Actor::new(1, "admin"),
            CreateWriteoffInput {
                product_id: product.id,
                quantity: 1,
                reason: "lost".into(),
                notes: None,
            },
        )
        .await
        .expect("admin may write off a lost item");
        assert_eq!(by_admin.status, "approved");
        assert_eq!(by_admin.approved_by, Some(1));

        // Both deducted stock straight away: 10 - 2 - 1.
        let after = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("product");
        assert_eq!(after.stock, 7);
    }

    /// `expired` follows the same evidence rule as `damaged`, and `other` is
    /// approved too rather than parking the stock deduction behind a status the
    /// loss report ignores. Every reason a cashier is allowed to use lands
    /// straight in the loss report.
    #[tokio::test]
    async fn every_reason_a_kasir_may_use_is_approved_and_reported() {
        let conn = setup_test_db().await;
        let kasir = insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await;

        for reason in ["expired", "other"] {
            let product = insert_product(&conn, reason, 4_000.0, 6_000.0, 10).await;
            let writeoff = create(
                &conn,
                &Actor::from(&kasir),
                CreateWriteoffInput {
                    product_id: product.id,
                    quantity: 3,
                    reason: reason.into(),
                    notes: Some("Ditemukan saat stock opname".into()),
                },
            )
            .await
            .unwrap_or_else(|e| panic!("kasir may write off '{}': {:?}", reason, e));

            assert_eq!(writeoff.status, "approved", "reason '{}'", reason);
            assert_eq!(writeoff.approved_by, Some(kasir.id), "reason '{}'", reason);
            assert_eq!(writeoff.user_id, kasir.id, "reason '{}'", reason);
        }
    }
}
