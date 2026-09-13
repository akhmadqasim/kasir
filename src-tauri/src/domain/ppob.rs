use serde::{Deserialize, Serialize};
use serde_json::Value;

// --- Internal API response types ---

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct MitraLoginResponse {
    pub message: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub flag_member: Option<String>,
    pub detail_member: Option<MitraDetailMember>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MitraDetailMember {
    pub username: String,
    pub is_omi: i32,
    pub store_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MitraErrorResponse {
    pub message: String,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub error_message: Option<String>,
}

// --- Public response types ---

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PpobSaldoResponse {
    pub saldo: f64,
    pub username: String,
    pub store_name: String,
    pub flag_member: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PpobMenuGroup {
    pub id: i64,
    pub group: String,
    #[serde(alias = "image_url")]
    pub image_url: Option<String>,
    #[serde(alias = "path_icon")]
    pub path_icon: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlnDenom {
    pub id: i64,
    pub denom: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PdamProduct {
    pub id: i64,
    pub plu: String,
    pub merchant: String,
    #[serde(alias = "igr_desc")]
    pub igr_desc: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmoneyDenom {
    pub id: i64,
    pub denom: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PulsaProvider {
    pub uid: String,
    pub provider: String,
    pub image: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PulsaProduct {
    #[serde(alias = "pulsa_product_id")]
    pub pulsa_product_id: i64,
    pub plu: String,
    pub provider: String,
    #[serde(rename = "type")]
    pub product_type: String,
    pub description: String,
    #[serde(alias = "product_price")]
    pub product_price: f64,
    #[serde(alias = "member_price")]
    pub member_price: f64,
    #[serde(alias = "base_price")]
    pub base_price: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PulsaDetailProduct {
    pub id: i64,
    pub plu: String,
    #[serde(alias = "igr_plu")]
    pub igr_plu: String,
    #[serde(alias = "base_price")]
    pub base_price: f64,
    #[serde(alias = "vendor_price")]
    pub vendor_price: f64,
    pub description: String,
    #[serde(alias = "is_trouble")]
    pub is_trouble: i32,
    #[serde(default, alias = "promo_id")]
    pub promo_id: Option<i64>,
    #[serde(default, alias = "nominal_cut_price")]
    pub nominal_cut_price: Option<f64>,
    #[serde(default, alias = "last_price")]
    pub last_price: Option<f64>,
    #[serde(default)]
    pub percentage: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PpSubMenuItem {
    pub id: i64,
    #[serde(alias = "payment_point_group_id")]
    pub payment_point_group_id: i64,
    pub plu: String,
    #[serde(alias = "igr_plu")]
    pub igr_plu: String,
    pub merchant: String,
    pub description: String,
    #[serde(alias = "input_amt")]
    pub input_amt: i32,
    #[serde(alias = "is_trouble")]
    pub is_trouble: i32,
    pub label: String,
    #[serde(alias = "path_icon")]
    pub path_icon: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferChannelGroup {
    pub channel: String,
    pub details: Vec<TransferChannelDetail>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferChannelDetail {
    #[serde(alias = "channel_id")]
    pub channel_id: String,
    #[serde(alias = "product_id")]
    pub product_id: i64,
    #[serde(rename = "type")]
    pub transfer_type: String,
    pub fee: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoucherGroup {
    pub id: i64,
    pub group: String,
    pub icon: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PulsaDetailsResponse {
    pub provider: String,
    pub image: String,
    pub products: Vec<PulsaDetailProduct>,
}

// --- Transaction types ---

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InquiryResult {
    pub inquiry_id: String,
    pub customer_name: Option<String>,
    pub customer_id: String,
    pub product_name: Option<String>,
    pub amount: f64,
    pub admin_fee: f64,
    pub total: f64,
    pub service_type: String,
    pub raw_data: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaymentResult {
    pub success: bool,
    pub receipt_data: Value,
    pub service_type: String,
    pub customer_id: String,
    pub amount: f64,
    pub admin_fee: f64,
    pub total: f64,
    pub product_name: Option<String>,
    pub customer_name: Option<String>,
    pub serial_number: Option<String>,
}

// --- History types ---

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPaymentItem {
    pub trx_id: Option<String>,
    pub inquiry_id: Option<String>,
    pub product_name: Option<String>,
    pub description: Option<String>,
    pub serial_number: Option<String>,
    pub total: Option<f64>,
    pub amount: Option<f64>,
    pub admin_fee: Option<f64>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub vendor_price: Option<f64>,
    pub base_price: Option<f64>,
    pub sell_price: Option<f64>,
    pub profit: Option<f64>,
    pub margin: Option<f64>,
    pub denom: Option<String>,
    pub provider: Option<String>,
    pub merchant: Option<String>,
    pub plu: Option<String>,
    pub service_type: Option<String>,
    pub customer_no: Option<String>,
    pub token_number: Option<String>,
    pub payment_code: Option<String>,
    pub receipt_text: Option<String>,
    pub invoice_url: Option<String>,
    pub igr_desc: Option<String>,
    pub no_ref: Option<String>,
}

// --- Mutation/topup history types ---

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MutasiItem {
    pub id: Option<String>,
    pub mutation_type: String, // "in" (topup) or "out" (payment)
    pub description: Option<String>,
    pub amount: Option<f64>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub payment_method: Option<String>,
    pub reference: Option<String>,
    pub raw_data: Value,
}

// --- Notification/Inbox types ---

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub inbox_id: String,
    pub title: String,
    pub message: String,
    pub category: String, // "INFORMASI", "TRANSAKSI", etc.
    pub status: String,   // "read" or "unread"
    pub created_at: Option<String>,
    pub raw_data: Value,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListResult {
    pub items: Vec<NotificationItem>,
    pub unread_count: i64,
    pub total_count: i64,
    pub current_page: i64,
    pub total_pages: i64,
}
