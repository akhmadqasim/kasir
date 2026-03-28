use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::super::settings::parse_app_settings;
use super::client::MitraClient;
use crate::entity::store_info;
use crate::utils::AppError;
use sea_orm::EntityTrait;

/// Save current tokens to database for persistence across restarts
pub async fn save_tokens(
    client: &MitraClient,
    db: &DatabaseConnection,
    phone: &str,
) -> Result<(), AppError> {
    let token = match &client.token {
        Some(t) => t,
        None => return Ok(()),
    };

    db.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "INSERT OR REPLACE INTO mitra_tokens (id, phone_number, access_token, refresh_token, device_id, updated_at)
         VALUES (1, $1, $2, $3, $4, datetime('now'))",
        vec![
            phone.into(),
            token.clone().into(),
            client.refresh_token.clone().unwrap_or_default().into(),
            client.device_id.clone().into(),
        ],
    ))
    .await
    .map_err(|e| AppError::Internal(format!("Gagal simpan token: {}", e)))?;

    Ok(())
}

/// Load tokens from database
pub async fn load_tokens(
    db: &DatabaseConnection,
) -> Result<Option<(String, Option<String>, String)>, AppError> {
    let result = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT access_token, refresh_token, device_id FROM mitra_tokens WHERE id = 1"
                .to_owned(),
        ))
        .await
        .map_err(|e| AppError::Internal(format!("Gagal baca token: {}", e)))?;

    if let Some(row) = result {
        let token: String = row
            .try_get_by_index(0)
            .map_err(|e| AppError::Internal(format!("Gagal parse token: {}", e)))?;
        let refresh: Option<String> = row
            .try_get_by_index::<String>(1)
            .ok()
            .filter(|s| !s.is_empty());
        let device_id: String = row
            .try_get_by_index(2)
            .map_err(|e| AppError::Internal(format!("Gagal parse device_id: {}", e)))?;
        Ok(Some((token, refresh, device_id)))
    } else {
        Ok(None)
    }
}

/// Ensure client is authenticated using 3-tier flow:
/// 1. Check in-memory token
/// 2. Try loading persisted token from database
/// 3. Full re-login from stored credentials
pub async fn get_mitra_client(
    db: &DatabaseConnection,
    client: &Arc<Mutex<MitraClient>>,
) -> Result<(), AppError> {
    let mut mitra = client.lock().await;

    // 1. Already authenticated in memory
    if mitra.is_authenticated() {
        return Ok(());
    }

    // 2. Try loading persisted token from database
    if let Some((token, refresh, device_id)) = load_tokens(db).await? {
        mitra.token = Some(token);
        mitra.refresh_token = refresh;
        mitra.device_id = device_id;

        // Validate token with a lightweight API call
        match mitra.get("menu-saldo").await {
            Ok(_) => {
                return Ok(());
            }
            Err(_) => {
                if mitra.try_refresh().await? {
                    let store = store_info::Entity::find_by_id(1_i64)
                        .one(db)
                        .await?
                        .ok_or_else(|| AppError::NotFound("Store info belum diatur".into()))?;
                    let settings = parse_app_settings(&store.additional_info);
                    save_tokens(&mitra, db, &settings.ppob.phone_number).await?;
                    return Ok(());
                }
                // Refresh failed, clear stale tokens
                mitra.token = None;
                mitra.refresh_token = None;

            }
        }
    }

    // 3. Full re-login from stored credentials
    let store = store_info::Entity::find_by_id(1_i64)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Informasi toko belum diatur".into()))?;

    let settings = parse_app_settings(&store.additional_info);

    if !settings.ppob.enabled || settings.ppob.phone_number.is_empty() {
        return Err(AppError::Validation(
            "PPOB belum dikonfigurasi. Atur di Pengaturan → PPOB".into(),
        ));
    }

    mitra
        .login(
            &settings.ppob.phone_number,
            &settings.ppob.password,
            &settings.ppob.device_id,
        )
        .await?;

    save_tokens(&mitra, db, &settings.ppob.phone_number).await?;

    Ok(())
}
