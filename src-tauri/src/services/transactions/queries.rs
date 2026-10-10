//! Reading sales back: the next receipt number, a filtered page, one in full.

use sea_orm::sea_query::Expr;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};

use super::ppob_recovery::advice_fail_opens_at;
use super::{
    is_failed_ppob_line, is_refundable_line, load_payment_breakdown, payment_breakdown_from,
    refundable_quantity, PPOB_STATUS_FAILED, PPOB_STATUS_PENDING, PPOB_STATUS_PROCESSING,
    PPOB_STATUS_SUCCESS, PPOB_STATUS_UNCERTAIN,
};
use crate::domain::transactions::{
    ListTransactionsInput, PaginatedTransactions, TransactionDetail, TransactionDetailItem,
    TransactionListItem,
};
use crate::entity::{transaction_items, transaction_payments, transactions, users};
use crate::services::pagination::clamp_per_page;
use crate::services::{document_number, refunds};
use crate::utils::sql::contains_literal;
use crate::utils::time::{
    format_ts, invalid_date, local_date_last_second_to_utc, local_date_start_to_utc,
    parse_date_filter,
};
use crate::utils::AppError;

/// History status filters that read the PPOB lines, not `transactions.status`.
/// Checkout never writes a PPOB state to the sale itself — it stays
/// `completed` while its lines move — so matching these against
/// `transactions.status` found nothing at all.
const FILTER_PPOB_IN_FLIGHT: &str = "pending_ppob";
const FILTER_PPOB_FAILED: &str = "ppob_failed";
const FILTER_PPOB_UNCERTAIN: &str = "ppob_uncertain";

/// The line states one of the PPOB filters stands for; `None` for a filter on
/// the sale's own status.
fn ppob_filter_statuses(filter: &str) -> Option<&'static [&'static str]> {
    match filter {
        FILTER_PPOB_IN_FLIGHT => Some(&[PPOB_STATUS_PENDING, PPOB_STATUS_PROCESSING]),
        FILTER_PPOB_FAILED => Some(&[PPOB_STATUS_FAILED]),
        FILTER_PPOB_UNCERTAIN => Some(&[PPOB_STATUS_UNCERTAIN]),
        _ => None,
    }
}

