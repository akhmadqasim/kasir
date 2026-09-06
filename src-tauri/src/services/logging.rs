//! Frontend log entries.

use crate::utils::logging;

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
