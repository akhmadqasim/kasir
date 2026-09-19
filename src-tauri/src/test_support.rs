//! Shared fixtures for backend integration tests.
//!
//! The reports and dashboard commands are pure SQL over a seeded database, so
//! their tests build the real schema through `db::setup_database` and insert
//! entities directly. An in-memory SQLite database is used instead of the
//! per-test temp files the older fixtures in `commands/transactions.rs` and
//! `commands/refunds.rs` create, so nothing is left behind on disk. The pool is
//! pinned to a single connection (`min_connections(1)`/`max_connections(1)`),
//! which is what keeps an in-memory database alive across queries.

use chrono::{Duration, Local, NaiveDate};
use sea_orm::{ActiveModelTrait, DatabaseConnection, NotSet, Set};

use crate::db;
use crate::entity::{
    exchange_items, products, refund_items, refunds, stock_writeoffs, store_info,
    transaction_items, transactions, users,
};

/// Current UTC timestamp in the `"YYYY-MM-DD HH:MM:SS"` shape used by every
/// `created_at` column.
pub fn now_ts() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Today's date in the machine's local timezone.
pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// `YYYY-MM-DD` rendering of a local calendar date, as the report commands
/// expect their `start_date`/`end_date` arguments.
pub fn date_str(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// UTC timestamp for 12:00 local time on `date`.
///
/// The reports group by `date(created_at,'localtime')` and filter on UTC
/// boundaries derived from local dates, so seeding at local noon pins a row to
/// a known local calendar day whatever the machine's timezone offset is.
pub fn utc_at_local_noon(date: NaiveDate) -> String {
    let offset_secs = Local::now().offset().local_minus_utc() as i64;
    (date.and_hms_opt(12, 0, 0).unwrap() - Duration::seconds(offset_secs))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// Fresh in-memory database with migrations applied and one admin user (id 1).
pub async fn setup_test_db() -> DatabaseConnection {
    let conn = db::setup_database(":memory:").await.expect("db setup");
    insert_user(&conn, "admin", "Admin Test", "admin").await;
    conn
}

/// Seeds the singleton `store_info` row so `parse_app_settings` reads real
/// settings instead of falling back to its defaults. Only the sales flags
/// matter to the transaction and refund paths; the PPOB block is left empty
/// because tests drive fulfilment through an injected executor.
pub async fn insert_store_info(
    conn: &DatabaseConnection,
    allow_negative_stock: bool,
) -> store_info::Model {
    store_info::ActiveModel {
        id: Set(1),
        name: Set("Toko Test".to_string()),
        address: Set(None),
        phone: Set(None),
        email: Set(None),
        logo_path: Set(None),
        additional_info: Set(Some(
            serde_json::json!({
                "sales": {
                    "allow_negative_stock": allow_negative_stock,
                    "default_payment_method": "cash"
                }
            })
            .to_string(),
        )),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(conn)
    .await
    .expect("store info insert")
}

pub async fn insert_user(
    conn: &DatabaseConnection,
    username: &str,
    full_name: &str,
    role: &str,
) -> users::Model {
    users::ActiveModel {
        id: NotSet,
        username: Set(username.to_string()),
        pin_hash: Set("hash".to_string()),
        full_name: Set(full_name.to_string()),
        role: Set(role.to_string()),
        is_active: Set(true),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(conn)
    .await
    .expect("user insert")
}

pub async fn insert_product(
    conn: &DatabaseConnection,
    name: &str,
    buy_price: f64,
    sell_price: f64,
    stock: i64,
) -> products::Model {
    products::ActiveModel {
        id: NotSet,
        barcode: Set(None),
        sku: Set(None),
        name: Set(name.to_string()),
        category_id: Set(None),
        buy_price: Set(buy_price),
        sell_price: Set(sell_price),
        margin: Set(0.0),
        stock: Set(stock),
        unit: Set("pcs".to_string()),
        min_stock: Set(Some(0)),
        is_active: Set(true),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(conn)
    .await
    .expect("product insert")
}

/// A sale rung up on the cashier's cart — the channel almost every test means.
pub async fn insert_transaction(
    conn: &DatabaseConnection,
    user_id: i64,
    total_amount: f64,
    status: &str,
    created_at: &str,
) -> transactions::Model {
    insert_transaction_in_channel(conn, user_id, total_amount, status, created_at, "sales").await
}

/// Same row, with the screen that rang it up spelled out: `sales` or `ppob`.
pub async fn insert_transaction_in_channel(
    conn: &DatabaseConnection,
    user_id: i64,
    total_amount: f64,
    status: &str,
    created_at: &str,
    channel: &str,
) -> transactions::Model {
    transactions::ActiveModel {
        id: NotSet,
        receipt_number: Set(format!("TRX-TEST-{}", uuid::Uuid::new_v4())),
        user_id: Set(user_id),
        total_amount: Set(total_amount),
        subtotal_amount: Set(total_amount),
        discount_amount: Set(0.0),
        payment_method: Set("cash".to_string()),
        payment_amount: Set(total_amount),
        change_amount: Set(Some(0.0)),
        status: Set(status.to_string()),
        channel: Set(channel.to_string()),
        notes: Set(None),
        shift_id: Set(None),
        deleted_at: Set(None),
        deleted_by: Set(None),
        deleted_reason: Set(None),
        updated_at: Set(None),
        created_at: Set(Some(created_at.to_string())),
    }
    .insert(conn)
    .await
    .expect("transaction insert")
}

/// Everything a `transaction_items` row needs that the shorthand
/// [`insert_transaction_item`] pins to a default. `product_id` is `None` for
/// PPOB rows, which is exactly the case the product reports used to collapse
/// into a single fake product.
pub struct TransactionItemSpec<'a> {
    pub transaction_id: i64,
    pub product_id: Option<i64>,
    pub product_name: &'a str,
    pub product_price: f64,
    pub buy_price: f64,
    pub quantity: i64,
    pub item_discount: f64,
    /// Rupiah paid for the line. `None` means "no transaction-level discount",
    /// i.e. `subtotal - item_discount`.
    pub net_subtotal: Option<f64>,
}

pub async fn insert_transaction_item_spec(
    conn: &DatabaseConnection,
    spec: TransactionItemSpec<'_>,
) -> transaction_items::Model {
    let subtotal = spec.product_price * spec.quantity as f64;
    let net_subtotal = spec.net_subtotal.unwrap_or(subtotal - spec.item_discount);
    transaction_items::ActiveModel {
        id: NotSet,
        transaction_id: Set(spec.transaction_id),
        product_id: Set(spec.product_id),
        product_name: Set(spec.product_name.to_string()),
        product_price: Set(spec.product_price),
        buy_price: Set(Some(spec.buy_price)),
        quantity: Set(spec.quantity),
        subtotal: Set(subtotal),
        item_discount: Set(spec.item_discount),
        net_subtotal: Set(net_subtotal),
        service_type: Set(None),
        service_ref: Set(None),
        ppob_product_id: Set(None),
        ppob_product_code: Set(None),
        ppob_inquiry_id: Set(None),
        ppob_payment_code: Set(None),
        ppob_flag_id: Set(None),
        ppob_status: Set(None),
        ppob_message: Set(None),
        ppob_serial_number: Set(None),
        created_at: Set(Some(now_ts())),
    }
    .insert(conn)
    .await
    .expect("transaction item insert")
}

/// A line item without discounts.
pub async fn insert_transaction_item(
    conn: &DatabaseConnection,
    transaction_id: i64,
    product_id: Option<i64>,
    product_name: &str,
    product_price: f64,
    buy_price: f64,
    quantity: i64,
) -> transaction_items::Model {
    insert_transaction_item_spec(
        conn,
        TransactionItemSpec {
            transaction_id,
            product_id,
            product_name,
            product_price,
            buy_price,
            quantity,
            item_discount: 0.0,
            net_subtotal: None,
        },
    )
    .await
}

/// A refund header. `total_exchange_amount`/`difference_amount` matter only for
/// exchanges; [`insert_refund`] derives nothing, so a test states exactly what
/// the row holds.
pub struct RefundSpec<'a> {
    pub transaction_id: i64,
    pub user_id: i64,
    /// `"refund"` or `"exchange"`.
    pub refund_type: &'a str,
    pub total_refund_amount: f64,
    pub total_exchange_amount: f64,
    /// `total_refund_amount - total_exchange_amount`: positive means the shop
    /// paid the customer.
    pub difference_amount: f64,
    pub payment_method: &'a str,
    pub shift_id: Option<i64>,
    pub created_at: &'a str,
}

pub async fn insert_refund(conn: &DatabaseConnection, spec: RefundSpec<'_>) -> refunds::Model {
    refunds::ActiveModel {
        id: NotSet,
        refund_number: Set(format!("RFD-TEST-{}", uuid::Uuid::new_v4())),
        transaction_id: Set(spec.transaction_id),
        user_id: Set(spec.user_id),
        refund_type: Set(spec.refund_type.to_string()),
        total_refund_amount: Set(spec.total_refund_amount),
        total_exchange_amount: Set(Some(spec.total_exchange_amount)),
        difference_amount: Set(Some(spec.difference_amount)),
        payment_method: Set(Some(spec.payment_method.to_string())),
        reason: Set(None),
        shift_id: Set(spec.shift_id),
        created_at: Set(Some(spec.created_at.to_string())),
    }
    .insert(conn)
    .await
    .expect("refund insert")
}

/// One returned line. `subtotal` is the money handed back, which is what the
/// service writes (`net_subtotal` per unit times the quantity).
pub async fn insert_refund_item(
    conn: &DatabaseConnection,
    refund_id: i64,
    transaction_item_id: i64,
    product_id: i64,
    quantity: i64,
    subtotal: f64,
) -> refund_items::Model {
    refund_items::ActiveModel {
        id: NotSet,
        refund_id: Set(refund_id),
        transaction_item_id: Set(transaction_item_id),
        product_id: Set(product_id),
        quantity: Set(quantity),
        subtotal: Set(subtotal),
        condition: Set(Some("good".to_string())),
        created_at: Set(Some(now_ts())),
    }
    .insert(conn)
    .await
    .expect("refund item insert")
}

/// One replacement handed over on an exchange.
pub async fn insert_exchange_item(
    conn: &DatabaseConnection,
    refund_id: i64,
    product_id: i64,
    product_name: &str,
    product_price: f64,
    quantity: i64,
) -> exchange_items::Model {
    exchange_items::ActiveModel {
        id: NotSet,
        refund_id: Set(refund_id),
        product_id: Set(product_id),
        product_name: Set(product_name.to_string()),
        product_price: Set(product_price),
        quantity: Set(quantity),
        subtotal: Set(product_price * quantity as f64),
        created_at: Set(Some(now_ts())),
    }
    .insert(conn)
    .await
    .expect("exchange item insert")
}

pub struct WriteoffSpec<'a> {
    pub product_id: i64,
    pub user_id: i64,
    pub quantity: i64,
    pub reason: &'a str,
    pub loss_value: f64,
    pub status: &'a str,
    pub created_at: &'a str,
}

pub async fn insert_writeoff(
    conn: &DatabaseConnection,
    spec: WriteoffSpec<'_>,
) -> stock_writeoffs::Model {
    stock_writeoffs::ActiveModel {
        id: NotSet,
        writeoff_number: Set(format!("WO-TEST-{}", uuid::Uuid::new_v4())),
        product_id: Set(spec.product_id),
        user_id: Set(spec.user_id),
        quantity: Set(spec.quantity),
        reason: Set(spec.reason.to_string()),
        loss_value: Set(spec.loss_value),
        notes: Set(None),
        approved_by: Set(None),
        status: Set(spec.status.to_string()),
        refund_id: Set(None),
        created_at: Set(Some(spec.created_at.to_string())),
    }
    .insert(conn)
    .await
    .expect("writeoff insert")
}
