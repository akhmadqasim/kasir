//! Settings reads and writes, and the PPOB credentials they must never leak.

use axum::body::Body;
use axum::http::{header, Method, StatusCode};
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};
use serde_json::{json, Value};
use tower::ServiceExt;

use super::{
    body_text, cookie, insert_user_with_pin, json_body, login_token, router, same_origin, state,
};
use crate::entity::store_info;
use crate::test_support::setup_test_db;
use crate::utils::time::now_ts;

/// A store row whose PPOB block holds a real password, stored the way
/// `update_app_settings` stores it — plus a legacy obfuscated `pin` key next
/// to it, the shape a build from before the PIN was removed from settings
/// left behind. `PpobSettings` has no field to read that key into any more;
/// every test using this fixture is incidentally proving the stray key does
/// not break anything.
async fn insert_store_with_ppob_credentials(
    db: &DatabaseConnection,
    password: &str,
    pin: &str,
) -> store_info::Model {
    use crate::domain::settings::obfuscate;

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
                "security": { "session_timeout_minutes": 30 },
                "ppob": {
                    "enabled": true,
                    "phone_number": "0812000111",
                    "password": obfuscate(password),
                    "device_id": "device-1",
                    "pin": obfuscate(pin),
                },
                "backup": { "interval_hours": 3, "retention_days": 90 },
            })
            .to_string(),
        )),
        created_at: Set(Some(now_ts())),
        updated_at: Set(Some(now_ts())),
    }
    .insert(db)
    .await
    .expect("store info insert")
}

/// The whole reason `/api/settings` exists separately from `get_app_settings`.
///
/// The service deobfuscates the PPOB password and PIN because the fulfilment
/// executor needs them; serialising that struct over HTTP would hand a shop's
/// gateway credentials to anything that can reach the port. The response is
/// checked as raw text, not as parsed fields, so a future field that happens to
/// carry the secret is caught too.
#[tokio::test]
async fn the_settings_read_never_contains_the_ppob_credentials() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);

    let text = body_text(response).await;
    assert!(
        !text.contains("rahasia-sekali"),
        "the PPOB password must not be in the response: {text}"
    );
    assert!(
        !text.contains("424242"),
        "the PPOB PIN must not be in the response: {text}"
    );

    let body: Value = serde_json::from_str(&text).expect("json");
    assert!(body["ppob"].get("password").is_none());
    assert!(body["ppob"].get("pin").is_none());
    assert_eq!(body["ppob"]["has_credentials"], json!(true));
    // The non-secret half is still readable, or the settings page has nothing
    // to draw.
    assert_eq!(body["ppob"]["phone_number"], json!("0812000111"));
    assert_eq!(body["ppob"]["device_id"], json!("device-1"));
}

#[tokio::test]
async fn the_settings_read_is_closed_to_a_cashier() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

/// The one slice of `/api/settings` a cashier is allowed to read: the markup
/// table `PpobQuickAccess` needs to price a top-up. Everything the admin-only
/// read withholds must stay withheld here too.
#[tokio::test]
async fn a_cashier_can_read_the_ppob_markup_but_not_the_credentials() {
    let db = setup_test_db().await;
    let store = insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let mut settings: Value =
        serde_json::from_str(store.additional_info.as_deref().unwrap_or("{}")).expect("json");
    settings["ppob"]["markup"] = json!({
        "pulsa": { "type": "percentage", "value": 5.0 },
        "data": { "type": "fixed", "value": 1000.0 },
        "pln": { "type": "fixed", "value": 2500.0 },
        "pdam": { "type": "fixed", "value": 2500.0 },
        "bpjs": { "type": "fixed", "value": 2500.0 },
        "emoney": { "type": "percentage", "value": 2.0 },
        "custom_prices": {},
    });
    let mut active: store_info::ActiveModel = store.into();
    active.additional_info = Set(Some(settings.to_string()));
    active.update(&db).await.expect("store update");

    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings/ppob/markup")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);

    let text = body_text(response).await;
    assert!(
        !text.contains("rahasia-sekali"),
        "the PPOB password must not be in the response: {text}"
    );
    assert!(
        !text.contains("424242"),
        "the PPOB PIN must not be in the response: {text}"
    );

    let body: Value = serde_json::from_str(&text).expect("json");
    assert!(body.get("password").is_none());
    assert!(body.get("pin").is_none());
    assert_eq!(body["pulsa"]["type"], json!("percentage"));
    assert_eq!(body["pulsa"]["value"], json!(5.0));
}

