//! Fixtures shared by the refund service tests.

use sea_orm::{DatabaseConnection, EntityTrait};

use crate::domain::refunds::{CreateRefundInput, RefundItemInput};
use crate::domain::Actor;
use crate::entity::{products, transaction_items, transactions};
use crate::test_support::{
    insert_product, insert_store_info, insert_transaction, insert_transaction_item,
};
use crate::utils::time::{format_ts, now_ts};

/// The seeded admin (id 1). Refunds do not gate on role, so what matters
/// here is only that the id is the actor's and not something the payload
/// carried.
pub fn actor() -> Actor {
    Actor::new(1, "admin")
}

/// In-memory database with the singleton store row seeded, so the exchange
/// path can read `allow_negative_stock` instead of falling back to its
/// permissive default.
pub async fn setup() -> DatabaseConnection {
    let conn = crate::test_support::setup_test_db().await;
    insert_store_info(&conn, false).await;
    conn
}

/// A completed sale made just now, with no lines yet.
pub async fn sale(conn: &DatabaseConnection, total: f64) -> transactions::Model {
    insert_transaction(conn, 1, total, "completed", &now_ts()).await
}

/// A new product with `stock` on the shelf and a sale made just now of
/// `quantity` of it at full price. Returns the product, the sale and its line.
pub async fn sold_line(
    conn: &DatabaseConnection,
    name: &str,
    buy_price: f64,
    sell_price: f64,
    stock: i64,
    quantity: i64,
) -> (
    products::Model,
    transactions::Model,
    transaction_items::Model,
) {
    let product = insert_product(conn, name, buy_price, sell_price, stock).await;
    let txn = sale(conn, sell_price * quantity as f64).await;
    let item = insert_transaction_item(
        conn,
        txn.id,
        Some(product.id),
        name,
        sell_price,
        buy_price,
        quantity,
    )
    .await;
    (product, txn, item)
}

pub async fn stock_of(conn: &DatabaseConnection, product_id: i64) -> i64 {
    products::Entity::find_by_id(product_id)
        .one(conn)
        .await
        .expect("product query")
        .expect("product exists")
        .stock
}

/// Builds the input the way the HTTP layer does, from the JSON the client
/// sends. Lets a test express a payload that the Rust struct no longer has
/// a field for.
pub fn refund_input(value: serde_json::Value) -> CreateRefundInput {
    serde_json::from_value(value).expect("refund input deserializes")
}

/// Builds a one-line sale aged `age` and returns the line to refund.
pub async fn aged_sale(
    conn: &DatabaseConnection,
    age: chrono::Duration,
) -> (transactions::Model, transaction_items::Model) {
    let product = insert_product(conn, "Roti Tawar", 9_000.0, 14_000.0, 20).await;
    let created_at = format_ts(chrono::Utc::now() - age);
    let txn = insert_transaction(conn, 1, 14_000.0, "completed", &created_at).await;
    let item = insert_transaction_item(
        conn,
        txn.id,
        Some(product.id),
        "Roti Tawar",
        14_000.0,
        9_000.0,
        1,
    )
    .await;
    (txn, item)
}

/// One returned line.
pub fn line(transaction_item_id: i64, quantity: i64, condition: &str) -> RefundItemInput {
    RefundItemInput {
        transaction_item_id,
        quantity,
        condition: condition.to_string(),
    }
}

/// A plain return (no exchange) of `items` from sale `txn_id`.
pub fn refund_of(txn_id: i64, items: Vec<RefundItemInput>) -> CreateRefundInput {
    CreateRefundInput {
        transaction_id: txn_id,
        reason: None,
        items,
        exchange_items: None,
    }
}

/// One unit of one line, returned in good condition.
pub fn refund_one(txn_id: i64, item_id: i64) -> CreateRefundInput {
    refund_of(txn_id, vec![line(item_id, 1, "good")])
}
