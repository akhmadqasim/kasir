use crate::db::Database;
use crate::db::models::category::Category;
use crate::utils::AppError;
use tauri::State;

#[tauri::command]
pub fn list_categories(db: State<'_, Database>) -> Result<Vec<Category>, AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at FROM categories ORDER BY name"
    )?;

    let categories = stmt
        .query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(categories)
}

#[tauri::command]
pub fn create_category(
    db: State<'_, Database>,
    name: String,
    description: Option<String>,
) -> Result<Category, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Nama kategori tidak boleh kosong".to_string()));
    }

    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    conn.execute(
        "INSERT INTO categories (name, description) VALUES (?1, ?2)",
        rusqlite::params![name, description],
    )?;

    let id = conn.last_insert_rowid();
    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at FROM categories WHERE id = ?1"
    )?;
    let category = stmt.query_row([id], |row| {
        Ok(Category {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;

    Ok(category)
}

#[tauri::command]
pub fn update_category(
    db: State<'_, Database>,
    id: i64,
    name: String,
    description: Option<String>,
) -> Result<Category, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Nama kategori tidak boleh kosong".to_string()));
    }

    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let rows = conn.execute(
        "UPDATE categories SET name = ?1, description = ?2 WHERE id = ?3",
        rusqlite::params![name, description, id],
    )?;

    if rows == 0 {
        return Err(AppError::NotFound("Kategori tidak ditemukan".to_string()));
    }

    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at FROM categories WHERE id = ?1"
    )?;
    let category = stmt.query_row([id], |row| {
        Ok(Category {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;

    Ok(category)
}

#[tauri::command]
pub fn delete_category(db: State<'_, Database>, id: i64) -> Result<(), AppError> {
    let conn = db.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    // Check if any active products use this category
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM products WHERE category_id = ?1 AND is_active = 1",
        [id],
        |row| row.get(0),
    )?;

    if count > 0 {
        return Err(AppError::Validation(format!(
            "Kategori tidak dapat dihapus karena masih digunakan oleh {} produk",
            count
        )));
    }

    let rows = conn.execute("DELETE FROM categories WHERE id = ?1", [id])?;

    if rows == 0 {
        return Err(AppError::NotFound("Kategori tidak ditemukan".to_string()));
    }

    Ok(())
}
