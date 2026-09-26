//! Fixtures shared by the transaction service tests.
//!
//! The store row here carries a full settings blob — negative stock refused,
//! PPOB enabled with zero markup — so the checkout path reads real settings
//! rather than falling back to its permissive defaults.

use sea_orm::{ActiveModelTrait, ActiveValue::NotSet, DatabaseConnection, EntityTrait, Set};

use crate::db;
use crate::domain::ppob::PaymentResult;
use crate::domain::transactions::{CheckoutTransactionInput, TransactionItemInput};
use crate::domain::Actor;
use crate::entity::{products, store_info, transaction_items, users};
use crate::services::ppob::executor::PpobFulfillmentRequest;
use crate::services::transactions::checkout::checkout_with_executor;
use crate::utils::time::now_ts;
use crate::utils::AppError;

/// In-memory database, so a test run leaves no temp files behind. The pool
/// is pinned to a single connection, which is what keeps an in-memory
/// database alive across queries.
pub async fn setup_test_db() -> DatabaseConnection {
    let conn = db::setup_database(":memory:").await.expect("db setup");

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
                    "allow_negative_stock": false,
                    "default_payment_method": "cash"
                },
                "ppob": {
                    "enabled": true,
                    "phone_number": "08123456789",
                    "password": "TEST_ONLY_NOT_REAL",
                    "device_id": "device-test",
                    "pin": "000000",
                    "markup": {
                        "pulsa": { "type": "fixed", "value": 0 },
                        "data": { "type": "fixed", "value": 0 },
                        "pln": { "type": "fixed", "value": 0 },
                        "pdam": { "type": "fixed", "value": 0 },
                        "bpjs": { "type": "fixed", "value": 0 },
                        "emoney": { "type": "fixed", "value": 0 },
                        "custom_prices": {}
                    }
                },
                "backup": {
                    "interval_hours": 3,
                    "retention_days": 90
                }
            })
            .to_string(),
        )),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(&conn)
    .await
    .expect("store insert");

    users::ActiveModel {
        id: NotSet,
        username: Set("admin".to_string()),
        pin_hash: Set("hash".to_string()),
        full_name: Set("Admin Test".to_string()),
        role: Set("admin".to_string()),
        is_active: Set(true),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(&conn)
    .await
    .expect("user insert");

    conn
}

pub async fn insert_product(
    conn: &DatabaseConnection,
    name: &str,
    sell_price: f64,
    stock: i64,
) -> products::Model {
    products::ActiveModel {
        id: NotSet,
        barcode: Set(None),
        sku: Set(None),
        name: Set(name.to_string()),
        category_id: Set(None),
        buy_price: Set(sell_price - 2_000.0),
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

/// The seeded admin (id 1).
pub fn admin() -> Actor {
    Actor::new(1, "admin")
}

/// A cart line for `quantity` of a shelf product, priced by the server.
pub fn product_line(product_id: i64, quantity: i64) -> TransactionItemInput {
    TransactionItemInput {
        product_id: Some(product_id),
        quantity,
        product_name: None,
        product_price: None,
        buy_price: None,
        service_type: None,
        service_ref: None,
        ppob_product_id: None,
        ppob_product_code: None,
        ppob_inquiry_id: None,
        ppob_payment_code: None,
        ppob_flag_id: None,
        item_discount: None,
    }
}

/// A Telkomsel 10K top-up sold at 12.000: a direct PPOB line, no inquiry.
pub fn pulsa_line() -> TransactionItemInput {
    TransactionItemInput {
        product_id: None,
        quantity: 1,
        product_name: Some("Pulsa Telkomsel 10K".to_string()),
        product_price: Some(12_000.0),
        buy_price: Some(10_000.0),
        service_type: Some("pulsa".to_string()),
        service_ref: Some("08123456789".to_string()),
        ppob_product_id: Some(101),
        ppob_product_code: Some("TS10".to_string()),
        ppob_inquiry_id: None,
        ppob_payment_code: None,
        ppob_flag_id: None,
        item_discount: None,
    }
}

/// A cashier-cart checkout of `items`, paid `payment_amount` in cash, with no
/// discount and no PPOB PIN.
pub fn cash_checkout(
    items: Vec<TransactionItemInput>,
    payment_amount: f64,
) -> CheckoutTransactionInput {
    CheckoutTransactionInput {
        items,
        payment_method: "cash".to_string(),
        payment_amount,
        notes: None,
        transaction_discount: None,
        payment_breakdown: None,
        ppob_pin: None,
        channel: None,
    }
}

/// A PPOB executor for carts that must never reach the provider.
pub async fn no_provider(_request: PpobFulfillmentRequest) -> Result<PaymentResult, AppError> {
    Err(AppError::Internal("should not execute".into()))
}

/// A completed sale with one pulsa line, left in `ppob_status`.
pub async fn seed_ppob_sale(
    conn: &DatabaseConnection,
    ppob_status: &str,
) -> transaction_items::Model {
    let result = checkout_with_executor(
        conn,
        &admin(),
        CheckoutTransactionInput {
            ppob_pin: Some("123456".to_string()),
            ..cash_checkout(vec![pulsa_line()], 12_000.0)
        },
        |_request| async { Err(AppError::Internal("Provider timeout".into())) },
    )
    .await
    .expect("ppob checkout success");

    let item = result
        .items
        .into_iter()
        .find(|item| item.service_type.is_some())
        .expect("ppob line");

    let mut line: transaction_items::ActiveModel = item.into();
    line.ppob_status = Set(Some(ppob_status.to_string()));
    line.ppob_message = Set(None);
    line.ppob_serial_number = Set(None);
    line.update(conn).await.expect("set ppob status")
}

pub async fn ppob_status_of(conn: &DatabaseConnection, item_id: i64) -> Option<String> {
    transaction_items::Entity::find_by_id(item_id)
        .one(conn)
        .await
        .expect("query")
        .expect("item exists")
        .ppob_status
}
