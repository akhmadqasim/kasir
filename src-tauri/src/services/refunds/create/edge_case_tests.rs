//! Behaviour-level edge cases of [`super::create`]: repeat and partial refunds,
//! quantity caps, exchanges in both directions, automatic write-offs, refund
//! numbers, the window's edges, and what a rejected refund leaves behind.

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, PaginatorTrait,
    QueryFilter, Statement,
};

use super::create;
use crate::domain::refunds::{CreateRefundInput, ExchangeItemInput, RefundItemInput};
use crate::entity::{exchange_items, products, refunds, stock_writeoffs, transactions};
use crate::services::refunds::fixtures::{
    actor, aged_sale, line, refund_of, refund_one, sale, setup, sold_line, stock_of,
};
use crate::test_support::{
    insert_product, insert_transaction_in_channel, insert_transaction_item,
    insert_transaction_item_spec, TransactionItemSpec,
};
use crate::utils::time::now_ts;
use crate::utils::AppError;

async fn status_of(conn: &DatabaseConnection, txn_id: i64) -> String {
    transactions::Entity::find_by_id(txn_id)
        .one(conn)
        .await
        .expect("query")
        .expect("transaction exists")
        .status
}

async fn refund_count(conn: &DatabaseConnection, txn_id: i64) -> u64 {
    refunds::Entity::find()
        .filter(refunds::Column::TransactionId.eq(txn_id))
        .count(conn)
        .await
        .expect("count refunds")
}

async fn writeoffs_of(conn: &DatabaseConnection, refund_id: i64) -> Vec<stock_writeoffs::Model> {
    stock_writeoffs::Entity::find()
        .filter(stock_writeoffs::Column::RefundId.eq(refund_id))
        .all(conn)
        .await
        .expect("query writeoffs")
}

fn exchange(
    txn_id: i64,
    items: Vec<RefundItemInput>,
    replacements: Vec<(i64, i64)>,
) -> CreateRefundInput {
    CreateRefundInput {
        transaction_id: txn_id,
        reason: Some("Tukar".to_string()),
        items,
        exchange_items: Some(
            replacements
                .into_iter()
                .map(|(product_id, quantity)| ExchangeItemInput {
                    product_id,
                    quantity,
                })
                .collect(),
        ),
    }
}

