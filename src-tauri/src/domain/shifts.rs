//! Shift and cash-flow types.
//!
//! Neither `OpenShiftInput` nor `CreateCashFlowInput` carries a `userId` any
//! more: the owner of a shift and the author of a cash-flow entry come from the
//! [`crate::domain::Actor`], never from the request body.

use serde::{Deserialize, Serialize};

use crate::entity::{cash_flows, shifts};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShiftInput {
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
    pub fn from_model(m: &shifts::Model, user_name: String) -> Self {
        Self {
            id: m.id,
            user_id: m.user_id,
            user_name,
            opening_cash: m.opening_cash,
            closing_cash: m.closing_cash,
            opened_at: m.opened_at.clone(),
            closed_at: m.closed_at.clone(),
            notes: m.notes.clone(),
            status: m.status.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCashFlowInput {
    pub shift_id: i64,
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
