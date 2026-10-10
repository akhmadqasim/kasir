//! Sales seen from the drawer and the admin's chair: real checkouts, refunds,
//! voids and payment-method corrections, read back through the shift summary
//! and the sales list.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::domain::refunds::{CreateRefundInput, ExchangeItemInput, RefundItemInput};
use crate::domain::shifts::{CloseShiftInput, CreateCashFlowInput, OpenShiftInput};
use crate::domain::transactions::{
    CheckoutTransactionInput, DeleteTransactionInput, ListTransactionsInput, PaymentSplitInput,
    TransactionResult, UpdatePaymentMethodInput,
};
use crate::domain::Actor;
use crate::entity::{products, transaction_payments, transactions};
use crate::services::transactions::checkout::checkout_with_executor;
use crate::services::transactions::fixtures::{
    admin, cash_checkout, insert_product, no_provider, product_line, pulsa_line, setup_test_db,
};
use crate::services::transactions::{list, update_payment_method, void};
use crate::services::{refunds, shifts};
use crate::test_support::insert_user;
use crate::utils::AppError;

async fn open_shift(conn: &DatabaseConnection, actor: &Actor, opening_cash: f64) -> i64 {
    shifts::open(
        conn,
        actor,
        OpenShiftInput {
            opening_cash: Some(opening_cash),
        },
    )
    .await
    .expect("shift opens")
    .id
}

async fn sell(
    conn: &DatabaseConnection,
    actor: &Actor,
    input: CheckoutTransactionInput,
) -> TransactionResult {
    checkout_with_executor(conn, actor, input, no_provider)
        .await
        .expect("checkout")
}

fn split_paid(product_id: i64, quantity: i64, splits: &[(&str, f64)]) -> CheckoutTransactionInput {
    CheckoutTransactionInput {
        payment_breakdown: Some(
            splits
                .iter()
                .map(|(method, amount)| PaymentSplitInput {
                    payment_method: method.to_string(),
                    bank_name: None,
                    amount: *amount,
                })
                .collect(),
        ),
        ..cash_checkout(vec![product_line(product_id, quantity)], 0.0)
    }
}

fn paid_with(
    method: &str,
    product_id: i64,
    quantity: i64,
    amount: f64,
) -> CheckoutTransactionInput {
    CheckoutTransactionInput {
        payment_method: method.to_string(),
        ..cash_checkout(vec![product_line(product_id, quantity)], amount)
    }
}

fn void_input(transaction_id: i64) -> DeleteTransactionInput {
    DeleteTransactionInput {
        transaction_id,
        reason: "Salah input".to_string(),
    }
}

fn refund_good(sale: &TransactionResult, quantity: i64) -> CreateRefundInput {
    CreateRefundInput {
        transaction_id: sale.transaction.id,
        reason: Some("Tidak jadi".to_string()),
        items: vec![RefundItemInput {
            transaction_item_id: sale.items[0].id,
            quantity,
            condition: "good".to_string(),
        }],
        exchange_items: None,
    }
}

async fn stock_of(conn: &DatabaseConnection, product_id: i64) -> i64 {
    products::Entity::find_by_id(product_id)
        .one(conn)
        .await
        .expect("query")
        .expect("product exists")
        .stock
}

fn list_input() -> ListTransactionsInput {
    ListTransactionsInput {
        page: None,
        per_page: None,
        date_from: None,
        date_to: None,
        payment_method: None,
        status: None,
        search: None,
        channel: None,
    }
}

// --- Expected cash in the drawer ---

