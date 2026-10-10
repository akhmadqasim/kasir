//! Categories, products and reports over HTTP: who may write, how the query
//! string is bounded, and what a refused write leaves behind.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use axum::response::Response;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, Statement};
use serde_json::{json, Value};
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::entity::{categories, products};
use crate::test_support::{insert_product, setup_test_db};

/// Sends one request with the session cookie, and a JSON body when given.
async fn send(
    db: &DatabaseConnection,
    token: &str,
    method: Method,
    uri: &str,
    body: Option<Value>,
) -> Response {
    let builder = same_origin(method, uri).header(header::COOKIE, cookie(token));
    let request = match body {
        Some(value) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(value)),
        None => builder.body(Body::empty()),
    }
    .expect("request");
    router(&state(db.clone()))
        .oneshot(request)
        .await
        .expect("response")
}

/// The seeded admin (id 1) and a cashier, each with a live session.
async fn sessions(db: &DatabaseConnection) -> (String, String) {
    let admin = login_token(db, 1).await;
    let kasir = insert_user_with_pin(db, "kasir1", "1234", "kasir").await;
    (admin, login_token(db, kasir.id).await)
}

fn product_body(name: &str, barcode: Option<&str>, category_id: Option<i64>) -> Value {
    json!({
        "name": name,
        "barcode": barcode,
        "sku": null,
        "category_id": category_id,
        "buy_price": 10_000.0,
        "sell_price": 12_000.0,
        "stock": 5,
        "unit": "pcs",
        "min_stock": 1,
    })
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/// A cashier reads the category list but every write is a 403 that leaves the
/// table as it was.
#[tokio::test]
async fn a_cashier_reads_categories_but_cannot_change_them() {
    let db = setup_test_db().await;
    let (admin, kasir) = sessions(&db).await;
    let created = send(
        &db,
        &admin,
        Method::POST,
        "/api/categories",
        Some(json!({ "name": "Sembako", "description": null })),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let id = body_json(created).await["id"].as_i64().expect("id");

    let listed = send(&db, &kasir, Method::GET, "/api/categories", None).await;
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(body_json(listed).await[0]["name"], json!("Sembako"));

    for (method, uri, body) in [
        (
            Method::POST,
            "/api/categories".to_string(),
            Some(json!({ "name": "Baru" })),
        ),
        (
            Method::PUT,
            format!("/api/categories/{id}"),
            Some(json!({ "name": "Ganti" })),
        ),
        (Method::DELETE, format!("/api/categories/{id}"), None),
    ] {
        let response = send(&db, &kasir, method.clone(), &uri, body).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{method} {uri}");
    }

    let rows = categories::Entity::find().all(&db).await.expect("query");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "Sembako");
}

/// A category a live product sits in cannot be deleted (422, nothing
/// detached); once that product is deleted, the category goes and the deleted
/// product is left with no category.
#[tokio::test]
async fn deleting_a_category_waits_for_its_live_products() {
    let db = setup_test_db().await;
    let (admin, _) = sessions(&db).await;
    let created = send(
        &db,
        &admin,
        Method::POST,
        "/api/categories",
        Some(json!({ "name": "Minuman" })),
    )
    .await;
    let category = body_json(created).await["id"].as_i64().expect("id");
    let made = send(
        &db,
        &admin,
        Method::POST,
        "/api/products",
        Some(product_body("Teh Botol", None, Some(category))),
    )
    .await;
    assert_eq!(made.status(), StatusCode::CREATED);
    let product = body_json(made).await["id"].as_i64().expect("id");

    let refused = send(
        &db,
        &admin,
        Method::DELETE,
        &format!("/api/categories/{category}"),
        None,
    )
    .await;
    assert_eq!(refused.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let row = products::Entity::find_by_id(product)
        .one(&db)
        .await
        .expect("query")
        .expect("row");
    assert_eq!(row.category_id, Some(category));

    let removed = send(
        &db,
        &admin,
        Method::DELETE,
        &format!("/api/products/{product}"),
        None,
    )
    .await;
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
    let deleted = send(
        &db,
        &admin,
        Method::DELETE,
        &format!("/api/categories/{category}"),
        None,
    )
    .await;
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let row = products::Entity::find_by_id(product)
        .one(&db)
        .await
        .expect("query")
        .expect("row");
    assert_eq!(row.category_id, None);

    let again = send(
        &db,
        &admin,
        Method::DELETE,
        &format!("/api/categories/{category}"),
        None,
    )
    .await;
    assert_eq!(again.status(), StatusCode::NOT_FOUND);
}

/// A product cannot be filed under a category that does not exist; the answer
/// is a 422, not a foreign-key 500.
#[tokio::test]
async fn a_product_in_a_missing_category_is_a_422() {
    let db = setup_test_db().await;
    let (admin, _) = sessions(&db).await;

    let response = send(
        &db,
        &admin,
        Method::POST,
        "/api/products",
        Some(product_body("Yatim", None, Some(9_999))),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/// A cashier may search and scan but not create, edit or delete a product.
#[tokio::test]
async fn a_cashier_cannot_write_products() {
    let db = setup_test_db().await;
    let (_, kasir) = sessions(&db).await;
    let beras = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;

    for (method, uri, body) in [
        (
            Method::POST,
            "/api/products".to_string(),
            Some(product_body("Baru", None, None)),
        ),
        (
            Method::PUT,
            format!("/api/products/{}", beras.id),
            Some(product_body("Ganti", None, None)),
        ),
        (Method::DELETE, format!("/api/products/{}", beras.id), None),
        (
            Method::POST,
            "/api/products/bulk".to_string(),
            Some(json!([])),
        ),
    ] {
        let response = send(&db, &kasir, method.clone(), &uri, body).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{method} {uri}");
    }

    let row = products::Entity::find_by_id(beras.id)
        .one(&db)
        .await
        .expect("query")
        .expect("row");
    assert_eq!((row.name.as_str(), row.is_active), ("Beras", true));
}

/// A barcode a live product holds is a 422 naming the holder, on create and
/// on edit.
#[tokio::test]
async fn a_duplicate_barcode_is_a_422_on_create_and_edit() {
    let db = setup_test_db().await;
    let (admin, _) = sessions(&db).await;
    let first = send(
        &db,
        &admin,
        Method::POST,
        "/api/products",
        Some(product_body("Pertama", Some("8990000000001"), None)),
    )
    .await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let second = send(
        &db,
        &admin,
        Method::POST,
        "/api/products",
        Some(product_body("Kedua", Some("8990000000002"), None)),
    )
    .await;
    let second_id = body_json(second).await["id"].as_i64().expect("id");

    let clash = send(
        &db,
        &admin,
        Method::POST,
        "/api/products",
        Some(product_body("Ketiga", Some(" 8990000000001 "), None)),
    )
    .await;
    assert_eq!(clash.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let message = body_json(clash).await["message"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(message.contains("Pertama"), "{message}");

    let steal = send(
        &db,
        &admin,
        Method::PUT,
        &format!("/api/products/{second_id}"),
        Some(product_body("Kedua", Some("8990000000001"), None)),
    )
    .await;
    assert_eq!(steal.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

/// The scan route answers `null` for an unknown or deleted code and the
/// product for a live one.
#[tokio::test]
async fn the_scan_route_answers_null_for_unknown_and_deleted_codes() {
    let db = setup_test_db().await;
    let (admin, kasir) = sessions(&db).await;
    let made = send(
        &db,
        &admin,
        Method::POST,
        "/api/products",
        Some(product_body("Susu", Some("8991234567890"), None)),
    )
    .await;
    let id = body_json(made).await["id"].as_i64().expect("id");

    let found = send(
        &db,
        &kasir,
        Method::GET,
        "/api/products/barcode/8991234567890",
        None,
    )
    .await;
    assert_eq!(found.status(), StatusCode::OK);
    assert_eq!(body_json(found).await["id"], json!(id));

    let unknown = send(
        &db,
        &kasir,
        Method::GET,
        "/api/products/barcode/0000000000000",
        None,
    )
    .await;
    assert_eq!(unknown.status(), StatusCode::OK);
    assert_eq!(body_json(unknown).await, Value::Null);

    send(
        &db,
        &admin,
        Method::DELETE,
        &format!("/api/products/{id}"),
        None,
    )
    .await;
    let deleted = send(
        &db,
        &kasir,
        Method::GET,
        "/api/products/barcode/8991234567890",
        None,
    )
    .await;
    assert_eq!(deleted.status(), StatusCode::OK);
    assert_eq!(body_json(deleted).await, Value::Null);
}

/// Paging values off the query string are bounded, and an encoded `%` is a
/// literal character.
#[tokio::test]
async fn the_product_list_bounds_its_paging_and_matches_percent_literally() {
    let db = setup_test_db().await;
    let (_, kasir) = sessions(&db).await;
    insert_product(&db, "Diskon 50% Sabun", 1_000.0, 2_000.0, 1).await;
    insert_product(&db, "Sabun 500g", 1_000.0, 2_000.0, 1).await;

    let page = send(
        &db,
        &kasir,
        Method::GET,
        "/api/products?page=-4&per_page=0",
        None,
    )
    .await;
    assert_eq!(page.status(), StatusCode::OK);
    let body = body_json(page).await;
    assert_eq!(
        (
            body["page"].clone(),
            body["per_page"].clone(),
            body["total_pages"].clone()
        ),
        (json!(1), json!(1), json!(2))
    );

    let page = send(
        &db,
        &kasir,
        Method::GET,
        "/api/products?per_page=100000",
        None,
    )
    .await;
    assert_eq!(body_json(page).await["per_page"], json!(100));

    let found = send(&db, &kasir, Method::GET, "/api/products?query=50%25", None).await;
    let body = body_json(found).await;
    assert_eq!(body["total"], json!(1));
    assert_eq!(body["data"][0]["name"], json!("Diskon 50% Sabun"));

    let bad = send(&db, &kasir, Method::GET, "/api/products?page=abc", None).await;
    assert!(bad.status().is_client_error(), "{}", bad.status());
}

/// Exactly 500 ids is allowed; the cap is on the count, not on the request.
#[tokio::test]
async fn the_lookup_takes_exactly_five_hundred_ids() {
    let db = setup_test_db().await;
    let (_, kasir) = sessions(&db).await;
    let beras = insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    let ids = std::iter::once(beras.id)
        .chain(10_000..10_499)
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let response = send(
        &db,
        &kasir,
        Method::GET,
        &format!("/api/products/lookup?ids={ids}"),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body.as_array().map(Vec::len), Some(1));

    let empty = send(&db, &kasir, Method::GET, "/api/products/lookup", None).await;
    assert_eq!(empty.status(), StatusCode::OK);
    assert_eq!(body_json(empty).await, json!([]));
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/// A missing or malformed date is a 422 on every dated report, and an
/// inverted range is just an empty report.
#[tokio::test]
async fn a_report_without_a_valid_window_is_refused() {
    let db = setup_test_db().await;
    let (_, kasir) = sessions(&db).await;

    for uri in [
        "/api/reports/sales/daily",
        "/api/reports/sales/period?start_date=2026-09-01",
        "/api/reports/products/sales?start_date=2026-02-30&end_date=2026-03-01",
        "/api/reports/losses?start_date=01-09-2026&end_date=2026-09-05",
    ] {
        let response = send(&db, &kasir, Method::GET, uri, None).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY, "{uri}");
    }

    let inverted = send(
        &db,
        &kasir,
        Method::GET,
        "/api/reports/sales/daily?start_date=2026-09-05&end_date=2026-09-01",
        None,
    )
    .await;
    assert_eq!(inverted.status(), StatusCode::OK);
    assert_eq!(body_json(inverted).await, json!([]));
}

/// The stock report reads `search` and `filter` off the query string and
/// answers in camelCase with window totals.
#[tokio::test]
async fn the_stock_report_filters_low_stock_over_http() {
    let db = setup_test_db().await;
    let (_, kasir) = sessions(&db).await;
    insert_product(&db, "Beras", 50_000.0, 65_000.0, 10).await;
    insert_product(&db, "Gula", 12_000.0, 15_000.0, 0).await;
    db.execute(Statement::from_string(
        DbBackend::Sqlite,
        "UPDATE products SET min_stock = 2",
    ))
    .await
    .expect("threshold");

    let response = send(
        &db,
        &kasir,
        Method::GET,
        "/api/reports/stock/current?filter=low",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["totalCount"], json!(1));
    assert_eq!(body["lowStockCount"], json!(1));
    assert_eq!(body["items"][0]["productName"], json!("Gula"));

    let all = send(&db, &kasir, Method::GET, "/api/reports/stock/current", None).await;
    let body = body_json(all).await;
    assert_eq!(body["totalCount"], json!(2));
    assert_eq!(body["totalStockValue"], json!(500_000.0));
}
