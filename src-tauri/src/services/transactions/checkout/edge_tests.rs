//! Edge cases of ringing up a sale: the money arithmetic (change, split
//! payments, discounts), stock that must move exactly once or not at all,
//! receipt numbers, and the shift a sale is booked to.

use super::*;
use crate::domain::transactions::{PaymentSplitInput, TransactionItemInput};
use crate::entity::{products, transaction_items, transaction_payments, transactions};
use crate::services::shifts;
use crate::services::transactions::fixtures::{
    admin, cash_checkout, insert_product, no_provider, product_line, pulsa_line, setup_test_db,
};
use crate::test_support::insert_user;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter};

async fn stock_of(conn: &DatabaseConnection, product_id: i64) -> i64 {
    products::Entity::find_by_id(product_id)
        .one(conn)
        .await
        .expect("query")
        .expect("product exists")
        .stock
}

async fn sale_count(conn: &DatabaseConnection) -> u64 {
    transactions::Entity::find()
        .count(conn)
        .await
        .expect("count")
}

async fn payments_of(conn: &DatabaseConnection, transaction_id: i64) -> Vec<(String, f64)> {
    transaction_payments::Entity::find()
        .filter(transaction_payments::Column::TransactionId.eq(transaction_id))
        .all(conn)
        .await
        .expect("query")
        .into_iter()
        .map(|p| (p.payment_method, p.amount))
        .collect()
}

fn split(method: &str, amount: f64) -> PaymentSplitInput {
    PaymentSplitInput {
        payment_method: method.to_string(),
        bank_name: None,
        amount,
    }
}

fn split_checkout(
    items: Vec<TransactionItemInput>,
    splits: Vec<PaymentSplitInput>,
) -> CheckoutTransactionInput {
    CheckoutTransactionInput {
        payment_breakdown: Some(splits),
        ..cash_checkout(items, 0.0)
    }
}

async fn allow_negative_stock(conn: &DatabaseConnection) {
    conn.execute_unprepared(
        "UPDATE store_info SET additional_info = \
         json_set(additional_info, '$.sales.allow_negative_stock', json('true')) WHERE id = 1",
    )
    .await
    .expect("allow negative stock");
}

fn today_receipt_prefix() -> String {
    format!("TRX-{}-", chrono::Utc::now().format("%Y%m%d"))
}

// --- Cash and change ---

#[tokio::test]
async fn cash_overpayment_records_the_change_and_the_full_amount_handed_over() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 100_000.0),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(result.transaction.total_amount, 65_000.0);
    assert_eq!(result.transaction.payment_amount, 100_000.0);
    assert_eq!(result.transaction.change_amount, Some(35_000.0));
    // The drawer keeps the total, not what was handed over.
    assert_eq!(
        payments_of(&conn, result.transaction.id).await,
        vec![("cash".to_string(), 65_000.0)]
    );
}

#[tokio::test]
async fn exact_cash_gives_no_change() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 2)], 130_000.0),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(result.transaction.change_amount, Some(0.0));
}

/// Short cash is refused and leaves no trace: no sale, the stock untouched,
/// and no receipt number burnt.
#[tokio::test]
async fn short_cash_is_refused_and_writes_nothing() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 64_999.0),
        no_provider,
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "got {result:?}"
    );
    assert_eq!(sale_count(&conn).await, 0);
    assert_eq!(stock_of(&conn, rice.id).await, 10);

    let next = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 65_000.0),
        no_provider,
    )
    .await
    .expect("corrected checkout");
    assert_eq!(
        next.transaction.receipt_number,
        format!("{}0001", today_receipt_prefix())
    );
}

/// A card or QRIS payment is the exact total whatever the client typed into
/// the amount box; it never produces change.
#[tokio::test]
async fn a_non_cash_payment_is_always_the_exact_total() {
    for typed in [0.0, 10_000.0, 999_999.0] {
        let conn = setup_test_db().await;
        let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

        let result = checkout_with_executor(
            &conn,
            &admin(),
            CheckoutTransactionInput {
                payment_method: "qris".to_string(),
                ..cash_checkout(vec![product_line(rice.id, 1)], typed)
            },
            no_provider,
        )
        .await
        .expect("checkout");

        assert_eq!(result.transaction.payment_method, "qris", "typed {typed}");
        assert_eq!(result.transaction.payment_amount, 65_000.0, "typed {typed}");
        assert_eq!(result.transaction.change_amount, Some(0.0), "typed {typed}");
    }
}