/// Opening 100.000; a cash sale of 65.000 paid with 100.000; a 65.000 sale
/// split QRIS 30.000 + cash 50.000 (35.000 stays, 15.000 change); a QRIS sale
/// of 20.000; 10.000 put in and 5.000 taken out. Change never counts: the
/// drawer should hold 100 + 65 + 35 + 10 - 5 = 205.000.
#[tokio::test]
async fn expected_cash_counts_only_the_cash_that_stayed_in_the_drawer() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;
    let soap = insert_product(&conn, "Sabun", 20_000.0, 10).await;
    let shift_id = open_shift(&conn, &admin(), 100_000.0).await;

    sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 100_000.0),
    )
    .await;
    sell(
        &conn,
        &admin(),
        split_paid(rice.id, 1, &[("qris", 30_000.0), ("cash", 50_000.0)]),
    )
    .await;
    sell(&conn, &admin(), paid_with("qris", soap.id, 1, 20_000.0)).await;

    for (flow_type, amount) in [("in", 10_000.0), ("out", 5_000.0)] {
        shifts::create_cash_flow(
            &conn,
            &admin(),
            CreateCashFlowInput {
                shift_id,
                flow_type: flow_type.to_string(),
                amount,
                description: "Kas".to_string(),
            },
        )
        .await
        .expect("cash flow");
    }

    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");

    assert_eq!(report.total_sales, 150_000.0);
    assert_eq!(report.total_transactions, 3);
    assert_eq!(report.cash_in, 10_000.0);
    assert_eq!(report.cash_out, 5_000.0);
    assert_eq!(report.expected_cash, 205_000.0);

    let cash = report
        .payment_breakdown
        .iter()
        .find(|b| b.method == "cash")
        .expect("cash row");
    assert_eq!((cash.count, cash.total), (2, 100_000.0));
    let qris = report
        .payment_breakdown
        .iter()
        .find(|b| b.method == "qris")
        .expect("qris row");
    assert_eq!((qris.count, qris.total), (2, 50_000.0));
}

/// A PPOB-page purchase is a real sale for the drawer: the customer's cash is
/// in it, so the shift counts it even though the goods reports do not.
#[tokio::test]
async fn a_ppob_page_sale_counts_in_the_shift() {
    let conn = setup_test_db().await;
    let shift_id = open_shift(&conn, &admin(), 50_000.0).await;

    let sale = sell(
        &conn,
        &admin(),
        CheckoutTransactionInput {
            ppob_pin: Some("123456".to_string()),
            channel: Some("ppob".to_string()),
            ..cash_checkout(vec![pulsa_line()], 12_000.0)
        },
    )
    .await;
    assert_eq!(sale.transaction.channel, "ppob");
    assert_eq!(sale.transaction.shift_id, Some(shift_id));

    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(report.total_transactions, 1);
    assert_eq!(report.expected_cash, 62_000.0);
}

#[tokio::test]
async fn a_voided_sale_leaves_the_shift_figures() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;
    let shift_id = open_shift(&conn, &admin(), 100_000.0).await;

    let sale = sell(
        &conn,
        &admin(),
        split_paid(rice.id, 1, &[("qris", 30_000.0), ("cash", 50_000.0)]),
    )
    .await;
    void(&conn, &admin(), void_input(sale.transaction.id))
        .await
        .expect("void");

    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(report.total_sales, 0.0);
    assert_eq!(report.total_transactions, 0);
    assert!(
        report.payment_breakdown.is_empty(),
        "{:?}",
        report.payment_breakdown
    );
    assert_eq!(report.expected_cash, 100_000.0);
    assert_eq!(stock_of(&conn, rice.id).await, 10);
}

/// Correcting a sale from cash to QRIS takes its money out of the drawer's
/// expectation, and the other way round puts it in.
#[tokio::test]
async fn a_payment_method_correction_moves_the_sale_in_or_out_of_the_drawer() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;
    let shift_id = open_shift(&conn, &admin(), 100_000.0).await;
    let sale = sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 70_000.0),
    )
    .await;

    let correct = |method: &str| UpdatePaymentMethodInput {
        transaction_id: sale.transaction.id,
        payment_method: method.to_string(),
        reason: "Salah pilih".to_string(),
    };

    update_payment_method(&conn, &admin(), correct("qris"))
        .await
        .expect("to qris");
    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(report.expected_cash, 100_000.0);
    assert_eq!(report.total_sales, 65_000.0);

    update_payment_method(&conn, &admin(), correct("cash"))
        .await
        .expect("back to cash");
    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(report.expected_cash, 165_000.0);
}