/// No session at all — the endpoint still requires login, it is just open to
/// every role once logged in.
#[tokio::test]
async fn the_ppob_markup_route_requires_a_session() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings/ppob/markup")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// The till opens its payment dialog on the shop's default method, so a kasir
/// must be able to read the sales block — and only that block: the PPOB
/// credentials stored beside it never come along.
#[tokio::test]
async fn a_kasir_reads_the_sales_settings_without_the_ppob_secrets() {
    let db = setup_test_db().await;
    let store = insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let mut settings: Value =
        serde_json::from_str(store.additional_info.as_deref().unwrap_or("{}")).expect("json");
    settings["sales"]["default_payment_method"] = json!("qris");
    let mut active: store_info::ActiveModel = store.into();
    active.additional_info = Set(Some(settings.to_string()));
    active.update(&db).await.expect("store update");

    let kasir = insert_user_with_pin(&db, "kasir1", "1234", "kasir").await;
    let token = login_token(&db, kasir.id).await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings/sales")
                .header(header::COOKIE, cookie(&token))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let text = body_text(response).await;
    assert!(!text.contains("rahasia-sekali"), "password leaked: {text}");
    assert!(!text.contains("424242"), "PIN leaked: {text}");
    let body: Value = serde_json::from_str(&text).expect("json");
    assert_eq!(
        body,
        json!({ "allow_negative_stock": true, "default_payment_method": "qris" })
    );
}

#[tokio::test]
async fn the_sales_settings_route_requires_a_session() {
    let db = setup_test_db().await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/settings/sales")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Because the client never receives the credentials, it cannot send them back
/// — so a settings save must not read their absence as "clear them".
///
/// `insert_store_with_ppob_credentials` still plants a legacy `"pin"` key
/// alongside the password (see its doc comment) purely so this exercises a
/// store row shaped like one an older build would have written; there is no
/// `stored.ppob.pin` to assert on any more — the field is gone — which is
/// itself the proof that the stray key is tolerated rather than read back.
#[tokio::test]
async fn saving_the_settings_leaves_the_stored_credentials_intact() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::PUT, "/api/settings")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(json!({
                    "sales": { "allow_negative_stock": false, "default_payment_method": "qris" },
                    "security": { "session_timeout_minutes": 45 },
                    "ppob": {
                        "enabled": true,
                        "phone_number": "0812000111",
                        "device_id": "device-1",
                    },
                    "backup": { "interval_hours": 6, "retention_days": 30 },
                })))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let stored = crate::services::settings::get_app_settings(&db)
        .await
        .expect("settings");
    assert_eq!(stored.ppob.password, "rahasia-sekali");
    assert_eq!(stored.sales.default_payment_method, "qris");
    assert_eq!(stored.security.session_timeout_minutes, 45);
}

/// The PIN in the request body is a client bug (there is nowhere left to put
/// one — `UpdatePpobCredentialsInput` is password-only) rather than a request
/// this route need refuse: unknown JSON fields are ignored, same as the
/// legacy stored `"pin"` key the fixture plants.
#[tokio::test]
async fn the_credentials_route_is_the_only_way_to_change_them() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let admin = insert_user_with_pin(&db, "admin2", "1234", "admin").await;
    let token = login_token(&db, admin.id).await;

    let response = router(&state(db.clone()))
        .oneshot(
            same_origin(Method::PUT, "/api/settings/ppob/credentials")
                .header(header::COOKIE, cookie(&token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(
                    json!({ "password": "sandi-baru", "pin": "111111" }),
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let stored = crate::services::settings::get_app_settings(&db)
        .await
        .expect("settings");
    assert_eq!(stored.ppob.password, "sandi-baru");

    // And what is on disk is still obfuscated, not the plain string.
    let row = store_info::Entity::find_by_id(1_i64)
        .one(&db)
        .await
        .expect("query")
        .expect("store row");
    let raw = row.additional_info.unwrap_or_default();
    assert!(
        !raw.contains("sandi-baru"),
        "credentials stored in the clear"
    );
}

/// The login screen shows the shop's name before anyone has signed in. The
/// route that feeds it must answer without a session and carry the name and
/// the logo flag only — not the address or phone, and never the PPOB secrets
/// stored on the same row.
#[tokio::test]
async fn the_public_store_route_needs_no_session_and_leaks_nothing() {
    let db = setup_test_db().await;
    let store = insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;
    let mut active: store_info::ActiveModel = store.into();
    active.address = Set(Some("Jl. Rahasia 12".to_string()));
    active.phone = Set(Some("0812999888".to_string()));
    active.email = Set(Some("pemilik@toko.test".to_string()));
    active.update(&db).await.expect("store update");

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/store/public")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let text = body_text(response).await;
    for secret in [
        "rahasia-sekali",
        "424242",
        "0812000111",
        "Jl. Rahasia",
        "0812999888",
        "pemilik@toko.test",
    ] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }
    let body: Value = serde_json::from_str(&text).expect("json");
    assert_eq!(body, json!({ "name": "Toko Test", "has_logo": false }));
}

/// Before onboarding there is no store row: the route still answers, with
/// `null`, and leaves the redirect to onboarding to `/onboarding/status`.
#[tokio::test]
async fn the_public_store_route_is_null_before_onboarding() {
    let db = setup_test_db().await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/store/public")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_text(response).await, "null");
}

/// Opening the public slice did not open the full row: `/store` still wants a
/// session.
#[tokio::test]
async fn the_full_store_row_still_requires_a_session() {
    let db = setup_test_db().await;
    insert_store_with_ppob_credentials(&db, "rahasia-sekali", "424242").await;

    let response = router(&state(db))
        .oneshot(
            same_origin(Method::GET, "/api/store")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
