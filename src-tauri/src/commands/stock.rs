use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, QueryFilter, Set, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::entity::{products, stock_writeoffs};
use crate::utils::{require_role, AppError};

const VALID_REASONS: &[&str] = &["damaged", "expired", "lost", "other"];

// --- Input DTOs ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWriteoffInput {
    pub product_id: i64,
    pub quantity: i64,
    pub reason: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWriteoffsInput {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub status: Option<String>,
    pub reason: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

// --- Output DTOs ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockWriteoffResponse {
    pub id: i64,
    pub writeoff_number: String,
    pub product_id: i64,
    pub product_name: String,
    pub user_id: i64,
    pub cashier_name: String,
    pub quantity: i64,
    pub reason: String,
    pub loss_value: f64,
    pub notes: Option<String>,
    pub approved_by: Option<i64>,
    pub approver_name: Option<String>,
    pub status: String,
    pub refund_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWriteoffsResult {
    pub items: Vec<StockWriteoffResponse>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}

// --- Helpers ---

fn now_timestamp() -> String {
    chrono::Local::now()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

async fn generate_writeoff_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
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

// --- Commands ---

#[tauri::command]
pub async fn list_stock_writeoffs(
    db: State<'_, DatabaseConnection>,
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
        if let Ok(ndt) =
            chrono::NaiveDateTime::parse_from_str(&local_start, "%Y-%m-%d %H:%M:%S")
        {
            let utc_start = ndt - chrono::Duration::seconds(offset_secs);
            conditions.push_str(" AND w.created_at >= ?");
            params.push(utc_start.format("%Y-%m-%d %H:%M:%S").to_string().into());
        }
    }

    if let Some(ref date_to) = input.date_to {
        let local_end = format!("{} 23:59:59", date_to);
        if let Ok(ndt) =
            chrono::NaiveDateTime::parse_from_str(&local_end, "%Y-%m-%d %H:%M:%S")
        {
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
        .inner()
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
        .inner()
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
            created_at: row
                .try_get::<String>("", "created_at")
                .unwrap_or_default(),
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

#[tauri::command]
pub async fn create_stock_writeoff(
    db: State<'_, DatabaseConnection>,
    input: CreateWriteoffInput,
    caller_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    // Validate reason
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

    // Auth: check caller role
    let caller = require_role(db.inner(), caller_id, "any").await?;

    // "lost" write-off requires admin
    if input.reason == "lost" && caller.role != "admin" {
        return Err(AppError::Forbidden(
            "Hanya admin yang dapat melakukan write-off barang hilang".into(),
        ));
    }

    let txn = db.inner().begin().await?;

    // Validate product exists and is active
    let product = products::Entity::find_by_id(input.product_id)
        .filter(products::Column::IsActive.eq(true))
        .one(&txn)
        .await?
        .ok_or_else(|| {
            AppError::NotFound("Produk tidak ditemukan atau tidak aktif".into())
        })?;

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

    // Status logic
    let (status, approved_by) = if caller.role == "admin" {
        // Admin: auto-approved
        ("approved".to_string(), Some(caller_id))
    } else {
        // Kasir: pending approval
        ("pending".to_string(), None)
    };

    // Insert write-off record
    let new_writeoff = stock_writeoffs::ActiveModel {
        id: NotSet,
        writeoff_number: Set(writeoff_number),
        product_id: Set(input.product_id),
        user_id: Set(caller_id),
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
            (input.quantity as i64).into(),
            now.clone().into(),
            input.product_id.into(),
        ],
    ))
    .await?;

    let caller_name = caller.full_name.clone();

    txn.commit().await?;

    Ok(StockWriteoffResponse {
        id: writeoff.id,
        writeoff_number: writeoff.writeoff_number,
        product_id: writeoff.product_id,
        product_name: product.name,
        user_id: writeoff.user_id,
        cashier_name: caller.full_name,
        quantity: writeoff.quantity,
        reason: writeoff.reason,
        loss_value: writeoff.loss_value,
        notes: writeoff.notes,
        approved_by: writeoff.approved_by,
        approver_name: if writeoff.approved_by.is_some() {
            Some(caller_name)
        } else {
            None
        },
        status: writeoff.status,
        refund_id: writeoff.refund_id,
        created_at: writeoff.created_at.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn approve_stock_writeoff(
    db: State<'_, DatabaseConnection>,
    writeoff_id: i64,
    caller_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    let caller = require_role(db.inner(), caller_id, "admin").await?;

    let writeoff = stock_writeoffs::Entity::find_by_id(writeoff_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Data write-off tidak ditemukan".into()))?;

    if writeoff.status != "pending" {
        return Err(AppError::Validation(format!(
            "Write-off tidak bisa disetujui karena statusnya '{}', bukan 'pending'",
            writeoff.status
        )));
    }

    let now = now_timestamp();

    // Update status
    let mut active: stock_writeoffs::ActiveModel = writeoff.clone().into();
    active.status = Set("approved".to_string());
    active.approved_by = Set(Some(caller_id));
    let updated = active.update(db.inner()).await?;

    // Get product name
    let product = products::Entity::find_by_id(updated.product_id)
        .one(db.inner())
        .await?;
    let product_name = product
        .map(|p| p.name)
        .unwrap_or_else(|| "(dihapus)".to_string());

    // Get cashier name
    let user = crate::entity::users::Entity::find_by_id(updated.user_id)
        .one(db.inner())
        .await?;
    let cashier_name = user
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".to_string());

    // Stock already reduced at creation — no further change needed
    // Suppress unused variable warning; `now` kept for clarity
    let _ = now;

    Ok(StockWriteoffResponse {
        id: updated.id,
        writeoff_number: updated.writeoff_number,
        product_id: updated.product_id,
        product_name,
        user_id: updated.user_id,
        cashier_name,
        quantity: updated.quantity,
        reason: updated.reason,
        loss_value: updated.loss_value,
        notes: updated.notes,
        approved_by: updated.approved_by,
        approver_name: Some(caller.full_name),
        status: updated.status,
        refund_id: updated.refund_id,
        created_at: updated.created_at.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn reject_stock_writeoff(
    db: State<'_, DatabaseConnection>,
    writeoff_id: i64,
    caller_id: i64,
) -> Result<StockWriteoffResponse, AppError> {
    let caller = require_role(db.inner(), caller_id, "admin").await?;

    let writeoff = stock_writeoffs::Entity::find_by_id(writeoff_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Data write-off tidak ditemukan".into()))?;

    if writeoff.status != "pending" {
        return Err(AppError::Validation(format!(
            "Write-off tidak bisa ditolak karena statusnya '{}', bukan 'pending'",
            writeoff.status
        )));
    }

    let now = now_timestamp();
    let txn = db.inner().begin().await?;

    // Update status to rejected
    let mut active: stock_writeoffs::ActiveModel = writeoff.clone().into();
    active.status = Set("rejected".to_string());
    active.approved_by = Set(Some(caller_id));
    let updated = active.update(&txn).await?;

    // Restore stock only for manual write-offs that actually deducted stock at
    // creation. Refund-originated write-offs (refund_id set) were inserted
    // WITHOUT deducting stock — the unit was already removed at sale time — so
    // restoring here would inflate stock. Mirrors delete_stock_writeoff's guard.
    if writeoff.refund_id.is_none() {
        txn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?",
            vec![
                (writeoff.quantity as i64).into(),
                now.into(),
                writeoff.product_id.into(),
            ],
        ))
        .await?;
    }

    txn.commit().await?;

    // Get product name
    let product = products::Entity::find_by_id(updated.product_id)
        .one(db.inner())
        .await?;
    let product_name = product
        .map(|p| p.name)
        .unwrap_or_else(|| "(dihapus)".to_string());

    // Get cashier name
    let user = crate::entity::users::Entity::find_by_id(updated.user_id)
        .one(db.inner())
        .await?;
    let cashier_name = user
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".to_string());

    Ok(StockWriteoffResponse {
        id: updated.id,
        writeoff_number: updated.writeoff_number,
        product_id: updated.product_id,
        product_name,
        user_id: updated.user_id,
        cashier_name,
        quantity: updated.quantity,
        reason: updated.reason,
        loss_value: updated.loss_value,
        notes: updated.notes,
        approved_by: updated.approved_by,
        approver_name: Some(caller.full_name),
        status: updated.status,
        refund_id: updated.refund_id,
        created_at: updated.created_at.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn delete_stock_writeoff(
    db: State<'_, DatabaseConnection>,
    writeoff_id: i64,
    caller_id: i64,
) -> Result<(), AppError> {
    require_role(db.inner(), caller_id, "admin").await?;

    let writeoff = stock_writeoffs::Entity::find_by_id(writeoff_id)
        .one(db.inner())
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
    let txn = db.inner().begin().await?;

    // Restore stock before deleting
    txn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?",
        vec![
            (writeoff.quantity as i64).into(),
            now.into(),
            writeoff.product_id.into(),
        ],
    ))
    .await?;

    // Delete the row
    stock_writeoffs::Entity::delete_by_id(writeoff_id)
        .exec(&txn)
        .await?;

    txn.commit().await?;

    Ok(())
}

#[tauri::command]
pub async fn get_stock_writeoff_detail(
    db: State<'_, DatabaseConnection>,
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
        .inner()
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
        created_at: row
            .try_get::<String>("", "created_at")
            .unwrap_or_default(),
    })
}
