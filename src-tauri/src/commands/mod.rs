//! Tauri IPC handlers.
//!
//! Handlers are deliberately thin: unwrap the managed state, turn the
//! client-supplied caller id into an [`Actor`], call the matching service, hand
//! the result back. No SQL and no business rules live here, so replacing this
//! layer with HTTP routes moves no logic.

pub mod auth;
pub mod backup;
pub mod categories;
pub mod dashboard;
pub mod logging;
pub mod onboarding;
pub mod ppob;
pub mod products;
pub mod receipt;
pub mod refunds;
pub mod reports;
pub mod settings;
pub mod shifts;
pub mod stock;
pub mod transactions;

use sea_orm::DatabaseConnection;

use crate::domain::Actor;
use crate::utils::{require_role, AppError};

/// Turn the caller id the webview sent into an [`Actor`].
///
/// This is the single place a client-supplied identity becomes an `Actor`, and
/// it checks exactly what the handlers used to check inline: the user exists and
/// is active. What that identity may then *do* is decided by the service. When
/// server-side sessions land, this function is replaced by a session lookup and
/// nothing downstream changes.
pub(crate) async fn resolve_actor(
    db: &DatabaseConnection,
    caller_id: i64,
) -> Result<Actor, AppError> {
    let user = require_role(db, caller_id, "any").await?;
    Ok(Actor::from(user))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{insert_user, setup_test_db};
    use sea_orm::{ActiveModelTrait, Set};

    /// The resolved actor carries the role the database holds, not anything the
    /// caller claimed, so every `guard::require_*` downstream decides on the
    /// stored value.
    #[tokio::test]
    async fn the_resolved_actor_carries_the_stored_role() {
        let conn = setup_test_db().await;
        let kasir = insert_user(&conn, "kasir1", "Kasir Satu", "kasir").await;

        let actor = resolve_actor(&conn, kasir.id).await.expect("resolves");
        assert_eq!(actor.user_id, kasir.id);
        assert_eq!(actor.role, "kasir");
        assert!(!actor.is_admin());
    }

    /// A deactivated account never becomes an actor, so nothing downstream —
    /// voiding a sale, changing a payment method, editing settings — can be
    /// reached with one. This check used to sit inside each of those handlers.
    #[tokio::test]
    async fn a_deactivated_admin_is_never_resolved() {
        let conn = setup_test_db().await;
        let ghost = insert_user(&conn, "mantan", "Mantan Admin", "admin").await;
        let mut deactivated: crate::entity::users::ActiveModel = ghost.clone().into();
        deactivated.is_active = Set(false);
        deactivated.update(&conn).await.expect("deactivate user");

        match resolve_actor(&conn, ghost.id).await {
            Err(AppError::Auth(_)) => {}
            other => panic!("expected Auth error, got {:?}", other.map(|a| a.role)),
        }
    }

    #[tokio::test]
    async fn an_unknown_caller_is_never_resolved() {
        let conn = setup_test_db().await;
        match resolve_actor(&conn, 9_999).await {
            Err(AppError::Auth(_)) => {}
            other => panic!("expected Auth error, got {:?}", other.map(|a| a.role)),
        }
    }
}
