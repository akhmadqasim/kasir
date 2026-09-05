//! Role rules, expressed against an [`Actor`] instead of a database lookup.
//!
//! Resolving an identity is the transport layer's job; deciding what that
//! identity is allowed to do is a business rule and lives here. The messages
//! match [`crate::utils::require_role`] exactly, because that is what these
//! checks replaced.

use crate::domain::Actor;
use crate::utils::AppError;

/// Reject an actor that does not hold `required_role`.
pub fn require_role(actor: &Actor, required_role: &str) -> Result<(), AppError> {
    if actor.role != required_role {
        return Err(AppError::Forbidden(format!(
            "Akses ditolak. Hanya {} yang boleh mengakses fitur ini.",
            required_role
        )));
    }
    Ok(())
}

/// Reject an actor that is not an admin.
pub fn require_admin(actor: &Actor) -> Result<(), AppError> {
    require_role(actor, "admin")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_passes_the_admin_guard() {
        assert!(require_admin(&Actor::new(1, "admin")).is_ok());
    }

    #[test]
    fn kasir_is_forbidden_with_the_message_the_ui_expects() {
        let err = require_admin(&Actor::new(2, "kasir")).unwrap_err();
        match err {
            AppError::Forbidden(msg) => {
                assert_eq!(
                    msg,
                    "Akses ditolak. Hanya admin yang boleh mengakses fitur ini."
                );
            }
            other => panic!("expected Forbidden, got {:?}", other),
        }
    }

    /// An actor with no role — what the Tauri layer's unverified constructor
    /// produces for a caller id it did not check — passes nothing.
    ///
    /// Written as `Actor::new(id, "")` rather than through that constructor on
    /// purpose. Grepping the tree for that constructor's name and finding it
    /// only under `commands/` is the standing check that no other layer has
    /// started inventing identities, and a test calling it would be the
    /// exception that makes the grep useless.
    #[test]
    fn an_actor_with_no_role_fails_closed() {
        let roleless = Actor::new(1, "");
        assert!(require_admin(&roleless).is_err());
        assert!(require_role(&roleless, "kasir").is_err());
        assert!(!roleless.is_admin());
    }
}
