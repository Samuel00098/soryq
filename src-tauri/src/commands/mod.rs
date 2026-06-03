pub mod background;
pub mod file_system;
pub mod github;
pub mod preview;
pub mod secrets;
pub mod terminal;
pub mod theme;
pub mod workspace;

use std::path::PathBuf;

pub fn clean_path_buf(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let path_str = path.to_string_lossy();
        if path_str.starts_with(r"\\?\UNC\") {
            return PathBuf::from(format!("\\{}", &path_str[7..]));
        } else if path_str.starts_with(r"\\?\") {
            return PathBuf::from(&path_str[4..]);
        }
    }
    path
}
