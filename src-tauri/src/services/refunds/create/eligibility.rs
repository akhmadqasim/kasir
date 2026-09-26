//! Whether a refund may happen at all: a well-formed request, against a sale
//! that is neither voided nor already fully refunded, inside the seven-day
//! window.

use sea_orm::{ConnectionTrait, EntityTrait};

use crate::domain::refunds::CreateRefundInput;
use crate::entity::transactions;
use crate::utils::time::TIMESTAMP_FORMAT;
use crate::utils::AppError;

const REFUND_MAX_DAYS: i64 = 7;
const VALID_CONDITIONS: &[&str] = &["good", "damaged", "expired"];

/// Checks the request on its own, before anything is read.
pub(super) fn validate_input(input: &CreateRefundInput) -> Result<(), AppError> {
    if input.items.is_empty() {
        return Err(AppError::Validation(
            "Item refund tidak boleh kosong".into(),
        ));
    }

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

    Ok(())
}

/// The sale being refunded, if it may still be refunded.
pub(super) async fn load_refundable_transaction<C: ConnectionTrait>(
    db: &C,
    transaction_id: i64,
) -> Result<transactions::Model, AppError> {
    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    if transaction.status == "refunded" {
        return Err(AppError::Validation(
            "Transaksi sudah di-refund sepenuhnya".into(),
        ));
    }

    // A void already restored the stock and zeroed the total. Refunding on top
    // would restore that stock a second time, overwrite `deleted` with
    // `refunded` while deleted_at/deleted_by stay filled in, and print a Rp 0
    // refund receipt. `transactions::void` guards the reverse order already.
    if transaction.status == "deleted" || transaction.deleted_at.is_some() {
        return Err(AppError::Validation(
            "Transaksi sudah dibatalkan dan tidak bisa di-refund".into(),
        ));
    }

    check_refund_window(&transaction)?;

    Ok(transaction)
}

/// The seven-day limit.
///
/// A missing timestamp cannot be shown to fall inside the window, and the old
/// code skipped the check entirely for those rows, so treat it as
/// non-refundable rather than unlimited.
fn check_refund_window(transaction: &transactions::Model) -> Result<(), AppError> {
    let created_at = transaction.created_at.as_deref().ok_or_else(|| {
        AppError::Validation("Transaksi tanpa tanggal tidak bisa di-refund".into())
    })?;

    let txn_date = chrono::NaiveDateTime::parse_from_str(created_at, TIMESTAMP_FORMAT)
        .map_err(|_| AppError::Internal("Format tanggal transaksi tidak valid".into()))?;

    // Compare durations, not whole days: `num_days()` truncates toward zero, so
    // `days > 7` stayed false until 7d23h59m and the "7 day" rule really ran for
    // almost eight.
    let age = chrono::Utc::now()
        .naive_utc()
        .signed_duration_since(txn_date);
    if age > chrono::Duration::days(REFUND_MAX_DAYS) {
        return Err(AppError::Validation(format!(
            "Refund hanya bisa dilakukan maksimal {} hari setelah pembelian",
            REFUND_MAX_DAYS
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::create;
    use crate::entity::transactions;
    use crate::services::refunds::fixtures::{
        actor, aged_sale, line, refund_of, refund_one, setup, sold_line, stock_of,
    };
    use crate::test_support::{insert_product, insert_transaction, insert_transaction_item};
    use crate::utils::time::{format_ts, now_ts};
    use crate::utils::AppError;
    use sea_orm::{ActiveModelTrait, EntityTrait, Set};

    #[tokio::test]
    async fn refund_rejects_a_sale_past_seven_days_by_an_hour() {
        let conn = setup().await;
        let (txn, item) = aged_sale(&conn, chrono::Duration::hours(7 * 24 + 1)).await;

        let result = create(&conn, &actor(), refund_one(txn.id, item.id)).await;

        match result {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("7"),
                "Error should mention the 7-day limit, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn refund_allows_a_sale_just_inside_seven_days() {
        let conn = setup().await;
        let (txn, item) = aged_sale(&conn, chrono::Duration::hours(7 * 24 - 1)).await;

        create(&conn, &actor(), refund_one(txn.id, item.id))
            .await
            .expect("refund inside the window should succeed");
    }

    #[tokio::test]
    async fn refund_rejects_a_sale_without_a_timestamp() {
        let conn = setup().await;
        let (txn, item) = aged_sale(&conn, chrono::Duration::zero()).await;

        let mut undated: transactions::ActiveModel = txn.clone().into();
        undated.created_at = Set(None);
        undated.update(&conn).await.expect("clear created_at");

        let result = create(&conn, &actor(), refund_one(txn.id, item.id)).await;

        match result {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("tanggal"),
                "Error should mention the missing date, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn refund_rejects_a_voided_transaction() {
        let conn = setup().await;
        let (product, txn, txn_item) = sold_line(&conn, "Teh Kotak", 4_000.0, 6_000.0, 20, 1).await;

        // Exactly what a void leaves behind: stock already given back, total
        // zeroed, the void recorded.
        let mut voided: transactions::ActiveModel = txn.clone().into();
        voided.status = Set("deleted".to_string());
        voided.total_amount = Set(0.0);
        voided.deleted_at = Set(Some(now_ts()));
        voided.deleted_by = Set(Some(1));
        voided.deleted_reason = Set(Some("Salah input".to_string()));
        voided.update(&conn).await.expect("void transaction");

        let stock_before = stock_of(&conn, product.id).await;

        let result = create(&conn, &actor(), refund_one(txn.id, txn_item.id)).await;

        match result {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("dibatalkan"),
                    "Error should say the sale was voided, got: {msg}"
                );
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        // No second stock restore, and the void is still recorded as a void.
        assert_eq!(stock_of(&conn, product.id).await, stock_before);
        let reloaded = transactions::Entity::find_by_id(txn.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("transaction exists");
        assert_eq!(reloaded.status, "deleted");
    }

    #[tokio::test]
    async fn test_refund_expired_transaction_rejected() {
        let conn = setup().await;

        let product = insert_product(&conn, "Minyak Goreng", 15_000.0, 20_000.0, 30).await;

        // Sale dated 8 days ago, beyond the 7-day window.
        let old_date = format_ts(chrono::Utc::now() - chrono::Duration::days(8));
        let txn = insert_transaction(&conn, 1, 20_000.0, "completed", &old_date).await;

        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Minyak Goreng",
            20_000.0,
            15_000.0,
            1,
        )
        .await;

        let result = create(&conn, &actor(), refund_one(txn.id, txn_item.id)).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("7"), "Error should mention 7-day limit");
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_refund_empty_items_rejected() {
        let conn = setup().await;
        let (_, txn, _) = sold_line(&conn, "Tepung", 8_000.0, 12_000.0, 20, 1).await;

        let result = create(&conn, &actor(), refund_of(txn.id, vec![])).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("kosong"), "Error should mention empty items");
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_refund_invalid_condition_rejected() {
        let conn = setup().await;
        let (_, txn, txn_item) = sold_line(&conn, "Sabun", 3_000.0, 5_000.0, 40, 1).await;

        let input = refund_of(txn.id, vec![line(txn_item.id, 1, "broken")]);
        let result = create(&conn, &actor(), input).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(
                    msg.contains("tidak valid"),
                    "Error should mention invalid condition"
                );
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }
}
