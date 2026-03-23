use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, QueryFilter, Set, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::entity::{
    exchange_items, products, refund_items, refunds, stock_writeoffs, store_info,
    transaction_items, transactions,
};
use crate::commands::settings::parse_app_settings;
use crate::utils::AppError;

const REFUND_MAX_DAYS: i64 = 7;
const VALID_CONDITIONS: &[&str] = &["good", "damaged", "expired"];

// --- Input DTOs ---

#[derive(Debug, Deserialize)]
pub struct RefundItemInput {
    pub transaction_item_id: i64,
    pub product_id: i64,
    pub quantity: i64,
    pub condition: String,
}

#[derive(Debug, Deserialize)]
pub struct ExchangeItemInput {
    pub product_id: i64,
    pub quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateRefundInput {
    pub transaction_id: i64,
    pub user_id: i64,
    pub reason: Option<String>,
    pub items: Vec<RefundItemInput>,
    pub exchange_items: Option<Vec<ExchangeItemInput>>,
}

#[derive(Debug, Deserialize)]
pub struct ListRefundsInput {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub refund_type: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

// --- Output DTOs ---

#[derive(Debug, Serialize)]
pub struct RefundResult {
    pub refund: refunds::Model,
    pub items: Vec<refund_items::Model>,
    pub exchange_items: Vec<exchange_items::Model>,
}

#[derive(Debug, Serialize)]
pub struct RefundDetailItem {
    pub id: i64,
    pub product_name: String,
    pub product_price: f64,
    pub quantity: i64,
    pub subtotal: f64,
    pub condition: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExchangeDetailItem {
    pub id: i64,
    pub product_name: String,
    pub product_price: f64,
    pub quantity: i64,
    pub subtotal: f64,
}

#[derive(Debug, Serialize)]
pub struct RefundDetailResult {
    pub refund: refunds::Model,
    pub items: Vec<RefundDetailItem>,
    pub exchange_items: Vec<ExchangeDetailItem>,
    pub transaction_receipt: String,
    pub cashier_name: String,
}

#[derive(Debug, Serialize)]
pub struct RefundListItem {
    pub id: i64,
    pub refund_number: String,
    pub refund_type: String,
    pub transaction_receipt: String,
    pub cashier_name: String,
    pub total_refund_amount: f64,
    pub total_exchange_amount: f64,
    pub difference_amount: f64,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListRefundsResult {
    pub items: Vec<RefundListItem>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}

// --- Helpers ---

async fn generate_refund_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let prefix = format!("RFD-{}-", today);

    let result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT MAX(CAST(SUBSTR(refund_number, LENGTH($1) + 1) AS INTEGER)) as max_num FROM refunds WHERE refund_number LIKE $2",
            vec![prefix.clone().into(), format!("{}%", prefix).into()],
        ))
        .await?;

    let max_num: i64 = result
        .map(|r| r.try_get::<i64>("", "max_num").unwrap_or(0))
        .unwrap_or(0);

