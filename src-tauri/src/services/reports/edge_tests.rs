//! Edge cases across the reports and the dashboard: local-day boundaries at
//! both midnights, the sales channel, partial refunds and exchanges, the
//! buy-price snapshot, split payments, low stock and the stock report past its
//! row cap.

use chrono::{Duration, NaiveDate};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::fixtures::{return_lines, three_item_sale};
use super::*;
use crate::domain::products::ProductSearchParams;
use crate::services::dashboard;
use crate::test_support::{
    date_str, insert_exchange_item, insert_product, insert_refund, insert_refund_item,
    insert_transaction, insert_transaction_in_channel, insert_transaction_item,
    insert_transaction_item_spec, insert_writeoff, setup_test_db, today, utc_at_local_noon,
    RefundSpec, TransactionItemSpec, WriteoffSpec,
};
use crate::utils::time::local_to_utc;

/// A day far from today, so nothing the clock does can move it.
fn fixed_day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 3, 15).expect("valid date")
}

/// UTC timestamp for `h:m:s` local time on `date`.
fn utc_at_local(date: NaiveDate, h: u32, m: u32, s: u32) -> String {
    local_to_utc(date.and_hms_opt(h, m, s).expect("valid time")).expect("ordinary date")
}

async fn exec(conn: &DatabaseConnection, sql: &str, values: Vec<sea_orm::Value>) {
    conn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        sql,
        values,
    ))
    .await
    .expect("raw statement");
}

async fn insert_split(conn: &DatabaseConnection, txn_id: i64, method: &str, amount: f64) {
    exec(
        conn,
        "INSERT INTO transaction_payments (transaction_id, payment_method, amount, created_at)
         VALUES ($1, $2, $3, $4)",
        vec![
            txn_id.into(),
            method.into(),
            amount.into(),
            crate::utils::time::now_ts().into(),
        ],
    )
    .await;
}

// ---------------------------------------------------------------------------
// Local-day boundaries
// ---------------------------------------------------------------------------

/// A sale at 23:59:59 local belongs to that day, one at 00:00:00 local to the
/// next, whatever the machine's UTC offset is.
#[tokio::test]
async fn daily_sales_put_each_sale_on_its_local_day_at_both_midnights() {
    let conn = setup_test_db().await;
    let day = fixed_day();
    let before = day - Duration::days(1);
    let after = day + Duration::days(1);

    insert_transaction(
        &conn,
        1,
        1_000.0,
        "completed",
        &utc_at_local(before, 23, 59, 59),
    )
    .await;
    insert_transaction(&conn, 1, 2_000.0, "completed", &utc_at_local(day, 0, 0, 0)).await;
    insert_transaction(
        &conn,
        1,
        4_000.0,
        "completed",
        &utc_at_local(day, 23, 59, 59),
    )
    .await;
    insert_transaction(
        &conn,
        1,
        8_000.0,
        "completed",
        &utc_at_local(after, 0, 0, 0),
    )
    .await;

    let rows = daily_sales(&conn, date_str(day), date_str(day))
        .await
        .expect("query");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].date, date_str(day));
    assert_eq!(rows[0].transaction_count, 2);
    assert_eq!(rows[0].total_revenue, 6_000.0);

    let rows = daily_sales(&conn, date_str(before), date_str(after))
        .await
        .expect("query");
    let by_day: Vec<(String, f64)> = rows
        .iter()
        .map(|r| (r.date.clone(), r.total_revenue))
        .collect();
    assert_eq!(
        by_day,
        vec![
            (date_str(after), 8_000.0),
            (date_str(day), 6_000.0),
            (date_str(before), 1_000.0),
        ]
    );
}

/// A return booked one second after local midnight is taken off the new day,
/// not the day of the sale.
#[tokio::test]
async fn a_return_just_after_local_midnight_lands_on_the_next_day() {
    let conn = setup_test_db().await;
    let day = fixed_day();
    let next = day + Duration::days(1);
    let (txn_id, lines) = three_item_sale(&conn, &utc_at_local(day, 23, 59, 59)).await;
    return_lines(
        &conn,
        txn_id,
        &utc_at_local(next, 0, 0, 1),
        "cash",
        &lines[..1],
        100_000.0,
    )
    .await;

    let sale_day = daily_sales(&conn, date_str(day), date_str(day))
        .await
        .expect("query");
    assert_eq!(sale_day[0].total_revenue, 300_000.0);
    assert_eq!(sale_day[0].total_cost, 180_000.0);

    let refund_day = daily_sales(&conn, date_str(next), date_str(next))
        .await
        .expect("query");
    assert_eq!(refund_day.len(), 1);
    assert_eq!(refund_day[0].date, date_str(next));
    assert_eq!(refund_day[0].total_revenue, -100_000.0);
    assert_eq!(refund_day[0].total_cost, -60_000.0);
    assert_eq!(refund_day[0].transaction_count, 0);
}

