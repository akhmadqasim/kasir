use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entity::users;
use crate::utils::AppError;

/// Verify user exists, is active, and has the required role.
/// Returns the user model on success.
pub async fn require_role(
    db: &DatabaseConnection,
    user_id: i64,
    required_role: &str,
) -> Result<users::Model, AppError> {
    let user = users::Entity::find_by_id(user_id)
        .filter(users::Column::IsActive.eq(true))
        .one(db)
        .await?
        .ok_or_else(|| AppError::Auth("Sesi tidak valid. Silakan login ulang.".to_string()))?;

    if required_role == "any" {
        return Ok(user);
    }

    if user.role != required_role {
        return Err(AppError::Forbidden(format!(
            "Akses ditolak. Hanya {} yang boleh mengakses fitur ini.",
            required_role
        )));
    }

    Ok(user)
}

/// Verify user exists and is active (any role).
#[allow(dead_code)]
pub async fn require_auth(db: &DatabaseConnection, user_id: i64) -> Result<users::Model, AppError> {
    require_role(db, user_id, "any").await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::users;
    use crate::test_support::{insert_user, now_ts, setup_test_db};
    use sea_orm::{ActiveModelTrait, ActiveValue::NotSet, Set};

    /// The guard cases need three users. The shared in-memory fixture supplies
    /// the admin (id 1); a kasir (id 2) and a deactivated admin (id 3) are added
    /// on top of it. `require_role` reads nothing but `users`, so no `store_info`
    /// row is seeded and the database never reaches the disk.
    async fn setup_guard_db() -> DatabaseConnection {
        let conn = setup_test_db().await;
        insert_user(&conn, "kasir1", "Kasir", "kasir").await;

        users::ActiveModel {
            id: NotSet,
            username: Set("inactive".to_string()),
            pin_hash: Set("hash".to_string()),
            full_name: Set("Inactive".to_string()),
            role: Set("admin".to_string()),
            is_active: Set(false),
            created_at: Set(Some(now_ts())),
            updated_at: Set(Some(now_ts())),
        }
        .insert(&conn)
        .await
        .expect("inactive user insert");

        conn
    }

    #[tokio::test]
    async fn test_require_role_admin_succeeds() {
        let conn = setup_guard_db().await;
        let user = require_role(&conn, 1, "admin")
            .await
            .expect("admin role check should succeed");
        assert_eq!(user.role, "admin");
        assert_eq!(user.username, "admin");
    }

    #[tokio::test]
    async fn test_require_role_kasir_rejected_for_admin_role() {
        let conn = setup_guard_db().await;
        let result = require_role(&conn, 2, "admin").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Forbidden(msg) => {
                assert!(msg.contains("admin"), "Error should mention required role");
            }
            other => panic!("Expected Forbidden error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_require_role_any_succeeds() {
        let conn = setup_guard_db().await;
        let user = require_role(&conn, 2, "any")
            .await
            .expect("any role check should succeed for kasir");
        assert_eq!(user.role, "kasir");
        assert_eq!(user.username, "kasir1");
    }

    #[tokio::test]
    async fn test_require_role_inactive_user_fails() {
        let conn = setup_guard_db().await;
        let result = require_role(&conn, 3, "admin").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Auth(msg) => {
                assert!(msg.contains("login"), "Error should mention login");
            }
            other => panic!("Expected Auth error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_require_role_nonexistent_user_fails() {
        let conn = setup_guard_db().await;
        let result = require_role(&conn, 999, "admin").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Auth(msg) => {
                assert!(msg.contains("login"), "Error should mention login");
            }
            other => panic!("Expected Auth error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_require_auth_succeeds_for_any_active_user() {
        let conn = setup_guard_db().await;
        let user = require_auth(&conn, 1)
            .await
            .expect("require_auth should succeed for active user");
        assert_eq!(user.id, 1);
    }

    #[tokio::test]
    async fn test_require_auth_fails_for_inactive_user() {
        let conn = setup_guard_db().await;
        let result = require_auth(&conn, 3).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Auth(_) => {} // expected
            other => panic!("Expected Auth error, got: {:?}", other),
        }
    }
}