fn expect_validation<T: std::fmt::Debug>(result: Result<T, AppError>, needle: &str) {
    match result {
        Err(AppError::Validation(msg)) => assert!(
            msg.contains(needle),
            "expected a validation error mentioning {needle:?}, got: {msg}"
        ),
        other => panic!("expected a Validation error, got: {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Partial and repeat refunds
// ---------------------------------------------------------------------------

#[tokio::test]
async fn repeat_partial_refunds_close_the_sale_and_then_nothing_more_comes_back() {
    let conn = setup().await;
    let (product, txn, item) = sold_line(&conn, "Mie Instan", 2_500.0, 3_500.0, 40, 3).await;

    let first = create(&conn, &actor(), refund_one(txn.id, item.id))
        .await
        .expect("first partial refund");
    assert_eq!(first.refund.total_refund_amount, 3_500.0);
    assert_eq!(status_of(&conn, txn.id).await, "partial_refund");

    let second = create(
        &conn,
        &actor(),
        refund_of(txn.id, vec![line(item.id, 2, "good")]),
    )
    .await
    .expect("the rest of the line comes back");
    assert_eq!(second.refund.total_refund_amount, 7_000.0);
    assert_eq!(status_of(&conn, txn.id).await, "refunded");
    assert_eq!(stock_of(&conn, product.id).await, 43);

    let third = create(&conn, &actor(), refund_one(txn.id, item.id)).await;
    expect_validation(third, "sepenuhnya");
    assert_eq!(stock_of(&conn, product.id).await, 43);
    assert_eq!(refund_count(&conn, txn.id).await, 2);
}

#[tokio::test]
async fn a_second_refund_cannot_take_back_more_than_is_left_of_the_line() {
    let conn = setup().await;
    let (product, txn, item) = sold_line(&conn, "Kopi Sachet", 1_000.0, 1_500.0, 50, 3).await;

    create(
        &conn,
        &actor(),
        refund_of(txn.id, vec![line(item.id, 2, "good")]),
    )
    .await
    .expect("first refund");

    let over = create(
        &conn,
        &actor(),
        refund_of(txn.id, vec![line(item.id, 2, "good")]),
    )
    .await;
    expect_validation(over, "melebihi");

    // The rejected attempt changed nothing.
    assert_eq!(stock_of(&conn, product.id).await, 52);
    assert_eq!(status_of(&conn, txn.id).await, "partial_refund");
    assert_eq!(refund_count(&conn, txn.id).await, 1);
}

#[tokio::test]
async fn two_lines_for_one_sold_line_cannot_together_exceed_what_was_bought() {
    let conn = setup().await;
    let (product, txn, item) = sold_line(&conn, "Gelas", 4_000.0, 7_000.0, 10, 2).await;

    let result = create(
        &conn,
        &actor(),
        refund_of(
            txn.id,
            vec![line(item.id, 2, "good"), line(item.id, 1, "damaged")],
        ),
    )
    .await;
    expect_validation(result, "melebihi");

    assert_eq!(stock_of(&conn, product.id).await, 10);
    assert_eq!(status_of(&conn, txn.id).await, "completed");
    assert_eq!(refund_count(&conn, txn.id).await, 0);
}

#[tokio::test]
async fn a_line_from_another_sale_cannot_be_refunded_against_this_one() {
    let conn = setup().await;
    let (_, txn_a, _) = sold_line(&conn, "Sabun A", 3_000.0, 5_000.0, 10, 1).await;
    let (product_b, _, item_b) = sold_line(&conn, "Sabun B", 3_000.0, 5_000.0, 10, 1).await;

    let result = create(&conn, &actor(), refund_one(txn_a.id, item_b.id)).await;
    expect_validation(result, "tidak ditemukan");
    assert_eq!(stock_of(&conn, product_b.id).await, 10);
}

#[tokio::test]
async fn a_zero_or_negative_quantity_is_rejected() {
    let conn = setup().await;
    let (product, txn, item) = sold_line(&conn, "Teh", 2_000.0, 3_000.0, 10, 2).await;

    for qty in [0, -1] {
        let result = create(
            &conn,
            &actor(),
            refund_of(txn.id, vec![line(item.id, qty, "good")]),
        )
        .await;
        expect_validation(result, "lebih dari 0");
    }
    assert_eq!(stock_of(&conn, product.id).await, 10);
}

#[tokio::test]
async fn refunding_an_unknown_sale_is_not_found() {
    let conn = setup().await;
    match create(&conn, &actor(), refund_one(9_999, 1)).await {
        Err(AppError::NotFound(_)) => {}
        other => panic!("expected NotFound, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Discounted lines
// ---------------------------------------------------------------------------

/// Unit by unit, a discounted line never hands back more than was paid for it,
/// and the last unit closes the books on exactly what was paid.
#[tokio::test]
async fn unit_by_unit_refunds_of_a_discounted_line_add_up_to_what_was_paid() {
    let conn = setup().await;
    let product = insert_product(&conn, "Susu UHT", 4_000.0, 5_000.0, 10).await;
    // 3 x 5.000 = 15.000, line discount 5.000 -> 10.000 paid for three units.
    let txn = sale(&conn, 10_000.0).await;
    let item = insert_transaction_item_spec(
        &conn,
        TransactionItemSpec {
            transaction_id: txn.id,
            product_id: Some(product.id),
            product_name: "Susu UHT",
            product_price: 5_000.0,
            buy_price: 4_000.0,
            quantity: 3,
            item_discount: 5_000.0,
            net_subtotal: None,
        },
    )
    .await;

    let mut handed_back = 0.0;
    for _ in 0..3 {
        let result = create(&conn, &actor(), refund_one(txn.id, item.id))
            .await
            .expect("one unit back");
        handed_back += result.refund.total_refund_amount;
    }

    assert!(
        handed_back <= 10_000.0,
        "the customer got back {handed_back}, more than the 10.000 paid"
    );
    assert!(
        (handed_back - 10_000.0).abs() < 0.01,
        "the three refunds should add up to the 10.000 paid, got {handed_back}"
    );
    assert_eq!(status_of(&conn, txn.id).await, "refunded");
}

/// A fully discounted (free) line refunds nothing but still restocks.
#[tokio::test]
async fn a_free_line_refunds_zero_but_still_goes_back_on_the_shelf() {
    let conn = setup().await;
    let product = insert_product(&conn, "Bonus Sendok", 500.0, 1_000.0, 5).await;
    let txn = sale(&conn, 0.0).await;
    let item = insert_transaction_item_spec(
        &conn,
        TransactionItemSpec {
            transaction_id: txn.id,
            product_id: Some(product.id),
            product_name: "Bonus Sendok",
            product_price: 1_000.0,
            buy_price: 500.0,
            quantity: 1,
            item_discount: 1_000.0,
            net_subtotal: None,
        },
    )
    .await;

    let result = create(&conn, &actor(), refund_one(txn.id, item.id))
        .await
        .expect("refund");
    assert_eq!(result.refund.total_refund_amount, 0.0);
    assert_eq!(stock_of(&conn, product.id).await, 6);
}

// ---------------------------------------------------------------------------
// Exchanges
// ---------------------------------------------------------------------------

/// A dearer replacement: the difference is negative and the customer pays it.
#[tokio::test]
async fn a_dearer_replacement_gives_a_negative_difference() {
    let conn = setup().await;
    let (returned, txn, item) = sold_line(&conn, "Kaos S", 15_000.0, 20_000.0, 5, 1).await;
    let replacement = insert_product(&conn, "Kaos XL", 25_000.0, 35_000.0, 5).await;

    let result = create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "good")],
            vec![(replacement.id, 1)],
        ),
    )
    .await
    .expect("exchange");

    assert_eq!(result.refund.refund_type, "exchange");
    assert_eq!(result.refund.total_refund_amount, 20_000.0);
    assert_eq!(result.refund.total_exchange_amount, Some(35_000.0));
    assert_eq!(result.refund.difference_amount, Some(-15_000.0));
    assert_eq!(stock_of(&conn, returned.id).await, 6);
    assert_eq!(stock_of(&conn, replacement.id).await, 4);
    assert_eq!(status_of(&conn, txn.id).await, "refunded");
}

/// Several replacement lines are summed, at today's sell price.
#[tokio::test]
async fn several_replacements_are_summed_at_todays_sell_price() {
    let conn = setup().await;
    let (_, txn, item) = sold_line(&conn, "Beras 5kg", 60_000.0, 70_000.0, 5, 2).await;
    let a = insert_product(&conn, "Minyak 1L", 14_000.0, 18_000.0, 10).await;
    let b = insert_product(&conn, "Gula 1kg", 13_000.0, 16_000.0, 10).await;

    let result = create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "good")],
            vec![(a.id, 2), (b.id, 1)],
        ),
    )
    .await
    .expect("exchange");

    assert_eq!(result.exchange_items.len(), 2);
    assert_eq!(result.refund.total_exchange_amount, Some(52_000.0));
    assert_eq!(result.refund.difference_amount, Some(18_000.0));
    assert_eq!(stock_of(&conn, a.id).await, 8);
    assert_eq!(stock_of(&conn, b.id).await, 9);
    // Half the sale came back; the other unit is still sold.
    assert_eq!(status_of(&conn, txn.id).await, "partial_refund");
}