/// A full cash refund through the real refund service, in the same shift, nets
/// the drawer back to its opening float and puts the goods back on the shelf.
#[tokio::test]
async fn a_real_cash_refund_in_the_same_shift_nets_the_drawer_to_the_float() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;
    let shift_id = open_shift(&conn, &admin(), 100_000.0).await;
    let sale = sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 2)], 130_000.0),
    )
    .await;

    refunds::create::create(&conn, &admin(), refund_good(&sale, 1))
        .await
        .expect("partial refund");
    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(report.cash_refunds, 65_000.0);
    assert_eq!(report.expected_cash, 165_000.0);
    assert_eq!(stock_of(&conn, rice.id).await, 9);

    refunds::create::create(&conn, &admin(), refund_good(&sale, 1))
        .await
        .expect("rest of the refund");
    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(report.total_sales, 130_000.0, "the sale still came in");
    assert_eq!(report.cash_refunds, 130_000.0);
    assert_eq!(report.expected_cash, 100_000.0);
    assert_eq!(stock_of(&conn, rice.id).await, 10);
}

/// An exchange for a dearer item: the customer tops up the difference in
/// cash, which goes into the drawer.
#[tokio::test]
async fn an_exchange_for_a_dearer_item_puts_the_top_up_in_the_drawer() {
    let conn = setup_test_db().await;
    let soap = insert_product(&conn, "Sabun", 10_000.0, 10).await;
    let shampoo = insert_product(&conn, "Sampo", 15_000.0, 10).await;
    let shift_id = open_shift(&conn, &admin(), 100_000.0).await;
    let sale = sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(soap.id, 1)], 10_000.0),
    )
    .await;

    let exchange = refunds::create::create(
        &conn,
        &admin(),
        CreateRefundInput {
            exchange_items: Some(vec![ExchangeItemInput {
                product_id: shampoo.id,
                quantity: 1,
            }]),
            ..refund_good(&sale, 1)
        },
    )
    .await
    .expect("exchange");
    assert_eq!(exchange.refund.difference_amount, Some(-5_000.0));

    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(report.expected_cash, 115_000.0);
    assert_eq!(stock_of(&conn, soap.id).await, 10);
    assert_eq!(stock_of(&conn, shampoo.id).await, 9);
}

/// A cash sale refunded in cash, then corrected to QRIS by the admin. The
/// refund's method was copied from the sale, so it keeps saying `cash`: the
/// drawer now expects 10.000 *less* than the float though no cash ever moved
/// (the sale was QRIS, so the payout went back over QRIS too).
#[tokio::test]
async fn correcting_a_refunded_sale_to_qris_does_not_leave_a_phantom_cash_payout() {
    let conn = setup_test_db().await;
    let soap = insert_product(&conn, "Sabun", 10_000.0, 10).await;
    let shift_id = open_shift(&conn, &admin(), 100_000.0).await;
    let sale = sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(soap.id, 1)], 10_000.0),
    )
    .await;
    refunds::create::create(&conn, &admin(), refund_good(&sale, 1))
        .await
        .expect("refund");

    let corrected = update_payment_method(
        &conn,
        &admin(),
        UpdatePaymentMethodInput {
            transaction_id: sale.transaction.id,
            payment_method: "qris".to_string(),
            reason: "Ternyata bayar QRIS".to_string(),
        },
    )
    .await;

    // Either refusing the correction or carrying it to the refund is fine;
    // what is not fine is a drawer that disagrees with every record.
    if corrected.is_ok() {
        let report = shifts::summary(&conn, &admin(), shift_id)
            .await
            .expect("summary");
        assert_eq!(report.expected_cash, 100_000.0, "no cash moved at all");
    }
}

