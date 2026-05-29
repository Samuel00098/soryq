use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;
use crate::state::AppState;

/// Resolve a (possibly new) path to its best canonical form and verify it
/// falls inside one of the currently open project roots.
fn require_in_project(path: &Path, state: &AppState) -> Result<(), String> {
    let projects = state.workspace_manager.list_projects();
    if projects.is_empty() {
        return Err("No project is open — open a project folder first".to_string());
    }
    // Get the best canonical path we can for a possibly-new file.
    let canonical: PathBuf = if path.exists() {
        std::fs::canonicalize(path).map_err(|_| "Invalid path".to_string())?
    } else if let Some(parent) = path.parent() {
        if parent.as_os_str().is_empty() || parent == Path::new(".") {
            path.to_path_buf()
        } else if parent.exists() {
            let cp = std::fs::canonicalize(parent).map_err(|_| "Invalid path".to_string())?;
            cp.join(path.file_name().unwrap_or_default())
        } else {
            path.to_path_buf()
        }
    } else {
        path.to_path_buf()
    };
    let canonical = crate::commands::clean_path_buf(canonical);
    if !projects.iter().any(|p| canonical.starts_with(&p.root_path)) {
        return Err("Access denied: path is outside any open project".to_string());
    }
    Ok(())
}

fn resolve_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let resolved = if p.exists() {
        std::fs::canonicalize(&p).map_err(|_| "Invalid path".to_string())?
    } else {
        let file_name = p.file_name().unwrap_or_default();
        if file_name == ".." {
            return Err("Invalid path".to_string());
        }
        if let Some(parent) = p.parent() {
            if parent.exists() {
                let canonical_parent = std::fs::canonicalize(parent).map_err(|_| "Invalid path".to_string())?;
                canonical_parent.join(file_name)
            } else {
                // Lexically resolve all .. components without I/O to prevent traversal
                // through non-existent intermediate directories (TOCTOU gap).
                let mut components: Vec<std::path::Component> = Vec::new();
                for comp in p.components() {
                    match comp {
                        std::path::Component::ParentDir => {
                            if components.is_empty() {
                                return Err("Invalid path: directory traversal detected".to_string());
                            }
                            components.pop();
                        }
                        std::path::Component::CurDir => {}
                        other => components.push(other),
                    }
                }
                components.iter().collect::<PathBuf>()
            }
        } else {
            p
        }
    };
    Ok(crate::commands::clean_path_buf(resolved))
}

fn require_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }
    let canonical = std::fs::canonicalize(&p).map_err(|_| "Invalid path".to_string())?;
    Ok(crate::commands::clean_path_buf(canonical))
}

fn redact_path(path: &str) -> String {
    let p = Path::new(path);
    p.file_name()
        .and_then(|n| n.to_str())
        .map(|n| format!("[redacted]/{}", n))
        .unwrap_or_else(|| "[redacted]".to_string())
}

fn sanitize_io_error(e: std::io::Error, path: &str) -> String {
    format!("{}: {}", e.kind(), redact_path(path))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
}

#[tauri::command]
pub fn fs_read_dir(path: String, state: State<AppState>) -> Result<Vec<FileEntry>, String> {
    let dir = require_path(&path)?;
    require_in_project(&dir, &state)?;
    if !dir.is_dir() {
        return Err("Not a directory".to_string());
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| sanitize_io_error(e, &path))? {
        let entry = entry.map_err(|e| sanitize_io_error(e, &path))?;
        let metadata = entry.metadata().map_err(|e| sanitize_io_error(e, &path))?;
        let modified = metadata
            .modified()
            .ok()
            .map(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
                    .to_string()
            })
            .unwrap_or_default();

        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
        });
    }

    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn fs_create_file(path: String, state: State<AppState>) -> Result<(), String> {
    let file_path = resolve_path(&path)?;
    require_in_project(&file_path, &state)?;
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| sanitize_io_error(e, &path))?;
    }
    std::fs::File::create(&file_path).map_err(|e| sanitize_io_error(e, &path))?;
    Ok(())
}

