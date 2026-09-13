//! The HTTP transport.
//!
//! This is the layer the LAN talks to. It owns exactly three things — turning a
//! cookie into an [`Actor`], turning an [`AppError`] into a status code, and
//! turning a URL into a service call. Everything it decides about *business* it
//! delegates: no SQL, no money arithmetic, no role rules beyond "this route
//! needs an admin" live here.
//!
//! It used to have a counterpart, the Tauri command layer, wired up alongside
//! it and serving the same webview. That layer trusted a caller id it read out
//! of the request payload; this one never has, because identity comes from the
//! session cookie instead. Once the frontend moved entirely to `fetch`, the
//! command layer had nothing left calling it and was deleted — every route
//! here is now the only way in.
//!
//! ```text
//! request ──► body limit ──► compression ──► CSRF (Origin/Referer)
//!                                              │
//!                    ┌─────────────────────────┴──────────────────┐
//!                    ▼                                            ▼
//!             /api/… routes                              anything else
//!         public │ session │ admin                    embedded dist/ files
//!                └── Actor from the session ──► services/ ──► JSON
//! ```

pub mod error;
pub mod extract;
pub mod idempotency;
pub mod middleware;
pub mod routes;
pub mod session;
pub mod static_files;
pub mod throttle;

#[cfg(test)]
mod router_tests;

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use sea_orm::DatabaseConnection;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};
use tower_http::compression::CompressionLayer;

use crate::services::backup::BackupScheduler;
use crate::services::ppob::MitraClient;
use crate::updater::Updater;
use crate::utils::{logging, AppError};
use throttle::LoginThrottle;

/// Default port. Deliberately high and unmemorable so it does not collide with
/// whatever else is installed on a shop PC; nginx is what the tablets actually
/// talk to.
const DEFAULT_PORT: u16 = 17720;

/// How many consecutive ports to try before giving up (17720..=17729).
const PORT_SCAN_RANGE: u16 = 9;

/// Ceiling on a request body. Generous because bulk product import posts the
/// whole spreadsheet as JSON; nginx has its own, larger limit for DB restore.
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

/// How often dead sessions and spent idempotency keys are swept from their
/// tables.
const SWEEP_INTERVAL_SECS: u64 = 60 * 60;

/// Everything the transport needs and nothing it does not.
///
/// `mitra`, `backup_scheduler` and `updater` are process-wide mutable state
/// that outlives any one request: the cached PPOB upstream session, the clock
/// the daily backup runs on, and the self-update state machine. `run()` builds
/// each once and hands the same handles in through [`AppState::sharing`], so
/// the transport can never hold a second copy that disagrees with the first —
/// a second `MitraClient` would hold a second upstream session, and logging
/// one in logs the other out.
#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub config: Arc<ServerConfig>,
    pub throttle: Arc<LoginThrottle>,
    pub mitra: Arc<Mutex<MitraClient>>,
    pub backup_scheduler: Arc<Mutex<BackupScheduler>>,
    /// The self-update state machine. Owned by `run()` too, which attaches the
    /// Tauri app handle once the app exists; a test state never gets one.
    pub updater: Arc<Updater>,
}

impl AppState {
    /// State that owns its PPOB client and backup scheduler. This is what tests
    /// build; the running app uses [`AppState::sharing`] so both transports see
    /// one of each.
    pub fn new(db: DatabaseConnection, config: ServerConfig) -> Self {
        Self {
            db,
            config: Arc::new(config),
            throttle: Arc::new(LoginThrottle::new()),
            mitra: Arc::new(Mutex::new(MitraClient::new())),
            backup_scheduler: Arc::new(Mutex::new(BackupScheduler::new())),
            updater: Arc::new(Updater::new()),
        }
    }

    /// Adopt the PPOB client and backup scheduler `run()` already created.
    pub fn sharing(
        mut self,
        mitra: Arc<Mutex<MitraClient>>,
        backup_scheduler: Arc<Mutex<BackupScheduler>>,
        updater: Arc<Updater>,
    ) -> Self {
        self.mitra = mitra;
        self.backup_scheduler = backup_scheduler;
        self.updater = updater;
        self
    }
}

/// Deployment knobs, all from the environment. Documented in `deploy/README.md`.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// `KASIR_BIND`. `0.0.0.0` so the shop LAN can reach it; set `127.0.0.1` to
    /// keep the app to the till it runs on.
    pub bind: IpAddr,
    /// `KASIR_PORT`, the first port tried.
    pub port: u16,
    /// `KASIR_TRUST_PROXY=1`.
    ///
    /// Off by default, and that default matters: `X-Forwarded-For` is a header
    /// like any other, so trusting it on a port the LAN can reach directly lets
    /// any client invent its own address and walk straight out of the login
    /// backoff. It is only safe when nginx is the sole path to this port.
    pub trust_proxy: bool,
    /// `KASIR_ALLOWED_ORIGINS`, comma separated. Extra origins the CSRF check
    /// accepts beyond the request's own host — needed only when nginx serves the
    /// app under a name that does not survive as the `Host` header.
    pub allowed_origins: Vec<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: IpAddr::from([0, 0, 0, 0]),
            port: DEFAULT_PORT,
            trust_proxy: false,
            allowed_origins: Vec::new(),
        }
    }
}

