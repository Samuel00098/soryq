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
    if port == 0 {
        return Err("Port 0 is not a valid target port".to_string());
    }
    // Block well-known service ports to prevent the proxy from being used to probe internal services
    const BLOCKED: &[u16] = &[22, 23, 25, 53, 110, 135, 139, 143, 445, 993, 995, 2375, 3306, 3389, 5432, 6379, 6443, 8500, 9090, 27017];
    if BLOCKED.contains(&port) {
        return Err(format!("Port {} is reserved for system services and cannot be used as a proxy target", port));
    }
    state.preview_manager.set_target_port(port)
}

#[tauri::command]
pub fn preview_set_preferred_local_host(host: Option<String>, state: State<AppState>) -> Result<(), String> {
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

/// Capture the preview panel region as PNG bytes.
/// x, y, width, height are CSS (logical) pixels relative to the webview; scale = devicePixelRatio.
///
/// Uses GDI BitBlt against the app's own WebviewWindow HWND — NOT GetDesktopWindow().
/// This restricts the capture to the app's own rendered content and cannot capture other
/// windows, the desktop, or any content outside of this app's window.
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
    use std::io::Cursor;

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

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Graphics::Gdi::*;

        // Use the webview's own HWND — this constrains GDI capture to our app window only.
        // GetDC on our own window returns the window's device context; BitBlt from it
        // gives only pixels rendered by our app, not other windows or the desktop.
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;

        let phys_x = (x.max(0) as f64 * scale).round() as i32;
        let phys_y = (y.max(0) as f64 * scale).round() as i32;
        let phys_w_i = phys_w as i32;
        let phys_h_i = phys_h as i32;

        let pixels = unsafe {
            let win_dc = GetDC(Some(hwnd));
            let mem_dc = CreateCompatibleDC(Some(win_dc));
            let bmp = CreateCompatibleBitmap(win_dc, phys_w_i, phys_h_i);
            let old_bmp = SelectObject(mem_dc, bmp.into());

            BitBlt(mem_dc, 0, 0, phys_w_i, phys_h_i, Some(win_dc), phys_x, phys_y, SRCCOPY)
                .map_err(|e| e.to_string())?;

            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: phys_w_i,
                    biHeight: -phys_h_i, // negative = top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [RGBQUAD { rgbBlue: 0, rgbGreen: 0, rgbRed: 0, rgbReserved: 0 }],
            };

            let mut pixels = vec![0u8; (phys_w_i * phys_h_i * 4) as usize];
            GetDIBits(
                mem_dc, bmp, 0, phys_h_i as u32,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            );

            SelectObject(mem_dc, old_bmp);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem_dc);
            ReleaseDC(Some(hwnd), win_dc);

            // GDI returns BGRA — swap B and R to get RGBA
            for chunk in pixels.chunks_exact_mut(4) {
                chunk.swap(0, 2);
            }
            pixels
        };

        use image::{DynamicImage, RgbaImage};
        let rgba_img = RgbaImage::from_raw(phys_w, phys_h, pixels)
            .ok_or_else(|| "Failed to build image".to_string())?;
        let dynamic = DynamicImage::ImageRgba8(rgba_img);
        let mut buf = Vec::new();
        dynamic
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        return Ok(buf);
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
