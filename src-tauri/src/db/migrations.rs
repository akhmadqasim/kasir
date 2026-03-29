use crate::utils::AppError;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

const MIGRATIONS: &[(&str, &str)] = &[
    (
        "001_initial",
        include_str!("../../migrations/001_initial.sql"),
    ),
    (
        "002_add_margin",
        include_str!("../../migrations/002_add_margin.sql"),
    ),
    (
        "003_product_shortcuts",
        include_str!("../../migrations/003_product_shortcuts.sql"),
    ),
    ("004_ppob", include_str!("../../migrations/004_ppob.sql")),
    (
        "005_mitra_tokens",
        include_str!("../../migrations/005_mitra_tokens.sql"),
    ),
    (
        "006_ppob_checkout",
        include_str!("../../migrations/006_ppob_checkout.sql"),
    ),
    (
        "007_discount",
        include_str!("../../migrations/007_discount.sql"),
    ),
    (
        "008_shifts",
        include_str!("../../migrations/008_shifts.sql"),
    ),
    (
        "009_performance_indexes",
        include_str!("../../migrations/009_performance_indexes.sql"),
    ),
];

pub async fn run_migrations(conn: &DatabaseConnection) -> Result<(), AppError> {
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );"
        .to_string(),
    ))
    .await?;

    // Disable FK checks during migrations (table recreation needs this)
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "PRAGMA foreign_keys = OFF;".to_string(),
    ))
    .await?;

    for (name, sql) in MIGRATIONS {
        let result = conn
            .query_one(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "SELECT COUNT(*) as cnt FROM _migrations WHERE name = $1",
                vec![(*name).into()],
            ))
            .await?;

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
                    ))
                    .await?;
                }
            }

            conn.execute(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO _migrations (name) VALUES ($1)",
                vec![(*name).into()],
            ))
            .await?;
            println!("Applied migration: {}", name);
        }
    }

    // Re-enable FK checks after migrations
    conn.execute(Statement::from_string(
        DbBackend::Sqlite,
        "PRAGMA foreign_keys = ON;".to_string(),
    ))
    .await?;

    Ok(())
}
