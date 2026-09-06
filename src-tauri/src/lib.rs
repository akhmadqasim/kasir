mod db;
mod domain;
pub mod entity;
mod http;
mod printing;
mod services;
#[cfg(test)]
mod test_support;
mod utils;

use std::fs;
use std::sync::Arc;

use tauri::{WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex;

/// Set `KASIR_WEB_MODE=1` to run the embedded HTTP server and point the desktop
/// window at it.
///
/// Off by default, and that default is load-bearing for now: the frontend still
/// talks to the Tauri commands, and it would find none of them behind an
/// `http://127.0.0.1` origin. Turning the flag on before the frontend has moved
/// to `fetch` gives you a working server and a blank window. The switch flips
/// for good in the phase that rewrites the frontend's transport; until then this
/// is how the HTTP surface is exercised against a real database.
const WEB_MODE_ENV: &str = "KASIR_WEB_MODE";

fn web_mode_enabled() -> bool {
    std::env::var(WEB_MODE_ENV)
        .map(|value| value.trim() == "1")
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = utils::paths::get_data_dir();
    utils::logging::log_startup(&format!("App starting, data_dir={}", data_dir.display()));

    if let Err(e) = fs::create_dir_all(&data_dir) {
        let msg = format!(
            "Failed to create data directory {}: {}",
            data_dir.display(),
            e
        );
        utils::logging::log_error(&msg);
        eprintln!("{}", msg);
        panic!("{}", msg);
    }

    let db_path = utils::paths::get_db_path();

    // Install a restore staged by `restore_backup`. This MUST happen before
    // `setup_database`: it is the only point in the process where nothing holds
    // `kasir.db` open, so it is the only point where swapping the file cannot
    // race SQLite's page cache or leave a stale `-wal` behind. A failure here is
    // logged and the app continues on the database it already had.
    match services::backup::apply_pending_restore(&db_path) {
        Ok(true) => utils::logging::log_startup("Applied pending database restore"),
        Ok(false) => {}
        Err(e) => {
            let msg = format!("Pending restore not applied: {}", e);
            utils::logging::log_error(&msg);
            eprintln!("{}", msg);
        }
    }

    utils::logging::log_startup(&format!("Opening database at {}", db_path.display()));

    let database =
        match tauri::async_runtime::block_on(db::setup_database(db_path.to_str().unwrap_or(""))) {
            Ok(db) => {
                utils::logging::log_startup("Database initialized successfully");
                db
            }
            Err(e) => {
                let msg = format!(
                    "Failed to initialize database at {}: {}",
                    db_path.display(),
                    e
                );
                utils::logging::log_error(&msg);
                eprintln!("{}", msg);
                panic!("{}", msg);
            }
        };

    let mitra_client = Arc::new(Mutex::new(services::ppob::MitraClient::new()));

    let backup_scheduler = Arc::new(Mutex::new(services::backup::BackupScheduler::new()));

    // The HTTP server is started before the Tauri builder because the window's
    // URL depends on the port it actually got, and the port is only known once
    // the listener is bound.
    let http_server = start_http_server(&database, &mitra_client, &backup_scheduler);
    let http_port = http_server.as_ref().map(|server| server.port);

    let backup_scheduler_clone = backup_scheduler.clone();
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(move |app| {
            // Start backup scheduler inside setup where tokio runtime is available
            tauri::async_runtime::spawn(services::backup::run_scheduler(backup_scheduler_clone));
            build_main_window(app, http_port)?;
            Ok(())
        })
        .manage(database)
        .manage(mitra_client)
        .manage(backup_scheduler)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    if let Some(server) = http_server {
        server.shutdown();
    }

    utils::logging::log_startup("App shutdown");
}

/// Bind the embedded HTTP server, or `None` when web mode is off.
///
/// A failure here aborts the launch on purpose. Web mode is opt-in, so if it was
/// asked for and could not be provided, carrying on would silently produce a
/// desktop-only app that the LAN clients cannot reach — a much harder thing to
/// notice than a refusal to start.
fn start_http_server(
    database: &sea_orm::DatabaseConnection,
    mitra_client: &Arc<Mutex<services::ppob::MitraClient>>,
    backup_scheduler: &Arc<Mutex<services::backup::BackupScheduler>>,
) -> Option<http::ServerHandle> {
    if !web_mode_enabled() {
        utils::logging::log_startup(&format!(
            "HTTP server disabled (set {WEB_MODE_ENV}=1 to enable web mode)"
        ));
        return None;
    }

    // Pay for the login timing-equaliser's one-off bcrypt hash now, so the first
    // login attempt against an unknown username is not the request that pays it.
    services::auth::warm_password_verifier();

    let state = http::AppState::new(database.clone(), http::ServerConfig::from_env())
        .sharing(mitra_client.clone(), backup_scheduler.clone());
    match tauri::async_runtime::block_on(http::start(state)) {
        Ok(server) => Some(server),
        Err(e) => {
            let msg = format!("Failed to start the HTTP server: {e}");
            utils::logging::log_error(&msg);
            eprintln!("{}", msg);
            panic!("{}", msg);
        }
    }
}

/// Create the one window the app has.
///
/// It is built here rather than declared in `tauri.conf.json` because in web
/// mode its URL contains the port the server just bound, which no static config
/// can know. With web mode off the window loads the bundled frontend exactly as
/// the removed config block did, so the Tauri commands keep working untouched.
fn build_main_window(app: &tauri::App, http_port: Option<u16>) -> tauri::Result<()> {
    let url = match http_port {
        Some(port) => {
            let origin = format!("http://127.0.0.1:{port}");
            utils::logging::log_startup(&format!("Window will load {origin}"));
            WebviewUrl::External(origin.parse().expect("a bound port makes a valid URL"))
        }
        // Must stay "index.html": the label `main` and this entry point are what
        // `capabilities/default.json` grants permissions to.
        None => WebviewUrl::App("index.html".into()),
    };

    WebviewWindowBuilder::new(app, "main", url)
        .title("POS Toko Sembako")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .fullscreen(false)
        .build()?;

    Ok(())
}
