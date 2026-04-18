use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::commands::ppob::executor::{execute_fulfillment_request, PpobFulfillmentRequest};
use crate::commands::ppob::{MitraClient, PaymentResult};
use crate::commands::settings::parse_app_settings;
use crate::entity::{products, store_info, transaction_items, transactions, users};
use crate::utils::AppError;

const VALID_PAYMENT_METHODS: &[&str] = &["cash", "qris", "ewallet", "transfer"];
const STATUS_COMPLETED: &str = "completed";

#[derive(Debug, Deserialize, Clone)]
pub struct TransactionItemInput {
    pub product_id: Option<i64>,
    pub quantity: i64,
    pub product_name: Option<String>,
    pub product_price: Option<f64>,
    pub buy_price: Option<f64>,
    pub item_discount: Option<f64>,
    pub service_type: Option<String>,
    pub service_ref: Option<String>,
    pub ppob_product_id: Option<i64>,
    pub ppob_product_code: Option<String>,
    pub ppob_inquiry_id: Option<String>,
    pub ppob_payment_code: Option<String>,
    pub ppob_flag_id: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CheckoutTransactionInput {
    pub user_id: i64,
    pub items: Vec<TransactionItemInput>,
    pub payment_method: String,
    pub payment_amount: f64,
    pub notes: Option<String>,
    pub transaction_discount: Option<f64>,
    pub shift_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct TransactionResult {
    pub transaction: transactions::Model,
    pub items: Vec<transaction_items::Model>,
}

struct ResolvedItem {
    product_id: Option<i64>,
    product_name: String,
    sell_price: f64,
    buy_price: Option<f64>,
    quantity: i64,
    subtotal: f64,
    item_discount: f64,
    service_type: Option<String>,
    service_ref: Option<String>,
    ppob_product_id: Option<i64>,
    ppob_product_code: Option<String>,
    ppob_inquiry_id: Option<String>,
    ppob_payment_code: Option<String>,
    ppob_flag_id: Option<String>,
}

fn now_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

async fn generate_receipt_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let prefix = format!("TRX-{}-", today);

    let result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT MAX(CAST(SUBSTR(receipt_number, LENGTH($1) + 1) AS INTEGER)) as max_num FROM transactions WHERE receipt_number LIKE $2",
            vec![prefix.clone().into(), format!("{}%", prefix).into()],
        ))
        .await?;

    let max_num: i64 = result
        .map(|r| r.try_get::<i64>("", "max_num").unwrap_or(0))
        .unwrap_or(0);

    Ok(format!("{}{:04}", prefix, max_num + 1))
}

async fn load_allow_negative_stock<C: ConnectionTrait>(db: &C) -> Result<bool, AppError> {
    Ok(store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .map(|s| parse_app_settings(&s.additional_info).sales.allow_negative_stock)
        .unwrap_or(true))
}

fn validate_cart_composition(items: &[TransactionItemInput]) -> Result<bool, AppError> {
    if items.is_empty() {
        return Err(AppError::Validation(
            "Item transaksi tidak boleh kosong".into(),
        ));
    }

    let has_ppob = items.iter().any(|item| item.service_type.is_some());

    Ok(has_ppob)
}

async fn resolve_items<C: ConnectionTrait>(
    db: &C,
    items: &[TransactionItemInput],
    allow_negative_stock: bool,
) -> Result<Vec<ResolvedItem>, AppError> {
    let mut resolved_items = Vec::with_capacity(items.len());

    for item_input in items {
        if item_input.quantity <= 0 {
            return Err(AppError::Validation(
                "Jumlah item harus lebih dari 0".into(),
            ));
        }

        if let Some(service_type) = item_input.service_type.clone() {
            let product_name = item_input
                .product_name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| AppError::Validation("Nama produk PPOB harus diisi".into()))?;
            let product_price = item_input
                .product_price
                .filter(|value| *value > 0.0)
                .ok_or_else(|| AppError::Validation("Harga produk PPOB harus diisi".into()))?;
            let service_ref = item_input
                .service_ref
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| AppError::Validation("Referensi pelanggan PPOB harus diisi".into()))?;

            match service_type.as_str() {
                "pulsa" | "data" => {
                    if item_input.ppob_product_id.is_none()
                        || item_input
                            .ppob_product_code
                            .as_ref()
                            .is_none_or(|value| value.trim().is_empty())
                    {
                        return Err(AppError::Validation(
                            "Metadata produk PPOB belum lengkap untuk topup langsung".into(),
                        ));
                    }
                }
                "pln" | "pdam" | "bpjs" | "pp" | "transfer" | "emoney" => {
                    if item_input
                        .ppob_inquiry_id
                        .as_ref()
                        .is_none_or(|value| value.trim().is_empty())
                    {
                        return Err(AppError::Validation(
                            "Inquiry PPOB harus dilakukan sebelum checkout".into(),
                        ));
                    }
                }
                other => {
                    return Err(AppError::Validation(format!(
                        "Service type PPOB tidak didukung: {}",
                        other
                    )))
                }
            }

            resolved_items.push(ResolvedItem {
                product_id: None,
                product_name,
                sell_price: product_price,
                buy_price: item_input.buy_price,
                quantity: item_input.quantity,
                subtotal: product_price * item_input.quantity as f64,
                item_discount: item_input.item_discount.unwrap_or(0.0),
                service_type: Some(service_type),
                service_ref: Some(service_ref),
                ppob_product_id: item_input.ppob_product_id,
                ppob_product_code: item_input.ppob_product_code.clone(),
                ppob_inquiry_id: item_input.ppob_inquiry_id.clone(),
                ppob_payment_code: item_input.ppob_payment_code.clone(),
                ppob_flag_id: item_input.ppob_flag_id.clone(),
            });
            continue;
        }

        let product_id = item_input.product_id.ok_or_else(|| {
            AppError::Validation("Produk fisik harus memiliki ID produk".into())
        })?;

        let product = products::Entity::find_by_id(product_id)
            .filter(products::Column::IsActive.eq(true))
            .one(db)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "Produk dengan ID {} tidak ditemukan atau tidak aktif",
                    product_id
                ))
            })?;

        if product.stock < item_input.quantity && !allow_negative_stock {
            return Err(AppError::Validation(format!(
                "Stok '{}' tidak cukup (tersedia: {}, diminta: {})",
                product.name, product.stock, item_input.quantity
            )));
        }

        resolved_items.push(ResolvedItem {
            product_id: Some(product.id),
            product_name: product.name,
            sell_price: product.sell_price,
            buy_price: Some(product.buy_price),
            quantity: item_input.quantity,
            subtotal: product.sell_price * item_input.quantity as f64,
            item_discount: item_input.item_discount.unwrap_or(0.0),
            service_type: None,
            service_ref: None,
            ppob_product_id: None,
            ppob_product_code: None,
            ppob_inquiry_id: None,
            ppob_payment_code: None,
            ppob_flag_id: None,
        });
    }

    Ok(resolved_items)
}

