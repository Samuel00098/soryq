use tauri::{AppHandle, Manager};

#[derive(serde::Deserialize)]
pub struct NotificationPayload {
    title: String,
    body: String,
}

fn focus_main_window(app: AppHandle) {
    let app_for_thread = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_for_thread.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
}

#[tauri::command]
pub async fn notification_show(app: AppHandle, payload: NotificationPayload) -> Result<(), String> {
    show_system_notification(app, payload)
}

#[cfg(target_os = "windows")]
fn show_system_notification(app: AppHandle, payload: NotificationPayload) -> Result<(), String> {
    use tauri_winrt_notification::{Duration, Toast};

    let app_id = app.config().identifier.clone();
    let focus_app = app.clone();

    Toast::new(&app_id)
        .title(&payload.title)
        .text1(&payload.body)
        .duration(Duration::Short)
        .on_activated(move |_| {
            focus_main_window(focus_app.clone());
            Ok(())
        })
        .show()
        .map_err(|err| format!("Failed to show Windows notification: {err}"))
}

#[cfg(not(target_os = "windows"))]
fn show_system_notification(app: AppHandle, payload: NotificationPayload) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    app.notification()
        .builder()
        .title(payload.title)
        .body(payload.body)
        .show()
        .map_err(|err| format!("Failed to show notification: {err}"))
}
