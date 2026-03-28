pub mod migrations;

use crate::utils::AppError;
use sea_orm::DbBackend;
use sea_orm::{ConnectionTrait, Database as SeaDatabase, DatabaseConnection, Statement};

pub async fn setup_database(db_path: &str) -> Result<DatabaseConnection, AppError> {
    let db_url = format!("sqlite:{}?mode=rwc", db_path);
    let conn = SeaDatabase::connect(&db_url).await?;

    // Performance pragmas
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "PRAGMA journal_mode = WAL;".to_string(),
    ))
    .await?;
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "PRAGMA synchronous = NORMAL;".to_string(),
    ))
    .await?;
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "PRAGMA cache_size = -64000;".to_string(),
    ))
    .await?;
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "PRAGMA foreign_keys = ON;".to_string(),
    ))
    .await?;
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "PRAGMA busy_timeout = 5000;".to_string(),
    ))
    .await?;
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "PRAGMA temp_store = MEMORY;".to_string(),
    ))
    .await?;

    // Run migrations
    migrations::run_migrations(&conn).await?;

    Ok(conn)
}