fn calculate_payment_amount(
    payment_method: &str,
    requested_payment_amount: f64,
    total_amount: f64,
) -> Result<(f64, f64), AppError> {
    if payment_method == "cash" && requested_payment_amount < total_amount {
        return Err(AppError::Validation(format!(
            "Pembayaran kurang. Total: {}, Dibayar: {}",
            total_amount, requested_payment_amount
        )));
    }

    let payment_amount = if payment_method == "cash" {
        requested_payment_amount
    } else {
        total_amount
    };
    let change_amount = if payment_method == "cash" {
        requested_payment_amount - total_amount
    } else {
        0.0
    };

    Ok((payment_amount, change_amount))
}

async fn persist_transaction<C: ConnectionTrait>(
    db: &C,
    input: &CheckoutTransactionInput,
    resolved_items: &[ResolvedItem],
    status: &str,
    deduct_physical_stock: bool,
) -> Result<TransactionResult, AppError> {
    let subtotal_amount: f64 = resolved_items.iter().map(|item| item.subtotal).sum();
    let item_discounts_total: f64 = resolved_items.iter().map(|item| item.item_discount).sum();
    let transaction_discount = input.transaction_discount.unwrap_or(0.0);
    let discount_amount = item_discounts_total + transaction_discount;
    let total_amount = (subtotal_amount - discount_amount).max(0.0);
    let (payment_amount, change_amount) = calculate_payment_amount(
        &input.payment_method,
        input.payment_amount,
        total_amount,
    )?;
    let receipt_number = generate_receipt_number(db).await?;
    let now = now_timestamp();

    let new_transaction = transactions::ActiveModel {
        id: NotSet,
        receipt_number: Set(receipt_number),
        user_id: Set(input.user_id),
        total_amount: Set(total_amount),
        subtotal_amount: Set(subtotal_amount),
        discount_amount: Set(discount_amount),
        payment_method: Set(input.payment_method.clone()),
        payment_amount: Set(payment_amount),
        change_amount: Set(Some(change_amount)),
        status: Set(status.to_string()),
        notes: Set(input.notes.clone()),
        shift_id: Set(input.shift_id),
        deleted_at: Set(None),
        deleted_by: Set(None),
        deleted_reason: Set(None),
        updated_at: Set(None),
        created_at: Set(Some(now.clone())),
    };

    let transaction = new_transaction.insert(db).await?;
    let mut items = Vec::with_capacity(resolved_items.len());

    for item in resolved_items {
        let is_ppob = item.service_type.is_some();
        let new_item = transaction_items::ActiveModel {
            id: NotSet,
            transaction_id: Set(transaction.id),
            product_id: Set(item.product_id),
            product_name: Set(item.product_name.clone()),
            product_price: Set(item.sell_price),
            buy_price: Set(item.buy_price),
            quantity: Set(item.quantity),
            subtotal: Set(item.subtotal),
            item_discount: Set(item.item_discount),
            service_type: Set(item.service_type.clone()),
            service_ref: Set(item.service_ref.clone()),
            ppob_product_id: Set(item.ppob_product_id),
            ppob_product_code: Set(item.ppob_product_code.clone()),
            ppob_inquiry_id: Set(item.ppob_inquiry_id.clone()),
            ppob_payment_code: Set(item.ppob_payment_code.clone()),
            ppob_flag_id: Set(item.ppob_flag_id.clone()),
            ppob_status: Set(if is_ppob { Some("pending".to_string()) } else { None }),
            ppob_message: Set(None),
            ppob_serial_number: Set(None),
            created_at: Set(Some(now.clone())),
        };

        let created_item = new_item.insert(db).await?;
        items.push(created_item);

        if deduct_physical_stock {
            if let Some(product_id) = item.product_id {
                db.execute(Statement::from_sql_and_values(
                    DbBackend::Sqlite,
                    "UPDATE products SET stock = stock - $1, updated_at = $2 WHERE id = $3",
                    vec![item.quantity.into(), now.clone().into(), product_id.into()],
                ))
                .await?;
            }
        }
    }

    Ok(TransactionResult { transaction, items })
}