    Ok(format!("{}{:04}", prefix, max_num + 1))
}

async fn generate_writeoff_number<C: ConnectionTrait>(db: &C) -> Result<String, AppError> {
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let prefix = format!("WO-{}-", today);

    let result = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT MAX(CAST(SUBSTR(writeoff_number, LENGTH($1) + 1) AS INTEGER)) as max_num FROM stock_writeoffs WHERE writeoff_number LIKE $2",
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
pub async fn create_refund(
    db: State<'_, DatabaseConnection>,
    input: CreateRefundInput,
) -> Result<RefundResult, AppError> {
    if input.items.is_empty() {
        return Err(AppError::Validation(
            "Item refund tidak boleh kosong".into(),
        ));
    }

    // Validate conditions
    for item in &input.items {
        if !VALID_CONDITIONS.contains(&item.condition.as_str()) {
            return Err(AppError::Validation(format!(
                "Kondisi barang tidak valid: {}",
                item.condition
            )));
        }
        if item.quantity <= 0 {
            return Err(AppError::Validation(
                "Jumlah refund harus lebih dari 0".into(),
            ));
        }
    }

    let txn = db.begin().await?;

    // Get original transaction
    let transaction = transactions::Entity::find_by_id(input.transaction_id)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    // Check status
    if transaction.status == "refunded" {
        return Err(AppError::Validation(
            "Transaksi sudah di-refund sepenuhnya".into(),
        ));
    }

    // Check 7-day limit
    if let Some(ref created_at) = transaction.created_at {
        let txn_date = chrono::NaiveDateTime::parse_from_str(created_at, "%Y-%m-%d %H:%M:%S")
            .map_err(|_| AppError::Internal("Format tanggal transaksi tidak valid".into()))?;

        let now = chrono::Utc::now().naive_utc();
        let diff = now.signed_duration_since(txn_date).num_days();
        if diff > REFUND_MAX_DAYS {
            return Err(AppError::Validation(format!(
                "Refund hanya bisa dilakukan maksimal {} hari setelah pembelian",
                REFUND_MAX_DAYS
            )));
        }
    }

    // Load transaction items for validation
    let txn_items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(input.transaction_id))
        .all(&txn)
        .await?;

    // Load existing refund items for this transaction to check already-refunded quantities
    let existing_refunds = refunds::Entity::find()
        .filter(refunds::Column::TransactionId.eq(input.transaction_id))
        .all(&txn)
        .await?;

    let mut existing_refund_qty: std::collections::HashMap<i64, i64> =
        std::collections::HashMap::new();

    for existing_refund in &existing_refunds {
        let existing_items = refund_items::Entity::find()
            .filter(refund_items::Column::RefundId.eq(existing_refund.id))
            .all(&txn)
            .await?;
        for ei in existing_items {
            *existing_refund_qty
                .entry(ei.transaction_item_id)
                .or_insert(0) += ei.quantity;
        }
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let refund_number = generate_refund_number(&txn).await?;

    let mut total_refund_amount: f64 = 0.0;
    let mut refund_items_result: Vec<refund_items::Model> = Vec::new();

    for item_input in &input.items {
        // Validate transaction item exists and belongs to this transaction
        let txn_item = txn_items
            .iter()
            .find(|ti| ti.id == item_input.transaction_item_id)
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "Item transaksi ID {} tidak ditemukan dalam transaksi ini",
                    item_input.transaction_item_id
                ))
            })?;

        // Check refund quantity doesn't exceed purchased quantity minus already refunded
        let already_refunded = existing_refund_qty
            .get(&item_input.transaction_item_id)
            .copied()
            .unwrap_or(0);
        let available_qty = txn_item.quantity - already_refunded;

        if item_input.quantity > available_qty {
            return Err(AppError::Validation(format!(
                "Jumlah refund {} melebihi sisa yang bisa di-refund ({}) untuk {}",
                item_input.quantity, available_qty, txn_item.product_name
            )));
        }

        let subtotal = txn_item.product_price * item_input.quantity as f64;
        total_refund_amount += subtotal;

        // Create refund item (will set refund_id after refund is created)
    }

    // Determine refund type based on exchange items
    let has_exchange = input
        .exchange_items
        .as_ref()
        .map(|items| !items.is_empty())
        .unwrap_or(false);
    let refund_type = if has_exchange { "exchange" } else { "refund" };

    // Create refund record
    let new_refund = refunds::ActiveModel {
        id: NotSet,
        refund_number: Set(refund_number),
        transaction_id: Set(input.transaction_id),
        user_id: Set(input.user_id),
        refund_type: Set(refund_type.to_string()),
        total_refund_amount: Set(total_refund_amount),
        total_exchange_amount: Set(Some(0.0)),
        difference_amount: Set(Some(0.0)),
        payment_method: Set(Some(transaction.payment_method.clone())),
        reason: Set(input.reason),
        created_at: Set(Some(now.clone())),
    };

    let refund = new_refund.insert(&txn).await?;

    // Create refund items and handle stock
    for item_input in &input.items {
        let txn_item = txn_items
            .iter()
            .find(|ti| ti.id == item_input.transaction_item_id)
            .unwrap();

        let subtotal = txn_item.product_price * item_input.quantity as f64;

        let new_refund_item = refund_items::ActiveModel {
            id: NotSet,
            refund_id: Set(refund.id),
            transaction_item_id: Set(item_input.transaction_item_id),
            product_id: Set(item_input.product_id),
            quantity: Set(item_input.quantity),
            subtotal: Set(subtotal),
            condition: Set(Some(item_input.condition.clone())),
            created_at: Set(Some(now.clone())),
        };

        let refund_item = new_refund_item.insert(&txn).await?;
        refund_items_result.push(refund_item);

        // Handle stock based on condition
        let product = products::Entity::find_by_id(item_input.product_id)
            .one(&txn)
            .await?
            .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan".into()))?;

        if item_input.condition == "good" {
            // Atomically restore stock for good condition items
            txn.execute(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "UPDATE products SET stock = stock + $1, updated_at = $2 WHERE id = $3",
                vec![
                    (item_input.quantity as i64).into(),
                    now.clone().into(),
                    item_input.product_id.into(),
                ],
            ))
            .await?;
        } else {
            // Create stock write-off for damaged/expired items
            let writeoff_number = generate_writeoff_number(&txn).await?;

            let loss_value = product.buy_price * item_input.quantity as f64;

            let new_writeoff = stock_writeoffs::ActiveModel {
                id: NotSet,
                writeoff_number: Set(writeoff_number),
                product_id: Set(item_input.product_id),
                user_id: Set(input.user_id),
                quantity: Set(item_input.quantity),
                reason: Set(item_input.condition.clone()),
                loss_value: Set(loss_value),
                notes: Set(Some(format!(
                    "Auto write-off dari refund {}",
                    refund.refund_number
                ))),
                approved_by: Set(Some(input.user_id)),
                status: Set("approved".to_string()),
                refund_id: Set(Some(refund.id)),
                created_at: Set(Some(now.clone())),
            };

            new_writeoff.insert(&txn).await?;
            // Stock is NOT restored for damaged/expired items (already sold, now written off)
        }
    }

    // Process exchange items if present
    let mut exchange_items_result: Vec<exchange_items::Model> = Vec::new();
    let mut total_exchange_amount: f64 = 0.0;

    if let Some(ref exchange_inputs) = input.exchange_items {
        // Read allow_negative_stock setting for exchange stock check
        let allow_negative_stock = store_info::Entity::find_by_id(1_i64)
            .one(&txn)
            .await?
            .map(|s| parse_app_settings(&s.additional_info).sales.allow_negative_stock)
            .unwrap_or(true);

        for ei_input in exchange_inputs {
            if ei_input.quantity <= 0 {
                return Err(AppError::Validation(
                    "Jumlah item tukar harus lebih dari 0".into(),
                ));
            }

            let product = products::Entity::find_by_id(ei_input.product_id)
                .one(&txn)
                .await?
                .ok_or_else(|| {
                    AppError::NotFound(format!(
                        "Produk exchange ID {} tidak ditemukan",
                        ei_input.product_id
                    ))
                })?;

            if !product.is_active {
                return Err(AppError::Validation(format!(
                    "Produk '{}' tidak aktif",
                    product.name
                )));
            }

            if !allow_negative_stock && product.stock < ei_input.quantity {
                return Err(AppError::Validation(format!(
                    "Stok '{}' tidak cukup (tersedia: {}, diminta: {})",
                    product.name, product.stock, ei_input.quantity
                )));
            }

            let exchange_subtotal = product.sell_price * ei_input.quantity as f64;
            total_exchange_amount += exchange_subtotal;

            let new_exchange_item = exchange_items::ActiveModel {
                id: NotSet,
                refund_id: Set(refund.id),
                product_id: Set(ei_input.product_id),
                product_name: Set(product.name.clone()),
                product_price: Set(product.sell_price),
                quantity: Set(ei_input.quantity),
                subtotal: Set(exchange_subtotal),
                created_at: Set(Some(now.clone())),
            };

            let exchange_item = new_exchange_item.insert(&txn).await?;
            exchange_items_result.push(exchange_item);

            // Atomically deduct stock for exchange item (like a sale)
            txn.execute(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "UPDATE products SET stock = stock - $1, updated_at = $2 WHERE id = $3",
                vec![
                    (ei_input.quantity as i64).into(),
                    now.clone().into(),
                    ei_input.product_id.into(),
                ],
            ))
            .await?;
        }
    }

    // Update refund with exchange amounts if applicable
    if has_exchange {
        let difference_amount = total_refund_amount - total_exchange_amount;
        let mut active_refund: refunds::ActiveModel = refund.clone().into();
        active_refund.total_exchange_amount = Set(Some(total_exchange_amount));
        active_refund.difference_amount = Set(Some(difference_amount));
        active_refund.update(&txn).await?;
    }

    // Determine transaction status: full or partial refund
    let total_refunded_qty: i64 = {
        let mut total = 0i64;
        for ti in &txn_items {
            let prev = existing_refund_qty.get(&ti.id).copied().unwrap_or(0);
            let current = input
                .items
                .iter()
                .find(|ii| ii.transaction_item_id == ti.id)
                .map(|ii| ii.quantity)
                .unwrap_or(0);
            total += prev + current;
        }
        total
    };

    let total_original_qty: i64 = txn_items.iter().map(|ti| ti.quantity).sum();

    let new_status = if total_refunded_qty >= total_original_qty {
        "refunded"
    } else {
        "partial_refund"
    };

    let mut active_txn: transactions::ActiveModel = transaction.into();
    active_txn.status = Set(new_status.to_string());
    active_txn.update(&txn).await?;

    txn.commit().await?;

    Ok(RefundResult {
        refund,
        items: refund_items_result,
        exchange_items: exchange_items_result,
    })
}

