//! Product list sorting over the query string.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use sea_orm::DatabaseConnection;
use tower::ServiceExt;

use super::{body_json, cookie, insert_user_with_pin, login_token, router, same_origin, state};
use crate::test_support::setup_test_db;

/// The names in the order `GET /api/products?{query}` returns them.
async fn product_names(db: &DatabaseConnection, token: &str, query: &str) -> Vec<String> {
    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::GET, &format!("/api/products?{query}"))
                .header(header::COOKIE, cookie(token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK, "{query}");
    body_json(response).await["data"]
        .as_array()
        .expect("a page of products")
        .iter()
        .map(|p| p["name"].as_str().expect("name").to_string())
        .collect()
}

/// `sort_by` and `sort_order` ride on the query string in the names the Rust
/// struct declares. Both are optional, a column off the allowlist is ignored
/// rather than refused, and `desc` is the only spelling that reverses.
#[tokio::test]
async fn the_product_list_sorts_by_the_query_string() {
    let db = setup_test_db().await;
    crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    crate::test_support::insert_product(&db, "Air Mineral", 2_000.0, 3_000.0, 40).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    assert_eq!(
        product_names(&db, &token, "sort_by=stock&sort_order=desc").await,
        vec!["Air Mineral", "Beras 5kg"]
    );
    assert_eq!(
        product_names(&db, &token, "sort_by=sell_price&sort_order=asc").await,
        vec!["Air Mineral", "Beras 5kg"]
    );
    // No sort at all, an unknown column, and an unknown direction: the
    // default order (name ascending), never an error.
    for query in ["", "sort_by=buy_price", "sort_by=name&sort_order=sideways"] {
        assert_eq!(
            product_names(&db, &token, query).await,
            vec!["Air Mineral", "Beras 5kg"],
            "{query:?}"
        );
    }
}

/// `GET /api/products/lookup?ids=` answers every listed product in one
/// request, inactive ones flagged rather than hidden, and refuses a list past
/// the cap instead of building an unbounded `IN (...)`.
#[tokio::test]
async fn the_cart_looks_products_up_by_id_in_one_request() {
    let db = setup_test_db().await;
    let beras = crate::test_support::insert_product(&db, "Beras 5kg", 50_000.0, 65_000.0, 10).await;
    let air = crate::test_support::insert_product(&db, "Air Mineral", 2_000.0, 3_000.0, 40).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let get = |query: String| {
        let db = db.clone();
        let token = token.clone();
        async move {
            router(&state(db))
                .oneshot(
                    same_origin(Method::GET, &format!("/api/products/lookup?{query}"))
                        .header(header::COOKIE, cookie(&token))
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("response")
        }
    };

    let response = get(format!("ids={},{}", beras.id, air.id)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    let mut rows: Vec<(i64, f64, i64, bool)> = body
        .as_array()
        .expect("a list")
        .iter()
        .map(|p| {
            (
                p["id"].as_i64().expect("id"),
                p["sell_price"].as_f64().expect("sell_price"),
                p["stock"].as_i64().expect("stock"),
                p["is_active"].as_bool().expect("is_active"),
            )
        })
        .collect();
    rows.sort_by_key(|row| row.0);
    assert_eq!(
        rows,
        vec![(beras.id, 65_000.0, 10, true), (air.id, 3_000.0, 40, true)]
    );

    let too_many = (1..=501)
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    assert_eq!(
        get(format!("ids={too_many}")).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        get("ids=1,x".to_string()).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}