/// A broken unit swapped for a new one of the same product: the broken one is
/// written off, the new one leaves the shelf, and no money changes hands.
#[tokio::test]
async fn a_like_for_like_swap_of_a_damaged_unit() {
    let conn = setup().await;
    let (product, txn, item) = sold_line(&conn, "Termos", 40_000.0, 55_000.0, 5, 1).await;

    let result = create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "damaged")],
            vec![(product.id, 1)],
        ),
    )
    .await
    .expect("exchange");

    assert_eq!(result.refund.difference_amount, Some(0.0));
    // Not restocked (damaged), and one new unit handed over.
    assert_eq!(stock_of(&conn, product.id).await, 4);
    let writeoffs = writeoffs_of(&conn, result.refund.id).await;
    assert_eq!(writeoffs.len(), 1);
    assert_eq!(writeoffs[0].loss_value, 40_000.0);
}

/// A good unit coming back is restocked before the replacement is taken off,
/// so swapping the last unit on the shelf for the same product works even
/// when negative stock is not allowed.
#[tokio::test]
async fn a_good_return_restocks_before_the_same_product_is_handed_back_out() {
    let conn = setup().await;
    let (product, txn, item) = sold_line(&conn, "Payung", 20_000.0, 30_000.0, 0, 1).await;

    create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "good")],
            vec![(product.id, 1)],
        ),
    )
    .await
    .expect("the returned unit covers the replacement");

    assert_eq!(stock_of(&conn, product.id).await, 0);
}

