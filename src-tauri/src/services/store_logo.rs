//! The store logo: one file under `<data_dir>/store/`, pointed at by
//! `store_info.logo_path`.
//!
//! The column holds a path relative to the data directory (`store/logo.png`),
//! never an absolute one, so a data directory that moves — a restore on a new
//! till, a `KASIR_DATA_DIR` override — still finds its logo. Reading it back
//! goes through [`resolve`], which keeps only the file name and only accepts
//! `logo.<ext>` for an extension in [`LogoFormat`]: a column edited by hand to
//! `..\kasir.db` is a missing logo, not a file read.

use std::fs;
use std::path::{Path, PathBuf};

use sea_orm::{ActiveModelTrait, DatabaseConnection, Set};

use crate::domain::store_logo::LogoFormat;
use crate::domain::Actor;
use crate::entity::store_info;
use crate::services::guard;
use crate::services::settings::{get_store_info, now_ts, require_store_info};
use crate::utils::paths::get_data_dir;
use crate::utils::AppError;

/// Directory under the data dir, and the prefix of the relative path stored.
const LOGO_DIR: &str = "store";
const LOGO_STEM: &str = "logo";

/// The logo as it sits on disk.
pub struct StoredLogo {
    pub bytes: Vec<u8>,
    pub format: LogoFormat,
}

fn logo_dir() -> PathBuf {
    get_data_dir().join(LOGO_DIR)
}

fn file_name(format: LogoFormat) -> String {
    format!("{LOGO_STEM}.{}", format.extension())
}

/// Turn a stored `logo_path` into the file it names, or `None` if the value is
/// not a logo file name this module would have written.
fn resolve(logo_path: &str) -> Option<(PathBuf, LogoFormat)> {
    let name = Path::new(logo_path).file_name()?.to_str()?;
    let extension = name.strip_prefix(LOGO_STEM)?.strip_prefix('.')?;
    let format = LogoFormat::from_extension(extension)?;
    Some((logo_dir().join(name), format))
}

/// Delete every `logo.<ext>` the module could have written. Called before a
/// new one lands so a PNG replaced by an SVG does not leave the PNG behind.
fn remove_all_files() -> Result<(), AppError> {
    let dir = logo_dir();
    for format in LogoFormat::ALL {
        let path = dir.join(file_name(format));
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(AppError::Internal(format!(
                    "gagal menghapus logo lama {}: {e}",
                    path.display()
                )))
            }
        }
    }
    Ok(())
}

/// Check `bytes`, write them as the store logo, and point `logo_path` at them.
///
/// The write goes to a `.tmp` sibling first and is renamed into place, so a
/// crash mid-write cannot leave a half-file where the sidebar expects an image.
pub async fn save(
    db: &DatabaseConnection,
    actor: &Actor,
    bytes: &[u8],
) -> Result<store_info::Model, AppError> {
    guard::require_admin(actor)?;
    let format = LogoFormat::sniff(bytes)?;
    let store = require_store_info(db).await?;

    let dir = logo_dir();
    fs::create_dir_all(&dir).map_err(|e| {
        AppError::Internal(format!("gagal membuat folder logo {}: {e}", dir.display()))
    })?;

    let name = file_name(format);
    let final_path = dir.join(&name);
    let tmp_path = dir.join(format!("{name}.tmp"));

    fs::write(&tmp_path, bytes).map_err(|e| {
        AppError::Internal(format!("gagal menulis logo {}: {e}", tmp_path.display()))
    })?;
    remove_all_files()?;
    fs::rename(&tmp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        AppError::Internal(format!("gagal memasang logo {}: {e}", final_path.display()))
    })?;

    let mut active: store_info::ActiveModel = store.into();
    active.logo_path = Set(Some(format!("{LOGO_DIR}/{name}")));
    active.updated_at = Set(Some(now_ts()));
    Ok(active.update(db).await?)
}

/// Remove the logo file and clear `logo_path`. Idempotent: a store without a
/// logo ends up exactly where it started.
pub async fn remove(db: &DatabaseConnection, actor: &Actor) -> Result<(), AppError> {
    guard::require_admin(actor)?;
    let store = require_store_info(db).await?;

    remove_all_files()?;

    if store.logo_path.is_some() {
        let mut active: store_info::ActiveModel = store.into();
        active.logo_path = Set(None);
        active.updated_at = Set(Some(now_ts()));
        active.update(db).await?;
    }
    Ok(())
}

/// The logo bytes and format, or `None` when the store has no logo — or claims
/// one whose file is gone, which the sidebar treats the same way.
pub async fn load(db: &DatabaseConnection) -> Result<Option<StoredLogo>, AppError> {
    let Some(store) = get_store_info(db).await? else {
        return Ok(None);
    };
    let Some((path, format)) = store.logo_path.as_deref().and_then(resolve) else {
        return Ok(None);
    };

    match fs::read(&path) {
        Ok(bytes) => Ok(Some(StoredLogo { bytes, format })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Internal(format!(
            "gagal membaca logo {}: {e}",
            path.display()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_file_name_of_a_stored_path_is_used() {
        let (path, format) = resolve("store/logo.png").expect("resolves");
        assert_eq!(format, LogoFormat::Png);
        assert_eq!(path.file_name().unwrap(), "logo.png");
        assert_eq!(path.parent().unwrap(), logo_dir());

        // A column edited to escape the data dir still resolves inside it.
        let (path, _) = resolve("../../logo.svg").expect("resolves");
        assert_eq!(path.parent().unwrap(), logo_dir());
    }

    #[test]
    fn a_stored_path_that_is_not_a_logo_is_ignored() {
        assert!(resolve("store/kasir.db").is_none());
        assert!(resolve("logo.exe").is_none());
        assert!(resolve("logo").is_none());
        assert!(resolve("").is_none());
    }
}