/// The sale has a line in one of `statuses`. An `IN` over the partial
/// `(ppob_status, transaction_id)` index (migration 033) instead of a
/// correlated `EXISTS` per sale. The statuses are this module's own
/// constants, never request text, so they are written into the SQL as
/// literals.
fn has_ppob_line_in(statuses: &[&'static str]) -> sea_orm::sea_query::SimpleExpr {
    let list = statuses
        .iter()
        .map(|status| format!("'{status}'"))
        .collect::<Vec<_>>()
        .join(", ");
    Expr::cust(format!(
        "transactions.id IN (SELECT transaction_id FROM transaction_items WHERE ppob_status IN ({list}))"
    ))
}

/// What the "Perlu dicek" indicator counts.
#[derive(Debug, serde::Serialize)]
pub struct PpobAttention {
    /// PPOB lines still `uncertain` — no answer, or Mitra ADVICE — on any day,
    /// in any channel. The reconcile loop or a person settles them.
    pub uncertain: u64,
}

/// The count behind the app-wide "PPOB perlu dicek" indicator. One `COUNT`
/// over `transaction_items`, cheap enough to poll; the same lines the
/// `ppob_uncertain` filter lists (a void is refused while one is uncertain, so
/// no voided sale hides among them).
pub async fn ppob_attention(db: &DatabaseConnection) -> Result<PpobAttention, AppError> {
    let uncertain = transaction_items::Entity::find()
        .filter(transaction_items::Column::PpobStatus.eq(PPOB_STATUS_UNCERTAIN))
        .count(db)
        .await?;
    Ok(PpobAttention { uncertain })
}

/// How badly a PPOB line needs a person, lowest first: an open question, then
/// money to give back, then a call still running, then nothing.
fn ppob_urgency(status: Option<&str>) -> u8 {
    match status {
        Some(PPOB_STATUS_UNCERTAIN) => 0,
        Some(PPOB_STATUS_FAILED) => 1,
        Some(PPOB_STATUS_PENDING) | Some(PPOB_STATUS_PROCESSING) => 2,
        Some(PPOB_STATUS_SUCCESS) => 3,
        _ => 4,
    }
}

/// The PPOB line a history row reports: the most urgent one, the first of
/// equals. A cart with a delivered pulsa and an uncertain PLN token must not
/// read "Berhasil" just because the pulsa came first.
fn most_urgent_ppob_line(items: &[transaction_items::Model]) -> Option<&transaction_items::Model> {
    items
        .iter()
        .filter(|item| item.service_type.is_some())
        .min_by_key(|item| ppob_urgency(item.ppob_status.as_deref()))
}

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

    // `created_at` has one-second resolution, so a busy till puts several sales
    // on the same timestamp. Without a unique tiebreaker SQLite may order those
    // ties differently per query, and LIMIT/OFFSET paging then repeats some
    // sales on the next page and skips others.
    let mut query = transactions::Entity::find()
        .order_by(transactions::Column::CreatedAt, Order::Desc)
        .order_by(transactions::Column::Id, Order::Desc);

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
                        "EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = transactions.id AND tp.payment_method = ?)",
                        vec![sea_orm::Value::String(Some(Box::new(method.clone())))],
                    )),
            );
        }
    }

    if let Some(ref status) = input.status {
        if !status.is_empty() {
            query = match ppob_filter_statuses(status) {
                Some(statuses) => query.filter(has_ppob_line_in(statuses)),
                None => query.filter(transactions::Column::Status.eq(status.as_str())),
            };
        }
    }

    if let Some(ref channel) = input.channel {
        if !channel.is_empty() {
            query = query.filter(transactions::Column::Channel.eq(channel.as_str()));
        }
    }

    if let Some(ref search) = input.search {
        if !search.is_empty() {
            // Literal, so a `_` or `%` typed into the box is not a wildcard.
            query = query.filter(contains_literal(
                transactions::Column::ReceiptNumber,
                search,
            ));
        }
    }

    let total = query.clone().count(db).await?;
    let total_pages = (total as f64 / per_page as f64).ceil() as u64;

    // `page` is unchecked input: the multiplication saturates instead of
    // overflowing, and the offset stays within the `i64` SQLite binds it as.
    let offset = (page - 1).saturating_mul(per_page).min(i64::MAX as u64);
    let txns = query.offset(offset).limit(per_page).all(db).await?;

    // Batch-load the page's children in a fixed number of queries, not per row.
    use std::collections::HashMap;

    let txn_ids: Vec<i64> = txns.iter().map(|txn| txn.id).collect();

    let mut items_map: HashMap<i64, Vec<transaction_items::Model>> = HashMap::new();
    let mut payments_map: HashMap<i64, Vec<transaction_payments::Model>> = HashMap::new();
    let mut cashier_names: HashMap<i64, String> = HashMap::new();
    let mut refunded: HashMap<i64, i64> = HashMap::new();

    if !txn_ids.is_empty() {
        let all_items = transaction_items::Entity::find()
            .filter(transaction_items::Column::TransactionId.is_in(txn_ids.clone()))
            .order_by_asc(transaction_items::Column::Id)
            .all(db)
            .await?;
        for item in all_items {
            items_map.entry(item.transaction_id).or_default().push(item);
        }

        // Only a sale some refund already touched has refund lines to tally.
        let refunded_txn_ids: Vec<i64> = txns
            .iter()
            .filter(|txn| matches!(txn.status.as_str(), "partial_refund" | "refunded"))
            .map(|txn| txn.id)
            .collect();
        refunded = refunds::refunded_quantities_for(db, &refunded_txn_ids).await?;

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
        let has_refundable_goods = items
            .iter()
            .any(|item| refundable_quantity(item, &refunded) > 0);
        let has_refundable_failed_ppob = items
            .iter()
            .any(|item| is_failed_ppob_line(item) && refundable_quantity(item, &refunded) > 0);
        let ppob_line = most_urgent_ppob_line(&items);

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
            has_refundable_goods,
            has_refundable_failed_ppob,
            has_ppob: ppob_line.is_some(),
            ppob_status: ppob_line.and_then(|line| line.ppob_status.clone()),
            ppob_message: ppob_line.and_then(|line| line.ppob_message.clone()),
            ppob_serial_number: ppob_line.and_then(|line| line.ppob_serial_number.clone()),
            ppob_service_type: ppob_line.and_then(|line| line.service_type.clone()),
            ppob_advice: ppob_line.and_then(|line| line.ppob_advice.clone()),
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
    let ppob_line = most_urgent_ppob_line(&items);
    let has_ppob = ppob_line.is_some();
    let ppob_status = ppob_line.and_then(|line| line.ppob_status.clone());
    let ppob_message = ppob_line.and_then(|line| line.ppob_message.clone());
    let ppob_serial_number = ppob_line.and_then(|line| line.ppob_serial_number.clone());

    let cashier = users::Entity::find_by_id(transaction.user_id)
        .one(db)
        .await?;
    let cashier_name = cashier
        .map(|u| u.full_name)
        .unwrap_or_else(|| "Unknown".into());
    let payment_breakdown = load_payment_breakdown(db, &transaction).await?;

    let refunded = refunds::refunded_quantities(db, transaction_id).await?;
    let items: Vec<TransactionDetailItem> = items
        .into_iter()
        .map(|item| TransactionDetailItem {
            refunded_quantity: refunded.get(&item.id).copied().unwrap_or(0),
            refundable: is_refundable_line(&item),
            refundable_quantity: refundable_quantity(&item, &refunded),
            ppob_manual_fail_opens_at: (item.ppob_status.as_deref() == Some(PPOB_STATUS_UNCERTAIN))
                .then(|| advice_fail_opens_at(&item))
                .flatten()
                .map(format_ts),
            item,
        })
        .collect();
    let has_refundable_goods = items.iter().any(|line| line.refundable_quantity > 0);
    let has_refundable_failed_ppob = items
        .iter()
        .any(|line| is_failed_ppob_line(&line.item) && line.refundable_quantity > 0);

    Ok(TransactionDetail {
        transaction,
        items,
        cashier_name,
        has_refundable_goods,
        has_refundable_failed_ppob,
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
        assert_eq!(first["refundable"], true);
        assert_eq!(first["refundable_quantity"], 1);
        assert_eq!(json["items"][1]["refundable_quantity"], 2);
        assert_eq!(json["has_refundable_goods"], true);
    }

    /// A mixed cart whose goods all came back stays `partial_refund` (its PPOB
    /// line was not reversed), so the history needs the lines to know it has
    /// nothing left to return — or it offers a refund that cannot happen.
    #[tokio::test]
    async fn list_says_whether_any_goods_are_left_to_return() {
        use crate::test_support::{
            insert_product, insert_refund, insert_refund_item, insert_transaction,
            insert_transaction_item, RefundSpec,
        };

        let conn = crate::services::transactions::fixtures::setup_test_db().await;
        let now = crate::utils::time::now_ts();
        let sugar = insert_product(&conn, "Gula 1kg", 14_000.0, 17_000.0, 10).await;

        /// Two sugar and one pulsa sold; `goods_back` of the sugar returned.
        async fn sale_with(
            conn: &sea_orm::DatabaseConnection,
            sugar_id: i64,
            goods_back: i64,
            now: &str,
        ) -> i64 {
            let sale = insert_transaction(conn, 1, 46_000.0, "partial_refund", now).await;
            let goods = insert_transaction_item(
                conn,
                sale.id,
                Some(sugar_id),
                "Gula 1kg",
                17_000.0,
                14_000.0,
                2,
            )
            .await;
            insert_transaction_item(conn, sale.id, None, "Pulsa 10K", 12_000.0, 10_000.0, 1).await;
            let amount = 17_000.0 * goods_back as f64;
            let refund = insert_refund(
                conn,
                RefundSpec {
                    transaction_id: sale.id,
                    user_id: 1,
                    refund_type: "refund",
                    total_refund_amount: amount,
                    total_exchange_amount: 0.0,
                    difference_amount: amount,
                    payment_method: "cash",
                    shift_id: None,
                    created_at: now,
                },
            )
            .await;
            insert_refund_item(conn, refund.id, goods.id, sugar_id, goods_back, amount).await;
            sale.id
        }
        let all_back = sale_with(&conn, sugar.id, 2, &now).await;
        let one_left = sale_with(&conn, sugar.id, 1, &now).await;

        let page = list(&conn, page_filter(None, None, None))
            .await
            .expect("list");
        let refundable = |id: i64| {
            page.data
                .iter()
                .find(|row| row.id == id)
                .map(|row| row.has_refundable_goods)
        };
        assert_eq!(refundable(all_back), Some(false));
        assert_eq!(refundable(one_left), Some(true));
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

    /// Sales rung up in the same second tie on `created_at`; without `id` as a
    /// tiebreaker LIMIT/OFFSET paging repeated some and skipped others.
    #[tokio::test]
    async fn paging_sales_with_the_same_timestamp_visits_each_once_newest_id_first() {
        let conn = crate::test_support::setup_test_db().await;
        let created_at = crate::utils::time::now_ts();
        let mut ids = Vec::new();
        for _ in 0..7 {
            ids.push(
                crate::test_support::insert_transaction(
                    &conn,
                    1,
                    1_000.0,
                    "completed",
                    &created_at,
                )
                .await
                .id,
            );
        }

        let mut seen = Vec::new();
        for page in 1..=4 {
            let mut input = page_filter(Some(page), None, None);
            input.per_page = Some(2);
            seen.extend(
                list(&conn, input)
                    .await
                    .expect("list")
                    .data
                    .iter()
                    .map(|t| t.id),
            );
        }

        ids.reverse();
        assert_eq!(seen, ids, "every sale once, newest id first");
    }

    /// `_` and `%` in the search box used to act as LIKE wildcards.
    #[tokio::test]
    async fn the_receipt_search_matches_wildcards_literally() {
        use sea_orm::{ActiveModelTrait, Set};

        let conn = crate::test_support::setup_test_db().await;
        let created_at = crate::utils::time::now_ts();
        for receipt in ["TRX-20260101-0001", "TRX_A"] {
            let row = crate::test_support::insert_transaction(
                &conn,
                1,
                1_000.0,
                "completed",
                &created_at,
            )
            .await;
            let mut active: transactions::ActiveModel = row.into();
            active.receipt_number = Set(receipt.to_string());
            active.update(&conn).await.expect("rename");
        }

        let search = |text: &str| {
            let mut input = page_filter(None, None, None);
            input.search = Some(text.to_string());
            input
        };
        let found = list(&conn, search("TRX_")).await.expect("list");
        assert_eq!(found.total, 1);
        assert_eq!(found.data[0].receipt_number, "TRX_A");

        assert_eq!(list(&conn, search("%")).await.expect("list").total, 0);
        assert_eq!(list(&conn, search("0101")).await.expect("list").total, 1);
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

    /// A sale made now with one PPOB line per `(service_type, status)`;
    /// `advice` marks the uncertain ones Mitra answered ADVICE for.
    async fn ppob_sale(
        conn: &sea_orm::DatabaseConnection,
        lines: &[(&str, &str, bool)],
        created_at: &str,
    ) -> i64 {
        use sea_orm::{ConnectionTrait, DbBackend, Statement};

        let sale =
            crate::test_support::insert_transaction(conn, 1, 20_000.0, "completed", created_at)
                .await;
        for (service, status, advice) in lines {
            let line = crate::test_support::insert_transaction_item(
                conn, sale.id, None, "PPOB", 20_000.0, 19_000.0, 1,
            )
            .await;
            conn.execute(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "UPDATE transaction_items SET service_type = $1, ppob_status = $2, ppob_advice = $3 WHERE id = $4",
                vec![
                    (*service).into(),
                    (*status).into(),
                    (if *advice { Some("{}".to_string()) } else { None }).into(),
                    line.id.into(),
                ],
            ))
            .await
            .expect("make it a PPOB line");
        }
        sale.id
    }

    fn by_status(status: &str) -> ListTransactionsInput {
        let mut input = page_filter(None, None, None);
        input.status = Some(status.to_string());
        input
    }

    async fn ids_for(conn: &sea_orm::DatabaseConnection, status: &str) -> Vec<i64> {
        let mut ids: Vec<i64> = list(conn, by_status(status))
            .await
            .expect("list")
            .data
            .iter()
            .map(|row| row.id)
            .collect();
        ids.sort_unstable();
        ids
    }

    /// Checkout leaves the sale `completed` whatever its PPOB lines do, so the
    /// PPOB filters have to look at the lines. They used to match
    /// `transactions.status` and never found anything.
    #[tokio::test]
    async fn the_ppob_status_filters_match_the_lines_not_the_sale() {
        let conn = crate::test_support::setup_test_db().await;
        let now = crate::utils::time::now_ts();
        let pending = ppob_sale(&conn, &[("pulsa", "pending", false)], &now).await;
        let processing = ppob_sale(&conn, &[("pulsa", "processing", false)], &now).await;
        let failed = ppob_sale(&conn, &[("pulsa", "failed", false)], &now).await;
        let advice = ppob_sale(&conn, &[("pln", "uncertain", true)], &now).await;
        let mixed = ppob_sale(
            &conn,
            &[("pulsa", "success", false), ("pln", "uncertain", false)],
            &now,
        )
        .await;
        ppob_sale(&conn, &[("pulsa", "success", false)], &now).await;

        assert_eq!(
            ids_for(&conn, "pending_ppob").await,
            vec![pending, processing]
        );
        assert_eq!(ids_for(&conn, "ppob_failed").await, vec![failed]);
        assert_eq!(ids_for(&conn, "ppob_uncertain").await, vec![advice, mixed]);
        // A plain status still filters on the sale itself.
        assert_eq!(ids_for(&conn, "completed").await.len(), 6);
    }

    /// The indicator counts uncertain lines of any day and channel; settling
    /// one takes it off.
    #[tokio::test]
    async fn ppob_attention_counts_uncertain_lines_of_any_day() {
        let conn = crate::test_support::setup_test_db().await;
        let last_month =
            crate::utils::time::format_ts(chrono::Utc::now() - chrono::Duration::days(30));
        let now = crate::utils::time::now_ts();
        assert_eq!(ppob_attention(&conn).await.expect("count").uncertain, 0);

        ppob_sale(&conn, &[("pln", "uncertain", true)], &last_month).await;
        let two = ppob_sale(
            &conn,
            &[
                ("pulsa", "uncertain", false),
                ("pulsa", "failed", false),
                ("pln", "success", false),
            ],
            &now,
        )
        .await;
        assert_eq!(ppob_attention(&conn).await.expect("count").uncertain, 2);

        use sea_orm::{ConnectionTrait, DbBackend, Statement};
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items SET ppob_status = 'success' WHERE transaction_id = $1 AND ppob_status = 'uncertain'",
            vec![two.into()],
        ))
        .await
        .expect("settle");
        assert_eq!(ppob_attention(&conn).await.expect("count").uncertain, 1);
    }

    /// A row reports its most urgent PPOB line, with what the badge needs to
    /// tell ADVICE apart, and whether a failed top-up still has money owed.
    #[tokio::test]
    async fn a_row_reports_its_most_urgent_ppob_line() {
        let conn = crate::test_support::setup_test_db().await;
        let now = crate::utils::time::now_ts();
        let sale = ppob_sale(
            &conn,
            &[
                ("pulsa", "success", false),
                ("pulsa", "failed", false),
                ("pln", "uncertain", true),
            ],
            &now,
        )
        .await;

        let page = list(&conn, page_filter(None, None, None))
            .await
            .expect("list");
        let row = page.data.iter().find(|row| row.id == sale).expect("row");
        assert!(row.has_ppob);
        assert_eq!(row.ppob_status.as_deref(), Some("uncertain"));
        assert_eq!(row.ppob_service_type.as_deref(), Some("pln"));
        assert_eq!(row.ppob_advice.as_deref(), Some("{}"));
        assert!(row.has_refundable_failed_ppob);

        assert_eq!(ppob_urgency(Some("failed")), 1);
        assert!(ppob_urgency(Some("pending")) < ppob_urgency(Some("success")));
    }

    /// The detail reports the same line and refund flag as the list row, and
    /// on each line when "Tandai gagal" opens for an uncertain ADVICE line.
    #[tokio::test]
    async fn the_detail_reports_the_ppob_rules_the_server_applies() {
        use sea_orm::{ConnectionTrait, DbBackend, Statement};

        let conn = crate::test_support::setup_test_db().await;
        let now = crate::utils::time::now_ts();
        let sale = ppob_sale(
            &conn,
            &[
                ("pulsa", "success", false),
                ("pulsa", "failed", false),
                ("pln", "uncertain", true),
                ("pln", "uncertain", false),
            ],
            &now,
        )
        .await;
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items SET created_at = '2026-09-28 03:10:00' WHERE transaction_id = $1",
            vec![sale.into()],
        ))
        .await
        .expect("date the lines");

        let detail = detail(&conn, sale).await.expect("detail");
        assert!(detail.has_ppob);
        assert_eq!(detail.ppob_status.as_deref(), Some("uncertain"));
        assert!(detail.has_refundable_failed_ppob);
        let opens: Vec<Option<&str>> = detail
            .items
            .iter()
            .map(|line| line.ppob_manual_fail_opens_at.as_deref())
            .collect();
        assert_eq!(opens, vec![None, None, Some("2026-09-29 03:10:00"), None]);
    }
}
