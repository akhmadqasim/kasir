mod db;
mod domain;
pub mod entity;
mod http;
mod printing;
mod services;
#[cfg(test)]
mod test_support;
mod updater;
mod utils;

use std::fs;
use std::sync::Arc;

use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Mutex;

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

    let updater = Arc::new(updater::Updater::new());

    // The HTTP server is started before the Tauri builder because the window's
    // URL depends on the port it actually got, and the port is only known once
    // the listener is bound. There is no longer a window path that does not
    // need it: the frontend speaks nothing but `fetch` to `/api`.
    let http_server = start_http_server(&database, &mitra_client, &backup_scheduler, &updater);
    let http_port = http_server.port;

    let backup_scheduler_clone = backup_scheduler.clone();
    let updater_clone = updater.clone();
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(move |app| {
            // Start backup scheduler inside setup where tokio runtime is available
            tauri::async_runtime::spawn(services::backup::run_scheduler(backup_scheduler_clone));
            // The updater needs the app handle for the plugin; the HTTP routes
            // that drive it were wired before this handle existed.
            let handle = app.handle().clone();
            updater_clone.attach(move || handle.updater_builder());
            // Release builds only: a dev build restarts many times an hour, and
            // must never be nudged into replacing itself with the installer.
            if !cfg!(debug_assertions) {
                updater_clone.spawn_background_checks();
            }
            build_main_window(app, http_port)?;
            Ok(())
        })
        .manage(database)
        .manage(mitra_client)
        .manage(backup_scheduler)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    http_server.shutdown();

    utils::logging::log_startup("App shutdown");
}

/// Bind the embedded HTTP server. The window has nothing to load without it,
/// so this always runs — there is no longer an opt-in flag.
///
/// A failure here aborts the launch on purpose: carrying on would produce a
/// window pointed at a server that is not there, which is a much harder thing
/// to notice than a refusal to start.
fn start_http_server(
    database: &sea_orm::DatabaseConnection,
    mitra_client: &Arc<Mutex<services::ppob::MitraClient>>,
    backup_scheduler: &Arc<Mutex<services::backup::BackupScheduler>>,
    updater: &Arc<updater::Updater>,
) -> http::ServerHandle {
    // Pay for the login timing-equaliser's one-off bcrypt hash now, so the first
    // login attempt against an unknown username is not the request that pays it.
    services::auth::warm_password_verifier();

    let state = http::AppState::new(database.clone(), http::ServerConfig::from_env())
        .sharing(
            mitra_client.clone(),
            backup_scheduler.clone(),
            updater.clone(),
        );
    match tauri::async_runtime::block_on(http::start(state)) {
        Ok(server) => server,
        Err(e) => {
            let msg = format!("Failed to start the HTTP server: {e}");
            utils::logging::log_error(&msg);
            eprintln!("{}", msg);
            panic!("{}", msg);
        }
    }
}

/// Create the one window the app has, pointed at the embedded server.
///
/// It is built here rather than declared in `tauri.conf.json` because its URL
/// contains the port the server just bound, which no static config can know
/// ahead of time — the default port is tried first, but a busy machine walks
/// up to the next one.
///
/// In a debug build the window loads the Vite dev server from `devUrl`
/// instead. The embedded server only ever serves the `dist/` that was compiled
/// into the binary, so pointing the window there during development meant a
/// saved `.tsx` never showed up until `bun run build` and a Rust rebuild. Vite
/// proxies `/api` to the same server, so sessions and CSRF behave exactly as
/// they do in the browser, and `KASIR_ALLOWED_ORIGINS` already covers 5173.
fn build_main_window(app: &tauri::App, http_port: u16) -> tauri::Result<()> {
    let origin = window_origin(app, http_port);
    utils::logging::log_startup(&format!("Window will load {origin}"));
    let url = WebviewUrl::External(origin.parse().expect("a bound port makes a valid URL"));

    WebviewWindowBuilder::new(app, "main", url)
        .title("POS Toko Sembako")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .fullscreen(false)
        .build()?;

    Ok(())
}

/// Debug: Vite's `devUrl` from `tauri.conf.json` when it is configured, so
/// the window hot-reloads with the browser. Release: always the embedded server.
fn window_origin(app: &tauri::App, http_port: u16) -> String {
    #[cfg(debug_assertions)]
    if let Some(dev_url) = &app.config().build.dev_url {
        return dev_url.to_string().trim_end_matches('/').to_string();
    }
    #[cfg(not(debug_assertions))]
    let _ = app;

    format!("http://127.0.0.1:{http_port}")
}