async fn fetch_transaction_result(
    db: &DatabaseConnection,
    transaction_id: i64,
) -> Result<TransactionResult, AppError> {
    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db)
        .await?;

    Ok(TransactionResult { transaction, items })
}

fn build_ppob_request(item: &transaction_items::Model) -> Result<PpobFulfillmentRequest, AppError> {
    let service_type = item
        .service_type
        .clone()
        .ok_or_else(|| AppError::Validation("Item PPOB tidak memiliki service type".into()))?;

    Ok(PpobFulfillmentRequest {
        service_type,
        customer_id: item.service_ref.clone(),
        inquiry_id: item.ppob_inquiry_id.clone(),
        product_id: item.ppob_product_id,
        product_code: item.ppob_product_code.clone(),
        payment_code: item.ppob_payment_code.clone(),
        flag_id: if item.service_type.as_deref() == Some("pln") {
            item.ppob_flag_id.clone()
        } else {
            None
        },
        phone_number: if item.service_type.as_deref() == Some("bpjs") {
            item.ppob_flag_id.clone()
        } else {
            None
        },
        amount: if item.service_type.as_deref() == Some("bpjs") {
            item.buy_price
        } else {
            None
        },
    })
}

fn build_ppob_success_message(payment_result: &PaymentResult) -> String {
    if let Some(serial_number) = &payment_result.serial_number {
        return format!("Fulfillment PPOB berhasil. SN: {}", serial_number);
    }

    if let Some(product_name) = &payment_result.product_name {
        return format!("Fulfillment PPOB berhasil untuk {}", product_name);
    }

    "Fulfillment PPOB berhasil".to_string()
}

