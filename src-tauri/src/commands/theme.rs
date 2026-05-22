use crate::theme::models::Theme;
use tauri::State;
use crate::state::AppState;

#[tauri::command]
pub fn theme_list(state: State<AppState>) -> Result<Vec<crate::theme::models::ThemeInfo>, String> {
    state.theme_registry.list_themes().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn theme_activate(theme_id: String, state: State<AppState>) -> Result<Theme, String> {
    state.theme_registry.activate_theme(&theme_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn theme_get_active(state: State<AppState>) -> Result<Theme, String> {
    state.theme_registry.get_active_theme().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn theme_save(theme: Theme, state: State<AppState>) -> Result<(), String> {
    state.theme_registry.save_custom_theme(theme).map_err(|e| e.to_string())
}
