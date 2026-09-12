//! Row and summary shapes for the eleven reports.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailySalesRow {
    pub date: String,
    pub transaction_count: i64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub gross_profit: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlySalesRow {
    pub month: String,
    pub transaction_count: i64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub gross_profit: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodSalesSummary {
    pub total_transactions: i64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub gross_profit: f64,
    pub avg_per_transaction: f64,
    pub daily_breakdown: Vec<DailySalesRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptRow {
    pub id: i64,
    pub receipt_number: String,
    pub cashier_name: String,
    pub total_amount: f64,
    pub payment_method: String,
    pub status: String,
    pub item_count: i64,
    pub created_at: String,
    /// Every return ever booked against this receipt, net of exchange
    /// replacements. Not scoped to the report's date range — it is a property
    /// of the receipt.
    pub refund_amount: f64,
    /// `total_amount - refund_amount`: what the customer kept and paid for.
    pub net_amount: f64,
}

/// `items` is capped at the report row limit; `total_count` is the number of
/// rows that matched, so `items.len() < total_count` means the list was
/// truncated.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptReport {
    pub items: Vec<ReceiptRow>,
    pub total_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodRow {
    pub payment_method: String,
    pub transaction_count: i64,
    pub total_amount: f64,
    pub percentage: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSalesRow {
    pub product_id: i64,
    pub product_name: String,
    pub barcode: Option<String>,
    pub category_name: Option<String>,
    pub qty_sold: i64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub profit: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopularProductRow {
    pub rank: i64,
    pub product_id: i64,
    pub product_name: String,
    pub category_name: Option<String>,
    pub qty_sold: i64,
    pub total_revenue: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReturnRow {
    pub id: i64,
    pub refund_number: String,
    pub transaction_receipt: String,
    pub cashier_name: String,
    #[serde(rename = "type")]
    pub refund_type: String,
    pub total_refund_amount: f64,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentStockRow {
    pub product_id: i64,
    pub barcode: Option<String>,
    pub product_name: String,
    pub category_name: Option<String>,
    pub stock: i64,
    pub min_stock: i64,
    pub unit: String,
    pub buy_price: f64,
    pub sell_price: f64,
    pub stock_value: f64,
}

/// See [`ReceiptReport`] — same truncation contract.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentStockReport {
    pub items: Vec<CurrentStockRow>,
    pub total_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LossRow {
    pub id: i64,
    pub writeoff_number: String,
    pub product_name: String,
    pub cashier_name: String,
    pub quantity: i64,
    pub reason: String,
    pub loss_value: f64,
    pub notes: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonBreakdown {
    pub reason: String,
    pub count: i64,
    pub total_value: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LossSummary {
    pub total_writeoffs: i64,
    pub total_quantity: i64,
    pub total_loss_value: f64,
    pub by_reason: Vec<ReasonBreakdown>,
    pub items: Vec<LossRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashFlowReportRow {
    pub id: i64,
    pub shift_id: i64,
    pub cashier_name: String,
    pub flow_type: String,
    pub amount: f64,
    pub description: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashFlowReportSummary {
    pub total_in: f64,
    pub total_out: f64,
    pub net_total: f64,
    pub items: Vec<CashFlowReportRow>,
}
