use crate::db::Database;
use crate::db::models::transaction::{Transaction, TransactionItem};
use crate::utils::AppError;
use serde::{Deserialize, Serialize};
use tauri::State;

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
    pub transaction: Transaction,
    pub items: Vec<TransactionItem>,
}

struct ResolvedItem {
    product_id: i64,
    product_name: String,
    sell_price: f64,
    quantity: i64,
    subtotal: f64,
}

const VALID_PAYMENT_METHODS: &[&str] = &["cash", "qris", "ewallet", "transfer"];

fn generate_receipt_number(conn: &rusqlite::Connection) -> Result<String, AppError> {
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let date_pattern = chrono::Local::now().format("%Y-%m-%d").to_string();

    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = ?",
        rusqlite::params![date_pattern],
        |row| row.get(0),
    )?;

    Ok(format!("TRX-{}-{:04}", today, count + 1))
}

#[tauri::command]
pub fn create_transaction(
    db: State<'_, Database>,
    input: CreateTransactionInput,
) -> Result<TransactionResult, AppError> {
    if input.items.is_empty() {
        return Err(AppError::Validation("Item transaksi tidak boleh kosong".into()));
    }

    if !VALID_PAYMENT_METHODS.contains(&input.payment_method.as_str()) {
        return Err(AppError::Validation(format!(
            "Metode pembayaran tidak valid: {}",
            input.payment_method
        )));
    }

    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    conn.execute_batch("BEGIN IMMEDIATE")?;

    let result = (|| -> Result<TransactionResult, AppError> {
        let receipt_number = generate_receipt_number(&conn)?;

        // Resolve and validate all items
        let mut resolved_items: Vec<ResolvedItem> = Vec::with_capacity(input.items.len());

        for item_input in &input.items {
            if item_input.quantity <= 0 {
                return Err(AppError::Validation(
                    "Jumlah item harus lebih dari 0".into(),
                ));
            }

            let product: (i64, String, f64, i64) = conn
                .query_row(
                    "SELECT id, name, sell_price, stock FROM products WHERE id = ? AND is_active = 1",
                    rusqlite::params![item_input.product_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!(
                        "Produk dengan ID {} tidak ditemukan atau tidak aktif",
                        item_input.product_id
                    )),
                    _ => AppError::Database(e),
                })?;

            let (product_id, product_name, sell_price, stock) = product;

            if stock < item_input.quantity {
                return Err(AppError::Validation(format!(
                    "Stok tidak cukup untuk {} (tersedia: {}, diminta: {})",
                    product_name, stock, item_input.quantity
                )));
            }

            let subtotal = sell_price * item_input.quantity as f64;

            resolved_items.push(ResolvedItem {
                product_id,
                product_name,
                sell_price,
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

        conn.execute(
            "INSERT INTO transactions (receipt_number, user_id, total_amount, payment_method, payment_amount, change_amount, status, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, CURRENT_TIMESTAMP)",
            rusqlite::params![
                receipt_number,
                input.user_id,
                total_amount,
                input.payment_method,
                payment_amount,
                change_amount,
                input.notes,
            ],
        )?;

        let transaction_id = conn.last_insert_rowid();

        let mut transaction_items: Vec<TransactionItem> = Vec::with_capacity(resolved_items.len());

        for resolved in &resolved_items {
            conn.execute(
                "INSERT INTO transaction_items (transaction_id, product_id, product_name, product_price, quantity, subtotal, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                rusqlite::params![
                    transaction_id,
                    resolved.product_id,
                    resolved.product_name,
                    resolved.sell_price,
                    resolved.quantity,
                    resolved.subtotal,
                ],
            )?;

            let item_id = conn.last_insert_rowid();

            conn.execute(
                "UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                rusqlite::params![resolved.quantity, resolved.product_id],
            )?;

            transaction_items.push(TransactionItem {
                id: item_id,
                transaction_id,
                product_id: resolved.product_id,
                product_name: resolved.product_name.clone(),
                product_price: resolved.sell_price,
                quantity: resolved.quantity,
                subtotal: resolved.subtotal,
                created_at: String::new(),
            });
        }

        // Read back the transaction to get the actual created_at
        let transaction = conn.query_row(
            "SELECT id, receipt_number, user_id, total_amount, payment_method, payment_amount, change_amount, status, notes, created_at
             FROM transactions WHERE id = ?",
            rusqlite::params![transaction_id],
            |row| {
                Ok(Transaction {
                    id: row.get(0)?,
                    receipt_number: row.get(1)?,
                    user_id: row.get(2)?,
                    total_amount: row.get(3)?,
                    payment_method: row.get(4)?,
                    payment_amount: row.get(5)?,
                    change_amount: row.get(6)?,
                    status: row.get(7)?,
                    notes: row.get(8)?,
                    created_at: row.get(9)?,
                })
            },
        )?;

        // Read back items to get actual created_at values
        let mut stmt = conn.prepare(
            "SELECT id, transaction_id, product_id, product_name, product_price, quantity, subtotal, created_at
             FROM transaction_items WHERE transaction_id = ?",
        )?;

        let items = stmt
            .query_map(rusqlite::params![transaction_id], |row| {
                Ok(TransactionItem {
                    id: row.get(0)?,
                    transaction_id: row.get(1)?,
                    product_id: row.get(2)?,
                    product_name: row.get(3)?,
                    product_price: row.get(4)?,
                    quantity: row.get(5)?,
                    subtotal: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(TransactionResult {
            transaction,
            items,
        })
    })();

    match result {
        Ok(transaction_result) => {
            conn.execute_batch("COMMIT")?;
            Ok(transaction_result)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

#[tauri::command]
pub fn get_next_receipt_number(db: State<'_, Database>) -> Result<String, AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    generate_receipt_number(&conn)
}
