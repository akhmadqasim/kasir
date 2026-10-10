//! User management, onboarding and the own-PIN form, driven over HTTP.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use serde_json::{json, Value};
use tower::ServiceExt;

use super::{
    body_json, body_text, cookie, insert_user_with_pin, json_body, login_token, router,
    same_origin, state,
};
use crate::entity::{store_info, users};
use crate::http::AppState;
use crate::test_support::setup_test_db;
use crate::utils::time::now_ts;

async fn send(
    state: &AppState,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Value,
) -> axum::response::Response {
    let mut request = same_origin(method, path).header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        request = request.header(header::COOKIE, cookie(token));
    }
    router(state)
        .oneshot(request.body(json_body(body)).expect("request"))
        .await
        .expect("response")
}

async fn user_named(db: &DatabaseConnection, username: &str) -> Option<users::Model> {
    users::Entity::find()
        .filter(users::Column::Username.eq(username))
        .one(db)
        .await
        .expect("query")
}

async fn admin_count(db: &DatabaseConnection) -> usize {
    users::Entity::find()
        .filter(users::Column::Role.eq("admin"))
        .all(db)
        .await
        .expect("query")
        .len()
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

#[tokio::test]
async fn an_admin_cannot_deactivate_their_own_account() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let response = send(
        &state,
        Method::PATCH,
        &format!("/api/users/{}/active", admin.id),
        Some(&token),
        json!({ "isActive": false }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(user_named(&db, "boss").await.expect("user").is_active);
}

#[tokio::test]
async fn an_admin_cannot_demote_their_own_account() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let response = send(
        &state,
        Method::PATCH,
        &format!("/api/users/{}", admin.id),
        Some(&token),
        json!({ "role": "kasir" }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(user_named(&db, "boss").await.expect("user").role, "admin");
}

/// A PIN is 4 to 6 ASCII digits — nothing shorter, longer, or non-numeric is
/// accepted, and a refused create writes no row.
#[tokio::test]
async fn creating_a_user_with_a_malformed_pin_is_refused_and_writes_nothing() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    for (i, pin) in ["123", "1234567", "12a4", "", "١٢٣٤", " 1234"]
        .iter()
        .enumerate()
    {
        let username = format!("baru{i}");
        let response = send(
            &state,
            Method::POST,
            "/api/users",
            Some(&token),
            json!({ "username": username, "fullName": "Baru", "role": "kasir", "pin": pin }),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "PIN {pin:?} must be refused"
        );
        assert!(
            user_named(&db, &username).await.is_none(),
            "PIN {pin:?} wrote a row"
        );
    }
}

#[tokio::test]
async fn creating_a_user_with_an_unknown_role_is_refused() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    for role in ["superadmin", "Admin", "", "owner"] {
        let response = send(
            &state,
            Method::POST,
            "/api/users",
            Some(&token),
            json!({ "username": "baru", "fullName": "Baru", "role": role, "pin": "1234" }),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "role {role:?} must be refused"
        );
    }
    assert!(user_named(&db, "baru").await.is_none());
}

/// The username is trimmed before the uniqueness check, so padding cannot
/// mint a second account under a name that looks the same.
#[tokio::test]
async fn a_padded_duplicate_username_is_refused() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let response = send(
        &state,
        Method::POST,
        "/api/users",
        Some(&token),
        json!({ "username": "  kasir1 ", "fullName": "Kembar", "role": "kasir", "pin": "5678" }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        users::Entity::find()
            .filter(users::Column::FullName.eq("Kembar"))
            .all(&db)
            .await
            .expect("query")
            .len(),
        0
    );
}

/// Renaming an account onto a name another account holds is refused.
#[tokio::test]
async fn renaming_a_user_onto_a_taken_username_is_refused() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let kasir2 = insert_user_with_pin(&db, "kasir2", "1234", "kasir").await;
    let token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let response = send(
        &state,
        Method::PATCH,
        &format!("/api/users/{}", kasir2.id),
        Some(&token),
        json!({ "username": "kasir1" }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(user_named(&db, "kasir2").await.is_some());
}

/// An admin resets a PIN because the old one got out. Every browser that is
/// logged in to that account must stop working, and the new PIN must be the
/// one that logs in.
#[tokio::test]
async fn an_admin_pin_reset_logs_the_account_out_everywhere() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let admin_token = login_token(&db, admin.id).await;
    let kasir_token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let reset = send(
        &state,
        Method::PATCH,
        &format!("/api/users/{}", kasir.id),
        Some(&admin_token),
        json!({ "newPin": "9876" }),
    )
    .await;
    assert_eq!(reset.status(), StatusCode::OK);

    let me = send(
        &state,
        Method::GET,
        "/api/auth/me",
        Some(&kasir_token),
        json!({}),
    )
    .await;
    assert_eq!(me.status(), StatusCode::UNAUTHORIZED);

    let old_pin = send(
        &state,
        Method::POST,
        "/api/auth/login",
        None,
        json!({ "username": "kasir1", "pin": "1234" }),
    )
    .await;
    assert_eq!(old_pin.status(), StatusCode::UNAUTHORIZED);

    let new_pin = send(
        &state,
        Method::POST,
        "/api/auth/login",
        None,
        json!({ "username": "kasir1", "pin": "9876" }),
    )
    .await;
    assert_eq!(new_pin.status(), StatusCode::OK);
}

/// A malformed new PIN on a reset changes nothing: not the hash, not the
/// sessions.
#[tokio::test]
async fn a_malformed_pin_reset_changes_nothing() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let admin_token = login_token(&db, admin.id).await;
    let kasir_token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let reset = send(
        &state,
        Method::PATCH,
        &format!("/api/users/{}", kasir.id),
        Some(&admin_token),
        json!({ "newPin": "12", "fullName": "Nama Baru" }),
    )
    .await;
    assert_eq!(reset.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let row = user_named(&db, "kasir1").await.expect("user");
    assert_eq!(row.pin_hash, kasir.pin_hash);
    assert_eq!(
        row.full_name, "kasir1",
        "a refused edit must not half-apply"
    );
    let me = send(
        &state,
        Method::GET,
        "/api/auth/me",
        Some(&kasir_token),
        json!({}),
    )
    .await;
    assert_eq!(me.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_deactivated_account_cannot_log_in_even_with_the_right_pin() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let admin_token = login_token(&db, admin.id).await;
    let state = state(db.clone());

    let off = send(
        &state,
        Method::PATCH,
        &format!("/api/users/{}/active", kasir.id),
        Some(&admin_token),
        json!({ "isActive": false }),
    )
    .await;
    assert_eq!(off.status(), StatusCode::OK);

    let login = send(
        &state,
        Method::POST,
        "/api/auth/login",
        None,
        json!({ "username": "kasir1", "pin": "1234" }),
    )
    .await;
    assert_eq!(login.status(), StatusCode::UNAUTHORIZED);
    assert!(login.headers().get(header::SET_COOKIE).is_none());
}

#[tokio::test]
async fn the_user_list_never_carries_a_pin_hash() {
    let db = setup_test_db().await;
    let admin = insert_user_with_pin(&db, "boss", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = send(
        &state(db),
        Method::GET,
        "/api/users",
        Some(&token),
        json!({}),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let text = body_text(response).await;
    assert!(!text.contains("pin_hash"), "{text}");
    assert!(!text.contains(&admin.pin_hash), "{text}");
}

// ---------------------------------------------------------------------------
// Own PIN
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_wrong_current_pin_is_a_422_and_keeps_the_old_pin() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db.clone());

    let response = send(
        &state,
        Method::PUT,
        "/api/auth/me/pin",
        Some(&token),
        json!({ "currentPin": "0000", "newPin": "5678" }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        user_named(&db, "kasir1").await.expect("user").pin_hash,
        kasir.pin_hash
    );
    // The session survives a typo.
    let me = send(&state, Method::GET, "/api/auth/me", Some(&token), json!({})).await;
    assert_eq!(me.status(), StatusCode::OK);
}

/// The login form backs off after a few wrong PINs; the own-PIN form checks the
/// same secret and must not be an unthrottled way around that. Someone at an
/// unattended, logged-in till can otherwise walk the 10 000 four-digit PINs.
#[tokio::test]
async fn guessing_the_current_pin_is_throttled_like_a_login() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    let mut last = StatusCode::OK;
    for guess in [
        "0000", "0001", "0002", "0003", "0004", "0005", "0006", "0007",
    ] {
        last = send(
            &state,
            Method::PUT,
            "/api/auth/me/pin",
            Some(&token),
            json!({ "currentPin": guess, "newPin": "5678" }),
        )
        .await
        .status();
    }

    assert_eq!(
        last,
        StatusCode::TOO_MANY_REQUESTS,
        "eight wrong current PINs in a row should be backed off"
    );
}

/// Only a wrong current PIN counts against the throttle. A malformed new PIN
/// after the right current one is a 422 too, but never backs off.
#[tokio::test]
async fn a_malformed_new_pin_is_not_charged_to_the_throttle() {
    let db = setup_test_db().await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let state = state(db);

    for _ in 0..8 {
        let status = send(
            &state,
            Method::PUT,
            "/api/auth/me/pin",
            Some(&token),
            json!({ "currentPin": "1234", "newPin": "12" }),
        )
        .await
        .status();
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

fn onboarding_body(store: &str, username: &str, pin: &str, full_name: &str) -> Value {
    json!({
        "store": { "name": store, "address": "Jl. Pasar 1", "phone": "0811", "email": null },
        "admin": { "username": username, "pin": pin, "full_name": full_name },
    })
}

#[tokio::test]
async fn onboarding_creates_the_store_and_an_admin_that_can_log_in() {
    let db = setup_test_db().await;
    let state = state(db.clone());

    let done = send(
        &state,
        Method::POST,
        "/api/onboarding",
        None,
        onboarding_body("Toko Makmur", "pemilik", "246810", "Pak Pemilik"),
    )
    .await;
    assert_eq!(done.status(), StatusCode::OK);

    let pending = send(
        &state,
        Method::GET,
        "/api/onboarding/status",
        None,
        json!({}),
    )
    .await;
    assert_eq!(body_json(pending).await, json!(false));

    let owner = user_named(&db, "pemilik").await.expect("admin row");
    assert_eq!(owner.role, "admin");
    let login = send(
        &state,
        Method::POST,
        "/api/auth/login",
        None,
        json!({ "username": "pemilik", "pin": "246810" }),
    )
    .await;
    assert_eq!(login.status(), StatusCode::OK);
}

/// `/api/onboarding` is public. Once the store exists, a second call must not
/// mint another admin account or rename the shop — otherwise anyone on the LAN
/// could give themselves admin.
#[tokio::test]
async fn a_second_onboarding_cannot_mint_an_admin_or_rename_the_store() {
    let db = setup_test_db().await;
    let state = state(db.clone());

    let first = send(
        &state,
        Method::POST,
        "/api/onboarding",
        None,
        onboarding_body("Toko Makmur", "pemilik", "246810", "Pak Pemilik"),
    )
    .await;
    assert_eq!(first.status(), StatusCode::OK);
    let admins_before = admin_count(&db).await;

    let second = send(
        &state,
        Method::POST,
        "/api/onboarding",
        None,
        onboarding_body("Toko Penyusup", "penyusup", "1111", "Penyusup"),
    )
    .await;
    assert_eq!(second.status(), StatusCode::CONFLICT);

    assert!(user_named(&db, "penyusup").await.is_none());
    assert_eq!(admin_count(&db).await, admins_before);
    let store = store_info::Entity::find_by_id(1_i64)
        .one(&db)
        .await
        .expect("query")
        .expect("store");
    assert_eq!(store.name, "Toko Makmur");
}

#[tokio::test]
async fn onboarding_with_a_malformed_pin_writes_nothing() {
    let db = setup_test_db().await;
    let state = state(db.clone());

    let response = send(
        &state,
        Method::POST,
        "/api/onboarding",
        None,
        onboarding_body("Toko Makmur", "pemilik", "12", "Pak Pemilik"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(user_named(&db, "pemilik").await.is_none());
    let pending = send(
        &state,
        Method::GET,
        "/api/onboarding/status",
        None,
        json!({}),
    )
    .await;
    assert_eq!(body_json(pending).await, json!(true));
}

#[tokio::test]
async fn onboarding_with_a_blank_store_name_or_username_writes_nothing() {
    let db = setup_test_db().await;
    let state = state(db.clone());

    for body in [
        onboarding_body("   ", "pemilik", "1234", "Pak Pemilik"),
        onboarding_body("Toko Makmur", "   ", "1234", "Pak Pemilik"),
    ] {
        let response = send(&state, Method::POST, "/api/onboarding", None, body).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let pending = send(
        &state,
        Method::GET,
        "/api/onboarding/status",
        None,
        json!({}),
    )
    .await;
    assert_eq!(body_json(pending).await, json!(true));
}

/// `create_user` refuses a blank full name ("Nama lengkap tidak boleh kosong").
/// The first admin is a user too, and their name is what every receipt they
/// ring up prints as the cashier.
#[tokio::test]
async fn onboarding_refuses_a_blank_admin_full_name() {
    let db = setup_test_db().await;
    let state = state(db.clone());

    let response = send(
        &state,
        Method::POST,
        "/api/onboarding",
        None,
        onboarding_body("Toko Makmur", "pemilik", "1234", "   "),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(user_named(&db, "pemilik").await.is_none());
}

// ---------------------------------------------------------------------------
// The store row and the PPOB secret inside it
// ---------------------------------------------------------------------------

/// The store row as `update_app_settings` leaves it: a PPOB block holding the
/// Mitra password in its reversible `OBF:` form.
async fn insert_store_with_ppob_password(db: &DatabaseConnection, password: &str) {
    store_info::ActiveModel {
        id: Set(1),
        name: Set("Toko Test".to_string()),
        address: Set(None),
        phone: Set(None),
        email: Set(None),
        logo_path: Set(None),
        additional_info: Set(Some(
            json!({
                "sales": { "allow_negative_stock": true, "default_payment_method": "cash" },
                "ppob": {
                    "enabled": true,
                    "phone_number": "0812000111",
                    "password": crate::domain::settings::obfuscate(password),
                    "device_id": "device-1",
                },
            })
            .to_string(),
        )),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(db)
    .await
    .expect("store insert");
}

/// `/api/onboarding` needs no session. After onboarding it answers with the
/// stored row, and that row's `additional_info` carries the Mitra password in
/// a form `deobfuscate` reverses with a key compiled into the binary.
#[tokio::test]
async fn the_public_onboarding_route_never_returns_the_ppob_password() {
    let db = setup_test_db().await;
    insert_store_with_ppob_password(&db, "rahasia-mitra").await;
    let secret = crate::domain::settings::obfuscate("rahasia-mitra");

    let response = send(
        &state(db),
        Method::POST,
        "/api/onboarding",
        None,
        onboarding_body("Apa Saja", "siapa", "1234", "Siapa"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let text = body_text(response).await;
    assert!(!text.contains(&secret), "anonymous caller got: {text}");
    assert!(
        !text.contains("phone_number"),
        "anonymous caller got: {text}"
    );
}

/// A cashier may read the sales settings and the PPOB markup, but not the
/// Mitra login: `/api/settings` is admin-only for exactly that reason. The
/// full store row a cashier can read must not hand it over either.
#[tokio::test]
async fn a_cashier_reading_the_store_row_does_not_get_the_ppob_password() {
    let db = setup_test_db().await;
    insert_store_with_ppob_password(&db, "rahasia-mitra").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;
    let secret = crate::domain::settings::obfuscate("rahasia-mitra");

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/store")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let text = body_text(response).await;
    assert!(!text.contains(&secret), "a cashier got: {text}");
}
