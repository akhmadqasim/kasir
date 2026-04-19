use std::fs::{self, OpenOptions};
use std::io::Write;

use super::paths;

fn write_log(filename: &str, level: &str, message: &str) {
    let dir = paths::get_log_dir();
    let _ = fs::create_dir_all(&dir);
    let path = dir.join(filename);
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] [{}] {}\n", timestamp, level, message);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
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
