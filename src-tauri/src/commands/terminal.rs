use crate::pty::session;
use crate::pty::shell::{self, ShellConfig};
use crate::state::AppState;
use tauri::ipc::{Channel, Response};
use tauri::State;

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
    let cwd = cwd.unwrap_or_else(shell::get_default_cwd);
    let clean_cwd = crate::commands::clean_path_buf(std::path::PathBuf::from(cwd))
        .to_string_lossy()
        .to_string();
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
