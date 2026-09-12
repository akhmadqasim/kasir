//! Reading sales back: the next receipt number, a filtered page, one in full.

use sea_orm::sea_query::Expr;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};

use super::{
    clamp_per_page, generate_receipt_number, load_payment_breakdown, summarize_ppob_items,
};
use crate::domain::transactions::{
    ListTransactionsInput, PaginatedTransactions, PaymentSplit, TransactionDetail,
    TransactionListItem,
};
use crate::entity::{transaction_items, transaction_payments, transactions, users};
use crate::utils::AppError;

/// The receipt number the next sale will get, for the cashier screen to show.
pub async fn next_receipt_number(db: &DatabaseConnection) -> Result<String, AppError> {
    generate_receipt_number(db).await
}

pub async fn list(
    db: &DatabaseConnection,
    input: ListTransactionsInput,
) -> Result<PaginatedTransactions, AppError> {
    let page = input.page.unwrap_or(1).max(1);
    let per_page = clamp_per_page(input.per_page);

    let mut query =
        transactions::Entity::find().order_by(transactions::Column::CreatedAt, Order::Desc);

    let offset_secs = chrono::Local::now().offset().local_minus_utc() as i64;

    if let Some(ref date_from) = input.date_from {
        let local_start = format!("{} 00:00:00", date_from);
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&local_start, "%Y-%m-%d %H:%M:%S") {
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

    if let Some(ref search) = input.search {
        if !search.is_empty() {
            query = query.filter(transactions::Column::ReceiptNumber.contains(search));
        }
    }

    let total = query.clone().count(db).await?;
    let total_pages = (total as f64 / per_page as f64).ceil() as u64;

    let txns = query
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all(db)
        .await?;

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

        // Mirror `load_payment_breakdown`: use recorded splits when present,
        // otherwise fall back to a single split from the transaction itself.
        let payment_breakdown = match payments_map.remove(&txn.id) {
            Some(splits) if !splits.is_empty() => splits
                .into_iter()
                .map(|split| PaymentSplit {
                    payment_method: split.payment_method,
                    bank_name: split.bank_name,
                    amount: split.amount,
                })
                .collect(),
            _ => vec![PaymentSplit {
                payment_method: txn.payment_method.clone(),
                bank_name: None,
                amount: txn.total_amount,
            }],
        };

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
        .all(db)
        .await?;
    let (has_ppob, ppob_status, ppob_message, ppob_serial_number) = summarize_ppob_items(&items);

    let cashier = users::Entity::find_by_id(transaction.user_id)
        .one(db)
        .await?;
    let cashier_name = cashier
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".into());
    let payment_breakdown = load_payment_breakdown(db, transaction_id, &transaction).await?;

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

    #[test]
    fn clamp_per_page_bounds_the_requested_page_size() {
        assert_eq!(clamp_per_page(None), 50);
        assert_eq!(clamp_per_page(Some(25)), 25);
        // Zero used to survive `.min(100)` and make total_pages u64::MAX.
        assert_eq!(clamp_per_page(Some(0)), 1);
        assert_eq!(clamp_per_page(Some(5_000)), 100);
    }

    #[test]
    fn total_pages_stays_finite_for_a_zero_page_size() {
        let per_page = clamp_per_page(Some(0));
        let total: u64 = 3;
        let total_pages = (total as f64 / per_page as f64).ceil() as u64;
        assert_eq!(total_pages, 3);
    }
}