/// New Year's Eve at 23:59:59 local is December of the old year; one second
/// later is January of the new one.
#[tokio::test]
async fn monthly_sales_split_the_year_at_local_midnight() {
    let conn = setup_test_db().await;
    let eve = NaiveDate::from_ymd_opt(2025, 12, 31).unwrap();
    let new_year = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    insert_transaction(
        &conn,
        1,
        10_000.0,
        "completed",
        &utc_at_local(eve, 23, 59, 59),
    )
    .await;
    insert_transaction(
        &conn,
        1,
        20_000.0,
        "completed",
        &utc_at_local(new_year, 0, 0, 0),
    )
    .await;

    let old = monthly_sales(&conn, 2025).await.expect("query");
    assert_eq!(old.len(), 1);
    assert_eq!(old[0].month, "2025-12");
    assert_eq!(old[0].total_revenue, 10_000.0);

    let new = monthly_sales(&conn, 2026).await.expect("query");
    assert_eq!(new.len(), 1);
    assert_eq!(new[0].month, "2026-01");
    assert_eq!(new[0].total_revenue, 20_000.0);
}

/// Every other dated report takes the same half-open local day: a row at
/// 00:00:00 local is in, the second before it and the midnight after are out.
#[tokio::test]
async fn every_dated_report_uses_the_same_local_day_boundaries() {
    let conn = setup_test_db().await;
    let day = fixed_day();
    let inside = utc_at_local(day, 0, 0, 0);
    let late_inside = utc_at_local(day, 23, 59, 59);
    let before = utc_at_local(day - Duration::days(1), 23, 59, 59);
    let after = utc_at_local(day + Duration::days(1), 0, 0, 0);

    let product = insert_product(&conn, "Telur", 1_500.0, 2_000.0, 100).await;
    // One sale on each side of both boundaries, each returned at the same time.
    for (at, price) in [
        (&before, 1_000.0),
        (&inside, 2_000.0),
        (&late_inside, 4_000.0),
        (&after, 8_000.0),
    ] {
        let txn = insert_transaction(&conn, 1, price, "completed", at).await;
        // Two units at half the price each; one comes back.
        let line = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Telur",
            price / 2.0,
            500.0,
            2,
        )
        .await;
        let refund = insert_refund(
            &conn,
            RefundSpec {
                transaction_id: txn.id,
                user_id: 1,
                refund_type: "refund",
                total_refund_amount: price / 2.0,
                total_exchange_amount: 0.0,
                difference_amount: price / 2.0,
                payment_method: "cash",
                shift_id: None,
                created_at: at,
            },
        )
        .await;
        insert_refund_item(&conn, refund.id, line.id, product.id, 1, price / 2.0).await;
        insert_writeoff(
            &conn,
            WriteoffSpec {
                product_id: product.id,
                user_id: 1,
                quantity: 1,
                reason: "damaged",
                loss_value: price,
                status: "approved",
                created_at: at,
            },
        )
        .await;
    }
    exec(
        &conn,
        "INSERT INTO shifts (user_id, opening_cash, opened_at, status) VALUES (1, 0, $1, 'open')",
        vec![before.clone().into()],
    )
    .await;
    for (at, amount) in [
        (&before, 1_000.0),
        (&inside, 2_000.0),
        (&late_inside, 4_000.0),
        (&after, 8_000.0),
    ] {
        exec(
            &conn,
            "INSERT INTO cash_flows (shift_id, user_id, type, amount, description, created_at)
             VALUES (1, 1, 'in', $1, 'modal', $2)",
            vec![amount.into(), at.clone().into()],
        )
        .await;
    }

    let d = date_str(day);
    let receipts = sales_receipts(&conn, d.clone(), d.clone(), String::new())
        .await
        .expect("receipts");
    assert_eq!(receipts.total_count, 2);
    let receipt_total: f64 = receipts.items.iter().map(|r| r.total_amount).sum();
    assert_eq!(receipt_total, 6_000.0);

    let methods = payment_methods(&conn, d.clone(), d.clone())
        .await
        .expect("payment methods");
    assert_eq!(methods.total_transactions, 2);
    let cash = methods
        .rows
        .iter()
        .find(|r| r.payment_method == "cash")
        .expect("cash row");
    assert_eq!(cash.total_amount, 3_000.0, "6.000 taken, 3.000 handed back");

    let products = product_sales(&conn, d.clone(), d.clone())
        .await
        .expect("product sales");
    assert_eq!(products.len(), 1);
    assert_eq!(products[0].qty_sold, 2);
    assert_eq!(products[0].total_revenue, 3_000.0);

    let returned = returns(&conn, d.clone(), d.clone()).await.expect("returns");
    assert_eq!(returned.len(), 2);
    let returned_total: f64 = returned.iter().map(|r| r.total_refund_amount).sum();
    assert_eq!(returned_total, 3_000.0);

    let lost = losses(&conn, d.clone(), d.clone()).await.expect("losses");
    assert_eq!(lost.total_writeoffs, 2);
    assert_eq!(lost.total_loss_value, 6_000.0);

    let flows = cash_flows(
        &conn,
        &crate::domain::actor::Actor::new(1, "admin"),
        d.clone(),
        d,
    )
    .await
    .expect("cash flows");
    assert_eq!(flows.items.len(), 2);
    assert_eq!(flows.total_in, 6_000.0);
    assert_eq!(flows.net_total, 6_000.0);
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/// A purchase paid on the PPOB page never reaches a sales figure — in the
/// reports or on the dashboard — even when its line points at a product.
#[tokio::test]
async fn a_ppob_page_purchase_is_left_out_of_every_sales_figure() {
    let conn = setup_test_db().await;
    let now = utc_at_local_noon(today());
    let product = insert_product(&conn, "Beras 5kg", 60_000.0, 100_000.0, 10).await;

    let sale = insert_transaction(&conn, 1, 100_000.0, "completed", &now).await;
    insert_transaction_item(
        &conn,
        sale.id,
        Some(product.id),
        "Beras 5kg",
        100_000.0,
        60_000.0,
        1,
    )
    .await;
    let ppob = insert_transaction_in_channel(&conn, 1, 52_000.0, "completed", &now, "ppob").await;
    insert_transaction_item(
        &conn,
        ppob.id,
        Some(product.id),
        "Beras 5kg",
        52_000.0,
        50_000.0,
        1,
    )
    .await;
    insert_split(&conn, ppob.id, "qris", 52_000.0).await;

    let d = date_str(today());
    let year: i32 = today().format("%Y").to_string().parse().unwrap();
    let month = today().format("%Y-%m").to_string();

    let monthly = monthly_sales(&conn, year).await.expect("monthly");
    let row = monthly
        .iter()
        .find(|r| r.month == month)
        .expect("month row");
    assert_eq!(row.total_revenue, 100_000.0);
    assert_eq!(row.total_cost, 60_000.0);

    let receipts = sales_receipts(&conn, d.clone(), d.clone(), String::new())
        .await
        .expect("receipts");
    assert_eq!(receipts.total_count, 1);
    assert_eq!(receipts.items[0].id, sale.id);

    let methods = payment_methods(&conn, d.clone(), d.clone())
        .await
        .expect("methods");
    assert_eq!(methods.total_transactions, 1);
    assert!(methods.rows.iter().all(|r| r.payment_method != "qris"));

    let products = product_sales(&conn, d.clone(), d.clone())
        .await
        .expect("products");
    assert_eq!(products.len(), 1);
    assert_eq!(products[0].qty_sold, 1);
    assert_eq!(products[0].total_revenue, 100_000.0);

    let popular = popular_products(&conn, d.clone(), d, 10)
        .await
        .expect("popular");
    assert_eq!(popular[0].qty_sold, 1);

    let chart = dashboard::daily_revenue(&conn, Some(1))
        .await
        .expect("chart");
    assert_eq!(chart[0].revenue, 100_000.0);
    assert_eq!(chart[0].transactions, 1);

    let stats = dashboard::payment_method_stats(&conn).await.expect("stats");
    assert!(stats.iter().all(|s| s.method != "qris"));
    let daily_methods = dashboard::payment_method_daily(&conn, Some(1))
        .await
        .expect("daily methods");
    assert!(daily_methods.iter().all(|s| s.method != "qris"));

    let top = dashboard::top_products(&conn, Some(10)).await.expect("top");
    assert_eq!(top.len(), 1);
    assert_eq!(top[0].total_qty, 1);
    assert_eq!(top[0].total_revenue, 100_000.0);
}

