//! `whatsapp_sends`: one row per attempt to send a struk, success or failure.
//! See migration 024.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, NotSet, QueryFilter,
    QueryOrder, Set,
};

use crate::domain::whatsapp::WhatsappSendRecord;
use crate::entity::whatsapp_sends;
use crate::services::settings::now_ts;
use crate::utils::AppError;

/// Record one attempt — success or failure. Its own table rather than a
/// column on `transactions`: a sale can be re-sent, and every attempt is worth
/// keeping for "Terkirim ke 0812..." in the transaction history, which a
/// single nullable column could only ever remember the last of.
pub async fn record_send(
    db: &DatabaseConnection,
    transaction_id: i64,
    phone: &str,
    result: &Result<(), String>,
) -> Result<(), AppError> {
    let (status, error) = match result {
        Ok(()) => ("sent", None),
        Err(message) => ("failed", Some(message.clone())),
    };

    whatsapp_sends::ActiveModel {
        id: NotSet,
        transaction_id: Set(transaction_id),
        phone: Set(phone.to_string()),
        status: Set(status.to_string()),
        error: Set(error),
        sent_at: Set(Some(now_ts())),
    }
    .insert(db)
    .await?;

    Ok(())
}

/// Every past send for a transaction, newest first — the transaction
/// history's "Terkirim ke 0812...".
pub async fn sends_for_transaction(
    db: &DatabaseConnection,
    transaction_id: i64,
) -> Result<Vec<WhatsappSendRecord>, AppError> {
    Ok(whatsapp_sends::Entity::find()
        .filter(whatsapp_sends::Column::TransactionId.eq(transaction_id))
        .order_by_desc(whatsapp_sends::Column::Id)
        .all(db)
        .await?
        .into_iter()
        .map(WhatsappSendRecord::from)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{insert_store_info, insert_transaction, insert_user, setup_test_db};

    #[tokio::test]
    async fn a_transaction_with_no_sends_has_an_empty_history() {
        let db = setup_test_db().await;
        insert_store_info(&db, false).await;
        let cashier = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let transaction = insert_transaction(
            &db,
            cashier.id,
            10_000.0,
            "completed",
            "2026-09-13 07:00:00",
        )
        .await;

        assert!(sends_for_transaction(&db, transaction.id)
            .await
            .expect("read")
            .is_empty());
    }

    #[tokio::test]
    async fn successes_and_failures_are_both_recorded_newest_first() {
        let db = setup_test_db().await;
        insert_store_info(&db, false).await;
        let cashier = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let transaction = insert_transaction(
            &db,
            cashier.id,
            10_000.0,
            "completed",
            "2026-09-13 07:00:00",
        )
        .await;

        record_send(&db, transaction.id, "6281111111111", &Ok(()))
            .await
            .expect("record success");
        record_send(
            &db,
            transaction.id,
            "6282222222222",
            &Err("Nomor tidak valid.".into()),
        )
        .await
        .expect("record failure");

        let history = sends_for_transaction(&db, transaction.id)
            .await
            .expect("read");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].phone, "6282222222222");
        assert_eq!(history[0].status, "failed");
        assert_eq!(history[0].error.as_deref(), Some("Nomor tidak valid."));
        assert_eq!(history[1].phone, "6281111111111");
        assert_eq!(history[1].status, "sent");
        assert_eq!(history[1].error, None);
    }

    #[tokio::test]
    async fn a_transactions_history_never_includes_another_transactions_sends() {
        let db = setup_test_db().await;
        insert_store_info(&db, false).await;
        let cashier = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let first = insert_transaction(
            &db,
            cashier.id,
            10_000.0,
            "completed",
            "2026-09-13 07:00:00",
        )
        .await;
        let second = insert_transaction(
            &db,
            cashier.id,
            20_000.0,
            "completed",
            "2026-09-13 07:05:00",
        )
        .await;

        record_send(&db, first.id, "6281111111111", &Ok(()))
            .await
            .expect("record");

        assert_eq!(
            sends_for_transaction(&db, second.id)
                .await
                .expect("read")
                .len(),
            0
        );
        assert_eq!(
            sends_for_transaction(&db, first.id)
                .await
                .expect("read")
                .len(),
            1
        );
    }
}
