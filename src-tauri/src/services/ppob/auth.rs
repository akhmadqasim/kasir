//! The Mitra session: restoring it from `mitra_tokens` across restarts,
//! refreshing it, and logging in again when neither works.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::domain::settings::parse_app_settings;
use crate::services::ppob::client::{is_transport_failure, MitraClient, MitraRequestContext};
use crate::services::settings::require_store_info;
use crate::utils::AppError;

pub struct MitraSessionContext {
    pub request: MitraRequestContext,
    pub menu_saldo_payload: Option<Value>,
}

/// The session saved by the last login or refresh, and who it belongs to.
struct StoredTokens {
    phone_number: String,
    access_token: String,
    refresh_token: Option<String>,
    device_id: String,
}

/// Save current tokens to database for persistence across restarts
async fn save_tokens(
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
async fn load_tokens(db: &DatabaseConnection) -> Result<Option<StoredTokens>, AppError> {
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
        Ok(Some(StoredTokens {
            phone_number,
            access_token: token,
            refresh_token: refresh,
            device_id,
        }))
    } else {
        Ok(None)
    }
}

/// Forget the upstream session — and with it everything remembered from
/// it, so a struk from the previous account cannot be printed from the cache,
/// a search cannot answer from the previous account's payment points, and
/// the inbox cannot list its messages, after the shop switches accounts.
///
/// The caches are forgotten once the row is gone, whether or not deleting it
/// worked: a rebuild that starts before that point may still read the old
/// session, and forgetting last turns it away too.
pub async fn clear_tokens(db: &DatabaseConnection) -> Result<(), AppError> {
    let deleted = db
        .execute(Statement::from_string(
            DbBackend::Sqlite,
            "DELETE FROM mitra_tokens WHERE id = 1".to_string(),
        ))
        .await;
    super::history::forget_details();
    super::search::forget_index();
    super::notifications::forget_cache();
    deleted.map_err(|e| AppError::Internal(format!("Gagal menghapus token Mitra: {}", e)))?;

    Ok(())
}

/// End the Mitra session for good, because the credentials it was opened
/// with no longer apply: the in-memory token, the saved row, and every cache
/// read from it.
///
/// The order matters. The token goes first and the caches last, all under the
/// client lock. A cache rebuild takes its [`Ticket`] before it asks for a
/// session and needs this lock to get one, so a rebuild that took its ticket
/// before the forget is turned away when it stores, and one that took it
/// after finds neither a token nor a saved row and logs in with the new
/// credentials. Forgetting the caches first left a window in which a rebuild
/// took a fresh ticket, was handed the previous account's still-installed
/// token, and stored that account's data for the next one.
///
/// [`Ticket`]: super::session_cache::Ticket
pub async fn end_session(
    db: &DatabaseConnection,
    client: &Arc<Mutex<MitraClient>>,
) -> Result<(), AppError> {
    let mut mitra = client.lock().await;
    mitra.clear_auth();
    clear_tokens(db).await
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
        let mut mitra = client.lock().await;
        if mitra.token_was_rejected() {
            // Mitra turned this token away mid-session. Drop it, so the path
            // below refreshes it or logs in again instead of handing it out
            // until the app restarts.
            mitra.clear_auth();
        } else if mitra.is_authenticated() {
            return Ok(MitraSessionContext {
                request: mitra.request_context()?,
                menu_saldo_payload: None,
            });
        }
    }

    let settings = parse_app_settings(&require_store_info(db).await?.additional_info);

    if !settings.ppob.enabled || settings.ppob.phone_number.is_empty() {
        return Err(AppError::Validation(
            "PPOB belum dikonfigurasi. Admin dapat mengaturnya di Mitra Indogrosir → Pengaturan"
                .into(),
        ));
    }

    if let Some(stored) = load_tokens(db).await? {
        if stored.phone_number == settings.ppob.phone_number
            && stored.device_id == settings.ppob.device_id
        {
            let request = {
                let mut mitra = client.lock().await;
                if mitra.is_authenticated() && !mitra.token_was_rejected() {
                    return Ok(MitraSessionContext {
                        request: mitra.request_context()?,
                        menu_saldo_payload: None,
                    });
                }

                mitra.token = Some(stored.access_token);
                mitra.refresh_token = stored.refresh_token;
                mitra.device_id = stored.device_id;
                mitra.request_context()?
            };

            match request.post("get-menu-saldo", json!({})).await {
                Ok(payload) => {
                    return Ok(MitraSessionContext {
                        request,
                        menu_saldo_payload: Some(payload),
                    });
                }
                // No answer from Mitra says nothing about the token. Keep the
                // saved tokens and let the caller retry once the network is
                // back, instead of refreshing (which would fail the same way)
                // and then deleting a session that may be perfectly good.
                Err(e) if is_transport_failure(&e) => return Err(e),
                Err(_) => {
                    let refreshed_request = {
                        let mut mitra = client.lock().await;
                        match mitra.try_refresh().await {
                            Ok(true) => {
                                save_tokens(&mitra, db, &settings.ppob.phone_number).await?;
                                Some(mitra.request_context()?)
                            }
                            Ok(false) => {
                                mitra.clear_auth();
                                None
                            }
                            Err(e) => {
                                // The restored token already failed; it must
                                // not stay installed for the next caller.
                                mitra.clear_auth();
                                return Err(e);
                            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::setup_test_db;

    /// Resetting the session for new credentials must take the client lock
    /// before it forgets anything: a cache rebuild needs that lock to get a
    /// session, so none can be handed the previous account's token between
    /// the forget and the token being dropped.
    #[tokio::test]
    async fn ending_the_session_drops_the_token_before_forgetting_the_caches() {
        let db = setup_test_db().await;
        let client = Arc::new(Mutex::new(MitraClient::new()));
        {
            let mut mitra = client.lock().await;
            mitra.token = Some("token-akun-lama".into());
            mitra.device_id = "device-lama".into();
            save_tokens(&mitra, &db, "081200000001")
                .await
                .expect("save");
        }
        let in_flight = super::super::history::details_ticket();

        // A rebuild holds the lock while it is being handed a session.
        let rebuild = client.lock().await;
        let reset = tokio::spawn({
            let db = db.clone();
            let client = Arc::clone(&client);
            async move { end_session(&db, &client).await }
        });
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert!(
            load_tokens(&db).await.expect("load").is_some(),
            "nothing may be deleted or forgotten before the token is dropped"
        );
        drop(rebuild);

        reset.await.expect("join").expect("end session");
        assert!(!client.lock().await.is_authenticated());
        assert!(load_tokens(&db).await.expect("load").is_none());
        assert_ne!(super::super::history::details_ticket(), in_flight);
    }
}
