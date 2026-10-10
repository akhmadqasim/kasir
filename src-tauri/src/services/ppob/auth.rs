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

/// Whether getting a session may fall back to a full password login.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginPolicy {
    /// A person is waiting on the answer: log in with the stored password when
    /// no saved session works.
    AllowPasswordLogin,
    /// Background work: use the session in memory, the saved tokens, or a
    /// token refresh — never the password. A password login every few minutes
    /// with wrong credentials can get the Mitra account locked, and it holds
    /// the client lock for up to the request timeout, blocking the cashier.
    StoredSessionOnly,
}

/// What [`LoginPolicy::StoredSessionOnly`] answers when only a password login
/// would have helped.
pub const NO_STORED_SESSION: &str =
    "Belum ada sesi Mitra tersimpan. Cek otomatis menunggu login dari halaman PPOB.";

/// Whether background work could get a Mitra session without the password:
/// PPOB is switched on with credentials, and there is a session in memory
/// Mitra has not turned away, or one saved for those same credentials (which
/// may still need a token refresh). The reconciler skips its run otherwise,
/// rather than fail the same way every time.
pub async fn has_reusable_session(
    db: &DatabaseConnection,
    client: &Arc<Mutex<MitraClient>>,
) -> Result<bool, AppError> {
    let settings = parse_app_settings(&require_store_info(db).await?.additional_info);
    if !settings.ppob.enabled
        || settings.ppob.phone_number.is_empty()
        || settings.ppob.password.is_empty()
    {
        return Ok(false);
    }
    {
        let mitra = client.lock().await;
        if mitra.is_authenticated() && !mitra.token_was_rejected() {
            return Ok(true);
        }
    }
    Ok(load_tokens(db).await?.is_some_and(|stored| {
        stored.phone_number == settings.ppob.phone_number
            && stored.device_id == settings.ppob.device_id
    }))
}

pub async fn get_mitra_request_context(
    db: &DatabaseConnection,
    client: &Arc<Mutex<MitraClient>>,
) -> Result<MitraRequestContext, AppError> {
    Ok(get_mitra_session_context(db, client).await?.request)
}

/// [`get_mitra_request_context`] under an explicit [`LoginPolicy`].
pub async fn get_mitra_request_context_with(
    db: &DatabaseConnection,
    client: &Arc<Mutex<MitraClient>>,
    policy: LoginPolicy,
) -> Result<MitraRequestContext, AppError> {
    Ok(session_context(db, client, policy).await?.request)
}

pub async fn get_mitra_session_context(
    db: &DatabaseConnection,
    client: &Arc<Mutex<MitraClient>>,
) -> Result<MitraSessionContext, AppError> {
    session_context(db, client, LoginPolicy::AllowPasswordLogin).await
}

/// The Mitra account the settings name right now; `None` when PPOB is off.
struct Account {
    phone_number: String,
    password: String,
    device_id: String,
}

async fn configured_account(db: &DatabaseConnection) -> Result<Option<Account>, AppError> {
    let ppob = parse_app_settings(&require_store_info(db).await?.additional_info).ppob;
    Ok(
        (ppob.enabled && !ppob.phone_number.is_empty()).then_some(Account {
            phone_number: ppob.phone_number,
            password: ppob.password,
            device_id: ppob.device_id,
        }),
    )
}

fn not_configured() -> AppError {
    AppError::Validation(
        "PPOB belum dikonfigurasi. Admin dapat mengaturnya di Mitra Indogrosir → Pengaturan".into(),
    )
}

impl StoredTokens {
    fn belongs_to(&self, account: &Account) -> bool {
        self.phone_number == account.phone_number && self.device_id == account.device_id
    }
}

/// Whether the client's session was opened for `account`.
fn opened_for(mitra: &MitraClient, account: &Account) -> bool {
    mitra.phone_number == account.phone_number && mitra.device_id == account.device_id
}

/// The session in memory, if it is live and was opened for `account`.
fn live_session(
    mitra: &MitraClient,
    account: &Account,
) -> Result<Option<MitraRequestContext>, AppError> {
    if mitra.is_authenticated() && !mitra.token_was_rejected() && opened_for(mitra, account) {
        return mitra.request_context().map(Some);
    }
    Ok(None)
}

fn context(request: MitraRequestContext) -> MitraSessionContext {
    MitraSessionContext {
        request,
        menu_saldo_payload: None,
    }
}

