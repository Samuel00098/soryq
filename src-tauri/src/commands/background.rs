use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

/// Image formats users are allowed to set as a background.
const ALLOWED_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "jfif", "pjpeg", "pjp", "webp", "gif", "apng", "bmp", "svg", "avif",
    "ico", "tiff", "tif", "heic", "heif",
];
/// Video formats users are allowed to set as a live wallpaper.
const ALLOWED_VIDEO_EXT: &[&str] = &["mp4", "webm", "m4v", "mov", "ogv"];
const MAX_BACKGROUND_BYTES: u64 = 10 * 1024 * 1024;
const MAX_LIVE_BACKGROUND_BYTES: u64 = 100 * 1024 * 1024;

fn backgrounds_dir(state: &State<AppState>) -> PathBuf {
    state.config_dir.join("backgrounds")
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

fn is_supported_media(ext: &str) -> bool {
    ALLOWED_EXT.contains(&ext) || ALLOWED_VIDEO_EXT.contains(&ext)
}

fn max_media_bytes(ext: &str) -> u64 {
    if ALLOWED_VIDEO_EXT.contains(&ext) {
        MAX_LIVE_BACKGROUND_BYTES
    } else {
        MAX_BACKGROUND_BYTES
    }
}

/// Copy a user-selected image/video into the app's data dir and return the stored
/// file path for the frontend to load through Tauri's asset protocol.
/// Any previously stored background is replaced.
#[tauri::command]
pub fn background_image_set(src_path: String, state: State<AppState>) -> Result<String, String> {
    let src = PathBuf::from(&src_path);

    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !is_supported_media(&ext) {
        return Err(format!("Unsupported background format '.{ext}'."));
    }
    let src_size = std::fs::metadata(&src)
        .map_err(|e| format!("Failed to read background file info: {e}"))?
        .len();
    let max_size = max_media_bytes(&ext);
    if src_size > max_size {
        if ALLOWED_VIDEO_EXT.contains(&ext.as_str()) {
            return Err("Live wallpaper is too large. Choose a video up to 100 MB.".to_string());
        }
        return Err("Image is too large. Choose an image up to 10 MB.".to_string());
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

    let direct_dest = dir.join(format!("background.{ext}"));

    std::fs::copy(&src, &direct_dest).map_err(|e| format!("Failed to save background: {e}"))?;
    let final_dest = direct_dest;

    Ok(final_dest.to_string_lossy().to_string())
}

/// Return the stored background path, or `None` if none is set.
#[tauri::command]
pub fn background_image_get(state: State<AppState>) -> Result<Option<String>, String> {
    let dir = backgrounds_dir(&state);
    match find_existing(&dir) {
        Some(path) => Ok(Some(path.to_string_lossy().to_string())),
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
