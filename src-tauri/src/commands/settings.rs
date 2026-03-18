use tauri::State;
use crate::db::Database;
use crate::db::models::store_info::StoreInfo;
use crate::utils::AppError;

#[tauri::command]
pub fn get_store_info(db: State<'_, Database>) -> Result<Option<StoreInfo>, AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, name, address, phone, email, logo_path, additional_info, created_at, updated_at FROM store_info WHERE id = 1"
    )?;

    let result = stmt.query_row([], |row| {
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
    });

    match result {
        Ok(info) => Ok(Some(info)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}
