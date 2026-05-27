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

/// Open a URL in the system's default web browser.
#[tauri::command]
pub async fn preview_open_in_browser(url: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only HTTP and HTTPS URLs are allowed".to_string());
    }
    #[allow(deprecated)]
    app.shell()
        .open(&url, None)
        .map_err(|e| format!("Failed to open browser: {}", e))
}

/// Capture the preview panel region as PNG bytes.
/// x, y, width, height are CSS (logical) pixels relative to the webview; scale = devicePixelRatio.
///
/// Windows: uses GDI BitBlt against the screen.
/// macOS/Linux: uses Tauri's WebviewWindow::capture_image() (webview-native, no screen access needed).
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
    use image::{DynamicImage, RgbaImage};
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
        use windows_sys::Win32::Graphics::Gdi::*;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetDesktopWindow;

        let win_pos = window.inner_position().map_err(|e| e.to_string())?;
        let phys_x = (win_pos.x as f64 + x as f64 * scale).round() as i32;
        let phys_y = (win_pos.y as f64 + y as f64 * scale).round() as i32;
        let phys_w_i = phys_w as i32;
        let phys_h_i = phys_h as i32;

        let pixels = unsafe {
            let hwnd = GetDesktopWindow();
            let screen_dc = GetDC(hwnd);
            let mem_dc = CreateCompatibleDC(screen_dc);
            let bmp = CreateCompatibleBitmap(screen_dc, phys_w_i, phys_h_i);
            let old_bmp = SelectObject(mem_dc, bmp as isize);

            BitBlt(mem_dc, 0, 0, phys_w_i, phys_h_i, screen_dc, phys_x, phys_y, SRCCOPY);

            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: phys_w_i,
                    biHeight: -phys_h_i, // negative = top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB as u32,
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
                pixels.as_mut_ptr() as *mut _,
                &mut bmi,
                DIB_RGB_COLORS,
            );

            SelectObject(mem_dc, old_bmp);
            DeleteObject(bmp as isize);
            DeleteDC(mem_dc);
            ReleaseDC(hwnd, screen_dc);

            // GDI returns BGRA — swap B and R to get RGBA
            for chunk in pixels.chunks_exact_mut(4) {
                chunk.swap(0, 2);
            }
            pixels
        };

        let rgba_img = RgbaImage::from_raw(phys_w, phys_h, pixels)
            .ok_or_else(|| "Failed to build image".to_string())?;
        let dynamic = DynamicImage::ImageRgba8(rgba_img);
        let mut buf = Vec::new();
        dynamic
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        return Ok(buf);
    }

    // macOS and Linux: capture the webview content directly.
    // capture_image() returns the full webview render at physical resolution;
    // we crop to the element's rect (x,y are CSS pixels, multiply by scale for physical).
    #[cfg(not(target_os = "windows"))]
    {
        let full_img = window.capture_image().map_err(|e| e.to_string())?;
        let crop_x = (x.max(0) as f64 * scale).round() as u32;
        let crop_y = (y.max(0) as f64 * scale).round() as u32;
        // crop_imm clamps to image bounds automatically
        let cropped = full_img.crop_imm(crop_x, crop_y, phys_w, phys_h);
        let mut buf = Vec::new();
        cropped
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        return Ok(buf);
    }

    #[allow(unreachable_code)]
    Err("Screenshot not supported on this platform".to_string())
}
