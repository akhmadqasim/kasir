//! Reading refunds back: one in detail, or a filtered page of them.

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, QueryFilter,
    Statement,
};

use super::refund_amount_for;
use crate::domain::refunds::{
    ExchangeDetailItem, ListRefundsInput, ListRefundsResult, RefundDetailItem, RefundDetailResult,
    RefundListItem,
};
use crate::entity::{exchange_items, refund_items, refunds, transaction_items, transactions};
use crate::services::pagination::clamp_per_page;
use crate::utils::time::{
    invalid_date, local_date_last_second_to_utc, local_date_start_to_utc, parse_date_filter,
};
use crate::utils::AppError;

pub async fn detail(
    db: &DatabaseConnection,
    refund_id: i64,
) -> Result<RefundDetailResult, AppError> {
    let refund = refunds::Entity::find_by_id(refund_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Refund tidak ditemukan".into()))?;

    // Get refund items with product info
    let items = refund_items::Entity::find()
        .filter(refund_items::Column::RefundId.eq(refund_id))
        .all(db)
        .await?;

    // Batch-fetch the referenced transaction items in one query instead of one
    // find_by_id per refund line (avoids N+1), then map in memory.
    let txn_item_ids: Vec<i64> = items.iter().map(|i| i.transaction_item_id).collect();
    let txn_item_map: std::collections::HashMap<i64, transaction_items::Model> =
        transaction_items::Entity::find()
            .filter(transaction_items::Column::Id.is_in(txn_item_ids))
            .all(db)
            .await?
            .into_iter()
            .map(|ti| (ti.id, ti))
            .collect();

    let mut detail_items: Vec<RefundDetailItem> = Vec::new();
    for item in items {
        // Show the unit price the customer actually paid, so the line reads
        // `price x qty = subtotal`. The list price would not reconcile with the
        // refunded subtotal on any discounted sale.
        let (product_name, product_price) = match txn_item_map.get(&item.transaction_item_id) {
            Some(ti) => (ti.product_name.clone(), refund_amount_for(ti, 1)),
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
        .one(db)
        .await?;
    let transaction_receipt = transaction.map(|t| t.receipt_number).unwrap_or_default();

    // Get cashier name
    let user = crate::entity::users::Entity::find_by_id(refund.user_id)
        .one(db)
        .await?;
    let cashier_name = user
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".to_string());

    // Get exchange items
    let exchange_items_models = exchange_items::Entity::find()
        .filter(exchange_items::Column::RefundId.eq(refund_id))
        .all(db)
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

pub async fn list(
    db: &DatabaseConnection,
    input: ListRefundsInput,
) -> Result<ListRefundsResult, AppError> {
    let page = input.page.unwrap_or(1).max(1);
    let per_page = clamp_per_page(input.per_page);
    // `page` comes straight off the query string; a huge one must not overflow.
    let offset = (page - 1).saturating_mul(per_page);

    let mut conditions = String::from("WHERE 1=1");
    let mut params: Vec<sea_orm::Value> = Vec::new();

    if let Some(ref refund_type) = input.refund_type {
        if !refund_type.is_empty() {
            conditions.push_str(" AND r.type = ?");
            params.push(refund_type.clone().into());
        }
    }

    if let Some(date_from) = parse_date_filter(input.date_from.as_deref())? {
        conditions.push_str(" AND r.created_at >= ?");
        params.push(
            local_date_start_to_utc(date_from)
                .ok_or_else(invalid_date)?
                .into(),
        );
    }

    if let Some(date_to) = parse_date_filter(input.date_to.as_deref())? {
        conditions.push_str(" AND r.created_at <= ?");
        params.push(
            local_date_last_second_to_utc(date_to)
                .ok_or_else(invalid_date)?
                .into(),
        );
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
            refund_type: row.try_get::<String>("", "refund_type").unwrap_or_default(),
            transaction_receipt: row
                .try_get::<String>("", "receipt_number")
                .unwrap_or_default(),
            cashier_name: row.try_get::<String>("", "full_name").unwrap_or_default(),
            total_refund_amount: row.try_get::<f64>("", "total_refund_amount").unwrap_or(0.0),
            total_exchange_amount: row
                .try_get::<f64>("", "total_exchange_amount")
                .unwrap_or(0.0),
            difference_amount: row.try_get::<f64>("", "difference_amount").unwrap_or(0.0),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_per_page_bounds_the_requested_page_size() {
        assert_eq!(clamp_per_page::<i64>(None), 50);
        assert_eq!(clamp_per_page(Some(25_i64)), 25);
        assert_eq!(clamp_per_page(Some(0_i64)), 1);
        assert_eq!(clamp_per_page(Some(-10_i64)), 1);
        assert_eq!(clamp_per_page(Some(5_000_i64)), 100);
    }

    fn filter(
        date_from: Option<&str>,
        date_to: Option<&str>,
        page: Option<i64>,
    ) -> ListRefundsInput {
        ListRefundsInput {
            page,
            per_page: None,
            refund_type: None,
            date_from: date_from.map(str::to_string),
            date_to: date_to.map(str::to_string),
        }
    }

    /// A date whose UTC boundary cannot be written as a sortable timestamp
    /// (a five-digit year, the last day of the calendar) is a 400, not a panic
    /// or a range compared against a made-up string.
    #[tokio::test]
    async fn a_date_without_a_boundary_is_a_validation_error() {
        let conn = crate::test_support::setup_test_db().await;

        // A malformed date used to be dropped, listing every refund instead.
        let last = chrono::NaiveDate::MAX.format("%Y-%m-%d").to_string();
        for bad in ["+10000-06-15", last.as_str(), "2026-02-30", "30/09/2026"] {
            for input in [filter(Some(bad), None, None), filter(None, Some(bad), None)] {
                match list(&conn, input).await {
                    Err(AppError::Validation(message)) => {
                        assert_eq!(message, crate::utils::time::INVALID_DATE)
                    }
                    other => panic!("expected a Validation error for {bad:?}, got {other:?}"),
                }
            }
        }

        // An ordinary range still lists.
        list(&conn, filter(Some("2026-09-01"), Some("2026-09-30"), None))
            .await
            .expect("an ordinary range lists");
    }

    /// `page` is unchecked input; the offset it implies used to overflow.
    #[tokio::test]
    async fn a_huge_page_number_is_an_empty_page_not_an_overflow() {
        let conn = crate::test_support::setup_test_db().await;

        let result = list(&conn, filter(None, None, Some(i64::MAX)))
            .await
            .expect("list");

        assert!(result.items.is_empty());
    }
}
