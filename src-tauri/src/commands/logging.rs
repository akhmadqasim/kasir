use crate::utils::{logging, paths};

#[tauri::command]
pub fn write_log_entry(level: String, message: String) {
    match level.as_str() {
        "startup" => logging::log_startup(&message),
        "info" => logging::log_info(&message),
        "warning" => logging::log_warning(&message),
        "error" => logging::log_error(&message),
        _ => logging::log_info(&message),
    }
}

#[tauri::command]
pub fn get_log_dir() -> String {
    paths::get_log_dir().to_string_lossy().to_string()
}

#[tauri::command]
pub fn get_data_dir() -> String {
    paths::get_data_dir().to_string_lossy().to_string()
}