#[tokio::test]
async fn an_unknown_payment_method_is_refused_before_anything_is_written() {
    for method in ["mixed", "bitcoin", ""] {
        let conn = setup_test_db().await;
        let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

        let result = checkout_with_executor(
            &conn,
            &admin(),
            CheckoutTransactionInput {
                payment_method: method.to_string(),
                ..cash_checkout(vec![product_line(rice.id, 1)], 65_000.0)
            },
            no_provider,
        )
        .await;

        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "{method:?}: got {result:?}"
        );
        assert_eq!(stock_of(&conn, rice.id).await, 10, "{method:?}");
    }
}

// --- Split payments ---

/// QRIS 30.000 + cash 50.000 for a 65.000 sale: cash covers the 35.000 left
/// and 15.000 goes back as change. Only the 35.000 is cash in the drawer.
#[tokio::test]
async fn a_split_payment_books_only_the_cash_that_stays_in_the_drawer() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        split_checkout(
            vec![product_line(rice.id, 1)],
            vec![split("qris", 30_000.0), split("cash", 50_000.0)],
        ),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(result.transaction.payment_method, "mixed");
    assert_eq!(result.transaction.payment_amount, 80_000.0);
    assert_eq!(result.transaction.change_amount, Some(15_000.0));

    let mut payments = payments_of(&conn, result.transaction.id).await;
    payments.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        payments,
        vec![
            ("cash".to_string(), 35_000.0),
            ("qris".to_string(), 30_000.0)
        ]
    );
    let paid: f64 = payments.iter().map(|(_, amount)| amount).sum();
    assert_eq!(paid, result.transaction.total_amount);
}

#[tokio::test]
async fn a_non_cash_split_must_add_up_to_the_total() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    for splits in [
        vec![split("qris", 30_000.0), split("transfer", 30_000.0)],
        vec![split("qris", 40_000.0), split("transfer", 30_000.0)],
    ] {
        let result = checkout_with_executor(
            &conn,
            &admin(),
            split_checkout(vec![product_line(rice.id, 1)], splits),
            no_provider,
        )
        .await;
        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "got {result:?}"
        );
    }

    assert_eq!(sale_count(&conn).await, 0);
    assert_eq!(stock_of(&conn, rice.id).await, 10);
}

#[tokio::test]
async fn a_split_whose_non_cash_part_overpays_is_refused() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        split_checkout(
            vec![product_line(rice.id, 1)],
            vec![split("qris", 70_000.0), split("cash", 10_000.0)],
        ),
        no_provider,
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "got {result:?}"
    );
    assert_eq!(sale_count(&conn).await, 0);
}

#[tokio::test]
async fn a_split_with_too_little_cash_is_refused() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        split_checkout(
            vec![product_line(rice.id, 1)],
            vec![split("qris", 30_000.0), split("cash", 30_000.0)],
        ),
        no_provider,
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "got {result:?}"
    );
    assert_eq!(stock_of(&conn, rice.id).await, 10);
}

#[tokio::test]
async fn a_split_may_not_name_the_same_method_twice() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        split_checkout(
            vec![product_line(rice.id, 1)],
            vec![split("qris", 30_000.0), split("qris", 35_000.0)],
        ),
        no_provider,
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "got {result:?}"
    );
}

#[tokio::test]
async fn a_split_with_an_invalid_method_is_refused() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        split_checkout(
            vec![product_line(rice.id, 1)],
            vec![split("qris", 30_000.0), split("voucher", 35_000.0)],
        ),
        no_provider,
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "got {result:?}"
    );
}

