//! Server-side sessions and the cookie that names one.
//!
//! The whole point of this module is that a request never says who it is. It
//! presents an opaque token; the server looks the token up and decides. What the
//! client holds is a 256-bit random string with no structure, no user id and
//! nothing signed into it, so there is nothing in it to tamper with — the only
//! way to be someone is to hold a token the server minted for them.
//!
//! Only the SHA-256 hash of the token is stored. A stolen `kasir.db` therefore
//! yields no usable sessions, the same way it yields no usable PINs.

use chrono::{DateTime, Duration, Utc};
use cookie::{Cookie, SameSite};
use rand::RngCore;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use sha2::{Digest, Sha256};

use crate::domain::Actor;
use crate::entity::{sessions, users};
use crate::utils::AppError;

/// Name of the session cookie. Prefixed like the rest of the app so it cannot
/// collide with anything else served from the same host by a future nginx
/// location.
pub const COOKIE_NAME: &str = "kasir_session";

/// Bytes of entropy in a token. 32 bytes is 256 bits; guessing one is not a
/// threat model, which is why the token needs no other protection.
const TOKEN_BYTES: usize = 32;

/// How stale `last_seen_at` may get before a request writes it back.
///
/// Sliding expiry means every authenticated request could push the deadline
/// forward, but this is SQLite behind a one-connection pool: a write per request
/// would serialise reads behind session bookkeeping. Refreshing at most once a
/// minute keeps the sliding window accurate to within a minute, which is far
/// finer than the 30-minute default timeout it slides.
const TOUCH_INTERVAL_SECS: i64 = 60;

/// Bounds on the configured timeout. Zero would expire a session before the
/// login response reached the browser; an unbounded value would make "logged in"
/// permanent by accident.
const MIN_TIMEOUT_MINUTES: i64 = 1;
const MAX_TIMEOUT_MINUTES: i64 = 60 * 24 * 30;

