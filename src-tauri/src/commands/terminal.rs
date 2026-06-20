use crate::pty::session;
use crate::pty::shell::{self, ShellConfig};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::ipc::{Channel, Response};
use tauri::State;

fn resolve_terminal_cwd(cwd: Option<String>, state: &AppState) -> Result<String, String> {
    let raw = match cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(value) => PathBuf::from(value),
        None => state
            .workspace_manager
            .get_active_project()
            .map(|project| project.root_path)
            .ok_or_else(|| "No project is open - open a project folder first".to_string())?,
    };

    let canonical = if raw.exists() {
        std::fs::canonicalize(&raw).map_err(|_| "Invalid terminal directory".to_string())?
    } else if let Some(parent) = raw.parent() {
        if parent.as_os_str().is_empty() || parent == Path::new(".") {
            raw
        } else {
            let parent = std::fs::canonicalize(parent)
                .map_err(|_| "Invalid terminal directory".to_string())?;
            parent.join(raw.file_name().unwrap_or_default())
        }
    } else {
        raw
    };
    let clean = crate::commands::clean_path_buf(canonical);
    super::file_system::require_in_project(&clean, state)?;
    if !clean.is_dir() {
        return Err("Terminal directory must be a folder inside an open project".to_string());
    }
    Ok(clean.to_string_lossy().to_string())
}

/// Create a new terminal session with the specified shell (or auto-detect)
#[tauri::command]
pub fn terminal_create(
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell_program: Option<String>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
    state: State<AppState>,
) -> Result<u32, String> {
    let shell = match shell_program {
        Some(prog) if !prog.is_empty() => {
            let available = shell::available_shells();
            let found = available.iter().find(|s| {
                s.program.to_lowercase().contains(&prog.to_lowercase())
                    || prog.to_lowercase().contains(
                        std::path::Path::new(&s.program)
                            .file_stem()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_lowercase()
                            .as_str(),
                    )
            });
            match found {
                Some(s) => s.clone(),
                None => {
                    return Err(format!(
                        "Unrecognized shell program: {}. Available shells: {}",
                        prog,
                        available
                            .iter()
                            .map(|s| s.program.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ))
                }
            }
        }
        _ => shell::detect_shell(),
    };
    let clean_cwd = resolve_terminal_cwd(cwd, &state)?;
    let pty_session = session::spawn(cols, rows, shell, clean_cwd, on_data, on_exit)?;
    let id = state.pty_manager.insert(pty_session);
    Ok(id)
}

/// Attach a fresh frontend channel pair to an existing backend PTY session.
/// Used after the webview reloads while the Rust process kept the shell alive.
/// Returns the buffered output history; it is deliberately NOT sent over
/// `on_data` so the frontend can replay it through xterm's gated path (see
/// `PtySession::attach`).
#[tauri::command]
pub fn terminal_attach(
    id: u32,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
    state: State<AppState>,
) -> Result<Response, String> {
    let session = state
        .pty_manager
        .get(id)
        .ok_or_else(|| format!("Session not found: {id}"))?;
    let replay = session.attach(on_data, on_exit)?;
    Ok(Response::new(replay))
}

/// List available shells on the system
#[tauri::command]
pub fn terminal_list_shells() -> Result<Vec<ShellConfig>, String> {
    Ok(shell::available_shells())
}

#[tauri::command]
pub fn terminal_write(id: u32, data: String, state: State<AppState>) -> Result<(), String> {
    const MAX_WRITE_LEN: usize = 256 * 1024;
    if data.len() > MAX_WRITE_LEN {
        return Err("Data exceeds maximum write size".to_string());
    }
    if !state.write_rate_limiter.check_and_record(id, data.len()) {
        return Err("Write rate limit exceeded (1 MB/s per session)".to_string());
    }
    let session = state
        .pty_manager
        .get(id)
        .ok_or_else(|| format!("Session not found: {id}"))?;
    session.write(&data)
}

#[tauri::command]
pub fn terminal_resize(
    id: u32,
    rows: u16,
    cols: u16,
    state: State<AppState>,
) -> Result<(), String> {
    let session = state
        .pty_manager
        .get(id)
        .ok_or_else(|| format!("Session not found: {id}"))?;
    session.resize(rows, cols)
}

#[tauri::command]
pub fn terminal_close(id: u32, state: State<AppState>) -> Result<(), String> {
    let session = state
        .pty_manager
        .remove(id)
        .ok_or_else(|| format!("Session not found: {id}"))?;
    state.write_rate_limiter.remove(id);
    let _ = session.close();
    Ok(())
}

#[tauri::command]
pub fn terminal_list(state: State<AppState>) -> Result<Vec<u32>, String> {
    Ok(state.pty_manager.list_ids())
}

#[tauri::command]
pub fn terminal_get_windows_build() -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let output = Command::new("cmd")
            .args(&["/c", "ver"])
            .output()
            .map_err(|e| e.to_string())?;
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        // ver output looks like: Microsoft Windows [Version 10.0.19045.4412]
        if let Some(start) = stdout.find("[Version ") {
            let version_str = &stdout[start + 9..];
            if let Some(end) = version_str.find(']') {
                let version_num_str = &version_str[..end]; // "10.0.19045.4412"
                let parts: Vec<&str> = version_num_str.split('.').collect();
                if parts.len() >= 3 {
                    if let Ok(build) = parts[2].parse::<u32>() {
                        return Ok(build);
                    }
                }
            }
        }
        
        // Fallback if parsing fails but we are on Windows
        Ok(22000)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Not a Windows host".to_string())
    }
}