/// A breakdown whose only leg is cash is just a cash sale.
#[tokio::test]
async fn a_cash_only_breakdown_is_filed_as_cash() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        split_checkout(
            vec![product_line(rice.id, 1)],
            vec![split("cash", 100_000.0), split("qris", 0.0)],
        ),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(result.transaction.payment_method, "cash");
    assert_eq!(result.transaction.change_amount, Some(35_000.0));
    assert_eq!(
        payments_of(&conn, result.transaction.id).await,
        vec![("cash".to_string(), 65_000.0)]
    );
}

// --- Discounts ---

#[tokio::test]
async fn a_fully_discounted_cart_is_a_zero_total_sale() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        CheckoutTransactionInput {
            transaction_discount: Some(65_000.0),
            ..cash_checkout(vec![product_line(rice.id, 1)], 0.0)
        },
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(result.transaction.total_amount, 0.0);
    assert_eq!(result.transaction.subtotal_amount, 65_000.0);
    assert_eq!(result.transaction.discount_amount, 65_000.0);
    assert_eq!(result.transaction.change_amount, Some(0.0));
    assert_eq!(result.items[0].net_subtotal, 0.0);
    assert_eq!(stock_of(&conn, rice.id).await, 9);
}

#[tokio::test]
async fn a_discount_larger_than_the_cart_is_refused_not_clamped() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let over_item = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(
            vec![TransactionItemInput {
                item_discount: Some(65_001.0),
                ..product_line(rice.id, 1)
            }],
            0.0,
        ),
        no_provider,
    )
    .await;
    assert!(
        matches!(over_item, Err(AppError::Validation(_))),
        "got {over_item:?}"
    );

    let over_cart = checkout_with_executor(
        &conn,
        &admin(),
        CheckoutTransactionInput {
            transaction_discount: Some(65_001.0),
            ..cash_checkout(vec![product_line(rice.id, 1)], 0.0)
        },
        no_provider,
    )
    .await;
    assert!(
        matches!(over_cart, Err(AppError::Validation(_))),
        "got {over_cart:?}"
    );

    assert_eq!(sale_count(&conn).await, 0);
    assert_eq!(stock_of(&conn, rice.id).await, 10);
}

/// The item discount is a per-line amount, not per unit: 3 x 10.000 with a
/// 5.000 line discount is 25.000.
#[tokio::test]
async fn an_item_discount_applies_once_per_line_not_per_unit() {
    let conn = setup_test_db().await;
    let soap = insert_product(&conn, "Sabun", 10_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(
            vec![TransactionItemInput {
                item_discount: Some(5_000.0),
                ..product_line(soap.id, 3)
            }],
            25_000.0,
        ),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(result.transaction.subtotal_amount, 30_000.0);
    assert_eq!(result.transaction.discount_amount, 5_000.0);
    assert_eq!(result.transaction.total_amount, 25_000.0);
    assert_eq!(result.items[0].net_subtotal, 25_000.0);
}

/// A one-line cart with a cart discount: the line's net is the whole total, so
/// a full refund hands back exactly what was paid. `12.000 * (1 - 5.000/12.000)`
/// in floating point is 6999.999999999999, which then flows into refunds and
/// the shift's expected cash.
#[tokio::test]
async fn a_single_line_net_equals_the_total_after_a_cart_discount() {
    let conn = setup_test_db().await;
    let soap = insert_product(&conn, "Sabun", 12_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        CheckoutTransactionInput {
            transaction_discount: Some(5_000.0),
            ..cash_checkout(vec![product_line(soap.id, 1)], 7_000.0)
        },
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(result.transaction.total_amount, 7_000.0);
    assert_eq!(
        result.items[0].net_subtotal,
        result.transaction.total_amount
    );
}

/// The price is the catalogue's, never the client's: a cart line carrying its
/// own price and name is stored with the product row's.
#[tokio::test]
async fn a_goods_line_ignores_the_price_and_name_the_client_sends() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(
            vec![TransactionItemInput {
                product_price: Some(1.0),
                product_name: Some("Gratis".to_string()),
                buy_price: Some(0.0),
                ..product_line(rice.id, 1)
            }],
            65_000.0,
        ),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(result.transaction.total_amount, 65_000.0);
    assert_eq!(result.items[0].product_price, 65_000.0);
    assert_eq!(result.items[0].product_name, "Beras");
    assert_eq!(result.items[0].buy_price, Some(63_000.0));
}

/// A PPOB line may not be sold below cost (see `a_ppob_line_may_not_sell_below_cost`
/// for the item discount). A cart-level discount is spread over every line,
/// PPOB included, so it reaches the same loss by another door: a 12.000 pulsa
/// costing 10.000 with a 5.000 cart discount is sold for 7.000.
#[tokio::test]
async fn a_cart_discount_cannot_push_a_ppob_line_below_cost() {
    let conn = setup_test_db().await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        CheckoutTransactionInput {
            transaction_discount: Some(5_000.0),
            ppob_pin: Some("123456".to_string()),
            ..cash_checkout(vec![pulsa_line()], 7_000.0)
        },
        no_provider,
    )
    .await;

    match result {
        Err(AppError::Validation(_)) => {}
        Ok(sale) => panic!(
            "sold a 10.000-cost pulsa line for {} (net {})",
            sale.transaction.total_amount, sale.items[0].net_subtotal
        ),
        Err(other) => panic!("expected Validation, got {other:?}"),
    }
}

