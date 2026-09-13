use std::path::PathBuf;

/// Returns the writable application data directory.
///
/// Production (release): `%APPDATA%/com.kasir.pos/`
/// Development (debug): prefers existing `../data/` relative to CWD for backward compat,
/// falls back to the production path.
pub fn get_data_dir() -> PathBuf {
    // Allow override for testing/custom deployments
    if let Ok(dir) = std::env::var("KASIR_DATA_DIR") {
        return PathBuf::from(dir);
    }

    // In debug builds, check for existing dev data directory
    #[cfg(debug_assertions)]
    {
        if let Ok(cwd) = std::env::current_dir() {
            if let Some(parent) = cwd.parent() {
                let dev_data = parent.join("data");
                if dev_data.exists() && dev_data.is_dir() {
                    return dev_data;
                }
            }
        }
    }

    // Production: use %APPDATA%/com.kasir.pos/ (always writable, even in MSIX)
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.kasir.pos")
}

pub fn get_db_path() -> PathBuf {
    get_data_dir().join("kasir.db")
}

pub fn get_backup_dir() -> PathBuf {
    get_data_dir().join("backups")
}

pub fn get_log_dir() -> PathBuf {
    get_data_dir().join("logs")
}
