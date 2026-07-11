pub mod migrations;

use crate::utils::AppError;
use sea_orm::{ConnectOptions, Database as SeaDatabase, DatabaseConnection};

pub async fn setup_database(db_path: &str) -> Result<DatabaseConnection, AppError> {
    let db_url = format!("sqlite:{}?mode=rwc", db_path);

    // This is a single-terminal POS, so we serialize all database access over a single
    // pooled connection (`max_connections(1)`). That alone prevents SQLITE_BUSY errors
    // caused by our own pool opening extra, uncontended connections.
    //
    // The pragmas are applied through `map_sqlx_sqlite_opts`, which hooks into sqlx's
    // `SqliteConnectOptions`. sqlx runs these pragmas while *establishing* each physical
    // connection (on a fresh connection, before any transaction is opened), so EVERY
    // connection the pool ever opens — including one it may transparently re-open after a
    // recycle — is primed identically. This fixes the previous bug where the per-connection
    // pragmas (synchronous, cache_size, foreign_keys, busy_timeout, temp_store) were run
    // once against a single pooled connection and never applied to later connections, which
    // left them defaulting to `busy_timeout = 0` and without FK enforcement.
    //
    // `journal_mode = WAL` is persistent at the DB-file level; it is set here too so the
    // full pragma set matches the intended configuration.
    let mut opt = ConnectOptions::new(db_url);
    opt.max_connections(1)
        .min_connections(1)
        .map_sqlx_sqlite_opts(|sqlite_opts| {
            sqlite_opts
                .pragma("journal_mode", "WAL")
                .pragma("synchronous", "NORMAL")
                .pragma("cache_size", "-64000")
                .pragma("foreign_keys", "ON")
                .pragma("busy_timeout", "5000")
                .pragma("temp_store", "MEMORY")
        });

    let conn = SeaDatabase::connect(opt).await?;

    // Run migrations
    migrations::run_migrations(&conn).await?;

    Ok(conn)
}
