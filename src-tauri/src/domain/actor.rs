//! Who a service call is made on behalf of.

use crate::entity::users;

/// The identity a service acts for.
///
/// Services never read an identity out of a request body — they take an `Actor`
/// as an explicit first-class parameter. Producing one is the transport layer's
/// job: today the Tauri command layer resolves the client-supplied caller id
/// through [`crate::utils::require_role`], and once server-side sessions land it
/// comes from the session instead. Because no service accepts a bare id, there
/// is no path left that can be pointed at a client-controlled identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Actor {
    pub user_id: i64,
    pub role: String,
}

impl Actor {
    pub fn new(user_id: i64, role: impl Into<String>) -> Self {
        Self {
            user_id,
            role: role.into(),
        }
    }

    /// An identity supplied by the client that the caller deliberately did not
    /// verify.
    ///
    /// It exists only so extracting the services preserves the behaviour of the
    /// handlers that never validated their `userId` argument. The role is left
    /// empty, so every role check on such an actor fails closed. Only the Tauri
    /// command layer may build one, and it disappears together with it.
    pub fn unverified(user_id: i64) -> Self {
        Self::new(user_id, "")
    }

    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }
}

impl From<&users::Model> for Actor {
    fn from(user: &users::Model) -> Self {
        Self {
            user_id: user.id,
            role: user.role.clone(),
        }
    }
}

impl From<users::Model> for Actor {
    fn from(user: users::Model) -> Self {
        Self {
            user_id: user.id,
            role: user.role,
        }
    }
}