// --- Stock ---

/// The same product on two lines is checked against the shelf as a whole: two
/// lines of 2 from a stock of 3 is an oversell, and the whole sale rolls back.
#[tokio::test]
async fn two_lines_of_one_product_cannot_oversell_together() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 3).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(
            vec![product_line(rice.id, 2), product_line(rice.id, 2)],
            40_000.0,
        ),
        no_provider,
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "got {result:?}"
    );
    assert_eq!(stock_of(&conn, rice.id).await, 3);
    assert_eq!(sale_count(&conn).await, 0);
    assert_eq!(
        transaction_items::Entity::find()
            .count(&conn)
            .await
            .expect("count"),
        0
    );
}

#[tokio::test]
async fn two_lines_of_one_product_within_stock_take_both_quantities() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 5).await;

    checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(
            vec![product_line(rice.id, 2), product_line(rice.id, 3)],
            50_000.0,
        ),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(stock_of(&conn, rice.id).await, 0);
}

/// When one line of a multi-line cart fails its stock check, the lines that
/// passed must not keep their decrement.
#[tokio::test]
async fn an_oversold_line_rolls_back_the_lines_before_it() {
    let conn = setup_test_db().await;
    let soap = insert_product(&conn, "Sabun", 5_000.0, 10).await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 1).await;

    let result = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(
            vec![
                product_line(soap.id, 4),
                product_line(rice.id, 1),
                product_line(rice.id, 1),
            ],
            40_000.0,
        ),
        no_provider,
    )
    .await;

    assert!(result.is_err(), "got {result:?}");
    assert_eq!(stock_of(&conn, soap.id).await, 10);
    assert_eq!(stock_of(&conn, rice.id).await, 1);
}

#[tokio::test]
async fn with_negative_stock_allowed_a_sale_may_take_the_shelf_below_zero() {
    let conn = setup_test_db().await;
    allow_negative_stock(&conn).await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 1).await;

    checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 3)], 30_000.0),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(stock_of(&conn, rice.id).await, -2);
}

#[tokio::test]
async fn a_non_positive_quantity_is_refused() {
    for quantity in [0, -1] {
        let conn = setup_test_db().await;
        let rice = insert_product(&conn, "Beras", 10_000.0, 5).await;

        let result = checkout_with_executor(
            &conn,
            &admin(),
            cash_checkout(vec![product_line(rice.id, quantity)], 10_000.0),
            no_provider,
        )
        .await;

        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "{quantity}: got {result:?}"
        );
        assert_eq!(stock_of(&conn, rice.id).await, 5, "{quantity}");
    }
}