// ---------------------------------------------------------------------------
// Partial refunds and exchanges
// ---------------------------------------------------------------------------

/// Three units at Rp 10.000 with a Rp 3.000 line discount (Rp 27.000 paid), one
/// unit handed back for its net Rp 9.000. Every report agrees on what stayed.
#[tokio::test]
async fn a_partial_refund_of_a_discounted_line_reconciles_across_reports() {
    let conn = setup_test_db().await;
    let now = utc_at_local_noon(today());
    let kopi = insert_product(&conn, "Kopi", 6_000.0, 10_000.0, 10).await;
    let sale = insert_transaction(&conn, 1, 27_000.0, "partial_refund", &now).await;
    let line = insert_transaction_item_spec(
        &conn,
        TransactionItemSpec {
            transaction_id: sale.id,
            product_id: Some(kopi.id),
            product_name: "Kopi",
            product_price: 10_000.0,
            buy_price: 6_000.0,
            quantity: 3,
            item_discount: 3_000.0,
            net_subtotal: None,
        },
    )
    .await;
    let refund = insert_refund(
        &conn,
        RefundSpec {
            transaction_id: sale.id,
            user_id: 1,
            refund_type: "refund",
            total_refund_amount: 9_000.0,
            total_exchange_amount: 0.0,
            difference_amount: 9_000.0,
            payment_method: "cash",
            shift_id: None,
            created_at: &now,
        },
    )
    .await;
    insert_refund_item(&conn, refund.id, line.id, kopi.id, 1, 9_000.0).await;

    let d = date_str(today());
    let daily = daily_sales(&conn, d.clone(), d.clone())
        .await
        .expect("daily");
    assert_eq!(daily[0].total_revenue, 18_000.0);
    assert_eq!(daily[0].total_cost, 12_000.0);
    assert_eq!(daily[0].gross_profit, 6_000.0);

    let products = product_sales(&conn, d.clone(), d.clone())
        .await
        .expect("products");
    assert_eq!(products[0].qty_sold, 2);
    assert_eq!(products[0].total_revenue, 18_000.0);
    assert_eq!(products[0].total_cost, 12_000.0);
    assert_eq!(products[0].profit, 6_000.0);

    let methods = payment_methods(&conn, d.clone(), d.clone())
        .await
        .expect("methods");
    assert_eq!(methods.rows.len(), 1);
    assert_eq!(methods.rows[0].total_amount, 18_000.0);
    assert_eq!(methods.rows[0].percentage, 100.0);

    let receipts = sales_receipts(&conn, d.clone(), d, String::new())
        .await
        .expect("receipts");
    assert_eq!(receipts.items[0].refund_amount, 9_000.0);
    assert_eq!(receipts.items[0].net_amount, 18_000.0);
    assert_eq!(receipts.items[0].status, "partial_refund");

    let summary = dashboard::summary(&conn).await.expect("summary");
    assert_eq!(summary.today_revenue, 18_000.0);
    assert_eq!(summary.today_gross_profit, 6_000.0);
    assert_eq!(summary.today_refunds, 1);
    assert_eq!(summary.today_refund_amount, 9_000.0);
}