#[tauri::command]
pub async fn get_refund_detail(
    db: State<'_, DatabaseConnection>,
    refund_id: i64,
) -> Result<RefundDetailResult, AppError> {
    let refund = refunds::Entity::find_by_id(refund_id)
        .one(db.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("Refund tidak ditemukan".into()))?;

    // Get refund items with product info
    let items = refund_items::Entity::find()
        .filter(refund_items::Column::RefundId.eq(refund_id))
        .all(db.inner())
        .await?;

    let mut detail_items: Vec<RefundDetailItem> = Vec::new();
    for item in items {
        let txn_item = transaction_items::Entity::find_by_id(item.transaction_item_id)
            .one(db.inner())
            .await?;

        let (product_name, product_price) = match txn_item {
            Some(ti) => (ti.product_name, ti.product_price),
            None => ("(deleted)".to_string(), 0.0),
        };

        detail_items.push(RefundDetailItem {
            id: item.id,
            product_name,
            product_price,
            quantity: item.quantity,
            subtotal: item.subtotal,
            condition: item.condition,
        });
    }

    // Get transaction receipt number
    let transaction = transactions::Entity::find_by_id(refund.transaction_id)
        .one(db.inner())
        .await?;
    let transaction_receipt = transaction
        .map(|t| t.receipt_number)
        .unwrap_or_default();

    // Get cashier name
    let user = crate::entity::users::Entity::find_by_id(refund.user_id)
        .one(db.inner())
        .await?;
    let cashier_name = user
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".to_string());

    // Get exchange items
    let exchange_items_models = exchange_items::Entity::find()
        .filter(exchange_items::Column::RefundId.eq(refund_id))
        .all(db.inner())
        .await?;

    let exchange_detail_items: Vec<ExchangeDetailItem> = exchange_items_models
        .into_iter()
        .map(|ei| ExchangeDetailItem {
            id: ei.id,
            product_name: ei.product_name,
            product_price: ei.product_price,
            quantity: ei.quantity,
            subtotal: ei.subtotal,
        })
        .collect();

    Ok(RefundDetailResult {
        refund,
        items: detail_items,
        exchange_items: exchange_detail_items,
        transaction_receipt,
        cashier_name,
    })
}

