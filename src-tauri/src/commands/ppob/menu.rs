use sea_orm::DatabaseConnection;
use serde_json::json;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use super::auth::get_mitra_client;
use super::client::MitraClient;
use super::models::*;
use crate::utils::AppError;

#[tauri::command]
pub async fn ppob_login(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<PpobSaldoResponse, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client.post("get-menu-saldo", json!({})).await?;

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

#[tauri::command]
pub async fn ppob_get_saldo(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<PpobSaldoResponse, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client.post("get-menu-saldo", json!({})).await?;

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

#[tauri::command]
pub async fn ppob_get_menu(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<PpobMenuGroup>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client.post("get-menu-saldo", json!({})).await?;

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

#[tauri::command]
pub async fn ppob_get_providers(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<PulsaProvider>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client.get("pulsa/get-providers").await?;

    let providers: Vec<PulsaProvider> = result["providers"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(providers)
}

#[tauri::command]
pub async fn ppob_get_pulsa_details(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    phone_number: String,
) -> Result<PulsaDetailsResponse, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client
        .post(
            "pulsa/v2/get-details",
            json!({ "phone_number": phone_number }),
        )
        .await?;

    let products: Vec<PulsaDetailProduct> = result["pulsa"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(PulsaDetailsResponse {
        provider: result["provider"].as_str().unwrap_or("").to_string(),
        image: result["image"].as_str().unwrap_or("").to_string(),
        products,
    })
}

#[tauri::command]
pub async fn ppob_get_pulsa_price_list(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    provider_uid: String,
) -> Result<Vec<PulsaProduct>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client
        .post(
            "pulsa/get-pulsa-price-list",
            json!({ "provider_uid": provider_uid }),
        )
        .await?;

    let products: Vec<PulsaProduct> = result["pulsa_options"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(products)
}

#[tauri::command]
pub async fn ppob_get_data_price_list(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    provider_uid: String,
) -> Result<Vec<PulsaProduct>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client
        .post(
            "pulsa/get-data-price-list",
            json!({ "provider_uid": provider_uid }),
        )
        .await?;

    let products: Vec<PulsaProduct> = result["data_options"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(products)
}

#[tauri::command]
pub async fn ppob_get_pln_denom(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<PlnDenom>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client.post("pln/get-denom", json!({})).await?;

    let denoms: Vec<PlnDenom> = result["pln"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(denoms)
}

#[tauri::command]
pub async fn ppob_get_pdam_products(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<PdamProduct>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client.post("pdam/get-product", json!({})).await?;

    let products: Vec<PdamProduct> = result["list_product"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(products)
}

#[tauri::command]
pub async fn ppob_get_emoney_denom(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    product_id: i64,
) -> Result<Vec<EmoneyDenom>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client
        .post("emoney/get-denom", json!({ "product_id": product_id }))
        .await?;

    let denoms: Vec<EmoneyDenom> = result["emoney"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(denoms)
}

#[tauri::command]
pub async fn ppob_get_pp_sub_menu(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
    pp_id: i64,
) -> Result<Vec<PpSubMenuItem>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client
        .post("pp/get-sub-menu", json!({ "pp_id": pp_id }))
        .await?;

    let items: Vec<PpSubMenuItem> = result["sub_menu"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(items)
}

#[tauri::command]
pub async fn ppob_get_transfer_channels(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<TransferChannelGroup>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client.get("transfer-uang/channel-group").await?;

    let channels: Vec<TransferChannelGroup> = result["channelList"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(channels)
}

#[tauri::command]
pub async fn ppob_get_voucher_groups(
    db: State<'_, DatabaseConnection>,
    mitra: State<'_, Arc<Mutex<MitraClient>>>,
) -> Result<Vec<VoucherGroup>, AppError> {
    get_mitra_client(db.inner(), mitra.inner()).await?;

    let client = mitra.lock().await;
    let result = client.get("voucher-prepaid/get/group").await?;

    let groups: Vec<VoucherGroup> = result["group_list"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(groups)
}