/// Seeds a Rp 45.000 peci sale exchanged for a Rp 60.000 sarung: the customer
/// pays Rp 15.000 more. Returns `(peci id, sarung id)`.
async fn seed_upgrade_exchange(conn: &DatabaseConnection, at: &str) -> (i64, i64) {
    let peci = insert_product(conn, "Peci", 25_000.0, 45_000.0, 10).await;
    let sarung = insert_product(conn, "Sarung", 40_000.0, 60_000.0, 10).await;
    let sale = insert_transaction(conn, 1, 45_000.0, "completed", at).await;
    let line =
        insert_transaction_item(conn, sale.id, Some(peci.id), "Peci", 45_000.0, 25_000.0, 1).await;
    let refund = insert_refund(
        conn,
        RefundSpec {
            transaction_id: sale.id,
            user_id: 1,
            refund_type: "exchange",
            total_refund_amount: 45_000.0,
            total_exchange_amount: 60_000.0,
            difference_amount: -15_000.0,
            payment_method: "cash",
            shift_id: None,
            created_at: at,
        },
    )
    .await;
    insert_refund_item(conn, refund.id, line.id, peci.id, 1, 45_000.0).await;
    insert_exchange_item(conn, refund.id, sarung.id, "Sarung", 60_000.0, 1).await;
    (peci.id, sarung.id)
}

