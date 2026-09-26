//! The two corrections an admin may make to a completed sale: voiding it, and
//! fixing the payment method it was recorded under.

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, PaginatorTrait,
    QueryFilter, Statement, TransactionTrait,
};

use super::{
    validate_payment_method, PPOB_STATUS_PENDING, PPOB_STATUS_PROCESSING, PPOB_STATUS_UNCERTAIN,
};
use crate::domain::transactions::{DeleteTransactionInput, UpdatePaymentMethodInput};
use crate::domain::Actor;
use crate::entity::{refunds, transaction_items, transactions};
use crate::services::guard;
use crate::utils::time::now_ts;
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

    let refund_count = refunds::Entity::find()
        .filter(refunds::Column::TransactionId.eq(input.transaction_id))
        .count(db)
        .await?;

    if refund_count > 0 {
        return Err(AppError::Validation(
            "Tidak dapat menghapus transaksi yang sudah pernah di-refund".into(),
        ));
    }

    if let Some(refusal) = unsettled_ppob_refusal(db, input.transaction_id).await? {
        return Err(refusal);
    }

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(input.transaction_id))
        .all(db)
        .await?;

    let now = now_ts();

    let txn = db.begin().await?;

    // Soft delete first, with the checks above repeated inside the write.
    let voided =
        soft_delete_if_voidable(&txn, actor, input.transaction_id, input.reason.trim(), &now)
            .await?;

    if !voided {
        // Name the PPOB line if that is what stopped it; otherwise another
        // void or a refund got there first.
        if let Some(refusal) = unsettled_ppob_refusal(&txn, input.transaction_id).await? {
            return Err(refusal);
        }
        return Err(AppError::Validation(
            "Transaksi baru saja dihapus atau di-refund. Muat ulang lalu coba lagi.".into(),
        ));
    }

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

    txn.commit().await?;

    Ok(())
}

/// Mark the sale voided, but only while it is still live, unrefunded and has
/// no PPOB line whose outcome is still open. `false` when it matched no row.
///
/// The checks in [`void`] run outside its transaction, so two voids (a double
/// click, or two admins) could both pass them; without this guard each restored
/// the stock, giving the goods back twice. Whichever loses the race matches no
/// row here and rolls back before touching stock. The same goes for a PPOB
/// retry claimed in between: the line is `processing` again and the void must
/// not land.
async fn soft_delete_if_voidable<C: ConnectionTrait>(
    db: &C,
    actor: &Actor,
    transaction_id: i64,
    reason: &str,
    now: &str,
) -> Result<bool, AppError> {
    let voided = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transactions
             SET status = 'deleted',
                 total_amount = 0,
                 deleted_at = $1,
                 deleted_by = $2,
                 deleted_reason = $3,
                 updated_at = $1
             WHERE id = $4
               AND deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM refunds WHERE transaction_id = $4)
               AND NOT EXISTS (
                   SELECT 1 FROM transaction_items
                   WHERE transaction_id = $4 AND ppob_status IN ($5, $6, $7)
               )",
            vec![
                now.into(),
                actor.user_id.into(),
                reason.into(),
                transaction_id.into(),
                PPOB_STATUS_PENDING.into(),
                PPOB_STATUS_PROCESSING.into(),
                PPOB_STATUS_UNCERTAIN.into(),
            ],
        ))
        .await?;
    Ok(voided.rows_affected() == 1)
}