/// The shape every timestamp column in this schema uses: UTC, second precision,
/// and lexicographically ordered the same way it is chronologically ordered.
pub fn format_ts(at: DateTime<Utc>) -> String {
    at.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// A freshly minted session: the raw token for the cookie, and how long the
/// cookie should live.
pub struct IssuedSession {
    pub token: String,
    pub max_age_secs: i64,
}

/// What a valid cookie resolves to.
///
/// Only the `Actor` comes out, not the whole account row. Handlers that need the
/// account fetch it through the service that owns it, which keeps the "is this
/// user still allowed to exist" question in one place instead of two.
pub struct ResolvedSession {
    pub actor: Actor,
    pub session_id: String,
    /// True when `last_seen_at` is older than [`TOUCH_INTERVAL_SECS`], i.e. this
    /// request should push the sliding deadline forward.
    pub needs_touch: bool,
}

/// 32 random bytes, hex encoded.
fn generate_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// The value stored in `sessions.id`.
pub fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn clamp_timeout(minutes: i64) -> i64 {
    minutes.clamp(MIN_TIMEOUT_MINUTES, MAX_TIMEOUT_MINUTES)
}

/// The configured idle timeout, in minutes, already clamped to something sane.
pub async fn timeout_minutes(db: &DatabaseConnection) -> Result<i64, AppError> {
    let settings = crate::services::settings::get_app_settings(db).await?;
    Ok(clamp_timeout(
        settings.security.session_timeout_minutes as i64,
    ))
}

/// Mint a session for `user_id` and return the raw token — the only moment it
/// exists outside the client.
pub async fn issue(
    db: &DatabaseConnection,
    user_id: i64,
    timeout_minutes: i64,
    user_agent: Option<String>,
    ip: Option<String>,
    now: DateTime<Utc>,
) -> Result<IssuedSession, AppError> {
    let timeout_minutes = clamp_timeout(timeout_minutes);
    let token = generate_token();
    let expires_at = now + Duration::minutes(timeout_minutes);

    sessions::ActiveModel {
        id: Set(token_hash(&token)),
        user_id: Set(user_id),
        created_at: Set(format_ts(now)),
        last_seen_at: Set(format_ts(now)),
        expires_at: Set(format_ts(expires_at)),
        // Truncated: these are attacker-controlled strings kept only to help an
        // admin recognise a session, and an unbounded header should not become
        // an unbounded row.
        user_agent: Set(user_agent.map(|ua| truncate(&ua, 255))),
        ip: Set(ip.map(|ip| truncate(&ip, 64))),
    }
    .insert(db)
    .await?;

    Ok(IssuedSession {
        token,
        max_age_secs: timeout_minutes * 60,
    })
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

/// Resolve a raw token to the account behind it.
///
/// Returns `None` for every way a token can fail — unknown, expired, revoked, or
/// belonging to an account that has since been deactivated — because the client
/// gets the same answer in all four cases and there is nothing it could usefully
/// do with the distinction. An expired row is deleted on the way past, so the
/// table does not accumulate them between sweeps.
pub async fn resolve(
    db: &DatabaseConnection,
    token: &str,
    now: DateTime<Utc>,
) -> Result<Option<ResolvedSession>, AppError> {
    let id = token_hash(token);

    let Some(session) = sessions::Entity::find_by_id(id.clone()).one(db).await? else {
        return Ok(None);
    };

    let now_ts = format_ts(now);
    if session.expires_at <= now_ts {
        sessions::Entity::delete_by_id(id).exec(db).await?;
        return Ok(None);
    }

    // A session outlives the account only until the next request. Deactivating a
    // user has to take effect immediately, which it cannot do if the check
    // happens anywhere but here.
    let Some(user) = users::Entity::find_by_id(session.user_id)
        .filter(users::Column::IsActive.eq(true))
        .one(db)
        .await?
    else {
        sessions::Entity::delete_by_id(id).exec(db).await?;
        return Ok(None);
    };

    let stale = seconds_since(&session.last_seen_at, now) >= TOUCH_INTERVAL_SECS;

    Ok(Some(ResolvedSession {
        actor: Actor::from(&user),
        session_id: session.id,
        needs_touch: stale,
    }))
}

/// Seconds between a stored timestamp and `now`. An unparsable timestamp counts
/// as infinitely old, which forces a refresh and repairs the row.
fn seconds_since(stored: &str, now: DateTime<Utc>) -> i64 {
    match chrono::NaiveDateTime::parse_from_str(stored, "%Y-%m-%d %H:%M:%S") {
        Ok(parsed) => (now.naive_utc() - parsed).num_seconds(),
        Err(_) => i64::MAX,
    }
}

/// Push the sliding deadline forward.
pub async fn touch(
    db: &DatabaseConnection,
    session_id: &str,
    timeout_minutes: i64,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    let timeout_minutes = clamp_timeout(timeout_minutes);
    let Some(session) = sessions::Entity::find_by_id(session_id.to_string())
        .one(db)
        .await?
    else {
        return Ok(());
    };

    let mut active: sessions::ActiveModel = session.into();
    active.last_seen_at = Set(format_ts(now));
    active.expires_at = Set(format_ts(now + Duration::minutes(timeout_minutes)));
    active.update(db).await?;
    Ok(())
}

/// Log out: the row is gone, so the cookie the browser still holds resolves to
/// nothing.
pub async fn revoke(db: &DatabaseConnection, session_id: &str) -> Result<(), AppError> {
    sessions::Entity::delete_by_id(session_id.to_string())
        .exec(db)
        .await?;
    Ok(())
}

/// Drop every session that is past its deadline.
pub async fn sweep_expired(db: &DatabaseConnection, now: DateTime<Utc>) -> Result<u64, AppError> {
    let result = sessions::Entity::delete_many()
        .filter(sessions::Column::ExpiresAt.lte(format_ts(now)))
        .exec(db)
        .await?;
    Ok(result.rows_affected)
}

/// `Set-Cookie` for a new session.
///
/// `HttpOnly` keeps the token out of `document.cookie`, so an XSS bug cannot
/// read it. `SameSite=Lax` stops a cross-site form post from carrying it, which
/// covers the navigational CSRF cases; the Origin check in
/// [`crate::http::middleware`] covers the rest. `Secure` is set only when the
/// request actually arrived over HTTPS — setting it on a plain-HTTP LAN would
/// make the browser drop the cookie and nobody could log in.
pub fn build_cookie(token: &str, secure: bool, max_age_secs: i64) -> String {
    Cookie::build((COOKIE_NAME, token.to_owned()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .max_age(cookie::time::Duration::seconds(max_age_secs))
        .build()
        .to_string()
}

/// `Set-Cookie` that removes the session cookie. The attributes must match the
/// ones it was set with or the browser keeps the original.
pub fn clear_cookie(secure: bool) -> String {
    Cookie::build((COOKIE_NAME, ""))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .max_age(cookie::time::Duration::seconds(0))
        .build()
        .to_string()
}

/// Pull the session token out of a `Cookie` header.
pub fn token_from_cookie_header(header: &str) -> Option<String> {
    Cookie::split_parse(header)
        .filter_map(|c| c.ok())
        .find(|c| c.name() == COOKIE_NAME)
        .map(|c| c.value().to_string())
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{insert_user, setup_test_db};
    use sea_orm::Set as SeaSet;

    #[test]
    fn a_token_is_256_bits_of_hex_and_never_repeats() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), TOKEN_BYTES * 2);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    /// What is written to the database must not be what the browser holds,
    /// otherwise a database file is a pile of live credentials.
    #[test]
    fn the_stored_id_is_the_hash_not_the_token() {
        let token = generate_token();
        let hash = token_hash(&token);
        assert_ne!(hash, token);
        assert_eq!(hash.len(), 64);
        assert_eq!(hash, token_hash(&token), "hashing is deterministic");
    }

    #[test]
    fn the_cookie_carries_the_attributes_that_make_it_safe() {
        let cookie = build_cookie("abc", false, 1800);
        assert!(cookie.starts_with("kasir_session=abc"));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
        assert!(cookie.contains("Path=/"));
        assert!(cookie.contains("Max-Age=1800"));
        assert!(
            !cookie.contains("Secure"),
            "a plain-HTTP LAN request must not get a cookie the browser will refuse to send back"
        );

        assert!(build_cookie("abc", true, 1800).contains("Secure"));
    }

    #[test]
    fn clearing_the_cookie_expires_it_on_the_same_path() {
        let cookie = clear_cookie(false);
        assert!(cookie.contains("Path=/"));
        assert!(cookie.contains("Max-Age=0"));
    }

    #[test]
    fn the_token_is_found_among_other_cookies() {
        assert_eq!(
            token_from_cookie_header("theme=dark; kasir_session=deadbeef; other=1"),
            Some("deadbeef".to_string())
        );
        assert_eq!(token_from_cookie_header("theme=dark"), None);
        assert_eq!(token_from_cookie_header("kasir_session="), None);
    }

    #[tokio::test]
    async fn a_fresh_token_resolves_to_its_user() {
        let db = setup_test_db().await;
        let kasir = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let now = Utc::now();

        let issued = issue(&db, kasir.id, 30, None, None, now)
            .await
            .expect("issue");
        let resolved = resolve(&db, &issued.token, now)
            .await
            .expect("resolve")
            .expect("session is live");

        assert_eq!(resolved.actor.user_id, kasir.id);
        assert_eq!(resolved.actor.role, "kasir");
        assert!(!resolved.needs_touch, "a session born now is not stale");
    }

    #[tokio::test]
    async fn an_unknown_token_resolves_to_nothing() {
        let db = setup_test_db().await;
        assert!(resolve(&db, "not-a-token", Utc::now())
            .await
            .expect("resolve")
            .is_none());
    }

    #[tokio::test]
    async fn an_expired_session_is_rejected_and_deleted() {
        let db = setup_test_db().await;
        let kasir = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let issued = issue(&db, kasir.id, 30, None, None, Utc::now())
            .await
            .expect("issue");

        let later = Utc::now() + Duration::minutes(31);
        assert!(resolve(&db, &issued.token, later)
            .await
            .expect("resolve")
            .is_none());

        assert!(
            sessions::Entity::find_by_id(token_hash(&issued.token))
                .one(&db)
                .await
                .expect("query")
                .is_none(),
            "the dead row is swept on the way past"
        );
    }

    #[tokio::test]
    async fn a_revoked_session_is_rejected() {
        let db = setup_test_db().await;
        let kasir = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let now = Utc::now();
        let issued = issue(&db, kasir.id, 30, None, None, now)
            .await
            .expect("issue");

        revoke(&db, &token_hash(&issued.token))
            .await
            .expect("revoke");

        assert!(resolve(&db, &issued.token, now)
            .await
            .expect("resolve")
            .is_none());
    }

    /// Disabling an account has to end its open sessions, not merely stop new
    /// logins — otherwise a dismissed cashier keeps working until the timeout.
    #[tokio::test]
    async fn a_session_belonging_to_a_deactivated_user_is_rejected() {
        let db = setup_test_db().await;
        let kasir = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let now = Utc::now();
        let issued = issue(&db, kasir.id, 30, None, None, now)
            .await
            .expect("issue");

        let mut deactivated: users::ActiveModel = kasir.into();
        deactivated.is_active = SeaSet(false);
        deactivated.update(&db).await.expect("deactivate");

        assert!(resolve(&db, &issued.token, now)
            .await
            .expect("resolve")
            .is_none());
    }

    #[tokio::test]
    async fn touching_a_session_slides_its_deadline_forward() {
        let db = setup_test_db().await;
        let kasir = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let now = Utc::now();
        let issued = issue(&db, kasir.id, 30, None, None, now)
            .await
            .expect("issue");
        let id = token_hash(&issued.token);

        let before = sessions::Entity::find_by_id(id.clone())
            .one(&db)
            .await
            .expect("query")
            .expect("row");

        let later = now + Duration::minutes(20);
        touch(&db, &id, 30, later).await.expect("touch");

        let after = sessions::Entity::find_by_id(id)
            .one(&db)
            .await
            .expect("query")
            .expect("row");

        assert!(after.expires_at > before.expires_at);
        // Still valid well past the original deadline.
        assert!(resolve(&db, &issued.token, now + Duration::minutes(45))
            .await
            .expect("resolve")
            .is_some());
    }

    #[tokio::test]
    async fn a_session_older_than_the_touch_interval_asks_to_be_refreshed() {
        let db = setup_test_db().await;
        let kasir = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let now = Utc::now();
        let issued = issue(&db, kasir.id, 30, None, None, now)
            .await
            .expect("issue");

        let soon = now + Duration::seconds(TOUCH_INTERVAL_SECS - 5);
        assert!(
            !resolve(&db, &issued.token, soon)
                .await
                .expect("resolve")
                .expect("live")
                .needs_touch
        );

        let later = now + Duration::seconds(TOUCH_INTERVAL_SECS + 5);
        assert!(
            resolve(&db, &issued.token, later)
                .await
                .expect("resolve")
                .expect("live")
                .needs_touch
        );
    }

    #[tokio::test]
    async fn the_sweep_removes_only_dead_sessions() {
        let db = setup_test_db().await;
        let kasir = insert_user(&db, "kasir1", "Kasir Satu", "kasir").await;
        let now = Utc::now();

        let short = issue(&db, kasir.id, 1, None, None, now)
            .await
            .expect("issue");
        let long = issue(&db, kasir.id, 600, None, None, now)
            .await
            .expect("issue");

        let removed = sweep_expired(&db, now + Duration::minutes(5))
            .await
            .expect("sweep");
        assert_eq!(removed, 1);

        assert!(resolve(&db, &short.token, now + Duration::minutes(5))
            .await
            .expect("resolve")
            .is_none());
        assert!(resolve(&db, &long.token, now + Duration::minutes(5))
            .await
            .expect("resolve")
            .is_some());
    }

    /// A configured timeout of zero would log everybody out instantly; a huge one
    /// would make sessions effectively permanent.
    #[test]
    fn the_configured_timeout_is_clamped_at_both_ends() {
        assert_eq!(clamp_timeout(0), MIN_TIMEOUT_MINUTES);
        assert_eq!(clamp_timeout(-5), MIN_TIMEOUT_MINUTES);
        assert_eq!(clamp_timeout(30), 30);
        assert_eq!(clamp_timeout(i64::MAX), MAX_TIMEOUT_MINUTES);
    }
}
