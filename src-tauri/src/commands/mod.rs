pub mod app_flags;
pub mod background;
pub mod db;
pub mod env_vars;
pub mod file_system;
pub mod github;
pub mod http;
pub mod lsp;
pub mod notification;
pub mod preview;
pub mod search;
pub mod secrets;
pub mod terminal;
pub mod theme;
pub mod workspace;
pub mod models;

use std::path::PathBuf;

pub fn clean_path_buf(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let path_str = path.to_string_lossy();
        if path_str.starts_with(r"\\?\UNC\") {
            return PathBuf::from(format!("\\{}", &path_str[7..]));
        } else if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}
