//! The two corrections an admin may make to a completed sale: voiding it, and
//! fixing the payment method it was recorded under.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait,
    PaginatorTrait, QueryFilter, Set, Statement, TransactionTrait,
};

use super::VALID_PAYMENT_METHODS;
use crate::domain::transactions::{DeleteTransactionInput, UpdatePaymentMethodInput};
use crate::domain::Actor;
use crate::entity::{transaction_items, transactions};
use crate::services::guard;
use crate::utils::AppError;

/// Void a completed sale: restore the stock, zero the total and record who did
/// it and why. The row is kept so the receipt can still be reprinted.
pub async fn void(
    db: &DatabaseConnection,
    actor: &Actor,
    input: DeleteTransactionInput,
) -> Result<(), AppError> {
    // Voiding a sale is an admin action.
    guard::require_admin(actor)?;

    if input.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "Alasan penghapusan wajib diisi".into(),
        ));
    }

    let transaction = transactions::Entity::find_by_id(input.transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    if transaction.deleted_at.is_some() {
        return Err(AppError::Validation(
            "Transaksi sudah dihapus sebelumnya".into(),
        ));
    }

    // Check for linked refunds
    use crate::entity::refunds;
    let refund_count = refunds::Entity::find()
        .filter(refunds::Column::TransactionId.eq(input.transaction_id))
        .count(db)
        .await?;

    if refund_count > 0 {
        return Err(AppError::Validation(
            "Tidak dapat menghapus transaksi yang sudah pernah di-refund".into(),
        ));
    }

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(input.transaction_id))
        .all(db)
        .await?;

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let txn = db.begin().await?;

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
        "UPDATE transactions
         SET status = 'deleted',
             total_amount = 0,
             deleted_at = $1,
             deleted_by = $2,
             deleted_reason = $3,
             updated_at = $1
         WHERE id = $4",
        vec![
            now.into(),
            actor.user_id.into(),
            input.reason.trim().to_string().into(),
            input.transaction_id.into(),
        ],
    ))
    .await?;

    txn.commit().await?;

    Ok(())
}

/// Correct the payment method a sale was recorded under, rewriting the payment
/// breakdown so shift closing and the reports read the same source of truth.
pub async fn update_payment_method(
    db: &DatabaseConnection,
    actor: &Actor,
    input: UpdatePaymentMethodInput,
) -> Result<transactions::Model, AppError> {
    // Same reasoning as `void`: correcting a completed sale is an admin action.
    guard::require_admin(actor)?;

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
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    if transaction.deleted_at.is_some() {
        return Err(AppError::Validation(
            "Tidak dapat mengubah transaksi yang sudah dihapus".into(),
        ));
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let payment_amount = transaction.total_amount;
    let txn = db.begin().await?;

    // Changing payment method should also rewrite the payment breakdown
    // so shift closing and reports read the same source of truth.
    txn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "DELETE FROM transaction_payments WHERE transaction_id = $1",
        vec![input.transaction_id.into()],
    ))
    .await?;

    txn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "INSERT INTO transaction_payments (transaction_id, payment_method, bank_name, amount, created_at)
         VALUES ($1, $2, NULL, $3, $4)",
        vec![
            input.transaction_id.into(),
            input.payment_method.clone().into(),
            transaction.total_amount.into(),
            now.clone().into(),
        ],
    ))
    .await?;

    let mut active_txn: transactions::ActiveModel = transaction.into();
    active_txn.payment_method = Set(input.payment_method);
    active_txn.payment_amount = Set(payment_amount);
    active_txn.change_amount = Set(Some(0.0));
    active_txn.updated_at = Set(Some(now));
    let updated = active_txn.update(&txn).await?;

    txn.commit().await?;

    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::transactions::{
        CheckoutTransactionInput, TransactionItemInput, TransactionResult,
    };
    use crate::services::transactions::checkout::checkout_with_executor;
    use crate::services::transactions::fixtures::{insert_product, setup_test_db};
    use crate::services::transactions::STATUS_COMPLETED;
    use crate::test_support::insert_user;

    /// The seeded admin (id 1).
    fn actor() -> Actor {
        Actor::new(1, "admin")
    }

    async fn seed_sale(conn: &DatabaseConnection) -> TransactionResult {
        let product = insert_product(conn, "Kopi Sachet", 2_000.0, 10).await;
        checkout_with_executor(
            conn,
            &actor(),
            CheckoutTransactionInput {
                items: vec![TransactionItemInput {
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
                }],
                payment_method: "cash".to_string(),
                payment_amount: 2_000.0,
                notes: None,
                transaction_discount: None,
                shift_id: None,
                payment_breakdown: None,
            },
            |_request| async { Err(AppError::Internal("should not execute".into())) },
        )
        .await
        .expect("checkout success")
    }

    /// Voiding a sale is admin-only. Whether the account is still *active* is
    /// decided when the actor is resolved, one layer up; see
    /// `a_session_belonging_to_a_deactivated_user_is_rejected` in
    /// `http/session.rs`.
    #[tokio::test]
    async fn kasir_cannot_void_a_transaction() {
        let conn = setup_test_db().await;
        let sale = seed_sale(&conn).await;
        let kasir = insert_user(&conn, "kasir1", "Kasir", "kasir").await;

        let result = void(
            &conn,
            &Actor::from(&kasir),
            DeleteTransactionInput {
                transaction_id: sale.transaction.id,
                reason: "Salah input".to_string(),
            },
        )
        .await;

        match result {
            Err(AppError::Forbidden(_)) => {}
            other => panic!("Expected Forbidden error, got: {:?}", other),
        }

        let reloaded = transactions::Entity::find_by_id(sale.transaction.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("transaction exists");
        assert_eq!(reloaded.status, STATUS_COMPLETED);
    }

    #[tokio::test]
    async fn kasir_cannot_change_the_payment_method() {
        let conn = setup_test_db().await;
        let sale = seed_sale(&conn).await;
        let kasir = insert_user(&conn, "kasir1", "Kasir", "kasir").await;

        let result = update_payment_method(
            &conn,
            &Actor::from(&kasir),
            UpdatePaymentMethodInput {
                transaction_id: sale.transaction.id,
                payment_method: "qris".to_string(),
                reason: "Salah pilih".to_string(),
            },
        )
        .await;

        match result {
            Err(AppError::Forbidden(_)) => {}
            other => panic!("Expected Forbidden error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn an_admin_can_void_a_transaction() {
        let conn = setup_test_db().await;
        let sale = seed_sale(&conn).await;

        void(
            &conn,
            &actor(),
            DeleteTransactionInput {
                transaction_id: sale.transaction.id,
                reason: "Salah input".to_string(),
            },
        )
        .await
        .expect("an admin may void");

        let reloaded = transactions::Entity::find_by_id(sale.transaction.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("transaction exists");
        assert_eq!(reloaded.status, "deleted");
    }
}
