//! Stock write-off rules through the real router: quantity against stock, the
//! loss value, who may settle or delete a row, and what each action does to
//! the shelf.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde_json::{json, Value};
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::http::AppState;
use crate::services::refunds::fixtures::stock_of;
use crate::test_support::{
    insert_product, insert_refund, insert_transaction, insert_writeoff, setup_test_db, RefundSpec,
    WriteoffSpec,
};
use crate::utils::time::now_ts;

async fn call(
    state: &AppState,
    method: Method,
    uri: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = same_origin(method, uri).header(header::COOKIE, cookie(token));
    let request = match body {
        Some(value) => request
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(value)),
        None => request.body(Body::empty()),
    }
    .expect("request");
    let response = router(state).oneshot(request).await.expect("response");
    let status = response.status();
    (status, body_json(response).await)
}

async fn write_off(
    state: &AppState,
    token: &str,
    product_id: i64,
    quantity: i64,
    reason: &str,
) -> (StatusCode, Value) {
    call(
        state,
        Method::POST,
        "/api/stock/writeoffs",
        token,
        Some(json!({ "productId": product_id, "quantity": quantity, "reason": reason })),
    )
    .await
}

async fn pending_writeoff(db: &DatabaseConnection, product_id: i64, quantity: i64) -> i64 {
    insert_writeoff(
        db,
        WriteoffSpec {
            product_id,
            user_id: 1,
            quantity,
            reason: "damaged",
            loss_value: 1_000.0 * quantity as f64,
            status: "pending",
            created_at: &now_ts(),
        },
    )
    .await
    .id
}

#[tokio::test]
async fn a_writeoff_may_take_the_whole_shelf_but_not_more() {
    let db = setup_test_db().await;
    let eggs = insert_product(&db, "Telur", 2_000.0, 2_500.0, 5).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let (status, body) = write_off(&state, &token, eggs.id, 6, "damaged").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(stock_of(&db, eggs.id).await, 5);

    let (status, body) = write_off(&state, &token, eggs.id, 5, "expired").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["lossValue"], json!(10_000.0));
    assert_eq!(body["productName"], json!("Telur"));
    assert!(body["writeoffNumber"]
        .as_str()
        .unwrap_or_default()
        .starts_with("WO-"));
    assert_eq!(stock_of(&db, eggs.id).await, 0);

    let (status, _) = write_off(&state, &token, eggs.id, 1, "damaged").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(stock_of(&db, eggs.id).await, 0);
}

/// The loss is the buy price at the time of the write-off, not the sell price.
#[tokio::test]
async fn the_loss_is_todays_buy_price_times_quantity() {
    let db = setup_test_db().await;
    let oil = insert_product(&db, "Minyak", 14_000.0, 18_000.0, 10).await;
    db.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE products SET buy_price = 15500 WHERE id = $1",
        vec![oil.id.into()],
    ))
    .await
    .expect("raise buy price");
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let (status, body) = write_off(&state, &token, oil.id, 3, "damaged").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["lossValue"], json!(46_500.0));
}

#[tokio::test]
async fn a_malformed_writeoff_is_rejected_without_touching_stock() {
    let db = setup_test_db().await;
    let soap = insert_product(&db, "Sabun", 3_000.0, 5_000.0, 10).await;
    let retired = insert_product(&db, "Sabun Lama", 3_000.0, 5_000.0, 10).await;
    db.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE products SET is_active = 0 WHERE id = $1",
        vec![retired.id.into()],
    ))
    .await
    .expect("deactivate");
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    for (quantity, reason) in [(1, "stolen"), (0, "damaged"), (-2, "damaged")] {
        let (status, body) = write_off(&state, &token, soap.id, quantity, reason).await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "qty {quantity}, reason {reason}: {body}"
        );
    }
    assert_eq!(stock_of(&db, soap.id).await, 10);

    let (status, _) = write_off(&state, &token, retired.id, 1, "damaged").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = write_off(&state, &token, 9_999, 1, "damaged").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(stock_of(&db, retired.id).await, 10);
}

/// `lost` is the admin's call, and an admin's is approved on the spot.
#[tokio::test]
async fn an_admin_may_write_off_a_lost_item() {
    let db = setup_test_db().await;
    let rice = insert_product(&db, "Beras", 50_000.0, 60_000.0, 4).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let (status, body) = write_off(&state, &token, rice.id, 1, "lost").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["status"], json!("approved"));
    assert_eq!(body["approvedBy"], json!(admin.id));
    assert_eq!(body["lossValue"], json!(50_000.0));
    assert_eq!(stock_of(&db, rice.id).await, 3);
}

/// A cashier's refused `lost` write-off leaves no row behind.
#[tokio::test]
async fn a_refused_lost_writeoff_writes_nothing() {
    let db = setup_test_db().await;
    let rice = insert_product(&db, "Beras", 50_000.0, 60_000.0, 4).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let (status, _) = write_off(&state, &token, rice.id, 1, "lost").await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (_, list) = call(&state, Method::GET, "/api/stock/writeoffs", &token, None).await;
    assert_eq!(list["total"], json!(0));
    assert_eq!(stock_of(&db, rice.id).await, 4);
}

