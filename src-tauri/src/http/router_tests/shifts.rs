//! Shifts and cash flows belong to the session that made them.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::test_support::setup_test_db;

/// `open_shift` and `get_active_shift` both took an unchecked `userId`, so one
/// cashier could open a shift as another and read that other's drawer. The owner
/// is now the session on both.
#[tokio::test]
async fn a_shift_belongs_to_the_session_that_opened_it() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let kasir_token = login_token(&db, kasir.id).await;
    let admin_token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let opened = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/shifts")
                .header(header::COOKIE, cookie(&kasir_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(
                    json!({ "openingCash": 100_000.0, "userId": admin.id }),
                ))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(opened.status(), StatusCode::CREATED);
    assert_eq!(body_json(opened).await["userId"], json!(kasir.id));

    // The admin has no shift of their own, and asking does not surface the
    // cashier's.
    let admins_active = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/shifts/active")
                .header(header::COOKIE, cookie(&admin_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(admins_active.status(), StatusCode::OK);
    assert_eq!(body_json(admins_active).await, Value::Null);
}

/// A cash-flow entry is deletable by its author or an admin, and only while the
/// shift is open. That is not a rule a route table can hold, so the service does
/// — and the route has to let the service see the real actor for it to work.
#[tokio::test]
async fn a_cash_flow_can_only_be_removed_by_its_author_or_an_admin() {
    let db = setup_test_db().await;
    let owner = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let other = insert_user_with_pin(&db, "kasir2", "1234", "kasir").await;
    let owner_token = login_token(&db, owner.id).await;
    let other_token = login_token(&db, other.id).await;
    let state = state(db.clone());

    let shift = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/shifts")
                .header(header::COOKIE, cookie(&owner_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "openingCash": 100_000.0 })))
                .expect("request"),
        )
        .await
        .expect("response");
    let shift_id = body_json(shift).await["id"].as_i64().expect("shift id");

    let flow = router(&state)
        .oneshot(
            same_origin(Method::POST, &format!("/api/shifts/{shift_id}/cash-flows"))
                .header(header::COOKIE, cookie(&owner_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "flowType": "out",
                    "amount": 50_000.0,
                    "description": "beli plastik",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(flow.status(), StatusCode::CREATED);
    let flow = body_json(flow).await;
    assert_eq!(flow["userId"], json!(owner.id));
    let flow_id = flow["id"].as_i64().expect("flow id");

    let refused = router(&state)
        .oneshot(
            same_origin(Method::DELETE, &format!("/api/cash-flows/{flow_id}"))
                .header(header::COOKIE, cookie(&other_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);

    let allowed = router(&state)
        .oneshot(
            same_origin(Method::DELETE, &format!("/api/cash-flows/{flow_id}"))
                .header(header::COOKIE, cookie(&owner_token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(allowed.status(), StatusCode::NO_CONTENT);
}

/// A shift's summary and cash-flow list used to answer anyone with a session,
/// so one cashier could read another's drawer — expected cash, sales, every
/// withdrawal — by guessing an id. Now the owner or an admin, nobody else.
#[tokio::test]
async fn a_shifts_summary_and_cash_flows_are_its_owners_or_an_admins() {
    let db = setup_test_db().await;
    let owner = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let other = insert_user_with_pin(&db, "kasir2", "1234", "kasir").await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let owner_token = login_token(&db, owner.id).await;
    let other_token = login_token(&db, other.id).await;
    let admin_token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let shift = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/shifts")
                .header(header::COOKIE, cookie(&owner_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "openingCash": 100_000.0 })))
                .expect("request"),
        )
        .await
        .expect("response");
    let shift_id = body_json(shift).await["id"].as_i64().expect("shift id");

    for path in [
        format!("/api/shifts/{shift_id}/summary"),
        format!("/api/shifts/{shift_id}/cash-flows"),
    ] {
        for (token, expected) in [
            (&other_token, StatusCode::FORBIDDEN),
            (&owner_token, StatusCode::OK),
            (&admin_token, StatusCode::OK),
        ] {
            let response = router(&state)
                .oneshot(
                    same_origin(Method::GET, &path)
                        .header(header::COOKIE, cookie(token))
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("response");
            assert_eq!(response.status(), expected, "GET {path}");
        }
    }
}
