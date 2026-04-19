use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, Order, QueryFilter, QueryOrder, Set, Statement,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::entity::{cash_flows, shifts, users};
use crate::utils::{require_role, AppError};

async fn get_user_name(db: &DatabaseConnection, user_id: i64) -> String {
    users::Entity::find_by_id(user_id)
        .one(db)
        .await
        .ok()
        .flatten()
        .map(|u| u.full_name)
        .unwrap_or_default()
}

// ─── Open Shift ───

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShiftInput {
    pub user_id: i64,
    pub opening_cash: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftResponse {
    pub id: i64,
    pub user_id: i64,
    pub user_name: String,
    pub opening_cash: f64,
    pub closing_cash: Option<f64>,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub notes: Option<String>,
    pub status: String,
}

impl ShiftResponse {
    fn from_model(m: &shifts::Model, user_name: String) -> Self {
        Self {
            id: m.id,
            user_id: m.user_id,
            user_name,
            opening_cash: m.opening_cash,
            closing_cash: m.closing_cash.clone(),
            opened_at: m.opened_at.clone(),
            closed_at: m.closed_at.clone(),
            notes: m.notes.clone(),
            status: m.status.clone(),
        }
    }
}

#[tauri::command]
pub async fn open_shift(
    db: State<'_, DatabaseConnection>,
    input: OpenShiftInput,
) -> Result<ShiftResponse, AppError> {
    // Check if there's already an open shift for this user
    let existing = shifts::Entity::find()
        .filter(shifts::Column::UserId.eq(input.user_id))
        .filter(shifts::Column::Status.eq("open"))
        .one(db.inner())
        .await?;

    if let Some(existing_shift) = existing {
        let name = get_user_name(db.inner(), existing_shift.user_id).await;
        return Ok(ShiftResponse::from_model(&existing_shift, name));
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let shift = shifts::ActiveModel {
        id: NotSet,
        user_id: Set(input.user_id),
        opening_cash: Set(input.opening_cash.unwrap_or(0.0)),
        closing_cash: Set(None),
        opened_at: Set(now),
        closed_at: Set(None),
        notes: Set(None),
        status: Set("open".to_string()),
    };

    let result = shift.insert(db.inner()).await?;
    let name = get_user_name(db.inner(), result.user_id).await;
    Ok(ShiftResponse::from_model(&result, name))
}

// ─── Get Active Shift ───

#[tauri::command]
pub async fn get_active_shift(
    db: State<'_, DatabaseConnection>,
    user_id: i64,
) -> Result<Option<ShiftResponse>, AppError> {
    let shift = shifts::Entity::find()
        .filter(shifts::Column::UserId.eq(user_id))
        .filter(shifts::Column::Status.eq("open"))
        .one(db.inner())
        .await?;

    match shift {
        Some(s) => {
            let name = get_user_name(db.inner(), s.user_id).await;
            Ok(Some(ShiftResponse::from_model(&s, name)))
        }
        None => Ok(None),
    }
}

// ─── Close Shift ───

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseShiftInput {
    pub shift_id: i64,
    pub closing_cash: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentBreakdown {
    pub method: String,
    pub count: i64,
    pub total: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSummaryResponse {
    pub shift: ShiftResponse,
    pub total_sales: f64,
    pub total_transactions: i64,
    pub cash_in: f64,
    pub cash_out: f64,
    pub expected_cash: f64,
    pub cash_flows: Vec<CashFlowResponse>,
    pub payment_breakdown: Vec<PaymentBreakdown>,
}

#[tauri::command]
pub async fn close_shift(
    db: State<'_, DatabaseConnection>,
    input: CloseShiftInput,
) -> Result<ShiftSummaryResponse, AppError> {
    let shift = shifts::Entity::find_by_id(input.shift_id)
        .one(db.inner())
        .await?
        .ok_or(AppError::NotFound("Shift tidak ditemukan".into()))?;

    if shift.status == "closed" {
        return Err(AppError::Validation("Shift sudah ditutup".into()));
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Update shift
    let mut active_shift: shifts::ActiveModel = shift.clone().into();
    active_shift.status = Set("closed".to_string());
    active_shift.closed_at = Set(Some(now));
    active_shift.closing_cash = Set(input.closing_cash);
    active_shift.notes = Set(input.notes);
    let updated_shift = active_shift.update(db.inner()).await?;

    // Get summary
    let summary = build_shift_summary(db.inner(), &updated_shift).await?;
    Ok(summary)
}

// ─── Get Shift Summary ───

#[tauri::command]
pub async fn get_shift_summary(
    db: State<'_, DatabaseConnection>,
    shift_id: i64,
) -> Result<ShiftSummaryResponse, AppError> {
    let shift = shifts::Entity::find_by_id(shift_id)
        .one(db.inner())
        .await?
        .ok_or(AppError::NotFound("Shift tidak ditemukan".into()))?;

    build_shift_summary(db.inner(), &shift).await
}

async fn build_shift_summary(
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

    // Cash sales only (for expected cash calculation)
    let cash_sales_result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(total_amount), 0) as total
             FROM transactions
             WHERE shift_id = $1 AND status IN ('completed', 'partial_refund')
             AND payment_method = 'cash'",
            vec![shift.id.into()],
        ))
        .await?;

    let cash_sales: f64 = match cash_sales_result {
        Some(row) => row.try_get("", "total").unwrap_or(0.0),
        None => 0.0,
    };

    // Cash change given back
    let change_result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COALESCE(SUM(change_amount), 0) as total
             FROM transactions
             WHERE shift_id = $1 AND status IN ('completed', 'partial_refund')
             AND payment_method = 'cash'",
            vec![shift.id.into()],
        ))
        .await?;

    let total_change: f64 = match change_result {
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

    // Expected cash = opening + cash received - change given + cash_in - cash_out
    let expected_cash =
        shift.opening_cash + cash_sales - total_change + cash_in - cash_out;

    // Payment method breakdown
    let payment_rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT payment_method, COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as total
             FROM transactions
             WHERE shift_id = $1 AND status IN ('completed', 'partial_refund')
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
            Some(PaymentBreakdown { method, count, total })
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

// ─── Cash Flow ───

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCashFlowInput {
    pub shift_id: i64,
    pub user_id: i64,
    pub flow_type: String,
    pub amount: f64,
    pub description: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CashFlowResponse {
    pub id: i64,
    pub shift_id: i64,
    pub user_id: i64,
    pub flow_type: String,
    pub amount: f64,
    pub description: String,
    pub created_at: Option<String>,
}

impl From<cash_flows::Model> for CashFlowResponse {
    fn from(m: cash_flows::Model) -> Self {
        Self {
            id: m.id,
            shift_id: m.shift_id,
            user_id: m.user_id,
            flow_type: m.flow_type,
            amount: m.amount,
            description: m.description,
            created_at: m.created_at,
        }
    }
}

#[tauri::command]
pub async fn create_cash_flow(
    db: State<'_, DatabaseConnection>,
    input: CreateCashFlowInput,
) -> Result<CashFlowResponse, AppError> {
    if input.flow_type != "in" && input.flow_type != "out" {
        return Err(AppError::Validation(
            "Jenis harus 'in' atau 'out'".into(),
        ));
    }
    if input.amount <= 0.0 {
        return Err(AppError::Validation("Nominal harus lebih dari 0".into()));
    }
    if input.description.trim().is_empty() {
        return Err(AppError::Validation("Keterangan tidak boleh kosong".into()));
    }

    // Verify shift is open
    let shift = shifts::Entity::find_by_id(input.shift_id)
        .one(db.inner())
        .await?
        .ok_or(AppError::NotFound("Shift tidak ditemukan".into()))?;

    if shift.status != "open" {
        return Err(AppError::Validation("Shift sudah ditutup".into()));
    }

    let flow = cash_flows::ActiveModel {
        id: NotSet,
        shift_id: Set(input.shift_id),
        user_id: Set(input.user_id),
        flow_type: Set(input.flow_type),
        amount: Set(input.amount),
        description: Set(input.description.trim().to_string()),
        created_at: NotSet,
    };

    let result = flow.insert(db.inner()).await?;
    Ok(CashFlowResponse::from(result))
}

#[tauri::command]
pub async fn list_cash_flows(
    db: State<'_, DatabaseConnection>,
    shift_id: i64,
) -> Result<Vec<CashFlowResponse>, AppError> {
    let flows = cash_flows::Entity::find()
        .filter(cash_flows::Column::ShiftId.eq(shift_id))
        .order_by(cash_flows::Column::CreatedAt, Order::Desc)
        .all(db.inner())
        .await?;

    Ok(flows.into_iter().map(CashFlowResponse::from).collect())
}

#[tauri::command]
pub async fn delete_cash_flow(
    db: State<'_, DatabaseConnection>,
    cash_flow_id: i64,
    caller_id: i64,
) -> Result<(), AppError> {
    let caller = require_role(db.inner(), caller_id, "any").await?;

    let flow = cash_flows::Entity::find_by_id(cash_flow_id)
        .one(db.inner())
        .await?
        .ok_or(AppError::NotFound("Arus kas tidak ditemukan".into()))?;

    let shift = shifts::Entity::find_by_id(flow.shift_id)
        .one(db.inner())
        .await?
        .ok_or(AppError::NotFound("Shift tidak ditemukan".into()))?;

    if shift.status != "open" {
        return Err(AppError::Validation(
            "Arus kas hanya bisa dihapus saat shift masih terbuka".into(),
        ));
    }

    if caller.role != "admin" && flow.user_id != caller_id {
        return Err(AppError::Forbidden(
            "Hanya admin atau pembuat entri yang dapat menghapus arus kas ini.".into(),
        ));
    }

    let active: cash_flows::ActiveModel = flow.into();
    active.delete(db.inner()).await?;

    Ok(())
}