/// Every token is checked against the settings read *under the client lock*
/// before it is installed or handed out. `update_app_settings` saves the new
/// settings and only then takes this lock in [`end_session`], so a check made
/// under the lock either sees the new settings or runs before the clear.
async fn session_context(
    db: &DatabaseConnection,
    client: &Arc<Mutex<MitraClient>>,
    policy: LoginPolicy,
) -> Result<MitraSessionContext, AppError> {
    {
        let mut mitra = client.lock().await;
        if mitra.token_was_rejected() {
            // Mitra turned this token away mid-session. Drop it, so the path
            // below refreshes it or logs in again instead of handing it out
            // until the app restarts.
            mitra.clear_auth();
        } else if mitra.is_authenticated() {
            if let Some(account) = configured_account(db).await? {
                if let Some(request) = live_session(&mitra, &account)? {
                    return Ok(context(request));
                }
            }
            // PPOB was switched off or the account changed: drop the token.
            mitra.clear_auth();
        }
    }

    let account = configured_account(db).await?.ok_or_else(not_configured)?;

    if let Some(stored) = load_tokens(db).await? {
        if stored.belongs_to(&account) {
            let restored = {
                let mut mitra = client.lock().await;
                let account = configured_account(db).await?.ok_or_else(not_configured)?;
                if let Some(request) = live_session(&mitra, &account)? {
                    return Ok(context(request));
                }
                // Re-read under the lock: `end_session` may have deleted the
                // row since the read above.
                match load_tokens(db).await? {
                    Some(stored) if stored.belongs_to(&account) => {
                        mitra.token = Some(stored.access_token.clone());
                        mitra.refresh_token = stored.refresh_token;
                        mitra.device_id = stored.device_id;
                        mitra.phone_number = stored.phone_number;
                        Some((mitra.request_context()?, stored.access_token))
                    }
                    _ => None,
                }
            };

            if let Some((request, installed)) = restored {
                match request.post("get-menu-saldo", json!({})).await {
                    Ok(payload) => {
                        return Ok(MitraSessionContext {
                            request,
                            menu_saldo_payload: Some(payload),
                        });
                    }
                    // No answer from Mitra says nothing about the token. Keep
                    // the saved tokens and let the caller retry once the
                    // network is back, instead of refreshing (which would fail
                    // the same way) and then deleting a session that may be
                    // perfectly good.
                    Err(e) if is_transport_failure(&e) => return Err(e),
                    Err(_) => {
                        let refreshed_request = {
                            let mut mitra = client.lock().await;
                            // Only refresh the token installed above, and only
                            // while the settings still name its account.
                            let account = configured_account(db).await?.filter(|account| {
                                mitra.token.as_deref() == Some(installed.as_str())
                                    && opened_for(&mitra, account)
                            });
                            match account {
                                Some(account) => match mitra.try_refresh().await {
                                    Ok(true) => {
                                        save_tokens(&mitra, db, &account.phone_number).await?;
                                        Some(mitra.request_context()?)
                                    }
                                    Ok(false) => {
                                        mitra.clear_auth();
                                        None
                                    }
                                    Err(e) => {
                                        // The restored token already failed;
                                        // it must not stay installed for the
                                        // next caller.
                                        mitra.clear_auth();
                                        return Err(e);
                                    }
                                },
                                // Ended or replaced meanwhile; the login step
                                // below re-checks the settings.
                                None => None,
                            }
                        };

                        if let Some(request) = refreshed_request {
                            return Ok(context(request));
                        }

                        clear_tokens(db).await?;
                    }
                }
            }
        } else {
            clear_tokens(db).await?;
        }
    }

    if policy == LoginPolicy::StoredSessionOnly {
        return Err(AppError::Validation(NO_STORED_SESSION.into()));
    }

    let request = {
        let mut mitra = client.lock().await;
        // The credentials as saved now, not as read before the lock.
        let account = configured_account(db).await?.ok_or_else(not_configured)?;
        if let Some(request) = live_session(&mitra, &account)? {
            return Ok(context(request));
        }
        mitra
            .login(&account.phone_number, &account.password, &account.device_id)
            .await?;

        save_tokens(&mitra, db, &account.phone_number).await?;
        mitra.request_context()?
    };

    Ok(context(request))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::setup_test_db;

    /// PPOB switched on with credentials, as the settings page saves them.
    async fn configure_ppob(db: &DatabaseConnection) {
        use crate::domain::settings::obfuscate;
        use crate::entity::store_info;
        use sea_orm::{ActiveModelTrait, Set};
        store_info::ActiveModel {
            id: Set(1),
            name: Set("Toko Test".into()),
            address: Set(None),
            phone: Set(None),
            email: Set(None),
            logo_path: Set(None),
            additional_info: Set(Some(
                json!({
                    "ppob": {
                        "enabled": true,
                        "phone_number": "081200000001",
                        "password": obfuscate("salah"),
                        "device_id": "device-1"
                    }
                })
                .to_string(),
            )),
            created_at: Set(None),
            updated_at: Set(None),
        }
        .insert(db)
        .await
        .expect("store info");
    }

    /// With no session in memory and none saved, background work gets an
    /// error instead of a password login — the login is never attempted, so
    /// no request leaves the machine and the client lock is never held for it.
    #[tokio::test]
    async fn background_work_never_falls_back_to_a_password_login() {
        let db = setup_test_db().await;
        configure_ppob(&db).await;
        let client = Arc::new(Mutex::new(MitraClient::new()));

        let result =
            get_mitra_request_context_with(&db, &client, LoginPolicy::StoredSessionOnly).await;

        assert!(
            matches!(&result, Err(AppError::Validation(message)) if message == NO_STORED_SESSION),
            "{:?}",
            result.err()
        );
        assert!(!client.lock().await.is_authenticated());
    }

    #[tokio::test]
    async fn a_reusable_session_needs_ppob_on_and_a_saved_or_live_token() {
        let db = setup_test_db().await;
        let client = Arc::new(Mutex::new(MitraClient::new()));
        // No store row yet: not configured.
        assert!(has_reusable_session(&db, &client).await.is_err());

        configure_ppob(&db).await;
        assert!(!has_reusable_session(&db, &client).await.unwrap());

        // Saved for another device: not reusable.
        {
            let mut mitra = client.lock().await;
            mitra.token = Some("t".into());
            mitra.device_id = "device-lain".into();
            save_tokens(&mitra, &db, "081200000001").await.unwrap();
            mitra.clear_auth();
        }
        assert!(!has_reusable_session(&db, &client).await.unwrap());

        {
            let mut mitra = client.lock().await;
            mitra.token = Some("t".into());
            mitra.device_id = "device-1".into();
            save_tokens(&mitra, &db, "081200000001").await.unwrap();
            mitra.clear_auth();
        }
        assert!(has_reusable_session(&db, &client).await.unwrap());
    }

    /// A session already in memory is used as it is, under either policy.
    #[tokio::test]
    async fn background_work_uses_the_session_in_memory() {
        let db = setup_test_db().await;
        configure_ppob(&db).await;
        let client = Arc::new(Mutex::new(MitraClient::new()));
        {
            let mut mitra = client.lock().await;
            mitra.token = Some("token".into());
            mitra.device_id = "device-1".into();
            mitra.phone_number = "081200000001".into();
        }

        assert!(
            get_mitra_request_context_with(&db, &client, LoginPolicy::StoredSessionOnly)
                .await
                .is_ok()
        );
    }

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

    /// Rewrite the PPOB settings, as `update_app_settings` does.
    async fn set_ppob(db: &DatabaseConnection, enabled: bool, phone: &str) {
        db.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE store_info SET additional_info = $1 WHERE id = 1",
            vec![json!({
                "ppob": {
                    "enabled": enabled,
                    "phone_number": phone,
                    "password": crate::domain::settings::obfuscate("salah"),
                    "device_id": "device-1"
                }
            })
            .to_string()
            .into()],
        ))
        .await
        .expect("settings");
    }

    /// A token already in memory is only handed out while the settings still
    /// have PPOB on and name the account it was opened for.
    #[tokio::test]
    async fn the_session_in_memory_is_dropped_once_ppob_is_off_or_the_account_changes() {
        let db = setup_test_db().await;
        configure_ppob(&db).await;
        let client = Arc::new(Mutex::new(MitraClient::new()));
        let install = || {
            let client = Arc::clone(&client);
            async move {
                let mut mitra = client.lock().await;
                mitra.token = Some("token-akun-lama".into());
                mitra.device_id = "device-1".into();
                mitra.phone_number = "081200000001".into();
            }
        };

        install().await;
        set_ppob(&db, false, "081200000001").await;
        let off =
            get_mitra_request_context_with(&db, &client, LoginPolicy::StoredSessionOnly).await;
        assert!(
            matches!(off, Err(AppError::Validation(_))),
            "{:?}",
            off.err()
        );
        assert!(!client.lock().await.is_authenticated());

        install().await;
        set_ppob(&db, true, "081299999999").await;
        let other =
            get_mitra_request_context_with(&db, &client, LoginPolicy::StoredSessionOnly).await;
        assert!(
            matches!(&other, Err(AppError::Validation(m)) if m == NO_STORED_SESSION),
            "{:?}",
            other.err()
        );
        assert!(!client.lock().await.is_authenticated());
    }

    /// The audit's race: a lookup reads the settings and the saved row, then
    /// waits for the client lock while an admin switches PPOB off and the
    /// session is ended. Once it gets the lock it must not install the old
    /// token (no request leaves the machine either way).
    #[tokio::test]
    async fn a_lookup_queued_behind_end_session_does_not_restore_the_old_token() {
        let db = setup_test_db().await;
        configure_ppob(&db).await;
        let client = Arc::new(Mutex::new(MitraClient::new()));
        {
            let mut mitra = client.lock().await;
            mitra.token = Some("token-akun-lama".into());
            mitra.device_id = "device-1".into();
            save_tokens(&mitra, &db, "081200000001")
                .await
                .expect("save");
            mitra.clear_auth();
        }

        // Hold the lock so the lookup queues at its first lock, then take it
        // back as soon as the lookup has passed it: it then reads the
        // settings and the saved row, and queues at the restore lock.
        let held = client.lock().await;
        let lookup = tokio::spawn({
            let db = db.clone();
            let client = Arc::clone(&client);
            async move {
                get_mitra_request_context_with(&db, &client, LoginPolicy::StoredSessionOnly).await
            }
        });
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        drop(held);
        let held = client.lock().await;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // What `update_app_settings` + `end_session` do, while the lookup waits.
        set_ppob(&db, false, "081200000001").await;
        clear_tokens(&db).await.expect("clear");
        drop(held);

        let result = lookup.await.expect("join");
        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "{:?}",
            result.err()
        );
        assert!(!client.lock().await.is_authenticated());
    }
}
