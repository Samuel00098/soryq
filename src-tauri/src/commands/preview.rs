use crate::state::AppState;
use tauri::State;

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
    validate_target_port(port)?;
    state.preview_manager.set_target_port(port)
}

#[tauri::command]
pub fn preview_start_local_proxy(
    port: u16,
    host: Option<String>,
    state: State<AppState>,
) -> Result<u16, String> {
    validate_target_port(port)?;
    state.preview_manager.start_local_dev_proxy(host, port)
}

fn validate_target_port(port: u16) -> Result<(), String> {
    if port == 0 {
        return Err("Port 0 is not a valid target port".to_string());
    }
    // Block well-known service ports to prevent the proxy from being used to probe internal services
    const BLOCKED: &[u16] = &[
        22, 23, 25, 53, 110, 135, 139, 143, 445, 993, 995, 2375, 3306, 3389, 5432, 6379, 6443,
        8500, 9090, 27017,
    ];
    if BLOCKED.contains(&port) {
        return Err(format!(
            "Port {} is reserved for system services and cannot be used as a proxy target",
            port
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn preview_set_preferred_local_host(
    host: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    state.preview_manager.set_preferred_local_host(host)
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

/// Validates that a URL is safe to open in the browser.
/// Returns the canonical URL string if valid, or an error message.
pub fn validate_browser_url(url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only HTTP and HTTPS URLs are allowed".to_string());
    }
    Ok(parsed.as_str().to_string())
}

/// Open a URL in the system's default web browser.
#[tauri::command]
pub async fn preview_open_in_browser(url: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let canonical = validate_browser_url(&url)?;
    #[allow(deprecated)]
    app.shell()
        .open(&canonical, None)
        .map_err(|e| format!("Failed to open browser: {}", e))
}

/// Clear cookies and cache for the embedded preview WebView2 profile.
///
/// The preview renders proxied content (and external sites) inside the main
/// webview, so stale auth cookies — e.g. a JWT minted against a skewed clock —
/// and cached assets accumulate in the shared WebView2 profile. This clears the
/// cookie + HTTP/cache layers (`COOKIES | DISK_CACHE | CACHE_STORAGE |
/// SERVICE_WORKERS`) only; `LOCAL_STORAGE`/`INDEXED_DB` are deliberately left
/// untouched so the app's own persisted state (settings, sketches) survives.
#[tauri::command]
pub async fn preview_clear_browsing_data(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    #[cfg(target_os = "windows")]
    {
        let (tx, rx) = std::sync::mpsc::channel();

        window
            .with_webview(move |webview| {
                let _ = tx.send(clear_webview2_browsing_data(webview));
            })
            .map_err(|e| e.to_string())?;

        return rx
            .recv()
            .map_err(|_| "Clearing browsing data was interrupted".to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("Clearing preview cookies and cache is only supported on Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
fn clear_webview2_browsing_data(
    webview: tauri::webview::PlatformWebview,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS,
        COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
        COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
        COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS,
    };
    use webview2_com::ClearBrowsingDataCompletedHandler;
    use windows::core::Interface;

    let controller = webview.controller();
    let core = unsafe { controller.CoreWebView2() }.map_err(|e| e.to_string())?;

    // Profile() lives on ICoreWebView2_13; ClearBrowsingData() on ICoreWebView2Profile2.
    let core13: ICoreWebView2_13 = core.cast().map_err(|e| e.to_string())?;
    let profile = unsafe { core13.Profile() }.map_err(|e| e.to_string())?;
    let profile2: ICoreWebView2Profile2 = profile.cast().map_err(|e| e.to_string())?;

    let kinds = COREWEBVIEW2_BROWSING_DATA_KINDS(
        COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES.0
            | COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE.0
            | COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE.0
            | COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS.0,
    );

    unsafe {
        ClearBrowsingDataCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| {
                profile2
                    .ClearBrowsingData(kinds, &handler)
                    .map_err(webview2_com::Error::WindowsError)
            }),
            Box::new(|result| {
                result?;
                Ok(())
            }),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Capture the preview panel region as PNG bytes.
/// x, y, width, height are CSS (logical) pixels relative to the webview; scale = devicePixelRatio.
///
/// On Windows this uses WebView2's native CapturePreview API. GDI BitBlt can
/// read WebView2 as a blank hardware-composited surface, so we capture the
/// webview itself and crop to the requested DOM rectangle.
#[tauri::command]
pub async fn preview_capture_screenshot(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
) -> Result<Vec<u8>, String> {
    use tauri::Manager;

    if width == 0 || height == 0 {
        return Err("Invalid capture dimensions".to_string());
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let phys_w = (width as f64 * scale).round() as u32;
    let phys_h = (height as f64 * scale).round() as u32;

    if phys_w == 0 || phys_h == 0 {
        return Err("Invalid capture dimensions".to_string());
    }

    // Guard against absurd sizes: the pixel buffer is phys_w * phys_h * 4 bytes and
    // is handed to GDI as i32 dimensions. Capping well below i32::MAX prevents the
    // size multiplication from overflowing and GetDIBits from writing out of bounds.
    const MAX_CAPTURE_DIM: u32 = 16_384;
    if phys_w > MAX_CAPTURE_DIM || phys_h > MAX_CAPTURE_DIM {
        return Err("Capture dimensions too large".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let phys_x = (x.max(0) as f64 * scale).round() as i32;
        let phys_y = (y.max(0) as f64 * scale).round() as i32;
        let (tx, rx) = std::sync::mpsc::channel();

        window
            .with_webview(move |webview| {
                let result =
                    capture_webview2_region(webview, phys_x, phys_y, phys_w, phys_h);
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;

        return rx
            .recv()
            .map_err(|_| "Screenshot capture was interrupted".to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        let _ = phys_w;
        let _ = phys_h;
        let _ = x;
        let _ = y;
        let _ = scale;
        return Err("Screenshot not supported on this platform".to_string());
    }

    #[allow(unreachable_code)]
    Err("Screenshot not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
fn capture_webview2_region(
    webview: tauri::webview::PlatformWebview,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    use image::DynamicImage;
    use std::io::Cursor;
    use std::slice;
    use webview2_com::{
        CapturePreviewCompletedHandler,
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    };
    use windows::Win32::{
        Foundation::HGLOBAL,
        System::{
            Com::StructuredStorage::{CreateStreamOnHGlobal, GetHGlobalFromStream},
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        },
    };

    let controller = webview.controller();
    let core = unsafe { controller.CoreWebView2() }.map_err(|e| e.to_string())?;
    let stream =
        unsafe { CreateStreamOnHGlobal(HGLOBAL::default(), true) }.map_err(|e| e.to_string())?;
    let capture_stream = stream.clone();

    unsafe {
        CapturePreviewCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| {
                core.CapturePreview(
                    COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                    &capture_stream,
                    &handler,
                )
                .map_err(webview2_com::Error::WindowsError)
            }),
            Box::new(|result| {
                result?;
                Ok(())
            }),
        )
        .map_err(|e| e.to_string())?;
    }

    let png = unsafe {
        let hglobal = GetHGlobalFromStream(&stream).map_err(|e| e.to_string())?;
        let size = GlobalSize(hglobal);
        if size == 0 {
            return Err("WebView2 returned an empty screenshot".to_string());
        }
        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            return Err("Failed to read WebView2 screenshot stream".to_string());
        }
        let bytes = slice::from_raw_parts(ptr as *const u8, size).to_vec();
        let _ = GlobalUnlock(hglobal);
        bytes
    };

    let image = image::load_from_memory(&png)
        .map_err(|e| format!("Failed to decode WebView2 screenshot: {e}"))?
        .to_rgba8();
    let (image_w, image_h) = image.dimensions();
    let crop_x = x.max(0) as u32;
    let crop_y = y.max(0) as u32;
    if crop_x >= image_w || crop_y >= image_h {
        return Err("Capture region is outside the webview".to_string());
    }
    let crop_w = width.min(image_w - crop_x);
    let crop_h = height.min(image_h - crop_y);
    if crop_w == 0 || crop_h == 0 {
        return Err("Invalid cropped capture dimensions".to_string());
    }

    let cropped = image::imageops::crop_imm(&image, crop_x, crop_y, crop_w, crop_h).to_image();
    let dynamic = DynamicImage::ImageRgba8(cropped);
    let mut buf = Vec::new();
    dynamic
        .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_browser_url_accepts_https() {
        let result = validate_browser_url("https://example.com");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "https://example.com/");
    }

    #[test]
    fn validate_browser_url_accepts_http() {
        let result = validate_browser_url("http://localhost:3000");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_browser_url_rejects_javascript_scheme() {
        let result = validate_browser_url("javascript:alert(1)");
        assert!(result.is_err());
    }

    #[test]
    fn validate_browser_url_rejects_file_scheme() {
        let result = validate_browser_url("file:///etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn validate_browser_url_rejects_ms_msdt_scheme() {
        // ms-msdt is not a valid URL per the url crate (no host) — parse fails
        let result = validate_browser_url("ms-msdt:id PCWDiagnostic");
        assert!(result.is_err());
    }

    #[test]
    fn validate_browser_url_rejects_data_uri() {
        let result = validate_browser_url("data:text/html,<script>alert(1)</script>");
        assert!(result.is_err());
    }

    #[test]
    fn validate_browser_url_rejects_invalid_url() {
        let result = validate_browser_url("not a url at all");
        assert!(result.is_err());
    }

    #[test]
    fn validate_browser_url_returns_canonical_form() {
        // The url crate normalises paths, so path traversal segments are resolved
        let result = validate_browser_url("https://example.com/path/../other");
        assert!(result.is_ok());
        // The canonical URL should resolve the traversal
        let canonical = result.unwrap();
        assert!(canonical.starts_with("https://example.com/"));
    }

    #[test]
    fn validate_browser_url_accepts_https_with_path_and_query() {
        let result = validate_browser_url("https://example.com/path?q=1&r=2");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_browser_url_accepts_http_localhost_with_port() {
        let result = validate_browser_url("http://localhost:5173/");
        assert!(result.is_ok());
    }
}