/// A sale rung up by another cashier, or with no shift open, is not this
/// shift's money.
#[tokio::test]
async fn only_the_owners_sales_in_the_shift_count() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let kasir = Actor::from(&insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await);

    sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
    )
    .await;
    let shift_id = open_shift(&conn, &admin(), 0.0).await;
    sell(
        &conn,
        &kasir,
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
    )
    .await;
    sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
    )
    .await;

    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(report.total_transactions, 1);
    assert_eq!(report.expected_cash, 10_000.0);
}

// --- Closing and cash flows ---

#[tokio::test]
async fn closing_records_the_count_and_a_second_close_is_refused() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let shift_id = open_shift(&conn, &admin(), 50_000.0).await;
    sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 20_000.0),
    )
    .await;

    let closed = shifts::close(
        &conn,
        &admin(),
        CloseShiftInput {
            shift_id,
            closing_cash: Some(58_000.0),
            notes: Some("kurang 2rb".to_string()),
        },
    )
    .await
    .expect("close");
    assert_eq!(closed.shift.status, "closed");
    assert_eq!(closed.shift.closing_cash, Some(58_000.0));
    assert_eq!(closed.expected_cash, 60_000.0);

    let again = shifts::close(
        &conn,
        &admin(),
        CloseShiftInput {
            shift_id,
            closing_cash: Some(0.0),
            notes: None,
        },
    )
    .await;
    assert!(
        matches!(again, Err(AppError::Validation(_))),
        "got {again:?}"
    );

    let reread = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(
        reread.shift.closing_cash,
        Some(58_000.0),
        "first count kept"
    );
}

#[tokio::test]
async fn a_cash_flow_needs_a_valid_type_a_positive_amount_and_a_description() {
    let conn = setup_test_db().await;
    let shift_id = open_shift(&conn, &admin(), 0.0).await;

    for (flow_type, amount, description) in [
        ("sideways", 1_000.0, "Kas"),
        ("in", 0.0, "Kas"),
        ("out", -1_000.0, "Kas"),
        ("in", 1_000.0, "   "),
    ] {
        let result = shifts::create_cash_flow(
            &conn,
            &admin(),
            CreateCashFlowInput {
                shift_id,
                flow_type: flow_type.to_string(),
                amount,
                description: description.to_string(),
            },
        )
        .await;
        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "{flow_type}/{amount}/{description:?}: got {result:?}"
        );
    }

    let missing = shifts::create_cash_flow(
        &conn,
        &admin(),
        CreateCashFlowInput {
            shift_id: 9_999,
            flow_type: "in".to_string(),
            amount: 1_000.0,
            description: "Kas".to_string(),
        },
    )
    .await;
    assert!(
        matches!(missing, Err(AppError::NotFound(_))),
        "got {missing:?}"
    );
}

/// A closed shift's drawer is settled: no cash can be booked to it and no
/// entry removed from it.
#[tokio::test]
async fn a_closed_shift_takes_no_more_cash_flows_and_loses_none() {
    let conn = setup_test_db().await;
    let shift_id = open_shift(&conn, &admin(), 0.0).await;
    let flow = shifts::create_cash_flow(
        &conn,
        &admin(),
        CreateCashFlowInput {
            shift_id,
            flow_type: "out".to_string(),
            amount: 5_000.0,
            description: "Beli galon".to_string(),
        },
    )
    .await
    .expect("cash flow");
    shifts::close(
        &conn,
        &admin(),
        CloseShiftInput {
            shift_id,
            closing_cash: Some(0.0),
            notes: None,
        },
    )
    .await
    .expect("close");

    let booked = shifts::create_cash_flow(
        &conn,
        &admin(),
        CreateCashFlowInput {
            shift_id,
            flow_type: "in".to_string(),
            amount: 5_000.0,
            description: "Telat".to_string(),
        },
    )
    .await;
    assert!(
        matches!(booked, Err(AppError::Validation(_))),
        "got {booked:?}"
    );

    let removed = shifts::delete_cash_flow(&conn, &admin(), flow.id).await;
    assert!(
        matches!(removed, Err(AppError::Validation(_))),
        "got {removed:?}"
    );

    let report = shifts::summary(&conn, &admin(), shift_id)
        .await
        .expect("summary");
    assert_eq!(report.cash_out, 5_000.0);
    assert_eq!(report.cash_flows.len(), 1);
}

