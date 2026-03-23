use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::entity::{products, store_info, transaction_items, transactions, users};
use crate::utils::AppError;
use crate::commands::settings::parse_app_settings;

#[derive(Debug, Deserialize)]
pub struct TransactionItemInput {
    pub product_id: i64,
    pub quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateTransactionInput {
    pub user_id: i64,
    pub items: Vec<TransactionItemInput>,
    pub payment_method: String,
    pub payment_amount: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TransactionResult {
    pub transaction: transactions::Model,
    pub items: Vec<transaction_items::Model>,
}

struct ResolvedItem {
    product_id: i64,
    product_name: String,
    sell_price: f64,
    quantity: i64,
    subtotal: f64,
}

const VALID_PAYMENT_METHODS: &[&str] = &["cash", "qris", "ewallet", "transfer"];

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

#[tauri::command]
pub async fn create_transaction(
    db: State<'_, DatabaseConnection>,
    input: CreateTransactionInput,
) -> Result<TransactionResult, AppError> {
    if input.items.is_empty() {
        return Err(AppError::Validation(
            "Item transaksi tidak boleh kosong".into(),
        ));
    }

    if !VALID_PAYMENT_METHODS.contains(&input.payment_method.as_str()) {
        return Err(AppError::Validation(format!(
            "Metode pembayaran tidak valid: {}",
            input.payment_method
        )));
    }

    let txn = db.begin().await?;

    let receipt_number = generate_receipt_number(&txn).await?;

    // Read allow_negative_stock setting
    let allow_negative_stock = store_info::Entity::find_by_id(1_i64)
        .one(&txn)
        .await?
        .map(|s| parse_app_settings(&s.additional_info).sales.allow_negative_stock)
        .unwrap_or(true);

    // Resolve and validate all items
    let mut resolved_items: Vec<ResolvedItem> = Vec::with_capacity(input.items.len());

    for item_input in &input.items {
        if item_input.quantity <= 0 {
            return Err(AppError::Validation(
                "Jumlah item harus lebih dari 0".into(),
            ));
        }

        let product = products::Entity::find_by_id(item_input.product_id)
            .filter(products::Column::IsActive.eq(true))
            .one(&txn)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "Produk dengan ID {} tidak ditemukan atau tidak aktif",
                    item_input.product_id
                ))
            })?;

        if product.stock < item_input.quantity {
            if !allow_negative_stock {
                return Err(AppError::Validation(format!(
                    "Stok '{}' tidak cukup (tersedia: {}, diminta: {})",
                    product.name, product.stock, item_input.quantity
                )));
            }
        }

        let subtotal = product.sell_price * item_input.quantity as f64;

        resolved_items.push(ResolvedItem {
            product_id: product.id,
            product_name: product.name,
            sell_price: product.sell_price,
            quantity: item_input.quantity,
            subtotal,
        });
    }

    let total_amount: f64 = resolved_items.iter().map(|i| i.subtotal).sum();

    if input.payment_method == "cash" && input.payment_amount < total_amount {
        return Err(AppError::Validation(format!(
            "Pembayaran kurang. Total: {}, Dibayar: {}",
            total_amount, input.payment_amount
        )));
    }

    let change_amount = if input.payment_method == "cash" {
        input.payment_amount - total_amount
    } else {
        0.0
    };

    let payment_amount = if input.payment_method == "cash" {
        input.payment_amount
    } else {
        total_amount
    };

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_txn = transactions::ActiveModel {
        id: NotSet,
        receipt_number: Set(receipt_number),
        user_id: Set(input.user_id),
        total_amount: Set(total_amount),
        payment_method: Set(input.payment_method),
        payment_amount: Set(payment_amount),
        change_amount: Set(Some(change_amount)),
        status: Set("completed".to_string()),
        notes: Set(input.notes),
        created_at: Set(Some(now.clone())),
    };

    let transaction = new_txn.insert(&txn).await?;

    let mut items: Vec<transaction_items::Model> = Vec::with_capacity(resolved_items.len());

    for resolved in &resolved_items {
        let new_item = transaction_items::ActiveModel {
            id: NotSet,
            transaction_id: Set(transaction.id),
            product_id: Set(resolved.product_id),
            product_name: Set(resolved.product_name.clone()),
            product_price: Set(resolved.sell_price),
            quantity: Set(resolved.quantity),
            subtotal: Set(resolved.subtotal),
            created_at: Set(Some(now.clone())),
        };

        let item = new_item.insert(&txn).await?;
        items.push(item);

        // Atomically deduct stock
        txn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE products SET stock = stock - $1, updated_at = $2 WHERE id = $3",
            vec![
                (resolved.quantity as i64).into(),
                chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string().into(),
                resolved.product_id.into(),
            ],
        ))
        .await?;
    }

    txn.commit().await?;

    Ok(TransactionResult { transaction, items })
}