/// A negative difference is money the customer paid in, so revenue goes up by
/// it, on the method it was paid with.
#[tokio::test]
async fn an_upgrade_exchange_adds_the_difference_the_customer_paid() {
    let conn = setup_test_db().await;
    let now = utc_at_local_noon(today());
    let (peci, sarung) = seed_upgrade_exchange(&conn, &now).await;

    let d = date_str(today());
    let daily = daily_sales(&conn, d.clone(), d.clone())
        .await
        .expect("daily");
    assert_eq!(daily[0].total_revenue, 60_000.0);
    assert_eq!(daily[0].total_cost, 40_000.0);

    let methods = payment_methods(&conn, d.clone(), d.clone())
        .await
        .expect("methods");
    assert_eq!(methods.rows[0].payment_method, "cash");
    assert_eq!(methods.rows[0].total_amount, 60_000.0);

    let products = product_sales(&conn, d.clone(), d.clone())
        .await
        .expect("products");
    let peci_row = products.iter().find(|r| r.product_id == peci).unwrap();
    let sarung_row = products.iter().find(|r| r.product_id == sarung).unwrap();
    assert_eq!((peci_row.qty_sold, peci_row.total_revenue), (0, 0.0));
    assert_eq!(
        (sarung_row.qty_sold, sarung_row.total_revenue),
        (1, 60_000.0)
    );
    assert_eq!(sarung_row.profit, 20_000.0);

    let receipts = sales_receipts(&conn, d.clone(), d, String::new())
        .await
        .expect("receipts");
    assert_eq!(receipts.items[0].refund_amount, -15_000.0);
    assert_eq!(receipts.items[0].net_amount, 60_000.0);
}

/// Swapping a damaged unit for a new one of the same product changes no sales
/// figure at all.
#[tokio::test]
async fn a_like_for_like_exchange_changes_no_sales_figure() {
    let conn = setup_test_db().await;
    let now = utc_at_local_noon(today());
    let gula = insert_product(&conn, "Gula", 12_000.0, 15_000.0, 10).await;
    let sale = insert_transaction(&conn, 1, 30_000.0, "completed", &now).await;
    let line =
        insert_transaction_item(&conn, sale.id, Some(gula.id), "Gula", 15_000.0, 12_000.0, 2).await;
    let refund = insert_refund(
        &conn,
        RefundSpec {
            transaction_id: sale.id,
            user_id: 1,
            refund_type: "exchange",
            total_refund_amount: 15_000.0,
            total_exchange_amount: 15_000.0,
            difference_amount: 0.0,
            payment_method: "cash",
            shift_id: None,
            created_at: &now,
        },
    )
    .await;
    insert_refund_item(&conn, refund.id, line.id, gula.id, 1, 15_000.0).await;
    insert_exchange_item(&conn, refund.id, gula.id, "Gula", 15_000.0, 1).await;

    let d = date_str(today());
    let daily = daily_sales(&conn, d.clone(), d.clone())
        .await
        .expect("daily");
    assert_eq!(daily[0].total_revenue, 30_000.0);
    assert_eq!(daily[0].total_cost, 24_000.0);

    let products = product_sales(&conn, d.clone(), d.clone())
        .await
        .expect("products");
    assert_eq!(products.len(), 1);
    assert_eq!(products[0].qty_sold, 2);
    assert_eq!(products[0].total_revenue, 30_000.0);

    let methods = payment_methods(&conn, d.clone(), d).await.expect("methods");
    assert_eq!(methods.rows[0].total_amount, 30_000.0);
}

// ---------------------------------------------------------------------------
// Buy-price snapshot
// ---------------------------------------------------------------------------

/// Editing a product's buy price later must not rewrite the profit of sales
/// (and of returns of those sales) that already happened.
#[tokio::test]
async fn profit_uses_the_buy_price_snapshotted_at_sale_time() {
    let conn = setup_test_db().await;
    let now = utc_at_local_noon(today());
    let (txn_id, lines) = three_item_sale(&conn, &now).await;
    return_lines(&conn, txn_id, &now, "cash", &lines[..1], 100_000.0).await;
    exec(&conn, "UPDATE products SET buy_price = 95000", vec![]).await;

    let d = date_str(today());
    let daily = daily_sales(&conn, d.clone(), d.clone())
        .await
        .expect("daily");
    assert_eq!(daily[0].total_cost, 120_000.0);
    assert_eq!(daily[0].gross_profit, 80_000.0);

    let products = product_sales(&conn, d.clone(), d).await.expect("products");
    let cost: f64 = products.iter().map(|r| r.total_cost).sum();
    assert_eq!(cost, 120_000.0);

    let summary = dashboard::summary(&conn).await.expect("summary");
    assert_eq!(summary.today_gross_profit, 80_000.0);
}

