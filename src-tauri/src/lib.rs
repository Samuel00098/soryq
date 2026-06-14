mod commands;
mod error;
mod lsp;
mod preview;
mod pty;
mod state;
mod theme;
mod workspace;

use state::AppState;
use std::io;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base_config_dir = dirs::config_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let config_dir = base_config_dir.join("soryq");

    std::fs::create_dir_all(&config_dir).expect("failed to create soryq config directory");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg_attr(
                not(any(target_os = "macos", target_os = "windows")),
                allow(unused_variables)
            )]
            let Some(window) = app.get_webview_window("main") else {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "main webview window not found",
                )
                .into());
            };
            #[cfg(target_os = "macos")]
            let _ = window_vibrancy::apply_vibrancy(
                &window,
                window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground,
                None,
                None,
            );

            #[cfg(target_os = "windows")]
            {
                // Try acrylic first (frosted glass), fallback to mica or basic blur
                if window_vibrancy::apply_acrylic(&window, Some((15, 15, 20, 10))).is_err() {
                    let _ = window_vibrancy::apply_mica(&window, None);
                }
            }

            Ok(())
        })
        .manage(AppState::new(config_dir))
        .invoke_handler(tauri::generate_handler![
            commands::theme::theme_list,
            commands::theme::theme_activate,
            commands::theme::theme_get_active,
            commands::theme::theme_save,
            commands::background::background_image_set,
            commands::background::background_image_get,
            commands::background::background_image_clear,
            commands::secrets::provider_api_key_exists,
            commands::secrets::provider_api_key_set,
            commands::secrets::provider_api_key_delete,
            commands::secrets::ai_refine_prompt,
            commands::secrets::ai_transcribe_audio,
            commands::secrets::ai_complete,
            commands::secrets::ai_generate_commit_message,
            commands::secrets::list_provider_models,
            commands::secrets::check_local_provider_online,
            commands::secrets::tts_speak,
            commands::http::http_send_request,
            commands::notification::notification_show,
            commands::workspace::workspace_open_project,
            commands::workspace::workspace_get_active,
            commands::workspace::workspace_set_active,
            commands::workspace::workspace_list_projects,
            commands::workspace::workspace_get_recent,
            commands::workspace::workspace_clear_recent,
            commands::workspace::workspace_get_recent_daily_notes,
            commands::workspace::workspace_git_push,
            commands::workspace::workspace_git_commit,
            commands::workspace::workspace_git_fetch,
            commands::workspace::workspace_git_status,
            commands::workspace::workspace_git_diff,
            commands::workspace::workspace_resolve_conflict,
            commands::workspace::workspace_git_log,
            commands::workspace::workspace_git_discard_file,
            commands::workspace::workspace_git_discard_all,
            commands::workspace::workspace_detect_port,
            commands::workspace::workspace_search_codebase,
            commands::workspace::workspace_git_branches,
            commands::workspace::workspace_git_checkout,
            commands::workspace::workspace_git_branch_create,
            commands::workspace::workspace_git_branch_delete,
            commands::github::github_token_set,
            commands::github::github_token_exists,
            commands::github::github_token_delete,
            commands::github::workspace_github_create_repo,
            commands::db::db_list_tables,
            commands::db::db_execute_query,
            commands::file_system::fs_read_dir,
            commands::file_system::fs_create_file,
            commands::file_system::fs_create_dir,
            commands::file_system::fs_rename,
            commands::file_system::fs_delete,
            commands::file_system::fs_copy,
            commands::file_system::fs_read_file,
            commands::file_system::fs_read_binary,
            commands::file_system::fs_write_file,
            commands::file_system::fs_write_binary,
            commands::file_system::fs_get_file_info,
            commands::search::search_in_project,
            commands::env_vars::env_vault_get,
            commands::env_vars::env_vault_set,
            commands::env_vars::env_vault_import_dotenv,
            commands::terminal::terminal_create,
            commands::terminal::terminal_attach,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::terminal::terminal_list,
            commands::terminal::terminal_list_shells,
            commands::lsp::lsp_check_server,
            commands::lsp::lsp_start,
            commands::lsp::lsp_install_server,
            commands::preview::preview_start_proxy,
            commands::preview::preview_start_local_proxy,
            commands::preview::preview_stop_proxy,
            commands::preview::preview_set_target_port,
            commands::preview::preview_set_preferred_local_host,
            commands::preview::preview_get_target_port,
            commands::preview::preview_get_proxy_port,
            commands::preview::preview_clear_proxy_target,
            commands::preview::preview_open_in_browser,
            commands::preview::preview_capture_screenshot,
            commands::preview::preview_clear_browsing_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running forge application");
}
