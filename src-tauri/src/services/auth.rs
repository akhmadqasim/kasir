//! Login and user management.

use std::sync::OnceLock;

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
};
use uuid::Uuid;

use crate::domain::auth::{CreateUserInput, LoginInput, ToggleUserActiveInput, UpdateUserInput};
use crate::domain::Actor;
use crate::entity::users;
use crate::services::guard;
use crate::utils::AppError;

fn now_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// A PIN is 4 to 6 digits, nothing else.
pub fn validate_pin(pin: &str) -> Result<(), AppError> {
    if pin.len() < 4 || pin.len() > 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation(
            "PIN harus terdiri dari 4-6 digit angka".into(),
        ));
    }
    Ok(())
}

fn validate_role(role: &str) -> Result<(), AppError> {
    if role != "admin" && role != "kasir" {
        return Err(AppError::Validation(
            "Role harus 'admin' atau 'kasir'".into(),
        ));
    }
    Ok(())
}

/// A bcrypt hash of a value nobody can guess, at the same cost as every stored
/// PIN hash.
///
/// It exists so that a login for a username that does not exist performs the
/// same work as one that does. Hashed once per process and cached; see
/// [`warm_password_verifier`].
fn decoy_hash() -> &'static str {
    static DECOY: OnceLock<String> = OnceLock::new();
    DECOY.get_or_init(|| {
        bcrypt::hash(Uuid::new_v4().to_string(), bcrypt::DEFAULT_COST)
            .expect("bcrypt can always hash a constant")
    })
}

/// Compute the decoy hash ahead of time.
///
/// Called at startup so the first login attempt against an unknown username
/// pays for one bcrypt verify like every other attempt, rather than for a hash
/// *and* a verify — which would make that one request stand out.
pub fn warm_password_verifier() {
    let _ = decoy_hash();
}

/// Verify a username/PIN pair.
///
/// Both failure modes — no such (active) user, and wrong PIN — return the same
/// message *and* cost the same time. The message alone was not enough: an
/// unknown username used to return the moment the query came back, while a real
/// one paid for a bcrypt verify first. On a 4-6 digit PIN that difference is
/// hundreds of milliseconds, which is trivially measurable over a LAN and hands
/// an attacker the list of valid usernames before they start guessing. Verifying
/// against a decoy hash when there is no user removes the difference.
pub async fn login(db: &DatabaseConnection, input: LoginInput) -> Result<users::Model, AppError> {
    let user = users::Entity::find()
        .filter(users::Column::Username.eq(&input.username))
        .filter(users::Column::IsActive.eq(true))
        .one(db)
        .await?;

    let stored_hash = match &user {
        Some(user) => user.pin_hash.as_str(),
        None => decoy_hash(),
    };

    // A malformed stored hash is a wrong PIN as far as the caller is concerned.
    // Surfacing it as an error would both leak that the account exists and skip
    // the work that makes the two paths indistinguishable.
    let pin_valid = bcrypt::verify(&input.pin, stored_hash).unwrap_or_else(|e| {
        crate::utils::logging::log_error(&format!(
            "PIN hash for '{}' could not be verified: {e}",
            input.username
        ));
        false
    });

    match user {
        Some(user) if pin_valid => Ok(user),
        _ => Err(AppError::Auth("Username atau PIN tidak sesuai".to_string())),
    }
}

/// The account behind the actor, provided it is still active.
pub async fn get_current_user(
    db: &DatabaseConnection,
    actor: &Actor,
) -> Result<users::Model, AppError> {
    users::Entity::find_by_id(actor.user_id)
        .filter(users::Column::IsActive.eq(true))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".to_string()))
}

pub async fn list_users(
    db: &DatabaseConnection,
    actor: &Actor,
) -> Result<Vec<users::Model>, AppError> {
    guard::require_admin(actor)?;

    let users = users::Entity::find()
        .order_by_asc(users::Column::FullName)
        .all(db)
        .await?;
    Ok(users)
}

pub async fn create_user(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateUserInput,
) -> Result<users::Model, AppError> {
    guard::require_admin(actor)?;

    let username = input.username.trim().to_string();
    if username.is_empty() {
        return Err(AppError::Validation("Username tidak boleh kosong".into()));
    }

    let full_name = input.full_name.trim().to_string();
    if full_name.is_empty() {
        return Err(AppError::Validation(
            "Nama lengkap tidak boleh kosong".into(),
        ));
    }

    validate_role(&input.role)?;
    validate_pin(&input.pin)?;

    let existing = users::Entity::find()
        .filter(users::Column::Username.eq(&username))
        .one(db)
        .await?;

    if existing.is_some() {
        return Err(AppError::Validation("Username sudah digunakan".into()));
    }

    let pin_hash = bcrypt::hash(&input.pin, bcrypt::DEFAULT_COST)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let now = now_timestamp();
    let new_user = users::ActiveModel {
        id: sea_orm::NotSet,
        username: Set(username),
        pin_hash: Set(pin_hash),
        full_name: Set(full_name),
        role: Set(input.role),
        is_active: Set(true),
        created_at: Set(Some(now.clone())),
        updated_at: Set(Some(now)),
    };

    let created = new_user.insert(db).await?;
    Ok(created)
}