// --- Void ---

#[tokio::test]
async fn a_void_puts_every_line_back_on_the_shelf() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let soap = insert_product(&conn, "Sabun", 5_000.0, 10).await;
    let sale = sell(
        &conn,
        &admin(),
        cash_checkout(
            vec![
                product_line(rice.id, 2),
                product_line(soap.id, 3),
                product_line(rice.id, 1),
            ],
            45_000.0,
        ),
    )
    .await;
    assert_eq!(stock_of(&conn, rice.id).await, 7);

    void(&conn, &admin(), void_input(sale.transaction.id))
        .await
        .expect("void");

    assert_eq!(stock_of(&conn, rice.id).await, 10);
    assert_eq!(stock_of(&conn, soap.id).await, 10);
    let voided = transactions::Entity::find_by_id(sale.transaction.id)
        .one(&conn)
        .await
        .expect("query")
        .expect("kept");
    assert_eq!(voided.status, "deleted");
    assert_eq!(voided.total_amount, 0.0);
    assert_eq!(voided.deleted_by, Some(1));
    assert_eq!(voided.deleted_reason.as_deref(), Some("Salah input"));
}

#[tokio::test]
async fn a_void_needs_a_reason_and_a_real_sale() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let sale = sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
    )
    .await;

    let blank = void(
        &conn,
        &admin(),
        DeleteTransactionInput {
            transaction_id: sale.transaction.id,
            reason: "   ".to_string(),
        },
    )
    .await;
    assert!(
        matches!(blank, Err(AppError::Validation(_))),
        "got {blank:?}"
    );
    assert_eq!(stock_of(&conn, rice.id).await, 9);

    let missing = void(&conn, &admin(), void_input(9_999)).await;
    assert!(
        matches!(missing, Err(AppError::NotFound(_))),
        "got {missing:?}"
    );
}

/// A refunded sale cannot be voided: the refund already put goods back, so a
/// void would put them back a second time.
#[tokio::test]
async fn a_sale_with_a_real_refund_cannot_be_voided() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let sale = sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 2)], 20_000.0),
    )
    .await;
    refunds::create::create(&conn, &admin(), refund_good(&sale, 1))
        .await
        .expect("refund");
    assert_eq!(stock_of(&conn, rice.id).await, 9);

    let result = void(&conn, &admin(), void_input(sale.transaction.id)).await;

    assert!(
        matches!(result, Err(AppError::Validation(_))),
        "got {result:?}"
    );
    assert_eq!(stock_of(&conn, rice.id).await, 9);
}

// --- Payment-method correction ---

#[tokio::test]
async fn a_payment_method_correction_needs_a_real_method_and_a_reason() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let sale = sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
    )
    .await;

    for (method, reason) in [("mixed", "Salah"), ("voucher", "Salah"), ("qris", "  ")] {
        let result = update_payment_method(
            &conn,
            &admin(),
            UpdatePaymentMethodInput {
                transaction_id: sale.transaction.id,
                payment_method: method.to_string(),
                reason: reason.to_string(),
            },
        )
        .await;
        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "{method}/{reason:?}: got {result:?}"
        );
    }

    let reloaded = transactions::Entity::find_by_id(sale.transaction.id)
        .one(&conn)
        .await
        .expect("query")
        .expect("exists");
    assert_eq!(reloaded.payment_method, "cash");
}

