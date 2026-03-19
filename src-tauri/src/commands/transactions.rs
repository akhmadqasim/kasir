use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, QueryFilter, Set, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::entity::{products, transaction_items, transactions};
use crate::utils::AppError;

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
    let date_pattern = chrono::Local::now().format("%Y-%m-%d").to_string();

    let result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) as cnt FROM transactions WHERE DATE(created_at) = $1",
            vec![date_pattern.into()],
        ))
        .await?;

    let count: i64 = result
        .map(|r| r.try_get::<i64>("", "cnt").unwrap_or(0))
        .unwrap_or(0);

    Ok(format!("TRX-{}-{:04}", today, count + 1))
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
            // Allow selling even with insufficient stock - just log warning
            eprintln!(
                "Warning: Stok {} kurang (tersedia: {}, diminta: {})",
                product.name, product.stock, item_input.quantity
            );
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

        // Deduct stock
        let product = products::Entity::find_by_id(resolved.product_id)
            .one(&txn)
            .await?
            .ok_or_else(|| {
                AppError::Internal("Product not found during stock update".into())
            })?;

        let new_stock = product.stock - resolved.quantity;
        let mut active_product: products::ActiveModel = product.into();
        active_product.stock = Set(new_stock);
        active_product.updated_at = Set(Some(
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        ));
        active_product.update(&txn).await?;
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
