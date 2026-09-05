//! Frontend log entries and the paths the app writes to.

use crate::utils::{logging, paths};

/// Record a line the frontend produced. An unknown level is treated as `info`
/// rather than dropped, because losing a log line is worse than filing it under
/// the wrong heading.
pub fn write_entry(level: &str, message: &str) {
    match level {
        "startup" => logging::log_startup(message),
        "info" => logging::log_info(message),
        "warning" => logging::log_warning(message),
        "error" => logging::log_error(message),
        _ => logging::log_info(message),
    }
}

pub fn log_dir() -> String {
    paths::get_log_dir().to_string_lossy().to_string()
}

pub fn data_dir() -> String {
    paths::get_data_dir().to_string_lossy().to_string()
}
