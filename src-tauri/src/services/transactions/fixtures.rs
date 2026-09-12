//! Fixtures shared by the transaction service tests.
//!
//! The store row here carries a full settings blob — negative stock refused,
//! PPOB enabled with zero markup — so the checkout path reads real settings
//! rather than falling back to its permissive defaults.

use sea_orm::{ActiveModelTrait, ActiveValue::NotSet, DatabaseConnection, Set};

use super::now_timestamp;
use crate::db;
use crate::entity::{products, store_info, users};

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
        created_at: Set(Some(now_timestamp())),
        updated_at: Set(Some(now_timestamp())),
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
        created_at: Set(Some(now_timestamp())),
        updated_at: Set(Some(now_timestamp())),
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
        created_at: Set(Some(now_timestamp())),
        updated_at: Set(Some(now_timestamp())),
    }
    .insert(conn)
    .await
    .expect("product insert")
}
