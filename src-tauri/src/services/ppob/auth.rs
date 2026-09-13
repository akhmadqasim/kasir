use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::domain::settings::parse_app_settings;
use crate::entity::store_info;
use crate::services::ppob::client::{MitraClient, MitraRequestContext};
use crate::utils::AppError;
use sea_orm::EntityTrait;

pub struct MitraSessionContext {
    pub request: MitraRequestContext,
    pub menu_saldo_payload: Option<Value>,
}

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
) -> Result<Option<(String, String, Option<String>, String)>, AppError> {
    let result = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT phone_number, access_token, refresh_token, device_id FROM mitra_tokens WHERE id = 1"
                .to_owned(),
        ))
        .await
        .map_err(|e| AppError::Internal(format!("Gagal baca token: {}", e)))?;

    if let Some(row) = result {
        let phone_number: String = row
            .try_get_by_index(0)
            .map_err(|e| AppError::Internal(format!("Gagal parse phone_number: {}", e)))?;
        let token: String = row
            .try_get_by_index(1)
            .map_err(|e| AppError::Internal(format!("Gagal parse token: {}", e)))?;
        let refresh: Option<String> = row
            .try_get_by_index::<String>(2)
            .ok()
            .filter(|s| !s.is_empty());
        let device_id: String = row
            .try_get_by_index(3)
            .map_err(|e| AppError::Internal(format!("Gagal parse device_id: {}", e)))?;
        Ok(Some((phone_number, token, refresh, device_id)))
    } else {
        Ok(None)
    }
}

/// Forget the upstream session — and with it everything remembered from
/// it, so a struk from the previous account cannot be printed from the cache
/// after the shop switches accounts.
pub async fn clear_tokens(db: &DatabaseConnection) -> Result<(), AppError> {
    super::history::forget_details();
    db.execute(Statement::from_string(
        DbBackend::Sqlite,
        "DELETE FROM mitra_tokens WHERE id = 1".to_string(),
    ))
    .await
    .map_err(|e| AppError::Internal(format!("Gagal menghapus token Mitra: {}", e)))?;

    Ok(())
}

pub async fn get_mitra_request_context(
    db: &DatabaseConnection,
    client: &Arc<Mutex<MitraClient>>,
) -> Result<MitraRequestContext, AppError> {
    Ok(get_mitra_session_context(db, client).await?.request)
}

pub async fn get_mitra_session_context(
    db: &DatabaseConnection,
    client: &Arc<Mutex<MitraClient>>,
) -> Result<MitraSessionContext, AppError> {
    {
        let mitra = client.lock().await;
        if mitra.is_authenticated() {
            return Ok(MitraSessionContext {
                request: mitra.request_context()?,
                menu_saldo_payload: None,
            });
        }
    }

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

    if let Some((phone_number, token, refresh, device_id)) = load_tokens(db).await? {
        if phone_number == settings.ppob.phone_number && device_id == settings.ppob.device_id {
            let request = {
                let mut mitra = client.lock().await;
                if mitra.is_authenticated() {
                    return Ok(MitraSessionContext {
                        request: mitra.request_context()?,
                        menu_saldo_payload: None,
                    });
                }

                mitra.token = Some(token);
                mitra.refresh_token = refresh;
                mitra.device_id = device_id;
                mitra.request_context()?
            };

            match request.post("get-menu-saldo", json!({})).await {
                Ok(payload) => {
                    return Ok(MitraSessionContext {
                        request,
                        menu_saldo_payload: Some(payload),
                    });
                }
                Err(_) => {
                    let refreshed_request = {
                        let mut mitra = client.lock().await;
                        if mitra.try_refresh().await? {
                            save_tokens(&mitra, db, &settings.ppob.phone_number).await?;
                            Some(mitra.request_context()?)
                        } else {
                            mitra.clear_auth();
                            None
                        }
                    };

                    if let Some(request) = refreshed_request {
                        return Ok(MitraSessionContext {
                            request,
                            menu_saldo_payload: None,
                        });
                    }

                    clear_tokens(db).await?;
                }
            }
        } else {
            clear_tokens(db).await?;
        }
    }

    let request = {
        let mut mitra = client.lock().await;
        mitra
            .login(
                &settings.ppob.phone_number,
                &settings.ppob.password,
                &settings.ppob.device_id,
            )
            .await?;

        save_tokens(&mitra, db, &settings.ppob.phone_number).await?;
        mitra.request_context()?
    };

    Ok(MitraSessionContext {
        request,
        menu_saldo_payload: None,
    })
}
