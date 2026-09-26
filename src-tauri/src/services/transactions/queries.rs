//! Reading sales back: the next receipt number, a filtered page, one in full.

use sea_orm::sea_query::Expr;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};

use super::{load_payment_breakdown, payment_breakdown_from, summarize_ppob_items};
use crate::domain::transactions::{
    ListTransactionsInput, PaginatedTransactions, TransactionDetail, TransactionDetailItem,
    TransactionListItem,
};
use crate::entity::{transaction_items, transaction_payments, transactions, users};
use crate::services::pagination::clamp_per_page;
use crate::services::{document_number, refunds};
use crate::utils::time::{
    invalid_date, local_date_last_second_to_utc, local_date_start_to_utc, parse_date_filter,
};
use crate::utils::AppError;

/// The receipt number the next sale will get, for the cashier screen to show.
pub async fn next_receipt_number(db: &DatabaseConnection) -> Result<String, AppError> {
    document_number::next_receipt_number(db).await
}

pub async fn list(
    db: &DatabaseConnection,
    input: ListTransactionsInput,
) -> Result<PaginatedTransactions, AppError> {
    let page = input.page.unwrap_or(1).max(1);
    let per_page = clamp_per_page(input.per_page);

    let mut query =
        transactions::Entity::find().order_by(transactions::Column::CreatedAt, Order::Desc);

    if let Some(date_from) = parse_date_filter(input.date_from.as_deref())? {
        let start = local_date_start_to_utc(date_from).ok_or_else(invalid_date)?;
        query = query.filter(transactions::Column::CreatedAt.gte(start));
    }

    if let Some(date_to) = parse_date_filter(input.date_to.as_deref())? {
        let end = local_date_last_second_to_utc(date_to).ok_or_else(invalid_date)?;
        query = query.filter(transactions::Column::CreatedAt.lte(end));
    }

    if let Some(ref method) = input.payment_method {
        if !method.is_empty() {
            query = query.filter(
                sea_orm::Condition::any()
                    .add(transactions::Column::PaymentMethod.eq(method.as_str()))
                    .add(Expr::cust_with_values(
                        "EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = transactions.id AND tp.payment_method = $1)",
                        vec![sea_orm::Value::String(Some(Box::new(method.clone())))],
                    )),
            );
        }
    }

    if let Some(ref status) = input.status {
        if !status.is_empty() {
            query = query.filter(transactions::Column::Status.eq(status.as_str()));
        }
    }

    if let Some(ref channel) = input.channel {
        if !channel.is_empty() {
            query = query.filter(transactions::Column::Channel.eq(channel.as_str()));
        }
    }

    if let Some(ref search) = input.search {
        if !search.is_empty() {
            query = query.filter(transactions::Column::ReceiptNumber.contains(search));
        }
    }

    let total = query.clone().count(db).await?;
    let total_pages = (total as f64 / per_page as f64).ceil() as u64;

    // `page` is unchecked input: the multiplication saturates instead of
    // overflowing, and the offset stays within the `i64` SQLite binds it as.
    let offset = (page - 1).saturating_mul(per_page).min(i64::MAX as u64);
    let txns = query.offset(offset).limit(per_page).all(db).await?;

    // Batch-load all children for the page in a fixed number of queries instead
    // of running items + cashier + payment-breakdown lookups per row (N+1).
    use std::collections::HashMap;

    let txn_ids: Vec<i64> = txns.iter().map(|txn| txn.id).collect();

    let mut items_map: HashMap<i64, Vec<transaction_items::Model>> = HashMap::new();
    let mut payments_map: HashMap<i64, Vec<transaction_payments::Model>> = HashMap::new();
    let mut cashier_names: HashMap<i64, String> = HashMap::new();

    if !txn_ids.is_empty() {
        let all_items = transaction_items::Entity::find()
            .filter(transaction_items::Column::TransactionId.is_in(txn_ids.clone()))
            .order_by_asc(transaction_items::Column::Id)
            .all(db)
            .await?;
        for item in all_items {
            items_map.entry(item.transaction_id).or_default().push(item);
        }

        let all_payments = transaction_payments::Entity::find()
            .filter(transaction_payments::Column::TransactionId.is_in(txn_ids.clone()))
            .order_by_asc(transaction_payments::Column::Id)
            .all(db)
            .await?;
        for payment in all_payments {
            payments_map
                .entry(payment.transaction_id)
                .or_default()
                .push(payment);
        }

        let mut user_ids: Vec<i64> = txns.iter().map(|txn| txn.user_id).collect();
        user_ids.sort_unstable();
        user_ids.dedup();
        let cashiers = users::Entity::find()
            .filter(users::Column::Id.is_in(user_ids))
            .all(db)
            .await?;
        for cashier in cashiers {
            cashier_names.insert(cashier.id, cashier.full_name);
        }
    }

    let mut data = Vec::with_capacity(txns.len());

    for txn in txns {
        let items = items_map.remove(&txn.id).unwrap_or_default();
        let item_count = items.len() as i64;
        let (has_ppob, ppob_status, ppob_message, ppob_serial_number) =
            summarize_ppob_items(&items);

        let cashier_name = cashier_names
            .get(&txn.user_id)
            .cloned()
            .unwrap_or_else(|| "Unknown".into());

        let payment_breakdown =
            payment_breakdown_from(payments_map.remove(&txn.id).unwrap_or_default(), &txn);

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
            channel: txn.channel,
            item_count,
            notes: txn.notes,
            created_at: txn.created_at,
            has_ppob,
            ppob_status,
            ppob_message,
            ppob_serial_number,
            deleted_at: txn.deleted_at,
            deleted_reason: txn.deleted_reason,
            payment_breakdown,
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
pub async fn detail(
    db: &DatabaseConnection,
    transaction_id: i64,
) -> Result<TransactionDetail, AppError> {
    let transaction = transactions::Entity::find_by_id(transaction_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    let items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(transaction_id))
        .order_by_asc(transaction_items::Column::Id)
        .all(db)
        .await?;
    let (has_ppob, ppob_status, ppob_message, ppob_serial_number) = summarize_ppob_items(&items);

    let cashier = users::Entity::find_by_id(transaction.user_id)
        .one(db)
        .await?;
    let cashier_name = cashier
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".into());
    let payment_breakdown = load_payment_breakdown(db, &transaction).await?;

    let refunded = refunds::refunded_quantities(db, transaction_id).await?;
    let items = items
        .into_iter()
        .map(|item| TransactionDetailItem {
            refunded_quantity: refunded.get(&item.id).copied().unwrap_or(0),
            item,
        })
        .collect();

    Ok(TransactionDetail {
        transaction,
        items,
        cashier_name,
        has_ppob,
        ppob_status,
        ppob_message,
        ppob_serial_number,
        payment_breakdown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The sales history asks for one channel; the admin views ask for none and
    /// keep seeing every sale.
    #[tokio::test]
    async fn list_filters_by_channel() {
        let conn = crate::services::transactions::fixtures::setup_test_db().await;
        let created_at = crate::utils::time::now_ts();
        let cart = crate::test_support::insert_transaction_in_channel(
            &conn,
            1,
            50_000.0,
            "completed",
            &created_at,
            "sales",
        )
        .await;
        let bill = crate::test_support::insert_transaction_in_channel(
            &conn,
            1,
            40_000.0,
            "completed",
            &created_at,
            "ppob",
        )
        .await;

        let only_ppob = list(
            &conn,
            ListTransactionsInput {
                page: None,
                per_page: None,
                date_from: None,
                date_to: None,
                payment_method: None,
                status: None,
                search: None,
                channel: Some("ppob".to_string()),
            },
        )
        .await
        .expect("list");

        assert_eq!(only_ppob.total, 1);
        assert_eq!(only_ppob.data.len(), 1);
        assert_eq!(only_ppob.data[0].id, bill.id);
        // The history page gates its refund button on this field.
        assert_eq!(only_ppob.data[0].channel, "ppob");

        let everything = list(
            &conn,
            ListTransactionsInput {
                page: None,
                per_page: None,
                date_from: None,
                date_to: None,
                payment_method: None,
                status: None,
                search: None,
                channel: None,
            },
        )
        .await
        .expect("list");

        assert_eq!(everything.total, 2);
        let mut ids: Vec<i64> = everything.data.iter().map(|row| row.id).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec![cart.id, bill.id]);
    }

    /// The refund form caps each line at what is left of it, so the detail has
    /// to say how much of each line earlier refunds already took back — and
    /// report it flat on the item, next to `quantity`.
    #[tokio::test]
    async fn detail_reports_units_already_refunded_per_line() {
        use crate::test_support::{
            insert_product, insert_refund, insert_refund_item, insert_transaction,
            insert_transaction_item, RefundSpec,
        };

        let conn = crate::services::transactions::fixtures::setup_test_db().await;
        let now = crate::utils::time::now_ts();
        let rice = insert_product(&conn, "Beras 5kg", 60_000.0, 70_000.0, 10).await;
        let oil = insert_product(&conn, "Minyak 1L", 14_000.0, 17_000.0, 10).await;
        let sale = insert_transaction(&conn, 1, 244_000.0, "partial_refund", &now).await;
        let rice_line = insert_transaction_item(
            &conn,
            sale.id,
            Some(rice.id),
            "Beras 5kg",
            70_000.0,
            60_000.0,
            3,
        )
        .await;
        let oil_line = insert_transaction_item(
            &conn,
            sale.id,
            Some(oil.id),
            "Minyak 1L",
            17_000.0,
            14_000.0,
            2,
        )
        .await;

        // Two separate refunds of the rice line add up; the oil line is untouched.
        for _ in 0..2 {
            let refund = insert_refund(
                &conn,
                RefundSpec {
                    transaction_id: sale.id,
                    user_id: 1,
                    refund_type: "refund",
                    total_refund_amount: 70_000.0,
                    total_exchange_amount: 0.0,
                    difference_amount: 70_000.0,
                    payment_method: "cash",
                    shift_id: None,
                    created_at: &now,
                },
            )
            .await;
            insert_refund_item(&conn, refund.id, rice_line.id, rice.id, 1, 70_000.0).await;
        }

        let detail = detail(&conn, sale.id).await.expect("detail");
        let refunded_of = |line_id: i64| {
            detail
                .items
                .iter()
                .find(|line| line.item.id == line_id)
                .map(|line| line.refunded_quantity)
        };
        assert_eq!(refunded_of(rice_line.id), Some(2));
        assert_eq!(refunded_of(oil_line.id), Some(0));

        let json = serde_json::to_value(&detail).expect("serialize");
        let first = &json["items"][0];
        assert_eq!(first["id"], rice_line.id);
        assert_eq!(first["quantity"], 3);
        assert_eq!(first["refunded_quantity"], 2);
    }

    #[test]
    fn clamp_per_page_bounds_the_requested_page_size() {
        assert_eq!(clamp_per_page::<u64>(None), 50);
        assert_eq!(clamp_per_page(Some(25_u64)), 25);
        // Zero used to survive `.min(100)` and make total_pages u64::MAX.
        assert_eq!(clamp_per_page(Some(0_u64)), 1);
        assert_eq!(clamp_per_page(Some(5_000_u64)), 100);
    }

    #[test]
    fn total_pages_stays_finite_for_a_zero_page_size() {
        let per_page = clamp_per_page(Some(0_u64));
        let total: u64 = 3;
        let total_pages = (total as f64 / per_page as f64).ceil() as u64;
        assert_eq!(total_pages, 3);
    }

    fn page_filter(
        page: Option<u64>,
        date_from: Option<&str>,
        date_to: Option<&str>,
    ) -> ListTransactionsInput {
        ListTransactionsInput {
            page,
            per_page: Some(100),
            date_from: date_from.map(str::to_string),
            date_to: date_to.map(str::to_string),
            payment_method: None,
            status: None,
            search: None,
            channel: None,
        }
    }

    /// `page` is unchecked input; `(page - 1) * per_page` used to overflow.
    #[tokio::test]
    async fn a_huge_page_number_is_an_empty_page_not_an_overflow() {
        let conn = crate::test_support::setup_test_db().await;

        let result = list(&conn, page_filter(Some(u64::MAX), None, None))
            .await
            .expect("list");

        assert!(result.data.is_empty());
    }

    /// A malformed date used to be dropped, listing every sale instead.
    #[tokio::test]
    async fn a_malformed_date_is_a_validation_error() {
        let conn = crate::test_support::setup_test_db().await;

        for bad in ["2026-02-30", "30/09/2026", "+10000-06-15"] {
            for input in [
                page_filter(None, Some(bad), None),
                page_filter(None, None, Some(bad)),
            ] {
                match list(&conn, input).await {
                    Err(AppError::Validation(message)) => {
                        assert_eq!(message, crate::utils::time::INVALID_DATE)
                    }
                    other => panic!("expected a Validation error for {bad:?}, got {other:?}"),
                }
            }
        }

        list(&conn, page_filter(None, Some("2026-09-01"), Some("")))
            .await
            .expect("a blank bound is no bound");
    }
}