impl ServerConfig {
    pub fn from_env() -> Self {
        let defaults = Self::default();

        let bind = std::env::var("KASIR_BIND")
            .ok()
            .and_then(|raw| raw.trim().parse::<IpAddr>().ok())
            .unwrap_or(defaults.bind);

        let port = std::env::var("KASIR_PORT")
            .ok()
            .and_then(|raw| raw.trim().parse::<u16>().ok())
            .filter(|port| *port > 0)
            .unwrap_or(defaults.port);

        let trust_proxy = std::env::var("KASIR_TRUST_PROXY")
            .map(|raw| raw.trim() == "1")
            .unwrap_or(false);

        let allowed_origins = std::env::var("KASIR_ALLOWED_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .collect();

        Self {
            bind,
            port,
            trust_proxy,
            allowed_origins,
        }
    }
}

/// A running server. Dropping it does not stop the server; call
/// [`ServerHandle::shutdown`] for that.
#[derive(Clone)]
pub struct ServerHandle {
    pub port: u16,
    shutdown: Arc<Notify>,
}

impl ServerHandle {
    /// Ask the server to stop accepting and finish in-flight requests.
    pub fn shutdown(&self) {
        self.shutdown.notify_waiters();
    }
}

/// The complete application, without a listener.
///
/// Split out from [`start`] so tests can drive it with
/// `tower::ServiceExt::oneshot` — no port, no sockets, no races, and every
/// middleware in the same order production uses.
pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/api", routes::api_router(state.clone()))
        // Anything that is not an API call is the single-page app. The fallback
        // deliberately sits outside `/api`, so a typo in an endpoint name gets a
        // JSON 404 instead of a 200 with HTML in it — which is what makes a
        // broken call look broken instead of merely confusing.
        .fallback(static_files::handler)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::csrf_guard,
        ))
        .layer(CompressionLayer::new())
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}

/// Bind and start serving. Returns once the listener is up, so the caller knows
/// the port before it points a window at it.
pub async fn start(state: AppState) -> Result<ServerHandle, AppError> {
    let listener = bind_listener(&state.config).await?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal(format!("failed to read the bound address: {e}")))?
        .port();

    logging::log_startup(&format!(
        "HTTP server listening on http://{}:{} (trust_proxy={})",
        state.config.bind, port, state.config.trust_proxy
    ));

    let shutdown = Arc::new(Notify::new());
    let app = router(state.clone());

    let serve_shutdown = shutdown.clone();
    tokio::spawn(async move {
        let served = axum::serve(
            listener,
            // `ConnectInfo` is what the login backoff counts per address when
            // there is no trusted proxy in front.
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            serve_shutdown.notified().await;
        })
        .await;

        if let Err(e) = served {
            logging::log_error(&format!("HTTP server stopped: {e}"));
        }
    });

    spawn_sweeper(state.db.clone(), shutdown.clone());

    Ok(ServerHandle { port, shutdown })
}

/// Try the configured port, then the nine above it.
///
/// A shop PC is not a server: something else may already own the port, and the
/// user has no console to read a bind error from. Scanning turns "the app did
/// not start" into "the app started on 17721", which the startup log records.
async fn bind_listener(config: &ServerConfig) -> Result<TcpListener, AppError> {
    let last = config.port.saturating_add(PORT_SCAN_RANGE);
    let mut last_error = None;

    for port in config.port..=last {
        match TcpListener::bind(SocketAddr::new(config.bind, port)).await {
            Ok(listener) => return Ok(listener),
            Err(e) => {
                logging::log_startup(&format!("Port {port} unavailable ({e}), trying the next"));
                last_error = Some(e);
            }
        }
    }

    Err(AppError::Internal(format!(
        "no free port between {} and {} on {}: {}",
        config.port,
        last,
        config.bind,
        last_error
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown".into())
    )))
}

/// Both tables drop their own dead rows when one is next presented, but a
/// session nobody comes back to — and an idempotency key whose sale nobody
/// retries, which is nearly all of them — would sit there forever.
fn spawn_sweeper(db: DatabaseConnection, shutdown: Arc<Notify>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(SWEEP_INTERVAL_SECS));
        ticker.tick().await; // the first tick fires immediately

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    let now = chrono::Utc::now();

                    match session::sweep_expired(&db, now).await {
                        Ok(0) => {}
                        Ok(n) => logging::log_info(&format!("Swept {n} expired session(s)")),
                        Err(e) => logging::log_error(&format!("Session sweep failed: {e}")),
                    }

                    match idempotency::sweep_expired(&db, now).await {
                        Ok(0) => {}
                        Ok(n) => logging::log_info(&format!("Swept {n} expired idempotency key(s)")),
                        Err(e) => logging::log_error(&format!("Idempotency sweep failed: {e}")),
                    }
                }
                _ = shutdown.notified() => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Nothing is read from the environment for a test router, so the checks
    /// under test are the defaults a fresh install runs with.
    pub fn test_config() -> ServerConfig {
        ServerConfig::default()
    }

    #[tokio::test]
    async fn the_port_scan_moves_on_when_a_port_is_taken() {
        let config = ServerConfig {
            bind: IpAddr::from([127, 0, 0, 1]),
            port: 0,
            ..test_config()
        };

        // Port 0 asks the OS for any free port, so this only proves the happy
        // path binds; the interesting case is the one below.
        let listener = bind_listener(&config).await.expect("binds");
        assert!(listener.local_addr().expect("addr").port() > 0);
    }

    #[tokio::test]
    async fn an_occupied_port_falls_through_to_the_next() {
        let squatter = TcpListener::bind(SocketAddr::new(IpAddr::from([127, 0, 0, 1]), 0))
            .await
            .expect("squatter binds");
        let taken = squatter.local_addr().expect("addr").port();

        let config = ServerConfig {
            bind: IpAddr::from([127, 0, 0, 1]),
            port: taken,
            ..test_config()
        };

        let listener = bind_listener(&config).await.expect("binds elsewhere");
        assert_ne!(listener.local_addr().expect("addr").port(), taken);
    }

    #[test]
    fn the_proxy_headers_are_distrusted_unless_asked_for() {
        assert!(!ServerConfig::default().trust_proxy);
    }
}