/// The replacement on an exchange has no buy-price snapshot, so its cost is
/// read off the product row at report time: re-pricing the sarung a week later
/// rewrites the profit of a day that is already closed.
#[tokio::test]
async fn an_exchange_replacement_keeps_its_cost_after_a_buy_price_edit() {
    let conn = setup_test_db().await;
    let day = fixed_day();
    let (_, sarung) = seed_upgrade_exchange(&conn, &utc_at_local_noon(day)).await;

    let d = date_str(day);
    let before = daily_sales(&conn, d.clone(), d.clone())
        .await
        .expect("daily");
    assert_eq!(before[0].total_cost, 40_000.0);

    exec(
        &conn,
        "UPDATE products SET buy_price = 55000 WHERE id = $1",
        vec![sarung.into()],
    )
    .await;

    let after = daily_sales(&conn, d.clone(), d).await.expect("daily");
    assert_eq!(
        after[0].total_cost, 40_000.0,
        "a closed day's cost must not follow a later price edit"
    );
}

// ---------------------------------------------------------------------------
// Split payments
// ---------------------------------------------------------------------------

/// A split sale and a plain cash sale (no split rows) side by side: each method
/// carries its own money, a split sale counts once in the total, the shares
/// add up to 100%, and the dashboard card says the same as the report.
#[tokio::test]
async fn split_and_single_method_sales_are_totalled_per_method() {
    let conn = setup_test_db().await;
    let now = utc_at_local_noon(today());
    let split = insert_transaction(&conn, 1, 300_000.0, "completed", &now).await;
    exec(
        &conn,
        "UPDATE transactions SET payment_method = 'mixed' WHERE id = $1",
        vec![split.id.into()],
    )
    .await;
    insert_split(&conn, split.id, "cash", 180_000.0).await;
    insert_split(&conn, split.id, "qris", 120_000.0).await;
    insert_transaction(&conn, 1, 100_000.0, "completed", &now).await;

    let d = date_str(today());
    let report = payment_methods(&conn, d.clone(), d).await.expect("methods");
    assert_eq!(report.total_transactions, 2);
    assert!(report.rows.iter().all(|r| r.payment_method != "mixed"));
    let cash = report
        .rows
        .iter()
        .find(|r| r.payment_method == "cash")
        .unwrap();
    let qris = report
        .rows
        .iter()
        .find(|r| r.payment_method == "qris")
        .unwrap();
    assert_eq!((cash.transaction_count, cash.total_amount), (2, 280_000.0));
    assert_eq!((qris.transaction_count, qris.total_amount), (1, 120_000.0));
    assert_eq!(report.rows[0].payment_method, "cash", "largest first");
    let share: f64 = report.rows.iter().map(|r| r.percentage).sum();
    assert!((share - 100.0).abs() < 1e-9);
    assert!((cash.percentage - 70.0).abs() < 1e-9);

    let stats = dashboard::payment_method_stats(&conn).await.expect("stats");
    let mut card: Vec<(String, i64, f64)> = stats
        .into_iter()
        .map(|s| (s.method, s.count, s.total))
        .collect();
    card.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        card,
        vec![
            ("cash".to_string(), 2, 280_000.0),
            ("qris".to_string(), 1, 120_000.0)
        ]
    );
}

/// A refund paid back on a method the sale never used still comes off that
/// method, and gives it a row with no sales.
#[tokio::test]
async fn a_refund_on_another_method_gets_its_own_row_with_no_sales() {
    let conn = setup_test_db().await;
    let now = utc_at_local_noon(today());
    let (txn_id, lines) = three_item_sale(&conn, &now).await;
    return_lines(&conn, txn_id, &now, "transfer", &lines[..1], 100_000.0).await;

    let d = date_str(today());
    let report = payment_methods(&conn, d.clone(), d).await.expect("methods");
    let transfer = report
        .rows
        .iter()
        .find(|r| r.payment_method == "transfer")
        .expect("transfer row");
    assert_eq!(transfer.transaction_count, 0);
    assert_eq!(transfer.total_amount, -100_000.0);
    let total: f64 = report.rows.iter().map(|r| r.total_amount).sum();
    assert_eq!(total, 200_000.0);
}

// ---------------------------------------------------------------------------
// Top products
// ---------------------------------------------------------------------------

/// The popular list's limit is clamped to `1..=500` rather than failing or
/// returning everything.
#[tokio::test]
async fn popular_products_clamp_the_limit() {
    let conn = setup_test_db().await;
    three_item_sale(&conn, &utc_at_local_noon(today())).await;
    let d = date_str(today());

    for (limit, expected) in [(0, 1), (-5, 1), (2, 2), (100_000, 3)] {
        let rows = popular_products(&conn, d.clone(), d.clone(), limit)
            .await
            .expect("popular");
        assert_eq!(rows.len(), expected, "limit {limit}");
    }
}

