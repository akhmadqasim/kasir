use serde::Deserialize;
use tauri::State;

use crate::db::Database;
use crate::db::models::store_info::StoreInfo;
use crate::utils::AppError;

#[derive(Debug, Deserialize)]
pub struct SetupStoreInput {
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetupAdminInput {
    pub username: String,
    pub pin: String,
    pub full_name: String,
}

#[derive(Debug, Deserialize)]
pub struct CompleteOnboardingInput {
    pub store: SetupStoreInput,
    pub admin: SetupAdminInput,
}

#[tauri::command]
pub fn check_onboarding_status(db: State<'_, Database>) -> Result<bool, AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM store_info", [], |row| row.get(0))?;
    Ok(count == 0)
}

#[tauri::command]
pub fn complete_onboarding(
    db: State<'_, Database>,
    input: CompleteOnboardingInput,
) -> Result<StoreInfo, AppError> {
    let store_name = input.store.name.trim().to_string();
    if store_name.is_empty() {
        return Err(AppError::Validation("Nama toko tidak boleh kosong".to_string()));
    }

    let admin_username = input.admin.username.trim().to_string();
    if admin_username.is_empty() {
        return Err(AppError::Validation("Username admin tidak boleh kosong".to_string()));
    }

    let pin = &input.admin.pin;
    if pin.len() < 4 || pin.len() > 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation(
            "PIN harus terdiri dari 4-6 digit angka".to_string(),
        ));
    }

    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    conn.execute_batch("BEGIN")?;

    let result = (|| -> Result<StoreInfo, AppError> {
        conn.execute(
            "INSERT INTO store_info (name, address, phone, email) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![store_name, input.store.address, input.store.phone, input.store.email],
        )?;

        let pin_hash = bcrypt::hash(&input.admin.pin, 12)
            .map_err(|e| AppError::Internal(format!("Gagal hash PIN: {}", e)))?;

        conn.execute(
            "INSERT INTO users (username, pin_hash, full_name, role, is_active) VALUES (?1, ?2, ?3, 'admin', 1)",
            rusqlite::params![admin_username, pin_hash, input.admin.full_name.trim()],
        )?;

        let store_info = conn.query_row(
            "SELECT id, name, address, phone, email, logo_path, additional_info, created_at, updated_at FROM store_info WHERE id = 1",
            [],
            |row| {
                Ok(StoreInfo {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    address: row.get(2)?,
                    phone: row.get(3)?,
                    email: row.get(4)?,
                    logo_path: row.get(5)?,
                    additional_info: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )?;

        Ok(store_info)
    })();

    match result {
        Ok(store_info) => {
            conn.execute_batch("COMMIT")?;
            Ok(store_info)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}
