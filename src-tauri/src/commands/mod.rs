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
