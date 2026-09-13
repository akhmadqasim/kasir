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
mod whatsapp;
mod window_icon;
mod window_zoom;

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

    let whatsapp = Arc::new(whatsapp::WhatsappManager::new(
        utils::paths::get_whatsapp_session_dir(),
    ));

    let window_zoom = Arc::new(window_zoom::WindowZoom::new());
    let window_icon = Arc::new(window_icon::WindowIcon::new());
    // Read before the window exists so it opens at the size it was left at,
    // rather than snapping from 100 % a moment after the first paint.
    let initial_zoom = tauri::async_runtime::block_on(services::settings::ui_zoom(&database))
        .unwrap_or_else(|e| {
            utils::logging::log_error(&format!("Stored window zoom not readable: {e}"));
            domain::settings::UI_ZOOM_DEFAULT
        });

    // The HTTP server is started before the Tauri builder because the window's
    // URL depends on the port it actually got, and the port is only known once
    // the listener is bound. There is no longer a window path that does not
    // need it: the frontend speaks nothing but `fetch` to `/api`.
    let http_server = start_http_server(
        &database,
        &mitra_client,
        &backup_scheduler,
        &updater,
        &whatsapp,
        &window_zoom,
        &window_icon,
    );
    let http_port = http_server.port;

    let backup_scheduler_clone = backup_scheduler.clone();
    let updater_clone = updater.clone();
    let whatsapp_clone = whatsapp.clone();
    let whatsapp_for_exit = whatsapp.clone();
    let database_for_setup = database.clone();
    let window_zoom_clone = window_zoom.clone();
    let window_icon_clone = window_icon.clone();
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

            // Same shape again: the sidecar needs the app handle to resolve
            // itself in a release build (or the workspace path in debug), so
            // this is attached here rather than when the manager was built.
            #[cfg(debug_assertions)]
            whatsapp_clone.attach(whatsapp::process::dev_spawn_factory(app.handle()));
            #[cfg(not(debug_assertions))]
            whatsapp_clone.attach(whatsapp::process::release_spawn_factory(app.handle()));

            // Whether to reconnect is read here rather than blocking the
            // synchronous setup path above on a DB round trip — nothing before
            // this point needs the answer (contrast `initial_zoom`, which the
            // window's own creation below needs synchronously).
            let whatsapp_startup = whatsapp_clone.clone();
            let db_startup = database_for_setup.clone();
            tauri::async_runtime::spawn(async move {
                let enabled =
                    match services::whatsapp::settings::get_whatsapp_settings(&db_startup).await {
                        Ok(settings) => settings.enabled,
                        Err(e) => {
                            utils::logging::log_error(&format!(
                                "Stored WhatsApp setting not readable: {e}"
                            ));
                            false
                        }
                    };
                // The setting is already `true` in the database; only the live
                // side needs starting, so this calls the manager directly
                // rather than `services::whatsapp::enable` (which would write
                // the same value back).
                if enabled {
                    if let Err(e) = whatsapp_startup.enable().await {
                        utils::logging::log_error(&format!(
                            "WhatsApp sidecar did not reconnect at startup: {e}"
                        ));
                    }
                }
            });

            let window = build_main_window(app, http_port)?;
            // Same shape as the updater: the HTTP route that drives the zoom was
            // wired before this window existed, so it gets a closure over it.
            // The icon too: the store logo, drawn as a PNG by the page, or the
            // built-in mark again once the logo is removed.
            let default_icon = app.default_window_icon().cloned().map(tauri::image::Image::to_owned);
            let icon_window = window.clone();
            window_icon_clone.attach(move |png| match (png, &default_icon) {
                (Some(bytes), _) => icon_window.set_icon(tauri::image::Image::from_bytes(bytes)?),
                (None, Some(icon)) => icon_window.set_icon(icon.clone()),
                (None, None) => Ok(()),
            });
            window_zoom_clone.attach(move |factor| window.set_zoom(factor));
            if initial_zoom != domain::settings::UI_ZOOM_DEFAULT {
                if let Err(e) = window_zoom_clone.apply(initial_zoom) {
                    utils::logging::log_error(&format!("Stored window zoom not applied: {e}"));
                }
            }
            Ok(())
        })
        .manage(database)
        .manage(mitra_client)
        .manage(backup_scheduler)
        .manage(whatsapp)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            // Closing the window does not stop a background sidecar on its
            // own — this is the one path guaranteed to run before the
            // process actually exits. Blocks briefly (see
            // `WhatsappManager::shutdown`/`GRACEFUL_STOP_TIMEOUT`) so the
            // sidecar closes its own browser instead of leaving it running as
            // an orphan after the till's own window is gone.
            if let tauri::RunEvent::Exit = event {
                tauri::async_runtime::block_on(whatsapp_for_exit.shutdown());
            }
        });

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
    whatsapp: &Arc<whatsapp::WhatsappManager>,
    window_zoom: &Arc<window_zoom::WindowZoom>,
    window_icon: &Arc<window_icon::WindowIcon>,
) -> http::ServerHandle {
    // Pay for the login timing-equaliser's one-off bcrypt hash now, so the first
    // login attempt against an unknown username is not the request that pays it.
    services::auth::warm_password_verifier();

    let state = http::AppState::new(database.clone(), http::ServerConfig::from_env()).sharing(
        mitra_client.clone(),
        backup_scheduler.clone(),
        updater.clone(),
        whatsapp.clone(),
        window_zoom.clone(),
        window_icon.clone(),
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
fn build_main_window(app: &tauri::App, http_port: u16) -> tauri::Result<tauri::WebviewWindow> {
    let origin = window_origin(app, http_port);
    utils::logging::log_startup(&format!("Window will load {origin}"));
    let url = WebviewUrl::External(origin.parse().expect("a bound port makes a valid URL"));

    WebviewWindowBuilder::new(app, "main", url)
        .title("POS Toko Sembako")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .fullscreen(false)
        .build()
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