pub async fn update_user(
    db: &DatabaseConnection,
    actor: &Actor,
    input: UpdateUserInput,
) -> Result<users::Model, AppError> {
    guard::require_admin(actor)?;

    let user = users::Entity::find_by_id(input.user_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    let mut active: users::ActiveModel = user.into();

    if let Some(username) = &input.username {
        let username = username.trim().to_string();
        if username.is_empty() {
            return Err(AppError::Validation("Username tidak boleh kosong".into()));
        }
        // Uniqueness, excluding the row being edited.
        let existing = users::Entity::find()
            .filter(users::Column::Username.eq(&username))
            .filter(users::Column::Id.ne(input.user_id))
            .one(db)
            .await?;
        if existing.is_some() {
            return Err(AppError::Validation("Username sudah digunakan".into()));
        }
        active.username = Set(username);
    }

    if let Some(full_name) = &input.full_name {
        let full_name = full_name.trim().to_string();
        if full_name.is_empty() {
            return Err(AppError::Validation(
                "Nama lengkap tidak boleh kosong".into(),
            ));
        }
        active.full_name = Set(full_name);
    }

    if let Some(role) = &input.role {
        validate_role(role)?;
        active.role = Set(role.clone());
    }

    if let Some(new_pin) = &input.new_pin {
        validate_pin(new_pin)?;
        let pin_hash = bcrypt::hash(new_pin, bcrypt::DEFAULT_COST)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        active.pin_hash = Set(pin_hash);
    }

    active.updated_at = Set(Some(now_timestamp()));
    let updated = active.update(db).await?;
    Ok(updated)
}

/// Enable or disable an account. An admin may not lock themselves out.
pub async fn toggle_user_active(
    db: &DatabaseConnection,
    actor: &Actor,
    input: ToggleUserActiveInput,
) -> Result<users::Model, AppError> {
    guard::require_admin(actor)?;

    if input.user_id == actor.user_id && !input.is_active {
        return Err(AppError::Validation(
            "Tidak dapat menonaktifkan akun sendiri".into(),
        ));
    }

    let user = users::Entity::find_by_id(input.user_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    let mut active: users::ActiveModel = user.into();
    active.is_active = Set(input.is_active);
    active.updated_at = Set(Some(now_timestamp()));

    let updated = active.update(db).await?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::setup_test_db;
    use std::time::Instant;

    /// Insert a user whose PIN really is hashed, which the shared fixture does
    /// not do — it stores the literal string `"hash"`.
    async fn insert_user_with_pin(db: &DatabaseConnection, username: &str, pin: &str) {
        let now = now_timestamp();
        users::ActiveModel {
            id: sea_orm::NotSet,
            username: Set(username.to_string()),
            pin_hash: Set(bcrypt::hash(pin, bcrypt::DEFAULT_COST).expect("hash")),
            full_name: Set(username.to_string()),
            role: Set("kasir".to_string()),
            is_active: Set(true),
            created_at: Set(Some(now.clone())),
            updated_at: Set(Some(now)),
        }
        .insert(db)
        .await
        .expect("user insert");
    }

    #[tokio::test]
    async fn the_right_pin_returns_the_account() {
        let db = setup_test_db().await;
        insert_user_with_pin(&db, "kasir1", "1234").await;

        let user = login(
            &db,
            LoginInput {
                username: "kasir1".into(),
                pin: "1234".into(),
            },
        )
        .await
        .expect("login succeeds");
        assert_eq!(user.username, "kasir1");
    }

    /// The two ways to fail must be indistinguishable in what they say.
    #[tokio::test]
    async fn a_wrong_pin_and_an_unknown_user_give_the_same_answer() {
        let db = setup_test_db().await;
        insert_user_with_pin(&db, "kasir1", "1234").await;

        let wrong_pin = login(
            &db,
            LoginInput {
                username: "kasir1".into(),
                pin: "9999".into(),
            },
        )
        .await
        .expect_err("wrong pin is rejected");

        let unknown = login(
            &db,
            LoginInput {
                username: "tidak-ada".into(),
                pin: "9999".into(),
            },
        )
        .await
        .expect_err("unknown user is rejected");

        assert_eq!(wrong_pin.to_string(), unknown.to_string());
        assert!(matches!(wrong_pin, AppError::Auth(_)));
        assert!(matches!(unknown, AppError::Auth(_)));
    }

    /// ...and indistinguishable in what they cost.
    ///
    /// Before the decoy hash, an unknown username returned as soon as the query
    /// came back — microseconds — while a real one paid for a bcrypt verify.
    /// The ratio is deliberately loose so a loaded machine cannot make it
    /// flaky; the regression it guards against is three orders of magnitude,
    /// not a few percent.
    #[tokio::test]
    async fn an_unknown_username_costs_what_a_real_one_costs() {
        let db = setup_test_db().await;
        insert_user_with_pin(&db, "kasir1", "1234").await;
        warm_password_verifier();

        let started = Instant::now();
        let _ = login(
            &db,
            LoginInput {
                username: "kasir1".into(),
                pin: "9999".into(),
            },
        )
        .await;
        let real = started.elapsed();

        let started = Instant::now();
        let _ = login(
            &db,
            LoginInput {
                username: "tidak-ada".into(),
                pin: "9999".into(),
            },
        )
        .await;
        let decoy = started.elapsed();

        assert!(
            decoy * 4 >= real,
            "unknown username returned far too fast ({decoy:?} vs {real:?}) — the username list leaks through timing"
        );
    }

    /// A deactivated account is not a login, and must not be a distinguishable
    /// one either.
    #[tokio::test]
    async fn a_deactivated_account_cannot_log_in() {
        let db = setup_test_db().await;
        insert_user_with_pin(&db, "mantan", "1234").await;
        let user = users::Entity::find()
            .filter(users::Column::Username.eq("mantan"))
            .one(&db)
            .await
            .expect("query")
            .expect("row");
        let mut active: users::ActiveModel = user.into();
        active.is_active = Set(false);
        active.update(&db).await.expect("deactivate");

        let err = login(
            &db,
            LoginInput {
                username: "mantan".into(),
                pin: "1234".into(),
            },
        )
        .await
        .expect_err("deactivated accounts are refused");
        assert!(matches!(err, AppError::Auth(_)));
    }
}
