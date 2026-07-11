use crate::utils::AppError;
use sea_orm::sqlx::{query as sqlx_query, Executor, SqliteConnection};
use sea_orm::DatabaseConnection;

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
    (
        "010_ppob_flag_id",
        include_str!("../../migrations/010_ppob_flag_id.sql"),
    ),
    (
        "011_transaction_management",
        include_str!("../../migrations/011_transaction_management.sql"),
    ),
    (
        "012_transaction_payments",
        include_str!("../../migrations/012_transaction_payments.sql"),
    ),
    (
        "013_transaction_deleted_status",
        include_str!("../../migrations/013_transaction_deleted_status.sql"),
    ),
    (
        "014_payment_method_debit_mixed",
        include_str!("../../migrations/014_payment_method_debit_mixed.sql"),
    ),
    (
        "015_transaction_payment_bank_name",
        include_str!("../../migrations/015_transaction_payment_bank_name.sql"),
    ),
    (
        "016_refund_payment_method_debit_mixed",
        include_str!("../../migrations/016_refund_payment_method_debit_mixed.sql"),
    ),
    (
        "017_drop_redundant_indexes",
        include_str!("../../migrations/017_drop_redundant_indexes.sql"),
    ),
];

pub async fn run_migrations(conn: &DatabaseConnection) -> Result<(), AppError> {
    // Run the whole migration phase on a SINGLE dedicated connection acquired from
    // the underlying sqlx pool (not the shared pool, where every statement may land
    // on a different pooled connection). This is required for two reasons:
    //   * `PRAGMA foreign_keys` is a per-connection setting and is a no-op inside a
    //     transaction, so it must be toggled once, outside any transaction, on the
    //     exact connection that then runs the migrations.
    //   * Each migration must run in its own transaction so a mid-way failure rolls
    //     back completely; that only works if all statements share one connection.
    let mut db_conn = conn
        .get_sqlite_connection_pool()
        .acquire()
        .await
        .map_err(|e| AppError::Internal(format!("failed to acquire migration connection: {e}")))?;

    // Bookkeeping table (no FK involved).
    (&mut *db_conn)
        .execute(
            "CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .await
        .map_err(|e| AppError::Internal(format!("failed to create _migrations table: {e}")))?;

    // Disable FK enforcement for the whole migration phase. This MUST happen before
    // any transaction is opened (it is ignored inside one). Table-recreation
    // migrations (006/013/014/016) drop & rebuild parent tables and would otherwise
    // trip FK constraints. sqlx enables foreign_keys per new connection, hence the
    // dedicated connection above.
    (&mut *db_conn)
        .execute("PRAGMA foreign_keys = OFF;")
        .await
        .map_err(|e| AppError::Internal(format!("failed to disable foreign keys: {e}")))?;

    // Heal partial state left by the previous, non-atomic runner. A botched
    // table-recreation could commit a shadow `*_new` table before failing, which
    // would make re-running that migration fail with "table ... already exists" and
    // keep the app bricked. These shadow tables are only ever intermediate (each
    // migration renames its `*_new` table away before finishing), so any that are
    // still present must be leftovers and are safe to drop. No canonical data lives
    // in them; the real rows are in the original tables. On healthy/fresh databases
    // these are all no-ops.
    for shadow in ["transactions_new", "transaction_items_new", "refunds_new"] {
        let drop_stmt = format!("DROP TABLE IF EXISTS {shadow};");
        (&mut *db_conn)
            .execute(drop_stmt.as_str())
            .await
            .map_err(|e| {
                AppError::Internal(format!("failed to drop stale shadow table {shadow}: {e}"))
            })?;
    }

    for (name, sql) in MIGRATIONS {
        let already_applied = sqlx_query("SELECT 1 FROM _migrations WHERE name = ?")
            .bind(*name)
            .fetch_optional(&mut *db_conn)
            .await
            .map_err(|e| AppError::Internal(format!("failed to check migration '{name}': {e}")))?
            .is_some();

        if already_applied {
            continue;
        }

        if let Err(err) = apply_migration(&mut db_conn, name, sql).await {
            // Restore FK enforcement before surfacing the error so this connection
            // returns to the pool in the expected state.
            let _ = (&mut *db_conn).execute("PRAGMA foreign_keys = ON;").await;
            return Err(err);
        }

        println!("Applied migration: {}", name);
    }

    // Re-enable FK enforcement before this connection returns to the pool.
    (&mut *db_conn)
        .execute("PRAGMA foreign_keys = ON;")
        .await
        .map_err(|e| AppError::Internal(format!("failed to re-enable foreign keys: {e}")))?;

    Ok(())
}

/// Apply one migration file atomically: the entire file plus its `_migrations`
/// bookkeeping row run inside a single transaction. On any failure the transaction
/// is rolled back, leaving no partial state (e.g. no leftover `*_new` table) and the
/// migration unrecorded, so the next launch retries cleanly.
async fn apply_migration(
    conn: &mut SqliteConnection,
    name: &str,
    sql: &str,
) -> Result<(), AppError> {
    (&mut *conn)
        .execute("BEGIN;")
        .await
        .map_err(|e| AppError::Internal(format!("failed to begin migration '{name}': {e}")))?;

    match run_migration_body(&mut *conn, name, sql).await {
        Ok(()) => {
            (&mut *conn)
                .execute("COMMIT;")
                .await
                .map_err(|e| AppError::Internal(format!("failed to commit migration '{name}': {e}")))?;
            Ok(())
        }
        Err(err) => {
            // Best-effort rollback; the original error is what matters to the caller.
            let _ = (&mut *conn).execute("ROLLBACK;").await;
            Err(err)
        }
    }
}

async fn run_migration_body(
    conn: &mut SqliteConnection,
    name: &str,
    sql: &str,
) -> Result<(), AppError> {
    // Execute the entire migration file as one multi-statement script. Passing the
    // raw &str runs every statement (no bound arguments), which is more robust than
    // splitting on ';' (that breaks on ';' inside string literals or triggers).
    (&mut *conn)
        .execute(sql)
        .await
        .map_err(|e| AppError::Internal(format!("migration '{name}' failed: {e}")))?;

    // Record the migration INSIDE the same transaction so bookkeeping and schema
    // changes commit (or roll back) together.
    sqlx_query("INSERT INTO _migrations (name) VALUES (?)")
        .bind(name)
        .execute(&mut *conn)
        .await
        .map_err(|e| AppError::Internal(format!("failed to record migration '{name}': {e}")))?;

    Ok(())
}