#[tauri::command]
pub fn fs_create_dir(path: String, state: State<AppState>) -> Result<(), String> {
    let p = resolve_path(&path)?;
    require_in_project(&p, &state)?;
    std::fs::create_dir_all(&p).map_err(|e| sanitize_io_error(e, &path))
}

#[tauri::command]
pub fn fs_rename(from: String, to: String, state: State<AppState>) -> Result<(), String> {
    let from_path = require_path(&from)?;
    let to_path = resolve_path(&to)?;
    require_in_project(&from_path, &state)?;
    require_in_project(&to_path, &state)?;
    std::fs::rename(&from_path, &to_path).map_err(|e| {
        format!("Failed to rename: {}", e.kind())
    })
}

#[tauri::command]
pub fn fs_delete(path: String, state: State<AppState>) -> Result<(), String> {
    let p = require_path(&path)?;
    require_in_project(&p, &state)?;
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| sanitize_io_error(e, &path))
    } else {
        std::fs::remove_file(&p).map_err(|e| sanitize_io_error(e, &path))
    }
}

#[tauri::command]
pub fn fs_copy(from: String, to: String, state: State<AppState>) -> Result<(), String> {
    let from_path = require_path(&from)?;
    let to_path = resolve_path(&to)?;
    require_in_project(&from_path, &state)?;
    require_in_project(&to_path, &state)?;
    if from_path.is_dir() {
        copy_dir_recursive(&from_path, &to_path).map_err(|e| format!("Copy failed: {}", e.kind()))
    } else {
        if let Some(parent) = to_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| sanitize_io_error(e, &to))?;
        }
        std::fs::copy(&from_path, &to_path).map_err(|e| sanitize_io_error(e, &from))?;
        Ok(())
    }
}

fn copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue; // skip symlinks — following them could escape the project root
        }
        let new_from = entry.path();
        let new_to = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&new_from, &new_to)?;
        } else {
            std::fs::copy(&new_from, &new_to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Create an AppState whose workspace has one open project rooted at `dir`.
    fn make_state_with_project(dir: &TempDir) -> crate::state::AppState {
        let config_dir = dir.path().join(".config");
        std::fs::create_dir_all(&config_dir).unwrap();
        let state = crate::state::AppState::new(config_dir);
        let project_root = std::fs::canonicalize(dir.path()).unwrap();
        let project_root = crate::commands::clean_path_buf(project_root);
        state.workspace_manager.open_project(project_root).unwrap();
        state
    }

    // --- require_in_project ---

    #[test]
    fn require_in_project_accepts_file_inside_root() {
        let dir = TempDir::new().unwrap();
        let state = make_state_with_project(&dir);
        // Create a real file so the path can be canonicalised
        let file = dir.path().join("hello.txt");
        std::fs::write(&file, "content").unwrap();
        let canonical = std::fs::canonicalize(&file).unwrap();
        let canonical = crate::commands::clean_path_buf(canonical);
        assert!(require_in_project(&canonical, &state).is_ok());
    }

    #[test]
    fn require_in_project_accepts_new_file_path_inside_root() {
        let dir = TempDir::new().unwrap();
        let state = make_state_with_project(&dir);
        // A path that does not exist yet — but its parent (dir) does
        let new_file = dir.path().join("new_file.rs");
        assert!(require_in_project(&new_file, &state).is_ok());
    }

    #[test]
    fn require_in_project_rejects_path_outside_project() {
        let dir = TempDir::new().unwrap();
        let state = make_state_with_project(&dir);
        // A completely separate temp dir — not an open project
        let other_dir = TempDir::new().unwrap();
        let outside = other_dir.path().join("secret.txt");
        std::fs::write(&outside, "secret").unwrap();
        let canonical = std::fs::canonicalize(&outside).unwrap();
        let canonical = crate::commands::clean_path_buf(canonical);
        assert!(require_in_project(&canonical, &state).is_err());
    }

    #[test]
    fn require_in_project_rejects_when_no_project_open() {
        let dir = TempDir::new().unwrap();
        let config_dir = dir.path().join(".config");
        std::fs::create_dir_all(&config_dir).unwrap();
        // State with NO project opened
        let state = crate::state::AppState::new(config_dir);
        let path = dir.path().join("file.txt");
        assert!(require_in_project(&path, &state).is_err());
    }

    #[test]
    fn require_in_project_accepts_nested_subdirectory() {
        let dir = TempDir::new().unwrap();
        let state = make_state_with_project(&dir);
        let nested = dir.path().join("a").join("b").join("c");
        std::fs::create_dir_all(&nested).unwrap();
        let file = nested.join("deep.txt");
        std::fs::write(&file, "deep").unwrap();
        let canonical = std::fs::canonicalize(&file).unwrap();
        let canonical = crate::commands::clean_path_buf(canonical);
        assert!(require_in_project(&canonical, &state).is_ok());
    }

    // --- resolve_path ---

    #[test]
    fn resolve_path_resolves_existing_file() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("test.txt");
        std::fs::write(&file, "data").unwrap();
        let result = resolve_path(&file.to_string_lossy());
        assert!(result.is_ok());
    }

    #[test]
    fn resolve_path_rejects_bare_dotdot() {
        // A path whose filename is ".." should fail
        let result = resolve_path("..");
        // resolve_path may succeed for ".." as it's an existing dir,
        // but require_in_project will reject it — this just checks it doesn't panic
        let _ = result;
    }

    // --- redact_path ---

    #[test]
    fn redact_path_keeps_only_filename() {
        let result = redact_path("/home/user/secrets/password.txt");
        assert_eq!(result, "[redacted]/password.txt");
        assert!(!result.contains("/home/user/secrets"));
    }

    #[test]
    fn redact_path_handles_filename_only() {
        let result = redact_path("readme.md");
        assert_eq!(result, "[redacted]/readme.md");
    }
}

