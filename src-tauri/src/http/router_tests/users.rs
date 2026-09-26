//! The admin-only user routes.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::json;
use tower::ServiceExt;

use super::{
    body_json, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::entity::users;
use crate::test_support::setup_test_db;

/// `/api/users` is the clearest case of the admin group doing its job: a cashier
/// with a perfectly valid session must not be able to read the staff list, let
/// alone mint an account.
#[tokio::test]
async fn the_user_routes_are_closed_to_a_cashier_session() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let listed = router(&state)
        .oneshot(
            same_origin(Method::GET, "/api/users")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(listed.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(listed).await["code"], json!("forbidden"));

    let created = router(&state)
        .oneshot(
            same_origin(Method::POST, "/api/users")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "username": "penyusup",
                    "fullName": "Penyusup",
                    "role": "admin",
                    "pin": "9999",
                })))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(created.status(), StatusCode::FORBIDDEN);

    assert!(
        users::Entity::find()
            .filter(users::Column::Username.eq("penyusup"))
            .one(&db)
            .await
            .expect("query")
            .is_none(),
        "a refused create must not have written a row"
    );
}

/// The account a PATCH edits is the one in the URL. A body that names a
/// different id changes nothing about which row is written.
#[tokio::test]
async fn a_user_patch_edits_the_account_in_the_url_not_the_one_in_the_body() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::PATCH, &format!("/api/users/{}", kasir.id))
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "fullName": "Kasir Satu",
                    "userId": admin.id,
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["id"], json!(kasir.id));

    let untouched = users::Entity::find_by_id(admin.id)
        .one(&db)
        .await
        .expect("query")
        .expect("the admin row is still there");
    assert_eq!(untouched.full_name, "admin2");
}

#[tokio::test]
async fn an_admin_can_deactivate_an_account_through_the_active_route() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::PATCH, &format!("/api/users/{}/active", kasir.id))
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({ "isActive": false })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_json(response).await["is_active"], json!(false));
}