/// "Bisa tukar barang sama": a like-for-like swap is administrative. A line
/// sold with a discount comes back at the discounted price but the replacement
/// is priced at the full list price, so the customer is asked to pay their
/// discount back to swap a broken item for an identical one.
#[tokio::test]
async fn a_like_for_like_swap_of_a_discounted_line_costs_the_customer_nothing() {
    let conn = setup().await;
    let product = insert_product(&conn, "Setrika", 80_000.0, 120_000.0, 5).await;
    let txn = sale(&conn, 100_000.0).await;
    let item = insert_transaction_item_spec(
        &conn,
        TransactionItemSpec {
            transaction_id: txn.id,
            product_id: Some(product.id),
            product_name: "Setrika",
            product_price: 120_000.0,
            buy_price: 80_000.0,
            quantity: 1,
            item_discount: 20_000.0,
            net_subtotal: None,
        },
    )
    .await;

    let result = create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "damaged")],
            vec![(product.id, 1)],
        ),
    )
    .await
    .expect("exchange");

    assert_eq!(
        result.refund.difference_amount,
        Some(0.0),
        "swapping a broken unit for the same product should not cost the customer \
         Rp {}",
        -result.refund.difference_amount.unwrap_or_default()
    );
}

/// Not enough stock for the replacement: the whole exchange is rolled back —
/// the returned goods are not restocked, no refund row or number is kept, and
/// the sale keeps its status.
#[tokio::test]
async fn an_exchange_short_of_stock_rolls_back_entirely() {
    let conn = setup().await;
    let (returned, txn, item) = sold_line(&conn, "Sendal", 10_000.0, 15_000.0, 3, 1).await;
    let replacement = insert_product(&conn, "Sepatu", 50_000.0, 80_000.0, 1).await;

    let result = create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "good")],
            vec![(replacement.id, 2)],
        ),
    )
    .await;
    expect_validation(result, "tidak cukup");

    assert_eq!(stock_of(&conn, returned.id).await, 3);
    assert_eq!(stock_of(&conn, replacement.id).await, 1);
    assert_eq!(status_of(&conn, txn.id).await, "completed");
    assert_eq!(refund_count(&conn, txn.id).await, 0);
    assert_eq!(
        exchange_items::Entity::find()
            .count(&conn)
            .await
            .expect("count"),
        0
    );

    // And the next refund still gets the first number of the day.
    let next = create(&conn, &actor(), refund_one(txn.id, item.id))
        .await
        .expect("plain refund");
    assert!(next.refund.refund_number.ends_with("-0001"));
}