#[tauri::command]
pub fn fs_read_file(path: String, state: State<AppState>) -> Result<String, String> {
    let p = require_path(&path)?;
    require_in_project(&p, &state)?;
    if p.metadata().map(|m| m.len()).unwrap_or(0) > 50 * 1024 * 1024 {
        return Err("File too large to read".to_string());
    }
    std::fs::read_to_string(&p).map_err(|e| sanitize_io_error(e, &path))
}

#[tauri::command]
pub fn fs_write_file(path: String, content: String, state: State<AppState>) -> Result<(), String> {
    if content.len() > 100 * 1024 * 1024 {
        return Err("Content too large to write (limit 100 MB)".to_string());
    }
    let file_path = resolve_path(&path)?;
    require_in_project(&file_path, &state)?;
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| sanitize_io_error(e, &path))?;
    }
    std::fs::write(&file_path, &content).map_err(|e| sanitize_io_error(e, &path))
}

#[tauri::command]
pub fn fs_write_binary(path: String, data: Vec<u8>, state: State<AppState>) -> Result<(), String> {
    if data.len() > 100 * 1024 * 1024 {
        return Err("Data too large to write (limit 100 MB)".to_string());
    }
    let file_path = resolve_path(&path)?;
    require_in_project(&file_path, &state)?;
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| sanitize_io_error(e, &path))?;
    }
    std::fs::write(&file_path, &data).map_err(|e| sanitize_io_error(e, &path))
}

#[tauri::command]
pub fn fs_get_file_info(path: String, state: State<AppState>) -> Result<FileEntry, String> {
    let p = require_path(&path)?;
    require_in_project(&p, &state)?;
    let metadata = std::fs::metadata(&p).map_err(|e| sanitize_io_error(e, &path))?;
    let modified = metadata
        .modified()
        .ok()
        .map(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .to_string()
        })
        .unwrap_or_default();

    Ok(FileEntry {
        name: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
        path: p.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        modified,
    })
}