#[tokio::test]
async fn a_cashier_cannot_reject_or_delete_a_writeoff() {
    let db = setup_test_db().await;
    let rice = insert_product(&db, "Beras", 50_000.0, 60_000.0, 4).await;
    let pending = pending_writeoff(&db, rice.id, 1).await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let (status, _) = call(
        &state,
        Method::POST,
        &format!("/api/stock/writeoffs/{pending}/reject"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = call(
        &state,
        Method::DELETE,
        &format!("/api/stock/writeoffs/{pending}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(stock_of(&db, rice.id).await, 4);
}

/// Rejecting a manual pending write-off puts its units back once; approving
/// one changes nothing on the shelf; neither can be done twice.
#[tokio::test]
async fn settling_a_pending_writeoff() {
    let db = setup_test_db().await;
    let rice = insert_product(&db, "Beras", 50_000.0, 60_000.0, 8).await;
    let to_reject = pending_writeoff(&db, rice.id, 2).await;
    let to_approve = pending_writeoff(&db, rice.id, 1).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let (status, body) = call(
        &state,
        Method::POST,
        &format!("/api/stock/writeoffs/{to_reject}/reject"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], json!("rejected"));
    assert_eq!(body["approvedBy"], json!(admin.id));
    assert_eq!(stock_of(&db, rice.id).await, 10);

    let (status, body) = call(
        &state,
        Method::POST,
        &format!("/api/stock/writeoffs/{to_approve}/approve"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], json!("approved"));
    assert_eq!(stock_of(&db, rice.id).await, 10);

    for (id, action) in [
        (to_reject, "reject"),
        (to_reject, "approve"),
        (to_approve, "reject"),
    ] {
        let (status, _) = call(
            &state,
            Method::POST,
            &format!("/api/stock/writeoffs/{id}/{action}"),
            &token,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{action} {id}");
    }
    assert_eq!(stock_of(&db, rice.id).await, 10);

    let (status, _) = call(
        &state,
        Method::DELETE,
        &format!("/api/stock/writeoffs/{to_approve}"),
        &token,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "an approved row stays"
    );
}

/// Deleting a manual pending write-off restores its units; a missing id is 404.
#[tokio::test]
async fn deleting_a_pending_manual_writeoff_restores_its_units() {
    let db = setup_test_db().await;
    let rice = insert_product(&db, "Beras", 50_000.0, 60_000.0, 8).await;
    let pending = pending_writeoff(&db, rice.id, 3).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let (status, _) = call(
        &state,
        Method::DELETE,
        &format!("/api/stock/writeoffs/{pending}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(stock_of(&db, rice.id).await, 11);

    let (status, _) = call(
        &state,
        Method::GET,
        &format!("/api/stock/writeoffs/{pending}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// A write-off raised by a damaged return never took stock off the shelf, so
/// rejecting it must not put any back, and it cannot be deleted at all.
#[tokio::test]
async fn a_refund_originated_writeoff_never_moves_stock_when_settled() {
    let db = setup_test_db().await;
    let rice = insert_product(&db, "Beras", 50_000.0, 60_000.0, 8).await;
    let txn = insert_transaction(&db, 1, 60_000.0, "refunded", &now_ts()).await;
    let refund = insert_refund(
        &db,
        RefundSpec {
            transaction_id: txn.id,
            user_id: 1,
            refund_type: "refund",
            total_refund_amount: 60_000.0,
            total_exchange_amount: 0.0,
            difference_amount: 60_000.0,
            payment_method: "cash",
            shift_id: None,
            created_at: &now_ts(),
        },
    )
    .await;
    let mut ids = Vec::new();
    for _ in 0..2 {
        let id = pending_writeoff(&db, rice.id, 1).await;
        db.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE stock_writeoffs SET refund_id = $1 WHERE id = $2",
            vec![refund.id.into(), id.into()],
        ))
        .await
        .expect("link to refund");
        ids.push(id);
    }
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let (status, _) = call(
        &state,
        Method::DELETE,
        &format!("/api/stock/writeoffs/{}", ids[0]),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = call(
        &state,
        Method::POST,
        &format!("/api/stock/writeoffs/{}/reject", ids[1]),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["refundId"], json!(refund.id));
    assert_eq!(stock_of(&db, rice.id).await, 8);
}

/// The list filters by reason and status.
#[tokio::test]
async fn the_writeoff_list_filters_by_reason_and_status() {
    let db = setup_test_db().await;
    let rice = insert_product(&db, "Beras", 50_000.0, 60_000.0, 20).await;
    pending_writeoff(&db, rice.id, 1).await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    for reason in ["damaged", "expired", "lost"] {
        let (status, _) = write_off(&state, &token, rice.id, 1, reason).await;
        assert_eq!(status, StatusCode::CREATED);
    }

    let (_, expired) = call(
        &state,
        Method::GET,
        "/api/stock/writeoffs?reason=expired",
        &token,
        None,
    )
    .await;
    assert_eq!(expired["total"], json!(1));
    assert_eq!(expired["items"][0]["reason"], json!("expired"));

    let (_, pending) = call(
        &state,
        Method::GET,
        "/api/stock/writeoffs?status=pending",
        &token,
        None,
    )
    .await;
    assert_eq!(pending["total"], json!(1));

    let (_, all) = call(&state, Method::GET, "/api/stock/writeoffs", &token, None).await;
    assert_eq!(all["total"], json!(4));
}