/// Two replacement lines of the same product together may not exceed its
/// stock either.
#[tokio::test]
async fn duplicate_replacement_lines_cannot_together_oversell() {
    let conn = setup().await;
    let (_, txn, item) = sold_line(&conn, "Kemeja", 50_000.0, 90_000.0, 5, 1).await;
    let replacement = insert_product(&conn, "Dasi", 10_000.0, 20_000.0, 3).await;

    let result = create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "good")],
            vec![(replacement.id, 2), (replacement.id, 2)],
        ),
    )
    .await;
    expect_validation(result, "tidak cukup");
    assert_eq!(stock_of(&conn, replacement.id).await, 3);
}

#[tokio::test]
async fn an_exchange_for_an_inactive_or_missing_product_is_rejected() {
    let conn = setup().await;
    let (returned, txn, item) = sold_line(&conn, "Topi", 10_000.0, 15_000.0, 3, 1).await;
    let retired = insert_product(&conn, "Topi Lama", 10_000.0, 15_000.0, 3).await;
    conn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE products SET is_active = 0 WHERE id = $1",
        vec![retired.id.into()],
    ))
    .await
    .expect("deactivate");

    let inactive = create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "good")],
            vec![(retired.id, 1)],
        ),
    )
    .await;
    expect_validation(inactive, "tidak aktif");

    let missing = create(
        &conn,
        &actor(),
        exchange(txn.id, vec![line(item.id, 1, "good")], vec![(9_999, 1)]),
    )
    .await;
    assert!(matches!(missing, Err(AppError::NotFound(_))), "{missing:?}");

    let zero = create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "good")],
            vec![(returned.id, 0)],
        ),
    )
    .await;
    expect_validation(zero, "lebih dari 0");

    assert_eq!(stock_of(&conn, returned.id).await, 3);
    assert_eq!(stock_of(&conn, retired.id).await, 3);
    assert_eq!(refund_count(&conn, txn.id).await, 0);
}

/// An empty replacement list is a plain refund, not an exchange.
#[tokio::test]
async fn an_empty_replacement_list_is_a_plain_refund() {
    let conn = setup().await;
    let (_, txn, item) = sold_line(&conn, "Pensil", 1_000.0, 2_000.0, 5, 1).await;

    let result = create(
        &conn,
        &actor(),
        exchange(txn.id, vec![line(item.id, 1, "good")], vec![]),
    )
    .await
    .expect("refund");
    assert_eq!(result.refund.refund_type, "refund");
    assert_eq!(result.refund.difference_amount, Some(0.0));
}

/// Negative stock is a store setting; with it on, an exchange may oversell
/// exactly like a sale can.
#[tokio::test]
async fn with_negative_stock_allowed_an_exchange_may_oversell() {
    let conn = crate::test_support::setup_test_db().await;
    crate::test_support::insert_store_info(&conn, true).await;
    let (_, txn, item) = sold_line(&conn, "Buku", 5_000.0, 8_000.0, 5, 1).await;
    let replacement = insert_product(&conn, "Pulpen", 2_000.0, 3_000.0, 0).await;

    create(
        &conn,
        &actor(),
        exchange(
            txn.id,
            vec![line(item.id, 1, "good")],
            vec![(replacement.id, 2)],
        ),
    )
    .await
    .expect("negative stock is allowed");
    assert_eq!(stock_of(&conn, replacement.id).await, -2);
}

// ---------------------------------------------------------------------------
// Automatic write-offs
// ---------------------------------------------------------------------------

