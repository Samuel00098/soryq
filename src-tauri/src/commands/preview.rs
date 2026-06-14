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

/// Clear browsing data for the embedded preview webview profile.
///
/// The preview renders proxied content (and external sites) inside the main
/// webview, so stale auth cookies — e.g. a JWT minted against a skewed clock —
/// and cached assets can accumulate in the platform webview profile. Tauri maps
/// this to the native WebView2, WKWebView, or WebKitGTK clear operation for the
/// current OS.
#[tauri::command]
pub async fn preview_clear_browsing_data(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    window
        .clear_all_browsing_data()
        .map_err(|e| format!("Failed to clear browsing data: {e}"))
}

/// Capture the preview panel region as PNG bytes.
/// x, y, width, height are CSS (logical) pixels relative to the webview; scale = devicePixelRatio.
///
/// Uses WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux. GDI
/// BitBlt can read WebView2 as a blank hardware-composited surface, so we
/// capture the webview itself and crop to the requested DOM rectangle.
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
                let result = capture_webview2_region(webview, phys_x, phys_y, phys_w, phys_h);
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;

        return rx
            .recv()
            .map_err(|_| "Screenshot capture was interrupted".to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let logical_x = x.max(0) as f64;
        let logical_y = y.max(0) as f64;
        let logical_w = width as f64;
        let logical_h = height as f64;
        let snapshot_width = phys_w as f64;
        let (tx, rx) = std::sync::mpsc::channel();

        window
            .with_webview(move |webview| {
                if let Err(error) = start_wkwebview_region_capture(
                    webview,
                    logical_x,
                    logical_y,
                    logical_w,
                    logical_h,
                    snapshot_width,
                    tx.clone(),
                ) {
                    let _ = tx.send(Err(error));
                }
            })
            .map_err(|e| e.to_string())?;

        return rx
            .recv()
            .map_err(|_| "Screenshot capture was interrupted".to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let phys_x = (x.max(0) as f64 * scale).round() as i32;
        let phys_y = (y.max(0) as f64 * scale).round() as i32;
        let (tx, rx) = std::sync::mpsc::channel();

        window
            .with_webview(move |webview| {
                if let Err(error) = start_webkitgtk_region_capture(
                    webview,
                    phys_x,
                    phys_y,
                    phys_w,
                    phys_h,
                    tx.clone(),
                ) {
                    let _ = tx.send(Err(error));
                }
            })
            .map_err(|e| e.to_string())?;

        return rx
            .recv()
            .map_err(|_| "Screenshot capture was interrupted".to_string())?;
    }

    #[cfg(all(
        not(target_os = "windows"),
        not(target_os = "macos"),
        not(target_os = "linux")
    ))]
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

#[cfg(target_os = "linux")]
fn start_webkitgtk_region_capture(
    webview: tauri::webview::PlatformWebview,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

    let webview = webview.inner();
    webview.snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::empty(),
        None::<&webkit2gtk::gio::Cancellable>,
        move |result| {
            let result = result
                .map_err(|e| e.to_string())
                .and_then(|surface| crop_cairo_surface_to_png(surface, x, y, width, height));
            let _ = tx.send(result);
        },
    );

    Ok(())
}

#[cfg(target_os = "linux")]
fn crop_cairo_surface_to_png(
    surface: cairo::Surface,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    use image::DynamicImage;
    use std::io::Cursor;

    let mut png = Vec::new();
    surface
        .write_to_png(&mut png)
        .map_err(|e| format!("Failed to encode WebKitGTK screenshot: {e}"))?;

    let image = image::load_from_memory(&png)
        .map_err(|e| format!("Failed to decode WebKitGTK screenshot: {e}"))?
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

#[cfg(target_os = "macos")]
fn start_wkwebview_region_capture(
    webview: tauri::webview::PlatformWebview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    snapshot_width: f64,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSImage;
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSError, NSNumber};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "WKWebView screenshot capture must start on the main thread".to_string())?;
    let wkwebview = unsafe {
        (webview.inner() as *mut WKWebView)
            .as_ref()
            .ok_or_else(|| "WKWebView handle was not available".to_string())?
    };

    let config = unsafe { WKSnapshotConfiguration::new(mtm) };
    let rect = CGRect::new(CGPoint::new(x, y), CGSize::new(width, height));
    let snapshot_width = NSNumber::new_f64(snapshot_width);

    unsafe {
        config.setRect(rect);
        config.setSnapshotWidth(Some(&snapshot_width));
        config.setAfterScreenUpdates(true);
    }

    let config_for_callback = config.clone();
    let snapshot_width_for_callback = snapshot_width.clone();
    let handler = block2::RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        let _keep_alive = (&config_for_callback, &snapshot_width_for_callback);
        let result = unsafe { wk_snapshot_to_png(image, error) };
        let _ = tx.send(result);
    });

    unsafe {
        wkwebview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
    }

    Ok(())
}

#[cfg(target_os = "macos")]
unsafe fn wk_snapshot_to_png(
    image: *mut objc2_app_kit::NSImage,
    error: *mut objc2_foundation::NSError,
) -> Result<Vec<u8>, String> {
    use core::ffi::c_void;
    use core::ptr::NonNull;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;

    if image.is_null() {
        let message = if error.is_null() {
            "WKWebView did not return a screenshot"
        } else {
            "WKWebView failed to capture the screenshot"
        };
        return Err(message.to_string());
    }

    let image = &*image;
    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| "WKWebView screenshot could not be converted to TIFF".to_string())?;
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or_else(|| "WKWebView screenshot could not be converted to bitmap data".to_string())?;
    let properties = NSDictionary::<objc2_app_kit::NSBitmapImageRepPropertyKey, AnyObject>::new();
    let png = bitmap
        .representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
        .ok_or_else(|| "WKWebView screenshot could not be encoded as PNG".to_string())?;

    let len = png.length() as usize;
    if len == 0 {
        return Err("WKWebView returned an empty screenshot".to_string());
    }

    let mut bytes = vec![0u8; len];
    let buffer = NonNull::new(bytes.as_mut_ptr() as *mut c_void)
        .ok_or_else(|| "Failed to allocate screenshot buffer".to_string())?;
    png.getBytes_length(buffer, len);
    Ok(bytes)
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
