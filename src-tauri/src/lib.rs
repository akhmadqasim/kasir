mod commands;
mod db;
pub mod entity;
mod printing;
mod utils;

use std::fs;
use std::sync::Arc;
use tokio::sync::Mutex;

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
    let database = tauri::async_runtime::block_on(db::setup_database(
        db_path.to_str().expect("Invalid DB path"),
    ))
    .expect("Failed to initialize database");

    let mitra_client = Arc::new(Mutex::new(commands::ppob::MitraClient::new()));

    let backup_scheduler = Arc::new(Mutex::new(commands::backup::BackupScheduler::new()));

    let backup_scheduler_clone = backup_scheduler.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |_app| {
            #[cfg(debug_assertions)]
            _app.handle().plugin(tauri_plugin_mcp_bridge::init())?;

            // Start backup scheduler inside setup where tokio runtime is available
            commands::backup::start_backup_scheduler(backup_scheduler_clone);
            Ok(())
        })
        .manage(database)
        .manage(mitra_client)
        .manage(backup_scheduler)
        .invoke_handler(tauri::generate_handler![
            commands::auth::login,
            commands::auth::get_current_user,
            commands::auth::list_users,
            commands::auth::create_user,
            commands::auth::update_user,
            commands::auth::toggle_user_active,
            commands::settings::get_store_info,
            commands::settings::update_store_info,
            commands::settings::get_app_settings,
            commands::settings::update_app_settings,
            commands::settings::change_user_pin,
            commands::settings::export_database,
            commands::settings::import_database,
            commands::settings::get_database_info,
            commands::onboarding::check_onboarding_status,
            commands::onboarding::complete_onboarding,
            commands::products::search_products,
            commands::products::get_product_by_barcode,
            commands::products::create_product,
            commands::products::update_product,
            commands::products::delete_product,
            commands::products::get_popular_products,
            commands::products::track_product_selection,
            commands::products::toggle_product_pin,
            commands::products::bulk_create_products,
            commands::products::save_template_file,
            commands::categories::list_categories,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::categories::delete_category,
            commands::transactions::checkout_transaction,
            commands::transactions::create_transaction,
            commands::transactions::get_next_receipt_number,
            commands::transactions::list_transactions,
            commands::transactions::get_transaction_detail,
            commands::receipt::list_printers,
            commands::receipt::print_receipt,
            commands::receipt::test_print,
            commands::receipt::update_printer_settings,
            commands::receipt::get_printer_settings_cmd,
            commands::receipt::get_receipt_data,
            commands::refunds::create_refund,
            commands::refunds::get_refund_detail,
            commands::refunds::list_refunds,
            commands::dashboard::get_dashboard_summary,
            commands::dashboard::get_daily_revenue,
            commands::dashboard::get_payment_method_stats,
            commands::dashboard::get_top_products,
            commands::dashboard::get_low_stock_products,
            commands::dashboard::get_recent_transactions,
            commands::dashboard::get_weekly_stats,
            commands::ppob::menu::ppob_login,
            commands::ppob::menu::ppob_get_saldo,
            commands::ppob::menu::ppob_get_menu,
            commands::ppob::menu::ppob_get_providers,
            commands::ppob::menu::ppob_get_pulsa_details,
            commands::ppob::menu::ppob_get_pulsa_price_list,
            commands::ppob::menu::ppob_get_data_price_list,
            commands::ppob::menu::ppob_get_pln_denom,
            commands::ppob::menu::ppob_get_pdam_products,
            commands::ppob::menu::ppob_get_emoney_denom,
            commands::ppob::menu::ppob_get_pp_sub_menu,
            commands::ppob::menu::ppob_get_transfer_channels,
            commands::ppob::menu::ppob_get_voucher_groups,
            commands::ppob::inquiry::ppob_pln_inquiry,
            commands::ppob::inquiry::ppob_pdam_inquiry,
            commands::ppob::inquiry::ppob_bpjs_inquiry,
            commands::ppob::inquiry::ppob_pp_inquiry,
            commands::ppob::inquiry::ppob_transfer_inquiry,
            commands::ppob::inquiry::ppob_emoney_inquiry,
            commands::ppob::inquiry::ppob_pulsa_purchase,
            commands::ppob::payment::ppob_confirm_payment,
            commands::ppob::payment::ppob_get_receipt_data,
            commands::ppob::history::ppob_get_history,
            commands::ppob::history::ppob_get_history_detail,
            commands::backup::create_backup,
            commands::backup::get_backup_status,
            commands::backup::list_backups,
            commands::backup::restore_backup,
            commands::backup::delete_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