#[tauri::command]
pub async fn list_refunds(
    db: State<'_, DatabaseConnection>,
    input: ListRefundsInput,
) -> Result<ListRefundsResult, AppError> {
    let page = input.page.unwrap_or(1).max(1);
    let per_page = input.per_page.unwrap_or(50).max(1);
    let offset = (page - 1) * per_page;

    let offset_secs = chrono::Local::now().offset().local_minus_utc() as i64;

    let mut conditions = String::from("WHERE 1=1");
    let mut params: Vec<sea_orm::Value> = Vec::new();

    if let Some(ref refund_type) = input.refund_type {
        if !refund_type.is_empty() {
            conditions.push_str(" AND r.type = ?");
            params.push(refund_type.clone().into());
        }
    }

    if let Some(ref date_from) = input.date_from {
        let local_start = format!("{} 00:00:00", date_from);
        if let Ok(ndt) =
            chrono::NaiveDateTime::parse_from_str(&local_start, "%Y-%m-%d %H:%M:%S")
        {
            let utc_start = ndt - chrono::Duration::seconds(offset_secs);
            conditions.push_str(" AND r.created_at >= ?");
            params.push(utc_start.format("%Y-%m-%d %H:%M:%S").to_string().into());
        }
    }

    if let Some(ref date_to) = input.date_to {
        let local_end = format!("{} 23:59:59", date_to);
        if let Ok(ndt) =
            chrono::NaiveDateTime::parse_from_str(&local_end, "%Y-%m-%d %H:%M:%S")
        {
            let utc_end = ndt - chrono::Duration::seconds(offset_secs);
            conditions.push_str(" AND r.created_at <= ?");
            params.push(utc_end.format("%Y-%m-%d %H:%M:%S").to_string().into());
        }
    }

    // Count query
    let count_sql = format!(
        "SELECT COUNT(*) as cnt FROM refunds r \
         JOIN transactions t ON r.transaction_id = t.id \
         JOIN users u ON r.user_id = u.id \
         {}",
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

    // Data query
    let data_sql = format!(
        "SELECT r.id, r.refund_number, r.type as refund_type, \
         r.total_refund_amount, r.total_exchange_amount, r.difference_amount, \
         r.created_at, t.receipt_number, u.full_name \
         FROM refunds r \
         JOIN transactions t ON r.transaction_id = t.id \
         JOIN users u ON r.user_id = u.id \
         {} \
         ORDER BY r.created_at DESC \
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

    let mut items: Vec<RefundListItem> = Vec::new();
    for row in rows {
        items.push(RefundListItem {
            id: row.try_get::<i64>("", "id").unwrap_or(0),
            refund_number: row
                .try_get::<String>("", "refund_number")
                .unwrap_or_default(),
            refund_type: row
                .try_get::<String>("", "refund_type")
                .unwrap_or_default(),
            transaction_receipt: row
                .try_get::<String>("", "receipt_number")
                .unwrap_or_default(),
            cashier_name: row
                .try_get::<String>("", "full_name")
                .unwrap_or_default(),
            total_refund_amount: row
                .try_get::<f64>("", "total_refund_amount")
                .unwrap_or(0.0),
            total_exchange_amount: row
                .try_get::<f64>("", "total_exchange_amount")
                .unwrap_or(0.0),
            difference_amount: row
                .try_get::<f64>("", "difference_amount")
                .unwrap_or(0.0),
            created_at: row.try_get::<String>("", "created_at").ok(),
        });
    }

    Ok(ListRefundsResult {
        items,
        total,
        page,
        per_page,
        total_pages,
    })
}
