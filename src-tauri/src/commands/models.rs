use std::path::{Path, PathBuf};
use std::fs;
use std::sync::{OnceLock, Mutex};
use std::collections::HashSet;
use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Emitter};
use futures_util::StreamExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub category: String, // "stt" | "tts"
    pub size: String,
    pub description: String,
    pub url: String,
    pub filename: String,
    pub downloaded: bool,
}

#[derive(Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub model_id: String,
    pub progress: f64,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub phase: String, // "main" | "voices" | "done"
}

#[derive(Clone, Serialize)]
pub struct DownloadErrorPayload {
    pub model_id: String,
    pub error: String,
}

static ACTIVE_DOWNLOADS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn active_downloads() -> &'static Mutex<HashSet<String>> {
    ACTIVE_DOWNLOADS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn get_models_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("soryq")
        .join("models")
}

#[tauri::command]
pub async fn list_downloadable_models() -> Result<Vec<ModelInfo>, String> {
    let models_dir = get_models_dir();
    let mut list = vec![
        ModelInfo {
            id: "whisper-tiny-en".to_string(),
            name: "Whisper Tiny (English)".to_string(),
            category: "stt".to_string(),
            size: "75 MB".to_string(),
            description: "Super fast, lightweight English transcription. Runs well on any CPU.".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin".to_string(),
            filename: "ggml-tiny.en.bin".to_string(),
            downloaded: false,
        },
        ModelInfo {
            id: "whisper-base-en".to_string(),
            name: "Whisper Base (English)".to_string(),
            category: "stt".to_string(),
            size: "140 MB".to_string(),
            description: "Balanced speed and accuracy English transcription.".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin".to_string(),
            filename: "ggml-base.en.bin".to_string(),
            downloaded: false,
        },
        ModelInfo {
            id: "parakeet-tdt-110m".to_string(),
            name: "NVIDIA Parakeet TDT (English)".to_string(),
            category: "stt".to_string(),
            size: "110 MB".to_string(),
            description: "Highly accurate and fast local English transcription with strong punctuation (ONNX format).".to_string(),
            url: "https://huggingface.co/nvidia/parakeet-tdt-0.6b/resolve/main/parakeet-tdt.onnx".to_string(),
            filename: "parakeet-tdt.onnx".to_string(),
            downloaded: false,
        },
        ModelInfo {
            id: "kokoro-tts-v0.19".to_string(),
            name: "Kokoro TTS (v0.19)".to_string(),
            category: "tts".to_string(),
            size: "330 MB".to_string(),
            description: "State-of-the-art offline text-to-speech engine. Extremely human-like voices (ONNX format).".to_string(),
            url: "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v0_19.onnx".to_string(),
            filename: "kokoro-v0_19.onnx".to_string(),
            downloaded: false,
        }
    ];

    for model in &mut list {
        let path = models_dir.join(&model.filename);
        let exists = path.exists() && path.metadata().map(|m| m.len() > 0).unwrap_or(false);
        
        // Kokoro needs voices.bin as well to be considered fully downloaded
        if model.id == "kokoro-tts-v0.19" {
            let voices_path = models_dir.join("voices.bin");
            let voices_exists = voices_path.exists() && voices_path.metadata().map(|m| m.len() > 0).unwrap_or(false);
            model.downloaded = exists && voices_exists;
        } else {
            model.downloaded = exists;
        }
    }

    Ok(list)
}

#[tauri::command]
pub async fn download_model(app_handle: AppHandle, model_id: String) -> Result<(), String> {
    // 1. Guard against duplicate active downloads
    {
        let mut active = active_downloads().lock().map_err(|_| "Failed to lock active downloads")?;
        if active.contains(&model_id) {
            return Err("Model is already downloading".to_string());
        }
        active.insert(model_id.clone());
    }

    // 2. Resolve URLs and filenames
    let models_dir = get_models_dir();
    fs::create_dir_all(&models_dir).map_err(|e| format!("Failed to create models directory: {}", e))?;

    let (url, filename) = match model_id.as_str() {
        "whisper-tiny-en" => (
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin".to_string(),
            "ggml-tiny.en.bin".to_string()
        ),
        "whisper-base-en" => (
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin".to_string(),
            "ggml-base.en.bin".to_string()
        ),
        "parakeet-tdt-110m" => (
            "https://huggingface.co/nvidia/parakeet-tdt-0.6b/resolve/main/parakeet-tdt.onnx".to_string(),
            "parakeet-tdt.onnx".to_string()
        ),
        "kokoro-tts-v0.19" => (
            "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v0_19.onnx".to_string(),
            "kokoro-v0_19.onnx".to_string()
        ),
        _ => {
            active_downloads().lock().unwrap().remove(&model_id);
            return Err("Unknown model ID".to_string());
        }
    };

    let app_handle_clone = app_handle.clone();
    let model_id_clone = model_id.clone();

    // 3. Run download loop in a background thread
    tokio::spawn(async move {
        let result = async {
            // Download the main file
            download_file_inner(&app_handle_clone, &model_id_clone, &url, &models_dir.join(&filename), "main").await?;

            // If Kokoro, sequentially download voices.bin
            if model_id_clone == "kokoro-tts-v0.19" {
                let voices_url = "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/voices.bin";
                let voices_path = models_dir.join("voices.bin");
                download_file_inner(&app_handle_clone, &model_id_clone, voices_url, &voices_path, "voices").await?;
            }

            Ok::<(), String>(())
        }.await;

        // Clean up active download list
        if let Ok(mut active) = active_downloads().lock() {
            active.remove(&model_id_clone);
        }

        // Notify final status
        match result {
            Ok(_) => {
                let _ = app_handle_clone.emit("download-progress", DownloadProgressPayload {
                    model_id: model_id_clone,
                    progress: 100.0,
                    bytes_downloaded: 0,
                    total_bytes: None,
                    phase: "done".to_string(),
                });
            }
            Err(err) => {
                let _ = app_handle_clone.emit("download-error", DownloadErrorPayload {
                    model_id: model_id_clone,
                    error: err,
                });
            }
        }
    });

    Ok(())
}

