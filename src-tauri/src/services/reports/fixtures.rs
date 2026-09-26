//! Fixtures shared by the report and dashboard tests: the owner's Rp 300.000
//! three-item sale and the returns booked against it.

use sea_orm::DatabaseConnection;

use crate::test_support::{
    insert_product, insert_refund, insert_refund_item, insert_transaction, insert_transaction_item,
    RefundSpec,
};

/// The scenario the owner described: one Rp 300.000 sale of three Rp 100.000
/// items (cost Rp 60.000 each), some of them handed back later. Returns
/// `(transaction, [(line id, product id)])`.
pub async fn three_item_sale(
    conn: &DatabaseConnection,
    created_at: &str,
) -> (i64, Vec<(i64, i64)>) {
    let beras = insert_product(conn, "Beras 5kg", 60_000.0, 100_000.0, 100).await;
    let gula = insert_product(conn, "Gula 1kg", 60_000.0, 100_000.0, 100).await;
    let minyak = insert_product(conn, "Minyak 1L", 60_000.0, 100_000.0, 100).await;

    let txn = insert_transaction(conn, 1, 300_000.0, "completed", created_at).await;
    let mut lines = Vec::new();
    for product in [&beras, &gula, &minyak] {
        let item = insert_transaction_item(
            conn,
            txn.id,
            Some(product.id),
            &product.name,
            100_000.0,
            60_000.0,
            1,
        )
        .await;
        lines.push((item.id, product.id));
    }
    (txn.id, lines)
}

/// Books a plain (non-exchange) return of `lines`, each one unit at
/// `unit_price`.
pub async fn return_lines(
    conn: &DatabaseConnection,
    txn_id: i64,
    created_at: &str,
    payment_method: &str,
    lines: &[(i64, i64)],
    unit_price: f64,
) {
    let refund = insert_refund(
        conn,
        RefundSpec {
            transaction_id: txn_id,
            user_id: 1,
            refund_type: "refund",
            total_refund_amount: unit_price * lines.len() as f64,
            total_exchange_amount: 0.0,
            difference_amount: unit_price * lines.len() as f64,
            payment_method,
            shift_id: None,
            created_at,
        },
    )
    .await;
    for (item_id, product_id) in lines {
        insert_refund_item(conn, refund.id, *item_id, *product_id, 1, unit_price).await;
    }
}