/// The dashboard's top products cover today and the thirty days before it:
/// a sale 30 days ago counts, one 31 days ago does not.
#[tokio::test]
async fn dashboard_top_products_cover_the_last_thirty_days() {
    let conn = setup_test_db().await;
    let old = insert_product(&conn, "Lama", 1_000.0, 2_000.0, 10).await;
    let edge = insert_product(&conn, "Tepi", 1_000.0, 2_000.0, 10).await;
    for (product, days_ago) in [(&old, 31), (&edge, 30)] {
        let at = utc_at_local_noon(today() - Duration::days(days_ago));
        let txn = insert_transaction(&conn, 1, 2_000.0, "completed", &at).await;
        insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            &product.name,
            2_000.0,
            1_000.0,
            1,
        )
        .await;
    }

    let top = dashboard::top_products(&conn, None).await.expect("top");
    let ids: Vec<i64> = top.iter().map(|t| t.product_id).collect();
    assert_eq!(ids, vec![edge.id]);
}

// ---------------------------------------------------------------------------
// Low stock
// ---------------------------------------------------------------------------

/// The dashboard card, the dashboard list, the stock report and the product
/// screen's quick filter all count the same products as low.
#[tokio::test]
async fn every_low_stock_figure_counts_the_same_products() {
    let conn = setup_test_db().await;
    // Low: out of stock with no threshold, at the threshold, negative.
    let empty = insert_product(&conn, "Kosong", 1_000.0, 2_000.0, 0).await;
    exec(
        &conn,
        "UPDATE products SET min_stock = NULL WHERE id = $1",
        vec![empty.id.into()],
    )
    .await;
    let at_min = insert_product(&conn, "Pas", 1_000.0, 2_000.0, 5).await;
    let negative = insert_product(&conn, "Minus", 1_000.0, 2_000.0, -2).await;
    // Not low: one above its threshold.
    let above = insert_product(&conn, "Aman", 1_000.0, 2_000.0, 6).await;
    // Low but deleted: counted nowhere.
    let gone = insert_product(&conn, "Dihapus", 1_000.0, 2_000.0, 0).await;
    exec(
        &conn,
        "UPDATE products SET min_stock = 5 WHERE id IN ($1, $2)",
        vec![at_min.id.into(), above.id.into()],
    )
    .await;
    exec(
        &conn,
        "UPDATE products SET is_active = 0 WHERE id = $1",
        vec![gone.id.into()],
    )
    .await;

    let summary = dashboard::summary(&conn).await.expect("summary");
    assert_eq!(summary.low_stock_count, 3);
    assert_eq!(summary.total_products, 4);

    let list = dashboard::low_stock_products(&conn).await.expect("list");
    let ids: Vec<i64> = list.iter().map(|p| p.id).collect();
    assert_eq!(
        ids,
        vec![negative.id, empty.id, at_min.id],
        "largest deficit first"
    );

    let report = current_stock(&conn, String::new(), "low".to_string())
        .await
        .expect("stock");
    assert_eq!(report.total_count, 3);
    assert_eq!(report.low_stock_count, 3);

    let filtered = crate::services::products::search(
        &conn,
        ProductSearchParams {
            query: None,
            category_id: None,
            quick_filter: Some("low_stock".to_string()),
            page: None,
            per_page: None,
            sort_by: None,
            sort_order: None,
        },
    )
    .await
    .expect("search");
    assert_eq!(filtered.total, 3);
}

// ---------------------------------------------------------------------------
// Losses
// ---------------------------------------------------------------------------

/// The per-reason breakdown adds up to the headline figures and is ordered by
/// value, largest first.
#[tokio::test]
async fn the_loss_breakdown_adds_up_to_the_totals() {
    let conn = setup_test_db().await;
    let now = utc_at_local_noon(today());
    let telur = insert_product(&conn, "Telur", 1_500.0, 2_000.0, 100).await;
    for (qty, reason, value) in [
        (2, "damaged", 3_000.0),
        (4, "expired", 6_000.0),
        (1, "damaged", 1_500.0),
        (10, "lost", 15_000.0),
    ] {
        insert_writeoff(
            &conn,
            WriteoffSpec {
                product_id: telur.id,
                user_id: 1,
                quantity: qty,
                reason,
                loss_value: value,
                status: "approved",
                created_at: &now,
            },
        )
        .await;
    }

    let d = date_str(today());
    let summary = losses(&conn, d.clone(), d).await.expect("losses");
    assert_eq!(summary.total_writeoffs, 4);
    assert_eq!(summary.total_quantity, 17);
    assert_eq!(summary.total_loss_value, 25_500.0);
    let reasons: Vec<(&str, i64, f64)> = summary
        .by_reason
        .iter()
        .map(|r| (r.reason.as_str(), r.count, r.total_value))
        .collect();
    assert_eq!(
        reasons,
        vec![
            ("lost", 1, 15_000.0),
            ("expired", 1, 6_000.0),
            ("damaged", 2, 4_500.0)
        ]
    );
}