#[tauri::command]
pub async fn get_next_receipt_number(
    db: State<'_, DatabaseConnection>,
) -> Result<String, AppError> {
    generate_receipt_number(db.inner()).await
}

// --- Transaction History Commands ---

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
    pub payment_method: String,
    pub payment_amount: f64,
    pub change_amount: f64,
    pub status: String,
    pub item_count: i64,
    pub notes: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PaginatedTransactions {
    pub data: Vec<TransactionListItem>,
    pub total: u64,
    pub page: u64,
    pub per_page: u64,
    pub total_pages: u64,
}

#[tauri::command]
pub async fn list_transactions(
    db: State<'_, DatabaseConnection>,
    input: ListTransactionsInput,
) -> Result<PaginatedTransactions, AppError> {
    let page = input.page.unwrap_or(1).max(1);
    let per_page = input.per_page.unwrap_or(50).min(100);

    let mut query = transactions::Entity::find()
        .order_by(transactions::Column::CreatedAt, Order::Desc);

    // Convert local date boundaries to UTC for filtering
    let offset_secs = chrono::Local::now().offset().local_minus_utc() as i64;

    if let Some(ref date_from) = input.date_from {
        let local_start = format!("{} 00:00:00", date_from);
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&local_start, "%Y-%m-%d %H:%M:%S") {
            let utc_start = ndt - chrono::Duration::seconds(offset_secs);
            query = query.filter(transactions::Column::CreatedAt.gte(utc_start.format("%Y-%m-%d %H:%M:%S").to_string()));
        }
    }
    if let Some(ref date_to) = input.date_to {
        let local_end = format!("{} 23:59:59", date_to);
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&local_end, "%Y-%m-%d %H:%M:%S") {
            let utc_end = ndt - chrono::Duration::seconds(offset_secs);
            query = query.filter(transactions::Column::CreatedAt.lte(utc_end.format("%Y-%m-%d %H:%M:%S").to_string()));
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
        let item_count = transaction_items::Entity::find()
            .filter(transaction_items::Column::TransactionId.eq(txn.id))
            .count(db.inner())
            .await? as i64;

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
            payment_method: txn.payment_method,
            payment_amount: txn.payment_amount,
            change_amount: txn.change_amount.unwrap_or(0.0),
            status: txn.status,
            item_count,
            notes: txn.notes,
            created_at: txn.created_at,
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
}

#[tauri::command]
pub async fn get_transaction_detail(
    db: State<'_, DatabaseConnection>,
    transaction_id: i64,
) -> Result<TransactionDetail, AppError> {
    let txn = transactions::Entity::find_by_id(transaction_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .all(db.inner())
        .await?;

    let cashier = users::Entity::find_by_id(txn.user_id)
        .one(db.inner())
        .await?;
    let cashier_name = cashier
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".into());

    Ok(TransactionDetail {
        transaction: txn,
        items,
        cashier_name,
    })
}