async fn update_ppob_item_status(
    db: &DatabaseConnection,
    item_id: i64,
    ppob_status: &str,
    ppob_message: Option<String>,
    ppob_serial_number: Option<String>,
) -> Result<(), AppError> {
    let item = transaction_items::Entity::find_by_id(item_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Item transaksi PPOB tidak ditemukan".into()))?;

    let mut active_item: transaction_items::ActiveModel = item.into();
    active_item.ppob_status = Set(Some(ppob_status.to_string()));
    active_item.ppob_message = Set(ppob_message);
    active_item.ppob_serial_number = Set(ppob_serial_number);
    active_item.update(db).await?;

    Ok(())
}

async fn checkout_transaction_with_executor<F, Fut>(
    db: &DatabaseConnection,
    input: CheckoutTransactionInput,
    fulfill_ppob: F,
) -> Result<TransactionResult, AppError>
where
    F: Fn(PpobFulfillmentRequest) -> Fut,
    Fut: Future<Output = Result<PaymentResult, AppError>>,
{
    if !VALID_PAYMENT_METHODS.contains(&input.payment_method.as_str()) {
        return Err(AppError::Validation(format!(
            "Metode pembayaran tidak valid: {}",
            input.payment_method
        )));
    }

    let has_ppob = validate_cart_composition(&input.items)?;
    let allow_negative_stock = load_allow_negative_stock(db).await?;
    let resolved_items = resolve_items(db, &input.items, allow_negative_stock).await?;

    // Always create transaction as completed and deduct physical stock
    let txn = db.begin().await?;
    let result =
        persist_transaction(&txn, &input, &resolved_items, STATUS_COMPLETED, true).await?;
    txn.commit().await?;

    if !has_ppob {
        return Ok(result);
    }

    // Process all PPOB items
    for ppob_item in result.items.iter().filter(|item| item.service_type.is_some()) {
        let request = build_ppob_request(ppob_item)?;
        let ppob_item_id = ppob_item.id;

        match fulfill_ppob(request).await {
            Ok(payment_result) => {
                update_ppob_item_status(
                    db,
                    ppob_item_id,
                    "success",
                    Some(build_ppob_success_message(&payment_result)),
                    payment_result.serial_number.clone(),
                )
                .await?;
            }
            Err(error) => {
                update_ppob_item_status(
                    db,
                    ppob_item_id,
                    "failed",
                    Some(error.to_string()),
                    None,
                )
                .await?;
            }
        }
    }

    fetch_transaction_result(db, result.transaction.id).await
}

#[tauri::command]
pub async fn checkout_transaction(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    input: CheckoutTransactionInput,
) -> Result<TransactionResult, AppError> {
    let conn = db.inner().clone();
    let mitra = mitra.inner().clone();

    if !VALID_PAYMENT_METHODS.contains(&input.payment_method.as_str()) {
        return Err(AppError::Validation(format!(
            "Metode pembayaran tidak valid: {}",
            input.payment_method
        )));
    }

    let has_ppob = validate_cart_composition(&input.items)?;
    let allow_negative_stock = load_allow_negative_stock(&conn).await?;
    let resolved_items = resolve_items(&conn, &input.items, allow_negative_stock).await?;

    // Always create as completed and deduct physical stock immediately
    let txn = conn.begin().await?;
    let result =
        persist_transaction(&txn, &input, &resolved_items, STATUS_COMPLETED, true).await?;
    txn.commit().await?;

    if has_ppob {
        // Process each PPOB item in its own background task
        for ppob_item in result.items.iter().filter(|item| item.service_type.is_some()) {
            let request = build_ppob_request(ppob_item)?;
            let ppob_item_id = ppob_item.id;
            let bg_conn = conn.clone();
            let bg_mitra = mitra.clone();

            tokio::spawn(async move {
                match execute_fulfillment_request(&bg_conn, &bg_mitra, &request).await {
                    Ok(payment_result) => {
                        let _ = update_ppob_item_status(
                            &bg_conn,
                            ppob_item_id,
                            "success",
                            Some(build_ppob_success_message(&payment_result)),
                            payment_result.serial_number.clone(),
                        )
                        .await;
                    }
                    Err(error) => {
                        let _ = update_ppob_item_status(
                            &bg_conn,
                            ppob_item_id,
                            "failed",
                            Some(error.to_string()),
                            None,
                        )
                        .await;
                    }
                }
            });
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn create_transaction(
    db: State<'_, DatabaseConnection>,
    input: CheckoutTransactionInput,
) -> Result<TransactionResult, AppError> {
    let conn = db.inner().clone();
    checkout_transaction_with_executor(&conn, input, |_request| async {
        Err(AppError::Validation(
            "Executor PPOB tidak boleh terpanggil untuk transaksi non-PPOB".into(),
        ))
    })
    .await
}

#[tauri::command]
pub async fn retry_ppob_fulfillment(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    item_id: i64,
) -> Result<String, AppError> {
    let conn = db.inner().clone();
    let mitra = mitra.inner().clone();

    let item = transaction_items::Entity::find_by_id(item_id)
        .one(&conn)
        .await?
        .ok_or_else(|| AppError::NotFound("Item transaksi tidak ditemukan".into()))?;

    let ppob_status = item
        .ppob_status
        .as_deref()
        .unwrap_or("");
    if ppob_status != "failed" && ppob_status != "pending" {
        return Err(AppError::Validation(
            "Hanya item PPOB yang gagal atau pending yang bisa di-retry".into(),
        ));
    }

    let request = build_ppob_request(&item)?;

    // Reset to pending before retrying
    update_ppob_item_status(&conn, item_id, "pending", Some("Sedang di-retry...".into()), None).await?;

    let bg_conn = conn.clone();
    tokio::spawn(async move {
        match execute_fulfillment_request(&bg_conn, &mitra, &request).await {
            Ok(payment_result) => {
                let _ = update_ppob_item_status(
                    &bg_conn,
                    item_id,
                    "success",
                    Some(build_ppob_success_message(&payment_result)),
                    payment_result.serial_number.clone(),
                )
                .await;
            }
            Err(error) => {
                let _ = update_ppob_item_status(
                    &bg_conn,
                    item_id,
                    "failed",
                    Some(error.to_string()),
                    None,
                )
                .await;
            }
        }
    });

    Ok("PPOB fulfillment sedang diproses ulang".into())
}

#[tauri::command]
pub async fn get_next_receipt_number(
    db: State<'_, DatabaseConnection>,
) -> Result<String, AppError> {
    generate_receipt_number(db.inner()).await
}

#[derive(Debug, Deserialize)]
pub struct ListTransactionsInput {
    pub page: Option<u64>,
    pub per_page: Option<u64>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub payment_method: Option<String>,
    pub status: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TransactionListItem {
    pub id: i64,
    pub receipt_number: String,
    pub user_id: i64,
    pub cashier_name: String,
    pub total_amount: f64,
    pub subtotal_amount: f64,
    pub discount_amount: f64,
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: f64,
    pub status: String,
    pub item_count: i64,
    pub notes: Option<String>,
    pub created_at: Option<String>,
    pub has_ppob: bool,
    pub ppob_status: Option<String>,
    pub ppob_message: Option<String>,
    pub ppob_serial_number: Option<String>,
    pub deleted_at: Option<String>,
    pub deleted_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PaginatedTransactions {
    pub data: Vec<TransactionListItem>,
    pub total: u64,
    pub page: u64,
    pub per_page: u64,
    pub total_pages: u64,
}

fn summarize_ppob_items(
    items: &[transaction_items::Model],
) -> (bool, Option<String>, Option<String>, Option<String>) {
    let ppob_item = items.iter().find(|item| item.service_type.is_some());

    match ppob_item {
        Some(item) => (
            true,
            item.ppob_status.clone(),
            item.ppob_message.clone(),
            item.ppob_serial_number.clone(),
        ),
        None => (false, None, None, None),
    }
}

#[tauri::command]
pub async fn list_transactions(
    db: State<'_, DatabaseConnection>,
    input: ListTransactionsInput,
) -> Result<PaginatedTransactions, AppError> {
    let page = input.page.unwrap_or(1).max(1);
    let per_page = input.per_page.unwrap_or(50).min(100);

    let mut query =
        transactions::Entity::find().order_by(transactions::Column::CreatedAt, Order::Desc);

    let offset_secs = chrono::Local::now().offset().local_minus_utc() as i64;

    if let Some(ref date_from) = input.date_from {
        let local_start = format!("{} 00:00:00", date_from);
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&local_start, "%Y-%m-%d %H:%M:%S")
        {
            let utc_start = ndt - chrono::Duration::seconds(offset_secs);
            query = query.filter(
                transactions::Column::CreatedAt
                    .gte(utc_start.format("%Y-%m-%d %H:%M:%S").to_string()),
            );
        }
    }

    if let Some(ref date_to) = input.date_to {
        let local_end = format!("{} 23:59:59", date_to);
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&local_end, "%Y-%m-%d %H:%M:%S") {
            let utc_end = ndt - chrono::Duration::seconds(offset_secs);
            query = query.filter(
                transactions::Column::CreatedAt
                    .lte(utc_end.format("%Y-%m-%d %H:%M:%S").to_string()),
            );
        }
    }

    if let Some(ref method) = input.payment_method {
        if !method.is_empty() {
            query = query.filter(transactions::Column::PaymentMethod.eq(method.as_str()));
        }
    }

    if let Some(ref status) = input.status {
        if !status.is_empty() {
            query = query.filter(transactions::Column::Status.eq(status.as_str()));
        }
    }

    if let Some(ref search) = input.search {
        if !search.is_empty() {
            query = query.filter(transactions::Column::ReceiptNumber.contains(search));
        }
    }

    let total = query.clone().count(db.inner()).await?;
    let total_pages = (total as f64 / per_page as f64).ceil() as u64;

    let txns = query
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all(db.inner())
        .await?;

    let mut data = Vec::with_capacity(txns.len());

    for txn in txns {
        let items = transaction_items::Entity::find()
            .filter(transaction_items::Column::TransactionId.eq(txn.id))
            .all(db.inner())
            .await?;
        let item_count = items.len() as i64;
        let (has_ppob, ppob_status, ppob_message, ppob_serial_number) =
            summarize_ppob_items(&items);

        let cashier = users::Entity::find_by_id(txn.user_id)
            .one(db.inner())
            .await?;
        let cashier_name = cashier
            .map(|u| u.full_name)
            .unwrap_or_else(|| "Unknown".into());

        data.push(TransactionListItem {
            id: txn.id,
            receipt_number: txn.receipt_number,
            user_id: txn.user_id,
            cashier_name,
            total_amount: txn.total_amount,
            subtotal_amount: txn.subtotal_amount,
            discount_amount: txn.discount_amount,
            payment_method: txn.payment_method,
            payment_amount: txn.payment_amount,
            change_amount: txn.change_amount.unwrap_or(0.0),
            status: txn.status,
            item_count,
            notes: txn.notes,
            created_at: txn.created_at,
            has_ppob,
            ppob_status,
            ppob_message,
            ppob_serial_number,
            deleted_at: txn.deleted_at,
            deleted_reason: txn.deleted_reason,
        });
    }

    Ok(PaginatedTransactions {
        data,
        total,
        page,
        per_page,
        total_pages,
    })
}

#[derive(Debug, Serialize)]
pub struct TransactionDetail {
    pub transaction: transactions::Model,
    pub items: Vec<transaction_items::Model>,
    pub cashier_name: String,
    pub has_ppob: bool,
    pub ppob_status: Option<String>,
    pub ppob_message: Option<String>,
    pub ppob_serial_number: Option<String>,
}

#[tauri::command]
pub async fn get_transaction_detail(
    db: State<'_, DatabaseConnection>,
    transaction_id: i64,
) -> Result<TransactionDetail, AppError> {
    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db.inner())
        .await?;
    let (has_ppob, ppob_status, ppob_message, ppob_serial_number) = summarize_ppob_items(&items);

    let cashier = users::Entity::find_by_id(transaction.user_id)
        .one(db.inner())
        .await?;
    let cashier_name = cashier
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".into());

    Ok(TransactionDetail {
        transaction,
        items,
        cashier_name,
        has_ppob,
        ppob_status,
        ppob_message,
        ppob_serial_number,
    })
}

#[derive(Debug, Deserialize)]
pub struct DeleteTransactionInput {
    pub transaction_id: i64,
    pub user_id: i64,
    pub reason: String,
}

#[tauri::command]
pub async fn delete_transaction(
    db: State<'_, DatabaseConnection>,
    input: DeleteTransactionInput,
) -> Result<(), AppError> {
    let user = users::Entity::find_by_id(input.user_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    if user.role != "admin" {
        return Err(AppError::Forbidden(
            "Hanya admin yang dapat menghapus transaksi".into(),
        ));
    }

    if input.reason.trim().is_empty() {
        return Err(AppError::Validation("Alasan penghapusan wajib diisi".into()));
    }

    let transaction = transactions::Entity::find_by_id(input.transaction_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    if transaction.deleted_at.is_some() {
        return Err(AppError::Validation("Transaksi sudah dihapus sebelumnya".into()));
    }

    // Check for linked refunds
    use crate::entity::refunds;
    let refund_count = refunds::Entity::find()
        .filter(refunds::Column::TransactionId.eq(input.transaction_id))
        .count(db.inner())
        .await?;

    if refund_count > 0 {
        return Err(AppError::Validation(
            "Tidak dapat menghapus transaksi yang sudah pernah di-refund".into(),
        ));
    }

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(input.transaction_id))
        .all(db.inner())
        .await?;

    let now = chrono::Utc::now()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    let txn = db.inner().begin().await?;

    // Restore stock for regular items (not PPOB)
    for item in &items {
        if item.service_type.is_none() {
            if let Some(product_id) = item.product_id {
                txn.execute(Statement::from_sql_and_values(
                    DbBackend::Sqlite,
                    "UPDATE products SET stock = stock + $1, updated_at = $2 WHERE id = $3",
                    vec![item.quantity.into(), now.clone().into(), product_id.into()],
                ))
                .await?;
            }
        }
    }

    // Soft delete the transaction
    txn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE transactions SET status = 'deleted', deleted_at = $1, deleted_by = $2, deleted_reason = $3, updated_at = $1 WHERE id = $4",
        vec![
            now.into(),
            input.user_id.into(),
            input.reason.trim().to_string().into(),
            input.transaction_id.into(),
        ],
    ))
    .await?;

    txn.commit().await?;

    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct UpdatePaymentMethodInput {
    pub transaction_id: i64,
    pub user_id: i64,
    pub payment_method: String,
    pub reason: String,
}

#[tauri::command]
pub async fn update_payment_method(
    db: State<'_, DatabaseConnection>,
    input: UpdatePaymentMethodInput,
) -> Result<transactions::Model, AppError> {
    let user = users::Entity::find_by_id(input.user_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    if user.role != "admin" {
        return Err(AppError::Forbidden(
            "Hanya admin yang dapat mengubah metode pembayaran".into(),
        ));
    }

    if !VALID_PAYMENT_METHODS.contains(&input.payment_method.as_str()) {
        return Err(AppError::Validation(format!(
            "Metode pembayaran tidak valid: {}",
            input.payment_method
        )));
    }

    if input.reason.trim().is_empty() {
        return Err(AppError::Validation("Alasan perubahan wajib diisi".into()));
    }

    let transaction = transactions::Entity::find_by_id(input.transaction_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    if transaction.deleted_at.is_some() {
        return Err(AppError::Validation(
            "Tidak dapat mengubah transaksi yang sudah dihapus".into(),
        ));
    }

    let now = chrono::Utc::now()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    // Recalculate change amount for cash payments
    let change_amount = if input.payment_method == "cash" {
        transaction.payment_amount - transaction.total_amount
    } else {
        0.0
    };

    let mut active_txn: transactions::ActiveModel = transaction.into();
    active_txn.payment_method = Set(input.payment_method);
    active_txn.change_amount = Set(Some(change_amount));
    active_txn.updated_at = Set(Some(now));
    let updated = active_txn.update(db.inner()).await?;

    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::entity::{products, store_info, users};
    use std::path::PathBuf;
    use uuid::Uuid;

    fn test_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("kasir-test-{}.db", Uuid::new_v4()))
    }

    async fn setup_test_db() -> DatabaseConnection {
        let db_path = test_db_path();
        let conn = db::setup_database(db_path.to_string_lossy().as_ref())
            .await
            .expect("db setup");

        store_info::ActiveModel {
            id: Set(1),
            name: Set("Toko Test".to_string()),
            address: Set(None),
            phone: Set(None),
            email: Set(None),
            logo_path: Set(None),
            additional_info: Set(Some(
                serde_json::json!({
                    "sales": {
                        "allow_negative_stock": false,
                        "default_payment_method": "cash"
                    },
                    "ppob": {
                        "enabled": true,
                        "phone_number": "08123456789",
                        "password": "TEST_ONLY_NOT_REAL",
                        "device_id": "device-test",
                        "pin": "000000",
                        "markup": {
                            "pulsa": { "type": "fixed", "value": 0 },
                            "data": { "type": "fixed", "value": 0 },
                            "pln": { "type": "fixed", "value": 0 },
                            "pdam": { "type": "fixed", "value": 0 },
                            "bpjs": { "type": "fixed", "value": 0 },
                            "emoney": { "type": "fixed", "value": 0 },
                            "custom_prices": {}
                        }
                    },
                    "backup": {
                        "interval_hours": 3,
                        "retention_days": 90
                    }
                })
                .to_string(),
            )),
            created_at: Set(Some(now_timestamp())),
            updated_at: Set(Some(now_timestamp())),
        }
        .insert(&conn)
        .await
        .expect("store insert");

        users::ActiveModel {
            id: NotSet,
            username: Set("admin".to_string()),
            pin_hash: Set("hash".to_string()),
            full_name: Set("Admin Test".to_string()),
            role: Set("admin".to_string()),
            is_active: Set(true),
            created_at: Set(Some(now_timestamp())),
            updated_at: Set(Some(now_timestamp())),
        }
        .insert(&conn)
        .await
        .expect("user insert");

        conn
    }

    async fn insert_product(
        conn: &DatabaseConnection,
        name: &str,
        sell_price: f64,
        stock: i64,
    ) -> products::Model {
        products::ActiveModel {
            id: NotSet,
            barcode: Set(None),
            sku: Set(None),
            name: Set(name.to_string()),
            category_id: Set(None),
            buy_price: Set(sell_price - 2_000.0),
            sell_price: Set(sell_price),
            margin: Set(0.0),
            stock: Set(stock),
            unit: Set("pcs".to_string()),
            min_stock: Set(Some(0)),
            is_active: Set(true),
            created_at: Set(Some(now_timestamp())),
            updated_at: Set(Some(now_timestamp())),
        }
        .insert(conn)
        .await
        .expect("product insert")
    }

    #[tokio::test]
    async fn standard_checkout_completes_and_deducts_stock() {
        let conn = setup_test_db().await;
        let product = insert_product(&conn, "Beras", 15_000.0, 10).await;

        let result = checkout_transaction_with_executor(
            &conn,
            CheckoutTransactionInput {
                user_id: 1,
                items: vec![TransactionItemInput {
                    product_id: Some(product.id),
                    quantity: 2,
                    product_name: None,
                    product_price: None,
                    buy_price: None,
                    service_type: None,
                    service_ref: None,
                    ppob_product_id: None,
                    ppob_product_code: None,
                    ppob_inquiry_id: None,
                    ppob_payment_code: None,
                    ppob_flag_id: None,
                        item_discount: None,
                }],
                payment_method: "cash".to_string(),
                payment_amount: 30_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
            },
            |_request| async { Err(AppError::Internal("should not execute".into())) },
        )
        .await
        .expect("checkout success");

        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        assert!(result.items[0].ppob_status.is_none());

        let updated_product = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("product query")
            .expect("product exists");
        assert_eq!(updated_product.stock, 8);
    }

    #[tokio::test]
    async fn ppob_checkout_success_updates_item_and_transaction() {
        let conn = setup_test_db().await;

        let result = checkout_transaction_with_executor(
            &conn,
            CheckoutTransactionInput {
                user_id: 1,
                items: vec![TransactionItemInput {
                    product_id: None,
                    quantity: 1,
                    product_name: Some("Pulsa Telkomsel 10K".to_string()),
                    product_price: Some(12_000.0),
                    buy_price: Some(10_000.0),
                    service_type: Some("pulsa".to_string()),
                    service_ref: Some("08123456789".to_string()),
                    ppob_product_id: Some(101),
                    ppob_product_code: Some("TS10".to_string()),
                    ppob_inquiry_id: None,
                    ppob_payment_code: None,
                    ppob_flag_id: None,
                        item_discount: None,
                }],
                payment_method: "cash".to_string(),
                payment_amount: 12_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
            },
            |request| async move {
                assert_eq!(request.service_type, "pulsa");
                Ok(PaymentResult {
                    success: true,
                    receipt_data: serde_json::json!({}),
                    service_type: "pulsa".to_string(),
                    customer_id: request.customer_id.unwrap_or_default(),
                    amount: 10_000.0,
                    admin_fee: 0.0,
                    total: 10_000.0,
                    product_name: Some("Pulsa Telkomsel 10K".to_string()),
                    customer_name: None,
                    serial_number: Some("SN-123".to_string()),
                })
            },
        )
        .await
        .expect("ppob checkout success");

        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        assert_eq!(result.items[0].ppob_status.as_deref(), Some("success"));
        assert_eq!(result.items[0].ppob_serial_number.as_deref(), Some("SN-123"));
    }

    #[tokio::test]
    async fn ppob_checkout_failure_keeps_transaction_completed_marks_item_failed() {
        let conn = setup_test_db().await;

        let result = checkout_transaction_with_executor(
            &conn,
            CheckoutTransactionInput {
                user_id: 1,
                items: vec![TransactionItemInput {
                    product_id: None,
                    quantity: 1,
                    product_name: Some("Token PLN 20K".to_string()),
                    product_price: Some(21_000.0),
                    buy_price: Some(20_000.0),
                    service_type: Some("pln".to_string()),
                    service_ref: Some("1234567890".to_string()),
                    ppob_product_id: None,
                    ppob_product_code: None,
                    ppob_inquiry_id: Some("INQ-1".to_string()),
                    ppob_payment_code: Some("20000".to_string()),
                    ppob_flag_id: Some("0".to_string()),
                    item_discount: None,
                }],
                payment_method: "cash".to_string(),
                payment_amount: 21_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
            },
            |_request| async { Err(AppError::Internal("Provider timeout".into())) },
        )
        .await
        .expect("ppob checkout should return transaction result even on PPOB failure");

        // Transaction stays completed (payment received)
        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        // But item is marked as failed
        assert_eq!(result.items[0].ppob_status.as_deref(), Some("failed"));
        assert!(
            result.items[0]
                .ppob_message
                .as_deref()
                .is_some_and(|message| message.contains("Provider timeout"))
        );
    }

    #[tokio::test]
    async fn mixed_cart_succeeds_with_stock_deduction_and_ppob_fulfillment() {
        let conn = setup_test_db().await;
        let product = insert_product(&conn, "Gula", 18_000.0, 5).await;

        let result = checkout_transaction_with_executor(
            &conn,
            CheckoutTransactionInput {
                user_id: 1,
                items: vec![
                    TransactionItemInput {
                        product_id: Some(product.id),
                        quantity: 1,
                        product_name: None,
                        product_price: None,
                        buy_price: None,
                        service_type: None,
                        service_ref: None,
                        ppob_product_id: None,
                        ppob_product_code: None,
                        ppob_inquiry_id: None,
                        ppob_payment_code: None,
                        ppob_flag_id: None,
                        item_discount: None,
                    },
                    TransactionItemInput {
                        product_id: None,
                        quantity: 1,
                        product_name: Some("Pulsa".to_string()),
                        product_price: Some(10_000.0),
                        buy_price: Some(9_000.0),
                        service_type: Some("pulsa".to_string()),
                        service_ref: Some("08123".to_string()),
                        ppob_product_id: Some(1),
                        ppob_product_code: Some("P1".to_string()),
                        ppob_inquiry_id: None,
                        ppob_payment_code: None,
                        ppob_flag_id: None,
                        item_discount: None,
                    },
                ],
                payment_method: "cash".to_string(),
                payment_amount: 28_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
            },
            |request| async move {
                assert_eq!(request.service_type, "pulsa");
                Ok(PaymentResult {
                    success: true,
                    receipt_data: serde_json::json!({}),
                    service_type: "pulsa".to_string(),
                    customer_id: request.customer_id.unwrap_or_default(),
                    amount: 10_000.0,
                    admin_fee: 0.0,
                    total: 10_000.0,
                    product_name: Some("Pulsa".to_string()),
                    customer_name: None,
                    serial_number: Some("SN-MIX-1".to_string()),
                })
            },
        )
        .await
        .expect("mixed cart checkout success");

        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        assert_eq!(result.items.len(), 2);

        // Physical item: no ppob_status, stock deducted
        let physical_item = result.items.iter().find(|i| i.service_type.is_none()).unwrap();
        assert!(physical_item.ppob_status.is_none());
        let updated_product = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("exists");
        assert_eq!(updated_product.stock, 4);

        // PPOB item: ppob_status = success
        let ppob_item = result.items.iter().find(|i| i.service_type.is_some()).unwrap();
        assert_eq!(ppob_item.ppob_status.as_deref(), Some("success"));
        assert_eq!(ppob_item.ppob_serial_number.as_deref(), Some("SN-MIX-1"));
    }

    #[tokio::test]
    async fn multi_ppob_cart_succeeds_with_all_items_fulfilled() {
        let conn = setup_test_db().await;

        let result = checkout_transaction_with_executor(
            &conn,
            CheckoutTransactionInput {
                user_id: 1,
                items: vec![
                    TransactionItemInput {
                        product_id: None,
                        quantity: 1,
                        product_name: Some("Pulsa 10K".to_string()),
                        product_price: Some(12_000.0),
                        buy_price: Some(10_000.0),
                        service_type: Some("pulsa".to_string()),
                        service_ref: Some("08123".to_string()),
                        ppob_product_id: Some(1),
                        ppob_product_code: Some("P1".to_string()),
                        ppob_inquiry_id: None,
                        ppob_payment_code: None,
                        ppob_flag_id: None,
                        item_discount: None,
                    },
                    TransactionItemInput {
                        product_id: None,
                        quantity: 1,
                        product_name: Some("Token PLN".to_string()),
                        product_price: Some(21_000.0),
                        buy_price: Some(20_000.0),
                        service_type: Some("pln".to_string()),
                        service_ref: Some("123456".to_string()),
                        ppob_product_id: None,
                        ppob_product_code: None,
                        ppob_inquiry_id: Some("INQ-2".to_string()),
                        ppob_payment_code: Some("20000".to_string()),
                        ppob_flag_id: Some("0".to_string()),
                        item_discount: None,
                    },
                ],
                payment_method: "cash".to_string(),
                payment_amount: 33_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
            },
            |request| async move {
                let sn = if request.service_type == "pulsa" {
                    "SN-PULSA"
                } else {
                    "SN-PLN"
                };
                Ok(PaymentResult {
                    success: true,
                    receipt_data: serde_json::json!({}),
                    service_type: request.service_type.clone(),
                    customer_id: request.customer_id.unwrap_or_default(),
                    amount: 10_000.0,
                    admin_fee: 0.0,
                    total: 10_000.0,
                    product_name: None,
                    customer_name: None,
                    serial_number: Some(sn.to_string()),
                })
            },
        )
        .await
        .expect("multi PPOB checkout should succeed");

        assert_eq!(result.transaction.status, STATUS_COMPLETED);
        assert_eq!(result.items.len(), 2);

        let pulsa_item = result
            .items
            .iter()
            .find(|i| i.service_type.as_deref() == Some("pulsa"))
            .unwrap();
        assert_eq!(pulsa_item.ppob_status.as_deref(), Some("success"));
        assert_eq!(
            pulsa_item.ppob_serial_number.as_deref(),
            Some("SN-PULSA")
        );

        let pln_item = result
            .items
            .iter()
            .find(|i| i.service_type.as_deref() == Some("pln"))
            .unwrap();
        assert_eq!(pln_item.ppob_status.as_deref(), Some("success"));
        assert_eq!(pln_item.ppob_serial_number.as_deref(), Some("SN-PLN"));
    }
}
