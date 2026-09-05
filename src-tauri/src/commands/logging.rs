use crate::services;

#[tauri::command]
pub fn write_log_entry(level: String, message: String) {
    services::logging::write_entry(&level, &message);
}

#[tauri::command]
pub fn get_log_dir() -> String {
    services::logging::log_dir()
}

#[tauri::command]
pub fn get_data_dir() -> String {
    services::logging::data_dir()
}