#[tokio::test]
async fn each_damaged_or_expired_line_gets_its_own_numbered_writeoff() {
    let conn = setup().await;
    let (milk, txn, milk_line) = sold_line(&conn, "Susu", 6_000.0, 8_000.0, 10, 3).await;
    let bread = insert_product(&conn, "Roti", 9_000.0, 12_000.0, 10).await;
    let bread_line =
        insert_transaction_item(&conn, txn.id, Some(bread.id), "Roti", 12_000.0, 9_000.0, 2).await;

    let result = create(
        &conn,
        &actor(),
        refund_of(
            txn.id,
            vec![
                line(milk_line.id, 2, "expired"),
                line(milk_line.id, 1, "good"),
                line(bread_line.id, 2, "damaged"),
            ],
        ),
    )
    .await
    .expect("refund");

    let mut writeoffs = writeoffs_of(&conn, result.refund.id).await;
    writeoffs.sort_by_key(|w| w.id);
    assert_eq!(writeoffs.len(), 2);
    assert_ne!(writeoffs[0].writeoff_number, writeoffs[1].writeoff_number);
    for w in &writeoffs {
        assert!(
            w.writeoff_number.starts_with("WO-"),
            "{}",
            w.writeoff_number
        );
        assert_eq!(w.user_id, 1);
        assert!(w
            .notes
            .as_deref()
            .unwrap_or_default()
            .contains(&result.refund.refund_number));
    }
    assert_eq!(writeoffs[0].product_id, milk.id);
    assert_eq!(writeoffs[0].reason, "expired");
    assert_eq!(writeoffs[0].quantity, 2);
    assert_eq!(writeoffs[0].loss_value, 12_000.0);
    assert_eq!(writeoffs[1].product_id, bread.id);
    assert_eq!(writeoffs[1].reason, "damaged");
    assert_eq!(writeoffs[1].loss_value, 18_000.0);

    // Only the good unit went back on the shelf.
    assert_eq!(stock_of(&conn, milk.id).await, 11);
    assert_eq!(stock_of(&conn, bread.id).await, 10);
    assert_eq!(status_of(&conn, txn.id).await, "refunded");
    assert_eq!(result.refund.total_refund_amount, 48_000.0);
}

/// The write-off is booked to the cashier who took the return, not the admin.
#[tokio::test]
async fn an_automatic_writeoff_belongs_to_the_cashier_who_took_the_return() {
    use crate::domain::Actor;
    let conn = setup().await;
    let kasir = crate::test_support::insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await;
    let (_, txn, item) = sold_line(&conn, "Telur", 2_000.0, 2_500.0, 30, 10).await;

    let result = create(
        &conn,
        &Actor::from(&kasir),
        refund_of(txn.id, vec![line(item.id, 4, "damaged")]),
    )
    .await
    .expect("refund");

    assert_eq!(result.refund.user_id, kasir.id);
    let writeoffs = writeoffs_of(&conn, result.refund.id).await;
    assert_eq!(writeoffs[0].user_id, kasir.id);
    assert_eq!(writeoffs[0].approved_by, Some(kasir.id));
    assert_eq!(writeoffs[0].status, "approved");
}

// ---------------------------------------------------------------------------
// Refund numbers
// ---------------------------------------------------------------------------

#[tokio::test]
async fn refund_numbers_are_rfd_local_date_and_a_daily_sequence() {
    let conn = setup().await;
    let (_, txn, item) = sold_line(&conn, "Sikat", 3_000.0, 5_000.0, 10, 3).await;

    let first = create(&conn, &actor(), refund_one(txn.id, item.id))
        .await
        .expect("first");
    let second = create(&conn, &actor(), refund_one(txn.id, item.id))
        .await
        .expect("second");

    let day = chrono::Local::now().format("%Y%m%d").to_string();
    assert_eq!(first.refund.refund_number, format!("RFD-{day}-0001"));
    assert_eq!(second.refund.refund_number, format!("RFD-{day}-0002"));
}

