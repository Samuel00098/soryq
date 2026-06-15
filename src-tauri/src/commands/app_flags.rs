//! Durable app-level flags persisted to a JSON file on disk.
//!
//! The frontend stores most settings in the WebView's `localStorage`, but that
//! store is flushed to disk lazily and recent writes can be lost when the
//! process is killed abruptly (e.g. an OS shutdown). For a handful of one-time
//! flags where that loss is user-visible — notably "onboarding completed" — we
//! mirror the value into `config_dir/app_flags.json`, which is written through
//! immediately and survives an abrupt shutdown. The frontend treats the backend
//! value as the durable source of truth and reconciles localStorage from it on
//! startup.

use crate::state::AppState;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::State;

fn flags_path(state: &State<AppState>) -> PathBuf {
    state.config_dir.join("app_flags.json")
}

fn read_flags(path: &PathBuf) -> BTreeMap<String, String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

/// Read a durable flag, or `None` if it has never been set.
#[tauri::command]
pub fn app_flag_get(key: String, state: State<AppState>) -> Option<String> {
    read_flags(&flags_path(&state)).get(&key).cloned()
}

/// Write a durable flag, flushing it to disk immediately.
#[tauri::command]
pub fn app_flag_set(key: String, value: String, state: State<AppState>) -> Result<(), String> {
    let path = flags_path(&state);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let mut flags = read_flags(&path);
    flags.insert(key, value);
    let content =
        serde_json::to_string_pretty(&flags).map_err(|e| format!("Failed to serialize flags: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write flags: {e}"))?;
    Ok(())
}
