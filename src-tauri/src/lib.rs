mod commands;
mod error;
mod preview;
mod pty;
mod state;
mod theme;
mod workspace;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("forge");

    std::fs::create_dir_all(&config_dir).ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(config_dir))
        .invoke_handler(tauri::generate_handler![
            commands::theme::theme_list,
            commands::theme::theme_activate,
            commands::theme::theme_get_active,
            commands::theme::theme_save,
            commands::workspace::workspace_open_project,
            commands::workspace::workspace_get_active,
            commands::workspace::workspace_set_active,
            commands::workspace::workspace_list_projects,
            commands::workspace::workspace_get_recent,
            commands::workspace::workspace_clear_recent,
            commands::workspace::workspace_git_push,
            commands::workspace::workspace_git_commit,
            commands::workspace::workspace_git_fetch,
            commands::workspace::workspace_git_status,
            commands::workspace::workspace_git_diff,
            commands::workspace::workspace_git_log,
            commands::workspace::workspace_git_discard_file,
            commands::workspace::workspace_git_discard_all,
            commands::workspace::workspace_detect_port,
            commands::workspace::workspace_search_codebase,
            commands::file_system::fs_read_dir,
            commands::file_system::fs_create_file,
            commands::file_system::fs_create_dir,
            commands::file_system::fs_rename,
            commands::file_system::fs_delete,
            commands::file_system::fs_copy,
            commands::file_system::fs_read_file,
            commands::file_system::fs_write_file,
            commands::file_system::fs_get_file_info,
            commands::terminal::terminal_create,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::terminal::terminal_list,
            commands::terminal::terminal_list_shells,
            commands::preview::preview_start_proxy,
            commands::preview::preview_stop_proxy,
            commands::preview::preview_set_target_port,
            commands::preview::preview_get_target_port,
            commands::preview::preview_get_proxy_port,
            commands::preview::preview_clear_proxy_target,
            commands::preview::preview_open_in_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running forge application");
}