#[tokio::test]
async fn an_inactive_or_missing_product_cannot_be_sold() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 5).await;
    conn.execute_unprepared(&format!(
        "UPDATE products SET is_active = 0 WHERE id = {}",
        rice.id
    ))
    .await
    .expect("deactivate");

    for product_id in [rice.id, 9_999] {
        let result = checkout_with_executor(
            &conn,
            &admin(),
            cash_checkout(vec![product_line(product_id, 1)], 10_000.0),
            no_provider,
        )
        .await;
        assert!(
            matches!(result, Err(AppError::NotFound(_))),
            "{product_id}: got {result:?}"
        );
    }
    assert_eq!(stock_of(&conn, rice.id).await, 5);
}

#[tokio::test]
async fn an_empty_cart_is_refused() {
    let conn = setup_test_db().await;

    let result =
        checkout_with_executor(&conn, &admin(), cash_checkout(vec![], 0.0), no_provider).await;

    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "got {result:?}"
    );
}

// --- Receipt numbers ---

#[tokio::test]
async fn receipt_numbers_run_in_sequence_for_the_day() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let prefix = today_receipt_prefix();

    let mut numbers = Vec::new();
    for _ in 0..3 {
        let sale = checkout_with_executor(
            &conn,
            &admin(),
            cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
            no_provider,
        )
        .await
        .expect("checkout");
        numbers.push(sale.transaction.receipt_number);
    }

    assert_eq!(
        numbers,
        vec![
            format!("{prefix}0001"),
            format!("{prefix}0002"),
            format!("{prefix}0003"),
        ]
    );
    assert_eq!(
        crate::services::transactions::next_receipt_number(&conn)
            .await
            .expect("preview"),
        format!("{prefix}0004")
    );
}

/// A voided sale keeps its number; the next sale must not reuse it.
#[tokio::test]
async fn a_voided_sale_keeps_its_receipt_number_out_of_reuse() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let prefix = today_receipt_prefix();

    let first = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
        no_provider,
    )
    .await
    .expect("checkout");
    crate::services::transactions::void(
        &conn,
        &admin(),
        crate::domain::transactions::DeleteTransactionInput {
            transaction_id: first.transaction.id,
            reason: "Salah input".to_string(),
        },
    )
    .await
    .expect("void");

    let second = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(second.transaction.receipt_number, format!("{prefix}0002"));
}

// --- Shift booking ---

/// A sale lands in the cashier's own open shift, never someone else's, and in
/// none when the cashier has no shift open.
#[tokio::test]
async fn a_sale_is_booked_to_the_cashiers_own_open_shift() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let kasir = Actor::from(&insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await);

    // Admin has a shift open; the cashier does not.
    let admin_shift = shifts::open(
        &conn,
        &admin(),
        crate::domain::shifts::OpenShiftInput {
            opening_cash: Some(0.0),
        },
    )
    .await
    .expect("admin shift");

    let unbooked = checkout_with_executor(
        &conn,
        &kasir,
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
        no_provider,
    )
    .await
    .expect("checkout");
    assert_eq!(unbooked.transaction.shift_id, None);
    assert_eq!(unbooked.transaction.user_id, kasir.user_id);

    let kasir_shift = shifts::open(
        &conn,
        &kasir,
        crate::domain::shifts::OpenShiftInput {
            opening_cash: Some(0.0),
        },
    )
    .await
    .expect("kasir shift");

    let booked = checkout_with_executor(
        &conn,
        &kasir,
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
        no_provider,
    )
    .await
    .expect("checkout");
    assert_eq!(booked.transaction.shift_id, Some(kasir_shift.id));
    assert_ne!(booked.transaction.shift_id, Some(admin_shift.id));
}

/// After the shift is closed, the next sale has no drawer to land in.
#[tokio::test]
async fn a_sale_after_closing_the_shift_is_not_booked_to_it() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let shift = shifts::open(
        &conn,
        &admin(),
        crate::domain::shifts::OpenShiftInput {
            opening_cash: Some(0.0),
        },
    )
    .await
    .expect("open");
    shifts::close(
        &conn,
        &admin(),
        crate::domain::shifts::CloseShiftInput {
            shift_id: shift.id,
            closing_cash: Some(0.0),
            notes: None,
        },
    )
    .await
    .expect("close");

    let sale = checkout_with_executor(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
        no_provider,
    )
    .await
    .expect("checkout");

    assert_eq!(sale.transaction.shift_id, None);
}
