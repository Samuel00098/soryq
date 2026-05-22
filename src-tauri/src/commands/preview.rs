use tauri::State;
use crate::state::AppState;

#[tauri::command]
pub fn preview_start_proxy(state: State<AppState>) -> Result<u16, String> {
    state.preview_manager.start_proxy()
}

#[tauri::command]
pub fn preview_stop_proxy(state: State<AppState>) -> Result<(), String> {
    state.preview_manager.stop_proxy()
}

#[tauri::command]
pub fn preview_set_target_port(port: u16, state: State<AppState>) -> Result<(), String> {
    state.preview_manager.set_target_port(port)
}

#[tauri::command]
pub fn preview_get_target_port(state: State<AppState>) -> Result<u16, String> {
    Ok(state.preview_manager.get_target_port())
}

#[tauri::command]
pub fn preview_get_proxy_port(state: State<AppState>) -> Result<Option<u16>, String> {
    Ok(state.preview_manager.get_proxy_port())
}

#[tauri::command]
pub fn preview_clear_proxy_target(state: State<AppState>) -> Result<(), String> {
    state.preview_manager.clear_proxy_target()
}

/// Open a URL in the system's default web browser.
#[tauri::command]
pub async fn preview_open_in_browser(url: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell()
        .open(&url, None)
        .map_err(|e| format!("Failed to open browser: {}", e))
}
