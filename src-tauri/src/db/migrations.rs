use sea_orm::{ConnectionTrait, DatabaseConnection, Statement, DbBackend};
use crate::utils::AppError;

const MIGRATIONS: &[(&str, &str)] = &[
    ("001_initial", include_str!("../../migrations/001_initial.sql")),
    ("002_add_margin", include_str!("../../migrations/002_add_margin.sql")),
    ("003_product_shortcuts", include_str!("../../migrations/003_product_shortcuts.sql")),
];

pub async fn run_migrations(conn: &DatabaseConnection) -> Result<(), AppError> {
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );".to_string(),
    )).await?;

    for (name, sql) in MIGRATIONS {
        let result = conn.query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) as cnt FROM _migrations WHERE name = $1",
            vec![(*name).into()],
        )).await?;

        let already_applied = match result {
            Some(row) => {
                let count: i32 = row.try_get("", "cnt").unwrap_or(0);
                count > 0
            }
            None => false,
        };

        if !already_applied {
            // Execute migration SQL statements one by one
            for statement in sql.split(';') {
                let trimmed = statement.trim();
                if !trimmed.is_empty() {
                    conn.execute(Statement::from_string(
                        DbBackend::Sqlite,
                        format!("{};", trimmed),
                    )).await?;
                }
            }

            conn.execute(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO _migrations (name) VALUES ($1)",
                vec![(*name).into()],
            )).await?;
            println!("Applied migration: {}", name);
        }
    }

    Ok(())
}
