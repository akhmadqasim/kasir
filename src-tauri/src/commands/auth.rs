use serde::Deserialize;
use tauri::State;

use crate::db::Database;
use crate::db::models::user::User;
use crate::utils::AppError;

#[derive(Debug, Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub pin: String,
}

#[tauri::command]
pub fn login(db: State<'_, Database>, input: LoginInput) -> Result<User, AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT id, username, pin_hash, full_name, role, is_active, created_at, updated_at
         FROM users WHERE username = ?1 AND is_active = 1"
    )?;

    let user = stmt.query_row([&input.username], |row| {
        Ok(User {
            id: row.get(0)?,
            username: row.get(1)?,
            pin_hash: row.get(2)?,
            full_name: row.get(3)?,
            role: row.get(4)?,
            is_active: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }).map_err(|_| AppError::Auth("Username tidak ditemukan".to_string()))?;

    let pin_valid = bcrypt::verify(&input.pin, &user.pin_hash)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !pin_valid {
        return Err(AppError::Auth("PIN salah".to_string()));
    }

    Ok(user)
}

#[tauri::command]
pub fn get_current_user(db: State<'_, Database>, user_id: i64) -> Result<User, AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT id, username, pin_hash, full_name, role, is_active, created_at, updated_at
         FROM users WHERE id = ?1 AND is_active = 1"
    )?;

    let user = stmt.query_row([user_id], |row| {
        Ok(User {
            id: row.get(0)?,
            username: row.get(1)?,
            pin_hash: row.get(2)?,
            full_name: row.get(3)?,
            role: row.get(4)?,
            is_active: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }).map_err(|_| AppError::NotFound("User tidak ditemukan".to_string()))?;

    Ok(user)
}

#[tauri::command]
pub fn list_users(db: State<'_, Database>) -> Result<Vec<User>, AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT id, username, pin_hash, full_name, role, is_active, created_at, updated_at
         FROM users WHERE is_active = 1 ORDER BY full_name"
    )?;

    let users = stmt.query_map([], |row| {
        Ok(User {
            id: row.get(0)?,
            username: row.get(1)?,
            pin_hash: row.get(2)?,
            full_name: row.get(3)?,
            role: row.get(4)?,
            is_active: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;

    Ok(users)
}