/// Why a sale cannot be voided yet because of its PPOB lines, if it cannot.
///
/// `pending` and `processing` mean a provider call is in flight: the provider
/// may still pay, and voiding would hand the customer's money back for a
/// purchase that then goes through. `uncertain` means the call's answer never
/// arrived and the money may already be spent; a person has to settle it
/// against the Mitra history first.
async fn unsettled_ppob_refusal<C: ConnectionTrait>(
    db: &C,
    transaction_id: i64,
) -> Result<Option<AppError>, AppError> {
    let statuses = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .filter(transaction_items::Column::PpobStatus.is_in([
            PPOB_STATUS_PENDING,
            PPOB_STATUS_PROCESSING,
            PPOB_STATUS_UNCERTAIN,
        ]))
        .all(db)
        .await?
        .into_iter()
        .filter_map(|item| item.ppob_status)
        .collect::<Vec<_>>();

    if statuses
        .iter()
        .any(|s| s == PPOB_STATUS_PENDING || s == PPOB_STATUS_PROCESSING)
    {
        return Ok(Some(AppError::Validation(
            "PPOB di transaksi ini masih diproses. Tunggu hasil PPOB selesai dulu, baru hapus transaksinya."
                .into(),
        )));
    }
    if !statuses.is_empty() {
        return Ok(Some(AppError::Validation(
            "Hasil PPOB di transaksi ini belum pasti. Cek riwayat Mitra dan tandai berhasil atau gagal dulu, baru hapus transaksinya."
                .into(),
        )));
    }
    Ok(None)
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

    validate_payment_method(&input.payment_method)?;

    if input.reason.trim().is_empty() {
        return Err(AppError::Validation("Alasan perubahan wajib diisi".into()));
    }

    let now = now_ts();
    let txn = db.begin().await?;

    // The sale is changed first, and only while it is still live. Checking
    // `deleted_at` on a read made before this transaction let a void land in
    // between: the method change then went through on a voided sale and wrote
    // a payment row for its old total next to a zeroed `total_amount`. The
    // amount is taken from the row inside the same statement for the same
    // reason. A void that loses the race sees the new method, which is fine.
    let changed = txn
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transactions
             SET payment_method = $1,
                 payment_amount = total_amount,
                 change_amount = 0,
                 updated_at = $2
             WHERE id = $3 AND deleted_at IS NULL",
            vec![
                input.payment_method.clone().into(),
                now.clone().into(),
                input.transaction_id.into(),
            ],
        ))
        .await?;

    if changed.rows_affected() != 1 {
        let exists = transactions::Entity::find_by_id(input.transaction_id)
            .one(&txn)
            .await?
            .is_some();
        return Err(if exists {
            AppError::Validation("Tidak dapat mengubah transaksi yang sudah dihapus".into())
        } else {
            AppError::NotFound("Transaksi tidak ditemukan".into())
        });
    }

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
         SELECT id, $2, NULL, total_amount, $3 FROM transactions WHERE id = $1",
        vec![
            input.transaction_id.into(),
            input.payment_method.into(),
            now.into(),
        ],
    ))
    .await?;

    let updated = transactions::Entity::find_by_id(input.transaction_id)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    txn.commit().await?;

    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::transactions::TransactionResult;
    use crate::entity::{products, transaction_payments};
    use crate::services::transactions::checkout::checkout_with_executor;
    use crate::services::transactions::fixtures::{
        admin as actor, cash_checkout, insert_product, no_provider, product_line, seed_ppob_sale,
        setup_test_db,
    };
    use crate::services::transactions::STATUS_COMPLETED;
    use crate::test_support::insert_user;

    async fn seed_sale(conn: &DatabaseConnection) -> TransactionResult {
        let product = insert_product(conn, "Kopi Sachet", 2_000.0, 10).await;
        checkout_with_executor(
            conn,
            &actor(),
            cash_checkout(vec![product_line(product.id, 1)], 2_000.0),
            no_provider,
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

    /// The goods go back on the shelf once, however many times the void is
    /// sent.
    #[tokio::test]
    async fn a_second_void_restores_no_more_stock() {
        let conn = setup_test_db().await;
        let sale = seed_sale(&conn).await;
        let product_id = sale.items[0].product_id.expect("goods line");
        let void_input = || DeleteTransactionInput {
            transaction_id: sale.transaction.id,
            reason: "Salah input".to_string(),
        };

        void(&conn, &actor(), void_input())
            .await
            .expect("first void");
        assert!(void(&conn, &actor(), void_input()).await.is_err());

        let product = products::Entity::find_by_id(product_id)
            .one(&conn)
            .await
            .expect("query")
            .expect("product exists");
        assert_eq!(product.stock, 10);
    }

    fn void_of(item: &transaction_items::Model) -> DeleteTransactionInput {
        DeleteTransactionInput {
            transaction_id: item.transaction_id,
            reason: "Salah input".to_string(),
        }
    }

    async fn is_voided(conn: &DatabaseConnection, transaction_id: i64) -> bool {
        transactions::Entity::find_by_id(transaction_id)
            .one(conn)
            .await
            .expect("query")
            .expect("transaction exists")
            .deleted_at
            .is_some()
    }

    /// A PPOB call still in flight may yet pay the provider. Voiding the sale
    /// then handed the customer's money back for a purchase that went through.
    #[tokio::test]
    async fn a_sale_whose_ppob_line_is_in_flight_cannot_be_voided() {
        for status in [PPOB_STATUS_PENDING, PPOB_STATUS_PROCESSING] {
            let conn = setup_test_db().await;
            let item = seed_ppob_sale(&conn, status).await;

            match void(&conn, &actor(), void_of(&item)).await {
                Err(AppError::Validation(msg)) => assert!(
                    msg.contains("Tunggu hasil PPOB selesai dulu"),
                    "{status}: message should say to wait, got: {msg}"
                ),
                other => panic!("{status}: expected Validation, got {:?}", other),
            }
            assert!(!is_voided(&conn, item.transaction_id).await, "{status}");
        }
    }

    /// An `uncertain` line may already have spent the money; it has to be
    /// settled against the Mitra history before the sale can go.
    #[tokio::test]
    async fn a_sale_whose_ppob_line_is_uncertain_cannot_be_voided() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, PPOB_STATUS_UNCERTAIN).await;

        match void(&conn, &actor(), void_of(&item)).await {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("belum pasti"),
                "message should say the outcome is open, got: {msg}"
            ),
            other => panic!("expected Validation, got {:?}", other),
        }
        assert!(!is_voided(&conn, item.transaction_id).await);
    }

    /// The guard inside the write holds on its own. A PPOB retry claimed after
    /// `void`'s pre-check turns the line back to `processing`; the soft delete
    /// must then match nothing, or the customer is paid back for a purchase
    /// the provider may still make.
    #[tokio::test]
    async fn the_void_write_itself_refuses_an_unsettled_ppob_line() {
        for status in [
            PPOB_STATUS_PENDING,
            PPOB_STATUS_PROCESSING,
            PPOB_STATUS_UNCERTAIN,
        ] {
            let conn = setup_test_db().await;
            let item = seed_ppob_sale(&conn, status).await;

            let voided = soft_delete_if_voidable(
                &conn,
                &actor(),
                item.transaction_id,
                "Salah input",
                &now_ts(),
            )
            .await
            .expect("query");
            assert!(!voided, "{status}: the write must not land");
            assert!(!is_voided(&conn, item.transaction_id).await, "{status}");
        }

        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, "success").await;
        let voided = soft_delete_if_voidable(
            &conn,
            &actor(),
            item.transaction_id,
            "Salah input",
            &now_ts(),
        )
        .await
        .expect("query");
        assert!(voided, "a settled line does not block the write");
    }

    /// Once the PPOB outcome is settled, the sale can be voided as before.
    #[tokio::test]
    async fn a_sale_whose_ppob_line_failed_can_be_voided() {
        let conn = setup_test_db().await;
        let item = seed_ppob_sale(&conn, "failed").await;

        void(&conn, &actor(), void_of(&item))
            .await
            .expect("a settled line does not block the void");
        assert!(is_voided(&conn, item.transaction_id).await);
    }

    /// The live-sale check sits inside the write: a sale voided after the admin
    /// opened the dialog keeps its method and its payment rows. The old code
    /// checked `deleted_at` on a read taken before the transaction, so a void
    /// landing in between let the change through on a voided sale.
    #[tokio::test]
    async fn the_payment_method_of_a_voided_sale_cannot_change() {
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
        .expect("void");

        let result = update_payment_method(
            &conn,
            &actor(),
            UpdatePaymentMethodInput {
                transaction_id: sale.transaction.id,
                payment_method: "qris".to_string(),
                reason: "Salah pilih".to_string(),
            },
        )
        .await;
        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "got {:?}",
            result
        );

        let reloaded = transactions::Entity::find_by_id(sale.transaction.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("transaction exists");
        assert_eq!(reloaded.payment_method, "cash");
        let methods: Vec<String> = transaction_payments::Entity::find()
            .filter(transaction_payments::Column::TransactionId.eq(sale.transaction.id))
            .all(&conn)
            .await
            .expect("query")
            .into_iter()
            .map(|p| p.payment_method)
            .collect();
        assert!(
            methods.iter().all(|m| m == "cash"),
            "payment rows untouched, got {methods:?}"
        );
    }

    #[tokio::test]
    async fn an_admin_can_change_the_payment_method_of_a_live_sale() {
        let conn = setup_test_db().await;
        let sale = seed_sale(&conn).await;

        let updated = update_payment_method(
            &conn,
            &actor(),
            UpdatePaymentMethodInput {
                transaction_id: sale.transaction.id,
                payment_method: "qris".to_string(),
                reason: "Salah pilih".to_string(),
            },
        )
        .await
        .expect("an admin may correct the method");

        assert_eq!(updated.payment_method, "qris");
        assert_eq!(updated.payment_amount, sale.transaction.total_amount);
        assert_eq!(updated.change_amount, Some(0.0));
        let payments = transaction_payments::Entity::find()
            .filter(transaction_payments::Column::TransactionId.eq(sale.transaction.id))
            .all(&conn)
            .await
            .expect("query");
        assert_eq!(payments.len(), 1);
        assert_eq!(payments[0].payment_method, "qris");
        assert_eq!(payments[0].amount, sale.transaction.total_amount);

        let missing = update_payment_method(
            &conn,
            &actor(),
            UpdatePaymentMethodInput {
                transaction_id: 9_999,
                payment_method: "qris".to_string(),
                reason: "Salah pilih".to_string(),
            },
        )
        .await;
        assert!(matches!(missing, Err(AppError::NotFound(_))));
    }
}