async fn download_file_inner(
    app_handle: &AppHandle,
    model_id: &str,
    url: &str,
    dest_path: &Path,
    phase: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to download server: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned error code: {}", response.status()));
    }

    let total_size = response.content_length();
    
    // Download to a temporary file, then rename to prevent partial/corrupt files
    let temp_path = dest_path.with_extension("downloading");
    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temporary file: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_progress_emit = std::time::Instant::now();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Error while downloading stream: {}", e))?;
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("Failed to write chunk to disk: {}", e))?;
        downloaded += chunk.len() as u64;

        // Throttle progress updates to avoid flooding the IPC channel
        if last_progress_emit.elapsed().as_millis() > 100 {
            let progress = if let Some(total) = total_size {
                (downloaded as f64 / total as f64) * 100.0
            } else {
                0.0
            };

            let _ = app_handle.emit("download-progress", DownloadProgressPayload {
                model_id: model_id.to_string(),
                progress,
                bytes_downloaded: downloaded,
                total_bytes: total_size,
                phase: phase.to_string(),
            });
            last_progress_emit = std::time::Instant::now();
        }
    }

    // Flush and rename
    std::io::Write::flush(&mut file).map_err(|e| format!("Failed to flush file: {}", e))?;
    drop(file);

    if dest_path.exists() {
        fs::remove_file(dest_path).map_err(|e| format!("Failed to replace old file: {}", e))?;
    }
    fs::rename(&temp_path, dest_path)
        .map_err(|e| format!("Failed to finalize model download: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_model(model_id: String) -> Result<(), String> {
    let models_dir = get_models_dir();
    let filename = match model_id.as_str() {
        "whisper-tiny-en" => "ggml-tiny.en.bin",
        "whisper-base-en" => "ggml-base.en.bin",
        "parakeet-tdt-110m" => "parakeet-tdt.onnx",
        "kokoro-tts-v0.19" => {
            let voices_path = models_dir.join("voices.bin");
            if voices_path.exists() {
                let _ = fs::remove_file(voices_path);
            }
            "kokoro-v0_19.onnx"
        }
        _ => return Err("Unknown model ID".to_string()),
    };

    let path = models_dir.join(filename);
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Failed to remove model file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_model_path(model_id: String) -> Result<String, String> {
    let models_dir = get_models_dir();
    let filename = match model_id.as_str() {
        "whisper-tiny-en" => "ggml-tiny.en.bin",
        "whisper-base-en" => "ggml-base.en.bin",
        "parakeet-tdt-110m" => "parakeet-tdt.onnx",
        "kokoro-tts-v0.19" => "kokoro-v0_19.onnx",
        _ => return Err("Unknown model ID".to_string()),
    };

    let path = models_dir.join(filename);
    if !path.exists() {
        return Err("Model is not downloaded".to_string());
    }

    Ok(path.to_string_lossy().to_string())
}

fn wav_to_f32_pcm(wav_bytes: &[u8]) -> Result<Vec<f32>, String> {
    if wav_bytes.len() < 44 {
        return Err("WAV file is too short".to_string());
    }
    
    if &wav_bytes[0..4] != b"RIFF" || &wav_bytes[8..12] != b"WAVE" {
        return Err("Not a valid WAV file".to_string());
    }

    // Skip the 44-byte WAV header and parse s16le PCM samples
    let pcm_data = &wav_bytes[44..];
    let num_samples = pcm_data.len() / 2;
    let mut f32_samples = Vec::with_capacity(num_samples);

    for i in 0..num_samples {
        let sample_bytes = [pcm_data[i * 2], pcm_data[i * 2 + 1]];
        let sample_i16 = i16::from_le_bytes(sample_bytes);
        f32_samples.push(sample_i16 as f32 / 32768.0);
    }

    Ok(f32_samples)
}

#[tauri::command]
pub async fn local_stt_transcribe(
    audio_bytes: Vec<u8>,
    model_id: String,
) -> Result<String, String> {
    let f32_samples = wav_to_f32_pcm(&audio_bytes)?;
    let model_path = get_model_path(model_id).await?;

    let model_path_clone = model_path.clone();
    let transcript = tokio::task::spawn_blocking(move || {
        Ok::<String, String>(format!(
            "[Offline Mode] Local Whisper / Parakeet transcription mock (Path: {}) for {} audio samples.",
            model_path_clone, f32_samples.len()
        ))
    })
    .await
    .map_err(|e| format!("Transcription thread crashed: {}", e))??;

    Ok(transcript)
}

#[derive(Serialize)]
pub struct TtsAudioPayload {
    pub bytes: Vec<u8>,
    pub mime_type: String,
}

#[tauri::command]
pub async fn local_tts_speak(
    text: String,
    model_id: String,
    voice: String,
) -> Result<TtsAudioPayload, String> {
    let _model_path = get_model_path(model_id.clone()).await?;
    
    // Kokoro TTS offline execution requires phonetization (G2P), which depends on espeak-ng.
    // For now, return a clear descriptive error guiding the user.
    Err(format!(
        "Local TTS model '{}' with voice '{}' for text '{}' is ready, but built-in offline Rust execution is pending espeak-ng linking. Please use system speech or run a local TTS server.",
        model_id, voice, text
    ))
}

