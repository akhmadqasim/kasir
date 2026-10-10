use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::paths;

/// A log file past this size is rotated before the next line is written.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// Rotated copies kept per log (`warning.log.1` .. `warning.log.3`); the
/// oldest is dropped. Caps each log at about 20 MB on disk.
const KEPT_LOG_FILES: usize = 3;

/// Serialises size check, rotation and append so two threads cannot rotate
/// the same file at once.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn write_log(filename: &str, level: &str, message: &str) {
    let dir = paths::get_log_dir();
    let _ = fs::create_dir_all(&dir);
    let path = dir.join(filename);
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] [{}] {}\n", timestamp, level, message);
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    append_line(&path, &line, MAX_LOG_BYTES, KEPT_LOG_FILES);
}

/// Append `line` to `path`, first rotating the file if it already holds
/// `max_bytes` or more.
fn append_line(path: &Path, line: &str, max_bytes: u64, keep: usize) {
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size >= max_bytes {
        rotate(path, keep);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

/// `x.log` -> `x.log.1` -> ... -> `x.log.<keep>`; the oldest copy is removed.
fn rotate(path: &Path, keep: usize) {
    if keep == 0 {
        let _ = fs::remove_file(path);
        return;
    }
    let _ = fs::remove_file(rotated(path, keep));
    for n in (1..keep).rev() {
        let _ = fs::rename(rotated(path, n), rotated(path, n + 1));
    }
    let _ = fs::rename(path, rotated(path, 1));
}

fn rotated(path: &Path, n: usize) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{n}"));
    PathBuf::from(name)
}

pub fn log_startup(message: &str) {
    write_log("startup.log", "STARTUP", message);
}

pub fn log_info(message: &str) {
    write_log("info.log", "INFO", message);
}

pub fn log_warning(message: &str) {
    write_log("warning.log", "WARN", message);
}

pub fn log_error(message: &str) {
    write_log("error.log", "ERROR", message);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A log that keeps receiving lines stays bounded: it rotates at the size
    /// limit and keeps only `keep` old copies.
    #[test]
    fn a_full_log_is_rotated_and_old_copies_are_capped() {
        let dir = std::env::temp_dir().join(format!("kasir-log-rotation-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("warning.log");
        let line = "x".repeat(99) + "\n";

        for _ in 0..100 {
            append_line(&path, &line, 1_000, 2);
        }

        let mut files: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        files.sort();
        assert_eq!(files, ["warning.log", "warning.log.1", "warning.log.2"]);
        let total: u64 = files
            .iter()
            .map(|f| fs::metadata(dir.join(f)).unwrap().len())
            .sum();
        assert!(total <= 3 * 1_000, "total {total} bytes");
        assert!(fs::metadata(&path).unwrap().len() <= 1_000);

        let _ = fs::remove_dir_all(&dir);
    }
}