/// A split sale corrected to one method has one payment row for the whole
/// total, and no change left over.
#[tokio::test]
async fn correcting_a_split_sale_collapses_it_to_one_payment() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;
    let sale = sell(
        &conn,
        &admin(),
        split_paid(rice.id, 1, &[("qris", 30_000.0), ("cash", 50_000.0)]),
    )
    .await;

    let updated = update_payment_method(
        &conn,
        &admin(),
        UpdatePaymentMethodInput {
            transaction_id: sale.transaction.id,
            payment_method: "transfer".to_string(),
            reason: "Semua transfer".to_string(),
        },
    )
    .await
    .expect("correct");

    assert_eq!(updated.payment_method, "transfer");
    assert_eq!(updated.payment_amount, 65_000.0);
    assert_eq!(updated.change_amount, Some(0.0));
    let rows: Vec<(String, f64)> = transaction_payments::Entity::find()
        .filter(transaction_payments::Column::TransactionId.eq(sale.transaction.id))
        .all(&conn)
        .await
        .expect("query")
        .into_iter()
        .map(|p| (p.payment_method, p.amount))
        .collect();
    assert_eq!(rows, vec![("transfer".to_string(), 65_000.0)]);
}

// --- Sales list ---

/// The `cash` filter finds a split sale with a cash leg, but not a QRIS sale
/// whose "cash" was all handed back as change.
#[tokio::test]
async fn the_cash_filter_follows_the_recorded_payment_legs() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;
    let mixed = sell(
        &conn,
        &admin(),
        split_paid(rice.id, 1, &[("qris", 30_000.0), ("cash", 50_000.0)]),
    )
    .await;
    let all_qris = sell(
        &conn,
        &admin(),
        split_paid(rice.id, 1, &[("qris", 65_000.0), ("cash", 20_000.0)]),
    )
    .await;
    assert_eq!(all_qris.transaction.payment_method, "qris");

    let page = list(
        &conn,
        ListTransactionsInput {
            payment_method: Some("cash".to_string()),
            ..list_input()
        },
    )
    .await
    .expect("list");

    let ids: Vec<i64> = page.data.iter().map(|row| row.id).collect();
    assert_eq!(ids, vec![mixed.transaction.id]);
    assert_eq!(page.data[0].payment_breakdown.len(), 2);
}

/// The payment-leg filter binds its own value even when other filters bind
/// values before it.
#[tokio::test]
async fn the_cash_filter_combines_with_other_filters() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 65_000.0, 10).await;
    let mixed = sell(
        &conn,
        &admin(),
        split_paid(rice.id, 1, &[("qris", 30_000.0), ("cash", 50_000.0)]),
    )
    .await;

    let page = list(
        &conn,
        ListTransactionsInput {
            payment_method: Some("cash".to_string()),
            channel: Some("sales".to_string()),
            status: Some("completed".to_string()),
            ..list_input()
        },
    )
    .await
    .expect("list");

    let ids: Vec<i64> = page.data.iter().map(|row| row.id).collect();
    assert_eq!(ids, vec![mixed.transaction.id]);
}

/// A voided sale stays in the history, marked, and drops out of a
/// `completed` filter.
#[tokio::test]
async fn a_voided_sale_stays_listed_but_not_as_completed() {
    let conn = setup_test_db().await;
    let rice = insert_product(&conn, "Beras", 10_000.0, 10).await;
    let sale = sell(
        &conn,
        &admin(),
        cash_checkout(vec![product_line(rice.id, 1)], 10_000.0),
    )
    .await;
    void(&conn, &admin(), void_input(sale.transaction.id))
        .await
        .expect("void");

    let everything = list(&conn, list_input()).await.expect("list");
    assert_eq!(everything.total, 1);
    assert_eq!(everything.data[0].status, "deleted");
    assert!(everything.data[0].deleted_at.is_some());

    let completed = list(
        &conn,
        ListTransactionsInput {
            status: Some("completed".to_string()),
            ..list_input()
        },
    )
    .await
    .expect("list");
    assert_eq!(completed.total, 0);
}
