use crate::state::AppState;
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

/// Copy a user-selected image into the app's data dir, downscale it if it's large,
/// and return the stored file path for the frontend to load through Tauri's asset
/// protocol.
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
    let direct_dest = dir.join(format!("background.{ext}"));
    let resized_dest = dir.join("background.jpg");

    let final_dest = if is_vector_or_anim {
        std::fs::copy(&src, &direct_dest).map_err(|e| format!("Failed to save image: {e}"))?;
        direct_dest
    } else {
        let max_dim = 1600;
        match image::image_dimensions(&src) {
            Ok((w, h)) if w > max_dim || h > max_dim => {
                let img = image::open(&src).map_err(|e| format!("Failed to process image: {e}"))?;
                img.resize(max_dim, max_dim, image::imageops::FilterType::Triangle)
                    .save(&resized_dest)
                    .map_err(|e| format!("Failed to save optimized image: {e}"))?;
                resized_dest
            }
            Ok(_) => {
                std::fs::copy(&src, &direct_dest)
                    .map_err(|e| format!("Failed to save image: {e}"))?;
                direct_dest
            }
            Err(_) => {
                std::fs::copy(&src, &direct_dest)
                    .map_err(|e| format!("Failed to save image: {e}"))?;
                direct_dest
            }
        }
    };

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