// ---------------------------------------------------------------------------
// Window, voided and PPOB sales
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_window_holds_a_minute_before_seven_days_and_closes_a_minute_after() {
    let conn = setup().await;
    let seven_days = chrono::Duration::days(7);

    let (inside, inside_item) = aged_sale(&conn, seven_days - chrono::Duration::minutes(1)).await;
    create(&conn, &actor(), refund_one(inside.id, inside_item.id))
        .await
        .expect("still inside the window");

    let (outside, outside_item) = aged_sale(&conn, seven_days + chrono::Duration::minutes(1)).await;
    expect_validation(
        create(&conn, &actor(), refund_one(outside.id, outside_item.id)).await,
        "7 hari",
    );
}

/// The window also holds for the second half of a partly refunded sale.
#[tokio::test]
async fn a_partly_refunded_sale_past_the_window_cannot_be_refunded_further() {
    let conn = setup().await;
    let product = insert_product(&conn, "Kecap", 5_000.0, 8_000.0, 10).await;
    let old = crate::utils::time::format_ts(chrono::Utc::now() - chrono::Duration::days(8));
    let txn =
        crate::test_support::insert_transaction(&conn, 1, 16_000.0, "partial_refund", &old).await;
    let item = insert_transaction_item(
        &conn,
        txn.id,
        Some(product.id),
        "Kecap",
        8_000.0,
        5_000.0,
        2,
    )
    .await;

    expect_validation(
        create(&conn, &actor(), refund_one(txn.id, item.id)).await,
        "7 hari",
    );
    assert_eq!(stock_of(&conn, product.id).await, 10);
}

/// A sale made on the PPOB page carries only PPOB lines, none of which is a
/// physical product. Nothing is refundable and nothing is written.
#[tokio::test]
async fn a_ppob_page_sale_cannot_be_refunded() {
    let conn = setup().await;
    let txn =
        insert_transaction_in_channel(&conn, 1, 52_000.0, "completed", &now_ts(), "ppob").await;
    let item =
        insert_transaction_item(&conn, txn.id, None, "Token PLN 50K", 52_000.0, 50_500.0, 1).await;

    expect_validation(
        create(&conn, &actor(), refund_one(txn.id, item.id)).await,
        "bukan produk fisik",
    );
    assert_eq!(status_of(&conn, txn.id).await, "completed");
    assert_eq!(refund_count(&conn, txn.id).await, 0);
}

/// A voided sale whose row still says `completed` (only `deleted_at` set) is
/// still a voided sale.
#[tokio::test]
async fn a_sale_with_deleted_at_set_is_treated_as_voided() {
    let conn = setup().await;
    let (product, txn, item) = sold_line(&conn, "Teh Botol", 3_000.0, 5_000.0, 10, 1).await;
    conn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE transactions SET deleted_at = $1, deleted_by = 1 WHERE id = $2",
        vec![now_ts().into(), txn.id.into()],
    ))
    .await
    .expect("mark voided");

    expect_validation(
        create(&conn, &actor(), refund_one(txn.id, item.id)).await,
        "dibatalkan",
    );
    assert_eq!(stock_of(&conn, product.id).await, 10);
}

/// A product deactivated after the sale can still be returned and restocked.
#[tokio::test]
async fn a_product_retired_after_the_sale_can_still_be_returned() {
    let conn = setup().await;
    let (product, txn, item) = sold_line(&conn, "Sabun Lama", 3_000.0, 5_000.0, 4, 1).await;
    conn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE products SET is_active = 0 WHERE id = $1",
        vec![product.id.into()],
    ))
    .await
    .expect("deactivate");

    create(&conn, &actor(), refund_one(txn.id, item.id))
        .await
        .expect("refund");
    let after = products::Entity::find_by_id(product.id)
        .one(&conn)
        .await
        .expect("query")
        .expect("product");
    assert_eq!(after.stock, 5);
}
