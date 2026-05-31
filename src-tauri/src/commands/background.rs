use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::path::PathBuf;
use tauri::State;

/// Image formats users are allowed to set as a background.
const ALLOWED_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "jfif", "pjpeg", "pjp", "webp", "gif", "bmp", "svg", "avif", "ico",
    "tiff", "tif", "heic", "heif",
];

fn backgrounds_dir(state: &State<AppState>) -> PathBuf {
    state.config_dir.join("backgrounds")
}

fn mime_for(ext: &str) -> String {
    let ext_lower = ext.to_lowercase();
    match ext_lower.as_str() {
        "png" => "image/png".to_string(),
        "jpg" | "jpeg" | "jfif" | "pjpeg" | "pjp" => "image/jpeg".to_string(),
        "webp" => "image/webp".to_string(),
        "gif" => "image/gif".to_string(),
        "bmp" => "image/bmp".to_string(),
        "svg" => "image/svg+xml".to_string(),
        "avif" => "image/avif".to_string(),
        "ico" => "image/x-icon".to_string(),
        "tiff" | "tif" => "image/tiff".to_string(),
        "heic" => "image/heic".to_string(),
        "heif" => "image/heif".to_string(),
        "" => "image/jpeg".to_string(),
        other => format!("image/{other}"),
    }
}

/// Locate the single stored background file (named `background.<ext>`), if any.
fn find_existing(dir: &PathBuf) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_stem().and_then(|s| s.to_str()) == Some("background") {
            return Some(path);
        }
    }
    None
}

/// Read an image file and encode it as a `data:` URL the webview can render
/// directly (the app CSP already allows `data:` for img-src).
fn to_data_url(path: &PathBuf) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read image: {e}"))?;
    let encoded = STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime_for(&ext), encoded))
}

/// Copy a user-selected image into the app's data dir, downscale it if it's large to
/// prevent base64 IPC issues in the webview, and return it as a data URL.
/// Any previously stored background is replaced.
#[tauri::command]
pub fn background_image_set(src_path: String, state: State<AppState>) -> Result<String, String> {
    let src = PathBuf::from(&src_path);

    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        return Err(format!("Unsupported image format '.{ext}'."));
    }

    let dir = backgrounds_dir(&state);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create folder: {e}"))?;

    // Remove any existing background files first.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.file_stem().and_then(|s| s.to_str()) == Some("background") {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    let is_vector_or_anim = ext == "svg" || ext == "gif";
    let dest = if is_vector_or_anim {
        dir.join(format!("background.{ext}"))
    } else {
        dir.join("background.jpg")
    };

    let mut final_dest = dest.clone();
    let mut optimized = false;

    // Resizing large images avoids WebView data-url payload limits.
    // Vector SVG and animated GIF formats are skipped.
    if !is_vector_or_anim {
        if let Ok(img) = image::open(&src) {
            let max_dim = 1600;
            let (w, h) = (img.width(), img.height());
            let optimized_img = if w > max_dim || h > max_dim {
                img.resize(max_dim, max_dim, image::imageops::FilterType::Triangle)
            } else {
                img
            };
            if optimized_img.save(&dest).is_ok() {
                optimized = true;
            }
        }
    }

    // Fallback: Copy directly if optimization failed or was skipped (SVG / GIF)
    if !optimized {
        final_dest = dir.join(format!("background.{ext}"));
        std::fs::copy(&src, &final_dest).map_err(|e| format!("Failed to save image: {e}"))?;
    }

    to_data_url(&final_dest)
}

/// Return the stored background as a data URL, or `None` if none is set.
#[tauri::command]
pub fn background_image_get(state: State<AppState>) -> Result<Option<String>, String> {
    let dir = backgrounds_dir(&state);
    match find_existing(&dir) {
        Some(path) => Ok(Some(to_data_url(&path)?)),
        None => Ok(None),
    }
}

/// Delete the stored background image.
#[tauri::command]
pub fn background_image_clear(state: State<AppState>) -> Result<(), String> {
    let dir = backgrounds_dir(&state);
    if let Some(path) = find_existing(&dir) {
        std::fs::remove_file(path).map_err(|e| format!("Failed to remove image: {e}"))?;
    }
    Ok(())
}
