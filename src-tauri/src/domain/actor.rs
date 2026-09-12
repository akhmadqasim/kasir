//! Who a service call is made on behalf of.

use crate::entity::users;

/// The identity a service acts for.
///
/// Services never read an identity out of a request body — they take an `Actor`
/// as an explicit first-class parameter. Producing one is the transport layer's
/// job, and the only transport left is HTTP: [`crate::http::session`] resolves
/// the session cookie into a user and builds the `Actor` from that. Because no
/// service accepts a bare id, there is no path left that can be pointed at a
/// client-controlled identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Actor {
    pub user_id: i64,
    pub role: String,
}

impl Actor {
    /// Build an actor directly from a role, without going through
    /// [`From<&users::Model>`]. Every non-test caller gets an `Actor` from a
    /// session instead, so this is a test-only convenience for exercising a
    /// service with a role that has no user row to back it.
    #[cfg(test)]
    pub fn new(user_id: i64, role: impl Into<String>) -> Self {
        Self {
            user_id,
            role: role.into(),
        }
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