// ---------------------------------------------------------------------------
// Current stock past the row cap
// ---------------------------------------------------------------------------

/// 520 products: the list stops at 500 rows, but the count, the value and the
/// low-stock figure cover all 520, and deleted products count nowhere.
#[tokio::test]
async fn current_stock_totals_cover_a_catalogue_past_five_hundred() {
    let conn = setup_test_db().await;
    let mut expected_value = 0.0;
    let mut expected_low = 0;
    for i in 0..520 {
        let stock = if i % 10 == 0 { 0 } else { 3 };
        let buy = 1_000.0 + i as f64;
        insert_product(&conn, &format!("Produk {i:03}"), buy, buy + 500.0, stock).await;
        expected_value += buy * stock as f64;
        if stock == 0 {
            expected_low += 1;
        }
    }
    let deleted = insert_product(&conn, "Zzz dihapus", 9_999.0, 10_000.0, 0).await;
    exec(
        &conn,
        "UPDATE products SET is_active = 0 WHERE id = $1",
        vec![deleted.id.into()],
    )
    .await;

    let report = current_stock(&conn, String::new(), String::new())
        .await
        .expect("stock");
    assert_eq!(report.items.len(), REPORT_ROW_LIMIT as usize);
    assert_eq!(report.total_count, 520);
    assert_eq!(report.total_stock_value, expected_value);
    assert_eq!(report.low_stock_count, expected_low);
    assert_eq!(report.items[0].product_name, "Produk 000", "sorted by name");

    let low = current_stock(&conn, String::new(), "low".to_string())
        .await
        .expect("stock");
    assert_eq!(low.total_count, expected_low);
    assert_eq!(low.items.len(), expected_low as usize);
}

/// The product screen trims its search box; the stock report should too, so a
/// stray space typed before the name does not empty the list.
#[tokio::test]
async fn current_stock_search_ignores_surrounding_spaces() {
    let conn = setup_test_db().await;
    insert_product(&conn, "Beras 5kg", 50_000.0, 65_000.0, 3).await;

    for search in [" beras", "beras ", " "] {
        let report = current_stock(&conn, search.to_string(), String::new())
            .await
            .expect("stock");
        assert_eq!(report.total_count, 1, "{search:?}");
    }
}

// ---------------------------------------------------------------------------
// Dashboard windows
// ---------------------------------------------------------------------------

/// The revenue chart has one row per day, oldest first and ending today, with
/// `days` clamped to `1..=365`.
#[tokio::test]
async fn the_revenue_chart_window_is_clamped_and_ends_today() {
    let conn = setup_test_db().await;

    for (days, expected) in [(None, 7), (Some(0), 1), (Some(-3), 1), (Some(1_000), 365)] {
        let rows = dashboard::daily_revenue(&conn, days).await.expect("chart");
        assert_eq!(rows.len(), expected, "{days:?}");
        assert_eq!(rows.last().unwrap().date, date_str(today()));
        assert_eq!(
            rows.first().unwrap().date,
            date_str(today() - Duration::days(expected as i64 - 1))
        );
    }
}

/// The chart and the daily sales report give the same figure for every day of
/// the week, returns included.
#[tokio::test]
async fn the_revenue_chart_agrees_with_the_daily_sales_report() {
    let conn = setup_test_db().await;
    let sale_day = today() - Duration::days(3);
    let (txn_id, lines) = three_item_sale(&conn, &utc_at_local_noon(sale_day)).await;
    return_lines(
        &conn,
        txn_id,
        &utc_at_local_noon(today()),
        "cash",
        &lines[..2],
        100_000.0,
    )
    .await;

    let chart = dashboard::daily_revenue(&conn, Some(7))
        .await
        .expect("chart");
    let report = daily_sales(
        &conn,
        date_str(today() - Duration::days(6)),
        date_str(today()),
    )
    .await
    .expect("daily");
    for day in &chart {
        let reported = report
            .iter()
            .find(|r| r.date == day.date)
            .map(|r| (r.total_revenue, r.transaction_count))
            .unwrap_or((0.0, 0));
        assert_eq!((day.revenue, day.transactions), reported, "{}", day.date);
    }
    assert_eq!(chart.last().unwrap().revenue, -200_000.0);
}
