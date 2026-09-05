//! The catalogues the PPOB screen browses: balance, menu, providers, denominations.

use sea_orm::DatabaseConnection;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::domain::ppob::*;
use crate::services::ppob::auth::{get_mitra_request_context, get_mitra_session_context};
use crate::services::ppob::client::MitraClient;
use crate::utils::AppError;

/// The combined menu-and-balance payload.
///
/// Opening a session may already have fetched it, in which case that copy is
/// reused rather than asking the provider twice.
async fn fetch_menu_saldo_payload(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<serde_json::Value, AppError> {
    let session = get_mitra_session_context(db, mitra).await?;
    if let Some(payload) = session.menu_saldo_payload {
        Ok(payload)
    } else {
        session.request.post("get-menu-saldo", json!({})).await
    }
}

/// Pull every element of `key` out of `payload` that deserialises into `T`,
/// skipping the ones that do not.
fn collect_list<T: serde::de::DeserializeOwned>(payload: &serde_json::Value, key: &str) -> Vec<T> {
    payload[key]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

pub async fn saldo(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<PpobSaldoResponse, AppError> {
    let result = fetch_menu_saldo_payload(db, mitra).await?;

    Ok(PpobSaldoResponse {
        saldo: result["saldo"].as_f64().unwrap_or(0.0),
        username: result["detail_member"]["username"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        store_name: result["detail_member"]["store_name"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        flag_member: result["flag_member"].as_str().unwrap_or("").to_string(),
    })
}

pub async fn menu(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<Vec<PpobMenuGroup>, AppError> {
    let result = fetch_menu_saldo_payload(db, mitra).await?;

    let menu_groups: Vec<PpobMenuGroup> = result["menu"]
        .as_array()
        .and_then(|menus| menus.first())
        .and_then(|m| m["list_menu"].as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(menu_groups)
}

pub async fn providers(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<Vec<PulsaProvider>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client.get("pulsa/get-providers").await?;
    Ok(collect_list(&result, "providers"))
}

pub async fn pulsa_details(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    phone_number: String,
) -> Result<PulsaDetailsResponse, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post(
            "pulsa/v2/get-details",
            json!({ "phone_number": phone_number }),
        )
        .await?;

    Ok(PulsaDetailsResponse {
        provider: result["provider"].as_str().unwrap_or("").to_string(),
        image: result["image"].as_str().unwrap_or("").to_string(),
        products: collect_list(&result, "pulsa"),
    })
}

pub async fn pulsa_price_list(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    provider_uid: String,
) -> Result<Vec<PulsaProduct>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post(
            "pulsa/get-pulsa-price-list",
            json!({ "provider_uid": provider_uid }),
        )
        .await?;
    Ok(collect_list(&result, "pulsa_options"))
}

pub async fn data_price_list(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    provider_uid: String,
) -> Result<Vec<PulsaProduct>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post(
            "pulsa/get-data-price-list",
            json!({ "provider_uid": provider_uid }),
        )
        .await?;
    Ok(collect_list(&result, "data_options"))
}

pub async fn pln_denom(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<Vec<PlnDenom>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client.post("pln/get-denom", json!({})).await?;
    Ok(collect_list(&result, "pln"))
}

pub async fn pdam_products(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<Vec<PdamProduct>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client.post("pdam/get-product", json!({})).await?;
    Ok(collect_list(&result, "list_product"))
}

pub async fn emoney_denom(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    product_id: i64,
) -> Result<Vec<EmoneyDenom>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post("emoney/get-denom", json!({ "product_id": product_id }))
        .await?;
    Ok(collect_list(&result, "emoney"))
}

pub async fn pp_sub_menu(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    pp_id: i64,
) -> Result<Vec<PpSubMenuItem>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client
        .post("pp/get-sub-menu", json!({ "pp_id": pp_id }))
        .await?;
    Ok(collect_list(&result, "sub_menu"))
}

pub async fn transfer_channels(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<Vec<TransferChannelGroup>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client.get("transfer-uang/channel-group").await?;
    Ok(collect_list(&result, "channelList"))
}

pub async fn voucher_groups(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<Vec<VoucherGroup>, AppError> {
    let client = get_mitra_request_context(db, mitra).await?;
    let result = client.get("voucher-prepaid/get/group").await?;
    Ok(collect_list(&result, "group_list"))
}
