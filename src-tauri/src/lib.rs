mod commands;
mod db;
mod printing;
mod utils;

use db::Database;
use std::fs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ensure data directory exists
    let data_dir = std::env::current_dir()
        .unwrap_or_default()
        .parent()
        .map(|p| p.join("data"))
        .unwrap_or_else(|| std::path::PathBuf::from("data"));

    fs::create_dir_all(&data_dir).expect("Failed to create data directory");

    let db_path = data_dir.join("kasir.db");
    let database = Database::new(
        db_path.to_str().expect("Invalid DB path")
    ).expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(database)
        .invoke_handler(tauri::generate_handler![
            commands::auth::login,
            commands::auth::get_current_user,
            commands::auth::list_users,
            commands::settings::get_store_info,
            commands::onboarding::check_onboarding_status,
            commands::onboarding::complete_onboarding,
            commands::products::search_products,
            commands::products::get_product_by_barcode,
            commands::products::create_product,
            commands::products::update_product,
            commands::products::delete_product,
            commands::categories::list_categories,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::categories::delete_category,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
