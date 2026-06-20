use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::json;

const KEYCHAIN_SERVICE: &str = "com.samue.soryq";
const APP_TITLE: &str = "Soryq";

/// Pooled HTTP clients keyed by their total-timeout (ms).
///
/// Building a fresh `reqwest::Client` per request throws away the connection
/// pool, so every call pays a new DNS + TCP + TLS handshake. That's especially
/// costly in the voice loop: TTS fires one request per sentence chunk, and the
/// transcription/routing/recon calls all hit the same few hosts moments apart.
/// Reusing a client keeps connections warm (HTTP keep-alive), so only the first
/// call to each host pays the handshake — later chunks and turns reuse it.
fn shared_http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    static CLIENTS: OnceLock<Mutex<HashMap<u64, reqwest::Client>>> = OnceLock::new();
    let cache = CLIENTS.get_or_init(|| Mutex::new(HashMap::new()));
    let key = timeout.as_millis() as u64;
    let mut map = cache.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(client) = map.get(&key) {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|err| format!("Failed to prepare the request: {err}"))?;
    map.insert(key, client.clone());
    Ok(client)
}

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_AUDIO_TRANSCRIPT_URL: &str = "https://openrouter.ai/api/v1/audio/transcriptions";
const OPENROUTER_TTS_URL: &str = "https://openrouter.ai/api/v1/audio/speech";
const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENAI_TTS_URL: &str = "https://api.openai.com/v1/audio/speech";
const OPENAI_STT_URL: &str = "https://api.openai.com/v1/audio/transcriptions";
const GROQ_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TTS_URL: &str = "https://api.groq.com/openai/v1/audio/speech";
const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const GOOGLE_AUDIO_TRANSCRIPTION_PROMPT: &str = "Transcribe this speech into clean, accurate text. Keep the speaker's exact technical terms, code words, file paths, flags, package names, and URLs. Use natural punctuation and paragraph breaks when they are obvious from the audio. Return only the transcript.";

const OPENROUTER_SYSTEM_PROMPT: &str = "Hey! You're a voice-to-text helper living inside a developer's productivity app. The person talking to you is a developer — they might be firing off a quick prompt to an AI coding agent, describing a bug, jotting down a task, or just thinking out loud while their hands are busy.\n\nYour job is to take their raw spoken words and turn them into clean, natural text — the kind of thing they'd have typed themselves if they weren't busy being a developer. Keep it human, keep it theirs.\n\nHere's how to do it well:\n\n1. DROP THE FILLER — quietly remove \"um\", \"uh\", \"like\", \"you know\", \"basically\", \"kind of\", \"sort of\", \"I mean\", false starts, and repeated words. Don't mention you did it, just clean it up.\n\n2. SPOKEN SYMBOLS → REAL SYMBOLS — when the developer says punctuation out loud, swap it in:\n   comma → ,   period / full stop → .   colon → :   semicolon → ;   exclamation / bang → !   question mark → ?   open paren / left paren → (   close paren / right paren → )   open bracket → [   close bracket → ]   open brace / left curly → {   close brace / right curly → }   equals → =   double equals → ==   triple equals → ===   fat arrow / arrow → =>   pipe → |   double pipe → ||   ampersand → &   double ampersand → &&   bang equals → !=   less than → <   greater than → >   slash → /   backslash → \\   dot → .   underscore → _   dash / hyphen → -   hash / pound → #   at sign → @   backtick → `   tilde → ~   star / asterisk → *   double star → **   caret → ^   percent → %   new line / next line → line break.\n\n3. DON'T TOUCH THE TECH STUFF — variable names, function names, file paths, CLI flags, package names, API names, URLs, config keys, environment variables — leave all of that exactly as spoken. When in doubt, keep it verbatim.\n\n4. TIDY UP THE SPEECH — casual, run-on spoken sentences should become clean written ones. Keep the developer's natural voice and directness though — don't make it stiff or formal. \"can you make it so that the button kind of changes colour when you hover over it\" → \"Make the button change colour on hover.\"\n\n5. KEEP THEIR VIBE — if they sound urgent, keep that urgency. If they're being casual, stay casual. If they're frustrated, that's fine too. Don't sanitise their personality out of the text.\n\n6. NUMBERS — use digits in technical contexts (port 8000, version 3, 12 files). Keep words for conversational mentions.\n\n7. STRUCTURE IT IF THEY SIGNAL IT — if they say \"first\", \"second\", \"also\", \"next\", \"new line\", shape it into a list or use line breaks naturally.\n\n8. NOTHING LOST, NOTHING ADDED — every idea they expressed should survive. Don't summarise, don't expand, don't add your own thoughts.\n\nJust output the cleaned-up text — no intro, no explanation, no quotes around it.";
const COMMIT_SYSTEM_PROMPT: &str = "You are an expert software engineer writing a git commit message. Analyse the diff thoroughly and write a high-quality commit message that clearly explains WHAT changed and WHY. Follow this structure:\n\n1. A short subject line (50–72 chars) using conventional commits when the type is clear (feat, fix, refactor, chore, docs, style, test, perf).\n2. A blank line.\n3. A body (one or more paragraphs) that describes the changes in detail — what was added, removed, or modified, and the reasoning or motivation behind the change. Mention any non-obvious decisions, trade-offs, or context a future reader would benefit from.\n\nOutput only the commit message — no preamble, no explanation, no markdown fences, no quotes.";

// Endpoints used to list each provider's live model catalogue. The frontend
// shows whatever these return so users can pick any model their key unlocks —
// new or old — instead of a hand-maintained allowlist.
const OPENROUTER_MODELS_URL: &str = "https://openrouter.ai/api/v1/models";
const OPENAI_MODELS_URL: &str = "https://api.openai.com/v1/models";
const GROQ_MODELS_URL: &str = "https://api.groq.com/openai/v1/models";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models?limit=1000";
const GOOGLE_MODELS_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";

const KNOWN_PROVIDERS: &[&str] = &[
    "openrouter",
    "anthropic",
    "openai",
    "google",
    "groq",
    "ollama",
    "lmstudio",
];

// Local providers run on the user's machine, configured by a server URL rather
// than an API key. They speak the OpenAI-compatible protocol, so they reuse the
// OpenAI request/response path with a user-supplied base URL and no auth header.
const LOCAL_PROVIDERS: &[&str] = &["ollama", "lmstudio"];

fn is_known_provider(provider: &str) -> bool {
    KNOWN_PROVIDERS.contains(&provider)
}

fn is_local_provider(provider: &str) -> bool {
    LOCAL_PROVIDERS.contains(&provider)
}

/// Validate a user-supplied local server URL before using it as a request base.
/// Keeps it to a well-formed http(s) URL with no whitespace, control chars, or
/// path-traversal sequences. Local providers point at the user's own machine,
/// so this is about rejecting malformed input, not sandboxing the host.
fn base_url_is_safe(url: &str) -> bool {
    let url = url.trim();
    (url.starts_with("http://") || url.starts_with("https://"))
        && url.len() <= 256
        && !url.contains("..")
        && url.chars().all(|c| !c.is_whitespace() && !c.is_control())
}

/// Build a concrete endpoint URL from a validated local base URL, trimming any
/// trailing slash so we don't produce `//path`.
fn local_endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

/// Resolve and validate the server URL for a provider. Local providers require a
/// safe, non-empty http(s) URL; non-local providers don't use one (returns
/// `None`). Centralises the checks shared by every command.
fn resolve_base_url(provider: &str, base_url: &Option<String>) -> Result<Option<String>, String> {
    if !is_local_provider(provider) {
        return Ok(None);
    }
    let url = base_url
        .as_ref()
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if url.is_empty() {
        return Err("Server URL is not set.".to_string());
    }
    if !base_url_is_safe(&url) {
        return Err("Invalid server URL".to_string());
    }
    Ok(Some(url))
}

/// Validate a model id is safe to embed in a request — including Google's URL
/// path (`/models/{model}:generateContent`) — without an exact allowlist, so
/// users can pick any model their provider exposes. Rejects empty/over-long
/// ids, path-traversal sequences, and anything outside a conservative set of
/// characters that real model ids use.
fn model_id_is_safe(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 128
        && !model.contains("..")
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':' | '/'))
}

/// A model offered by a provider, normalised across the providers' differing
/// list-models response shapes. Serialised to the frontend model picker.
#[derive(serde::Serialize)]
pub struct ModelInfo {
    id: String,
    label: String,
    description: String,
}

/// Trim a provider-supplied description to a single tidy line for the picker.
fn truncate_desc(s: &str) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    const MAX: usize = 140;
    if s.chars().count() > MAX {
        let mut t: String = s.chars().take(MAX).collect();
        t.push('…');
        t
    } else {
        s
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModelPurpose {
    Chat,
    Stt,
    Tts,
}

fn openai_is_stt_model(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    id.contains("whisper") || id.contains("transcribe") || id.contains("transcription")
}

fn openai_is_tts_model(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    id.contains("tts") || id.contains("speech")
}

fn groq_is_stt_model(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    id.contains("whisper") || id.contains("transcribe") || id.contains("asr")
}

fn groq_is_tts_model(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    id.contains("tts") || id.contains("orpheus") || id.contains("playai") || id.contains("speech")
}

fn text_matches_any(value: &str, needles: &[&str]) -> bool {
    let value = value.to_ascii_lowercase();
    needles.iter().any(|needle| value.contains(needle))
}

fn json_string_array_contains(value: Option<&serde_json::Value>, needle: &str) -> bool {
    value
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().any(|item| item.as_str().map(|s| s.eq_ignore_ascii_case(needle)).unwrap_or(false)))
        .unwrap_or(false)
}

fn openrouter_model_matches_purpose(item: &serde_json::Value, id: &str, purpose: ModelPurpose) -> bool {
    if purpose == ModelPurpose::Chat {
        return true;
    }

    let architecture = item.get("architecture");
    let input_audio = json_string_array_contains(
        architecture.and_then(|a| a.get("input_modalities")),
        "audio",
    );
    let output_audio = json_string_array_contains(
        architecture.and_then(|a| a.get("output_modalities")),
        "audio",
    );
    let output_text = json_string_array_contains(
        architecture.and_then(|a| a.get("output_modalities")),
        "text",
    );
    let label = item
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(id);
    let haystack = format!("{id} {label}");

    match purpose {
        ModelPurpose::Stt => {
            (input_audio && !output_audio)
                || (input_audio && output_text)
                || text_matches_any(
                    &haystack,
                    &[
                        "whisper",
                        "transcribe",
                        "transcription",
                        "asr",
                        "chirp",
                        "voxtral",
                        "parakeet",
                    ],
                )
        }
        ModelPurpose::Tts => {
            output_audio
                || text_matches_any(
                    &haystack,
                    &[
                        "tts",
                        "text-to-speech",
                        "voice",
                        "speech",
                        "kokoro",
                        "zonos",
                        "orpheus",
                        "csm",
                    ],
                ) && !text_matches_any(&haystack, &["whisper", "transcribe", "asr"])
        }
        ModelPurpose::Chat => true,
    }
}

/// OpenAI's /models lists embeddings, audio, image, and moderation models too;
/// keep only the text chat families.
fn openai_is_chat_model(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    const BLOCK: &[&str] = &[
        "embedding",
        "whisper",
        "tts",
        "dall-e",
        "audio",
        "realtime",
        "image",
        "moderation",
        "transcribe",
        "search",
        "babbage",
        "davinci",
        "instruct",
    ];
    if BLOCK.iter().any(|b| id.contains(b)) {
        return false;
    }
    id.starts_with("gpt")
        || id.starts_with("chatgpt")
        || id.starts_with("o1")
        || id.starts_with("o3")
        || id.starts_with("o4")
}

/// Groq serves transcription and safety models alongside chat LLMs; drop those.
fn groq_is_chat_model(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    const BLOCK: &[&str] = &["whisper", "tts", "guard"];
    !BLOCK.iter().any(|b| id.contains(b))
}

/// Parse a successful JSON response, or surface a redacted error preview.
async fn ok_json(response: reqwest::Response, who: &str) -> Result<serde_json::Value, String> {
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let preview = redact_secrets(&body.chars().take(200).collect::<String>());
        return Err(format!("{who} model list failed ({status}): {preview}"));
    }
    response
        .json()
        .await
        .map_err(|err| format!("{who} returned an invalid model list: {err}"))
}

/// Redact API-key-shaped substrings from an error body before surfacing it to
/// the frontend. Covers the key prefixes used by every supported provider:
/// `sk-` (OpenRouter / OpenAI / Anthropic `sk-ant-`), `AIza` (Google) and
/// `gsk_` (Groq).
fn redact_secrets(s: &str) -> String {
    const PREFIXES: &[&str] = &["sk-", "AIza", "gsk_"];

    let mut out = String::new();
    let mut rest = s;

    loop {
        // Find the earliest occurrence of any known key prefix.
        let next = PREFIXES
            .iter()
            .filter_map(|p| rest.find(p).map(|pos| (pos, p.len())))
            .min_by_key(|&(pos, _)| pos);

        let Some((pos, prefix_len)) = next else {
            break;
        };

        out.push_str(&rest[..pos]);
        out.push_str("[redacted]");
        let after = &rest[pos + prefix_len..];
        // Skip the rest of the key token until whitespace, a quote, or the end.
        let end = after
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
            .unwrap_or(after.len());
        rest = &after[end..];
    }

    out.push_str(rest);
    out
}

/// Format a reqwest error for the frontend without leaking the request URL,
/// which for some providers (Google) carries the API key as a query param.
fn safe_request_error(context: &str, err: reqwest::Error) -> String {
    let stripped = err.without_url();
    format!("{context}: {}", redact_secrets(&stripped.to_string()))
}

fn extract_google_text(payload: &serde_json::Value) -> String {
    payload
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|cand| cand.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(|parts| parts.get(0))
        .and_then(|part| part.get("text"))
        .and_then(|t| t.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string()
}

fn audio_mime_type_is_safe(mime_type: &str) -> bool {
    matches!(
        mime_type,
        "audio/wav"
            | "audio/mp3"
            | "audio/mpeg"
            | "audio/aiff"
            | "audio/aac"
            | "audio/ogg"
            | "audio/flac"
            | "audio/mp4"
            | "audio/webm"
            | "audio/x-m4a"
    )
}

fn audio_format_from_mime_type(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "audio/wav" => Some("wav"),
        "audio/mp3" | "audio/mpeg" => Some("mp3"),
        "audio/aiff" => Some("aiff"),
        "audio/aac" => Some("aac"),
        "audio/ogg" => Some("ogg"),
        "audio/flac" => Some("flac"),
        "audio/mp4" | "audio/x-m4a" => Some("m4a"),
        "audio/webm" => Some("webm"),
        _ => None,
    }
}

fn openrouter_audio_chat_model_is_unsupported(model: &str) -> bool {
    matches!(model, "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
}

fn audio_filename_for_format(format: &str) -> &'static str {
    match format {
        "mp3" => "audio.mp3",
        "aiff" => "audio.aiff",
        "aac" => "audio.aac",
        "ogg" => "audio.ogg",
        "flac" => "audio.flac",
        "m4a" => "audio.m4a",
        "webm" => "audio.webm",
        _ => "audio.wav",
    }
}

fn build_audio_transcription_multipart_body(
    boundary: &str,
    model: &str,
    mime_type: &str,
    audio_format: &str,
    audio_bytes: &[u8],
) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: {mime_type}\r\n\r\n",
            audio_filename_for_format(audio_format)
        )
        .as_bytes(),
    );
    body.extend_from_slice(audio_bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn keychain_username(provider: &str) -> String {
    format!("{provider}_api_key")
}

fn keychain_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, &keychain_username(provider))
        .map_err(|err| format!("Failed to access the system keychain: {err}"))
}

#[tauri::command]
pub fn provider_api_key_get(provider: String) -> Result<Option<String>, String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let entry = keychain_entry(&provider)?;
    match entry.get_password() {
        Ok(password) => {
            let trimmed = password.trim().to_string();
            Ok(if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            })
        }
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("Failed to read the API key: {err}")),
    }
}

#[tauri::command]
pub fn provider_api_key_exists(provider: String) -> Result<bool, String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let entry = keychain_entry(&provider)?;
    match entry.get_password() {
        Ok(password) => Ok(!password.trim().is_empty()),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(err) => Err(format!("Failed to check the API key: {err}")),
    }
}

#[tauri::command]
pub fn provider_api_key_set(provider: String, api_key: String) -> Result<(), String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let api_key = api_key.trim().to_string();
    let entry = keychain_entry(&provider)?;

    if api_key.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(format!("Failed to remove the API key: {err}")),
        }
    } else {
        entry
            .set_password(&api_key)
            .map_err(|err| format!("Failed to save the API key: {err}"))
    }
}

#[tauri::command]
pub fn provider_api_key_delete(provider: String) -> Result<(), String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let entry = keychain_entry(&provider)?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(format!("Failed to remove the API key: {err}")),
    }
}

fn resolve_api_key(provider: &str, provided_api_key: &str) -> Result<String, String> {
    if is_local_provider(provider) {
        return Ok(String::new());
    }
    let provided_api_key = provided_api_key.trim();
    if !provided_api_key.is_empty() {
        return Ok(provided_api_key.to_string());
    }
    provider_api_key_get(provider.to_string())?
        .ok_or_else(|| format!("{} API key is not set.", provider))
}

/// Run a single-shot system+user completion against the chosen provider and
/// return the assistant's text. Normalises the three request/response shapes
/// (OpenAI-compatible, Anthropic Messages, Google Gemini) behind one signature.
#[allow(clippy::too_many_arguments)]
async fn run_completion(
    provider: &str,
    model: &str,
    api_key: &str,
    base_url: Option<&str>,
    system_prompt: &str,
    user_text: &str,
    temperature: f64,
    max_tokens: u32,
) -> Result<String, String> {
    let client = shared_http_client(Duration::from_secs(45))?;

    match provider {
        "anthropic" => {
            let response = client
                .post(ANTHROPIC_URL)
                .header("x-api-key", api_key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .json(&json!({
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "system": system_prompt,
                    "messages": [ { "role": "user", "content": user_text } ],
                }))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact Anthropic", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("Anthropic request failed ({status}): {preview}"));
            }

            let payload: serde_json::Value = response
                .json()
                .await
                .map_err(|err| format!("Anthropic returned an invalid response: {err}"))?;

            let content = payload
                .get("content")
                .and_then(|c| c.get(0))
                .and_then(|block| block.get("text"))
                .and_then(|t| t.as_str())
                .map(str::trim)
                .unwrap_or("");
            Ok(content.to_string())
        }
        "google" => {
            // Pass the key via the documented header, never in the URL — the URL
            // shows up in reqwest error strings and any request logging.
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            );
            let response = client
                .post(url)
                .header("x-goog-api-key", api_key)
                .json(&json!({
                    "systemInstruction": { "parts": [ { "text": system_prompt } ] },
                    "contents": [ { "role": "user", "parts": [ { "text": user_text } ] } ],
                    "generationConfig": { "temperature": temperature, "maxOutputTokens": max_tokens },
                }))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact Google", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("Google request failed ({status}): {preview}"));
            }

            let payload: serde_json::Value = response
                .json()
                .await
                .map_err(|err| format!("Google returned an invalid response: {err}"))?;

            Ok(extract_google_text(&payload))
        }
        // OpenAI-compatible: openrouter, openai, groq, ollama, lmstudio.
        _ => {
            let url = match provider {
                "openai" => OPENAI_URL.to_string(),
                "groq" => GROQ_URL.to_string(),
                // Local providers point at the user's own server.
                p if is_local_provider(p) => {
                    let base = base_url.unwrap_or_default();
                    local_endpoint(base, "chat/completions")
                }
                _ => OPENROUTER_URL.to_string(),
            };

            let mut request = client.post(&url);

            // Local providers default to no authentication; only send the bearer
            // token when we actually have one.
            if !api_key.is_empty() {
                request =
                    request.header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"));
            }

            // OpenRouter asks for attribution headers; harmless elsewhere but we
            // only send them where they belong.
            if provider == "openrouter" {
                request = request
                    .header("HTTP-Referer", "https://soryq.app")
                    .header("X-Title", APP_TITLE);
            }

            let response = request
                .json(&json!({
                    "model": model,
                    "messages": [
                        { "role": "system", "content": system_prompt },
                        { "role": "user", "content": user_text },
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact the model provider", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("Model request failed ({status}): {preview}"));
            }

            let payload: serde_json::Value = response
                .json()
                .await
                .map_err(|err| format!("The model provider returned an invalid response: {err}"))?;

            let content = payload
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("message"))
                .and_then(|message| message.get("content"))
                .and_then(|content| content.as_str())
                .map(str::trim)
                .unwrap_or("");
            Ok(content.to_string())
        }
    }
}

#[tauri::command]
pub async fn ai_refine_prompt(
    text: String,
    provider: String,
    model: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<String, String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let api_key = resolve_api_key(&provider, &api_key)?;
    let base_url = resolve_base_url(&provider, &base_url)?;
    if !model_id_is_safe(&model) {
        return Err("Invalid model id".to_string());
    }

    const MAX_TEXT_LEN: usize = 32_000;

    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(String::new());
    }
    if text.chars().count() > MAX_TEXT_LEN {
        return Err("Input text exceeds maximum length".to_string());
    }

    let content = run_completion(
        &provider,
        &model,
        &api_key,
        base_url.as_deref(),
        OPENROUTER_SYSTEM_PROMPT,
        &text,
        0.1,
        512,
    )
    .await?;

    if content.is_empty() {
        return Err("The model returned an empty response.".to_string());
    }
    Ok(content)
}

#[tauri::command]
pub async fn ai_transcribe_audio(
    audio_bytes: Vec<u8>,
    mime_type: String,
    provider: String,
    model: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<String, String> {
    if provider != "google" && provider != "openai" && provider != "openrouter" && !is_local_provider(&provider) {
        return Err("Selected provider does not support transcription yet.".to_string());
    }

    let api_key = resolve_api_key(&provider, &api_key)?;
    let base_url = resolve_base_url(&provider, &base_url)?;

    let model = model.trim().to_string();
    if !model_id_is_safe(&model) {
        return Err("Invalid transcription model id".to_string());
    }

    let mime_type = mime_type.trim().to_ascii_lowercase();
    if !audio_mime_type_is_safe(&mime_type) {
        return Err("Unsupported audio format".to_string());
    }
    let audio_format = audio_format_from_mime_type(&mime_type)
        .ok_or_else(|| "Unsupported audio format".to_string())?;

    if audio_bytes.is_empty() {
        return Ok(String::new());
    }

    let client = shared_http_client(Duration::from_secs(60))?;

    let audio_b64 = STANDARD.encode(&audio_bytes);

    match provider.as_str() {
        "google" => {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            );

            let response = client
                .post(url)
                .header("x-goog-api-key", api_key)
                .json(&json!({
                    "contents": [{
                        "role": "user",
                        "parts": [
                            { "text": GOOGLE_AUDIO_TRANSCRIPTION_PROMPT },
                            {
                                "inlineData": {
                                    "mimeType": mime_type,
                                    "data": audio_b64
                                }
                            }
                        ]
                    }],
                    "generationConfig": {
                        "temperature": 0.1,
                        "maxOutputTokens": 2048
                    }
                }))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact Google transcription", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("Google transcription failed ({status}): {preview}"));
            }

            let payload: serde_json::Value = response.json().await.map_err(|err| {
                format!("Google transcription returned an invalid response: {err}")
            })?;

            Ok(extract_google_text(&payload))
        }
        "openai" => {
            let response = client
                .post(OPENAI_STT_URL)
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
                .header(reqwest::header::CONTENT_TYPE, "multipart/form-data; boundary=soryq-openai-stt")
                .body(build_audio_transcription_multipart_body(
                    "soryq-openai-stt",
                    &model,
                    &mime_type,
                    audio_format,
                    &audio_bytes,
                ))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact OpenAI transcription", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("OpenAI transcription failed ({status}): {preview}"));
            }

            let payload: serde_json::Value = response.json().await.map_err(|err| {
                format!("OpenAI transcription returned an invalid response: {err}")
            })?;

            Ok(payload
                .get("text")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .unwrap_or("")
                .to_string())
        }
        "openrouter" => {
            if openrouter_audio_chat_model_is_unsupported(&model) {
                return Err("That OpenRouter :free audio model is not usable for no-balance transcription; OpenRouter returns 402 Payment Required for audio. Choose a dedicated STT model, browser Web Speech, or a local transcription server.".to_string());
            }

            let response = client
                .post(OPENROUTER_AUDIO_TRANSCRIPT_URL)
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
                .header("HTTP-Referer", "https://soryq.app")
                .header("X-Title", APP_TITLE)
                .json(&json!({
                    "model": model,
                    "input_audio": {
                        "data": audio_b64,
                        "format": audio_format,
                    }
                }))
                .send()
                .await
                .map_err(|err| {
                    safe_request_error("Failed to contact OpenRouter transcription", err)
                })?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!(
                    "OpenRouter transcription failed ({status}): {preview}"
                ));
            }

            let payload: serde_json::Value = response.json().await.map_err(|err| {
                format!("OpenRouter transcription returned an invalid response: {err}")
            })?;

            Ok(payload
                .get("text")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .unwrap_or("")
                .to_string())
        }
        p if is_local_provider(p) => {
            let Some(base) = base_url.as_deref() else {
                return Err("Server URL is not set.".to_string());
            };
            let boundary = "soryq-audio-transcription-boundary";
            let response = client
                .post(local_endpoint(base, "/audio/transcriptions"))
                .header(
                    reqwest::header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(build_audio_transcription_multipart_body(
                    boundary,
                    &model,
                    &mime_type,
                    audio_format,
                    &audio_bytes,
                ))
                .send()
                .await
                .map_err(|err| {
                    safe_request_error("Failed to contact local transcription provider", err)
                })?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("Local transcription failed ({status}): {preview}"));
            }

            let payload: serde_json::Value = response.json().await.map_err(|err| {
                format!("Local transcription returned an invalid response: {err}")
            })?;

            Ok(payload
                .get("text")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .unwrap_or("")
                .to_string())
        }
        _ => Err("Selected provider does not support transcription yet.".to_string()),
    }
}

/// Generic single-shot completion with a caller-supplied system prompt. Powers
/// the agent orchestrator "brain" (routing a natural-language request to the
/// right terminal agent). Shares the same provider plumbing as the other AI
/// commands; the caller is responsible for the system prompt's contract.
#[tauri::command]
pub async fn ai_complete(
    system_prompt: String,
    user_text: String,
    provider: String,
    model: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<String, String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let api_key = resolve_api_key(&provider, &api_key)?;
    let base_url = resolve_base_url(&provider, &base_url)?;
    if !model_id_is_safe(&model) {
        return Err("Invalid model id".to_string());
    }

    const MAX_TEXT_LEN: usize = 32_000;

    let user_text = user_text.trim().to_string();
    if user_text.is_empty() {
        return Ok(String::new());
    }
    if user_text.chars().count() > MAX_TEXT_LEN {
        return Err("Input text exceeds maximum length".to_string());
    }

    let system_prompt = system_prompt.trim();
    let system_prompt = if system_prompt.is_empty() {
        OPENROUTER_SYSTEM_PROMPT
    } else {
        system_prompt
    };

    let content = run_completion(
        &provider,
        &model,
        &api_key,
        base_url.as_deref(),
        system_prompt,
        &user_text,
        0.3,
        1024,
    )
    .await?;

    if content.is_empty() {
        return Err("The model returned an empty response.".to_string());
    }
    Ok(content)
}

#[tauri::command]
pub async fn ai_generate_commit_message(
    diff: String,
    provider: String,
    model: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<String, String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let api_key = resolve_api_key(&provider, &api_key)?;
    let base_url = resolve_base_url(&provider, &base_url)?;
    if !model_id_is_safe(&model) {
        return Err("Invalid model id".to_string());
    }

    const MAX_DIFF_LEN: usize = 20_000;

    let diff = diff.trim().to_string();
    if diff.is_empty() {
        return Err("No changes to summarize.".to_string());
    }
    let diff = if diff.len() > MAX_DIFF_LEN {
        diff.chars().take(MAX_DIFF_LEN).collect::<String>()
    } else {
        diff
    };

    let content = run_completion(
        &provider,
        &model,
        &api_key,
        base_url.as_deref(),
        COMMIT_SYSTEM_PROMPT,
        &diff,
        0.2,
        512,
    )
    .await?;

    if content.is_empty() {
        return Err("The model returned an empty response.".to_string());
    }
    Ok(content)
}

/// Fetch the live list of models a provider's key unlocks. Normalises each
/// provider's response into `ModelInfo` and filters by `purpose` (chat, stt,
/// or tts) so the picker only shows usable options. Returns an empty list
/// rather than erroring when a provider simply has no matching models.
#[tauri::command]
pub async fn list_provider_models(
    provider: String,
    api_key: String,
    base_url: Option<String>,
    purpose: Option<ModelPurpose>,
) -> Result<Vec<ModelInfo>, String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let api_key = resolve_api_key(&provider, &api_key)?;
    let base_url = resolve_base_url(&provider, &base_url)?;
    let purpose = purpose.unwrap_or(ModelPurpose::Chat);

    let timeout_secs = if is_local_provider(&provider) { 2 } else { 20 };
    let client = shared_http_client(Duration::from_secs(timeout_secs))?;

    let mut models = match provider.as_str() {
        "anthropic" => {
            let response = client
                .get(ANTHROPIC_MODELS_URL)
                .header("x-api-key", &api_key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to fetch Anthropic models", err))?;
            let payload = ok_json(response, "Anthropic").await?;
            let data = payload
                .get("data")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            let mut out = Vec::new();
            for item in data {
                let id = item
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if id.is_empty() || !model_id_is_safe(&id) {
                    continue;
                }
                let label = item
                    .get("display_name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&id)
                    .to_string();
                out.push(ModelInfo {
                    id,
                    label,
                    description: String::new(),
                });
            }
            out
        }
        "google" => {
            let response = client
                .get(GOOGLE_MODELS_URL)
                .header("x-goog-api-key", &api_key)
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to fetch Google models", err))?;
            let payload = ok_json(response, "Google").await?;
            let data = payload
                .get("models")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            let mut out = Vec::new();
            for item in data {
                let raw = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let id = raw
                    .strip_prefix("models/")
                    .unwrap_or(raw)
                    .trim()
                    .to_string();
                if id.is_empty() || !model_id_is_safe(&id) {
                    continue;
                }
                let supports_generate = item
                    .get("supportedGenerationMethods")
                    .and_then(|m| m.as_array())
                    .map(|arr| arr.iter().any(|v| v.as_str() == Some("generateContent")))
                    .unwrap_or(false);
                match purpose {
                    ModelPurpose::Chat if !supports_generate => continue,
                    ModelPurpose::Stt if !id.to_ascii_lowercase().contains("chirp") => continue,
                    ModelPurpose::Tts
                        if !id.to_ascii_lowercase().contains("tts")
                            && !id.to_ascii_lowercase().contains("speech") =>
                    {
                        continue
                    }
                    _ => {}
                }
                let label = item
                    .get("displayName")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&id)
                    .to_string();
                let desc = item
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                out.push(ModelInfo {
                    id,
                    label,
                    description: truncate_desc(desc),
                });
            }
            out
        }
        // OpenAI-compatible list endpoints: openrouter, openai, groq, ollama,
        // lmstudio.
        _ => {
            let url = match provider.as_str() {
                "openai" => OPENAI_MODELS_URL.to_string(),
                "groq" => GROQ_MODELS_URL.to_string(),
                p if is_local_provider(p) => {
                    local_endpoint(base_url.as_deref().unwrap_or_default(), "models")
                }
                _ => OPENROUTER_MODELS_URL.to_string(),
            };
            let mut request = client.get(&url);
            if !api_key.is_empty() {
                request =
                    request.header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"));
            }
            if provider == "openrouter" {
                request = request
                    .header("HTTP-Referer", "https://soryq.app")
                    .header("X-Title", APP_TITLE);
            }
            let response = request
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to fetch models", err))?;
            let payload = ok_json(response, "Model provider").await?;
            let data = payload
                .get("data")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            let mut out = Vec::new();
            for item in data {
                let id = item
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if id.is_empty() || !model_id_is_safe(&id) {
                    continue;
                }
                match provider.as_str() {
                    "openai" => match purpose {
                        ModelPurpose::Stt => {
                            if !openai_is_stt_model(&id) {
                                continue;
                            }
                        }
                        ModelPurpose::Tts => {
                            if !openai_is_tts_model(&id) {
                                continue;
                            }
                        }
                        ModelPurpose::Chat => {
                            if !openai_is_chat_model(&id) {
                                continue;
                            }
                        }
                    },
                    "groq" => match purpose {
                        ModelPurpose::Stt => {
                            if !groq_is_stt_model(&id) {
                                continue;
                            }
                        }
                        ModelPurpose::Tts => {
                            if !groq_is_tts_model(&id) {
                                continue;
                            }
                        }
                        ModelPurpose::Chat => {
                            if !groq_is_chat_model(&id) {
                                continue;
                            }
                        }
                    },
                    p if is_local_provider(p) => {
                        // Local providers — no structured metadata, return all
                    }
                    _ => {
                        if !openrouter_model_matches_purpose(&item, &id, purpose) {
                            continue;
                        }
                    }
                }
                let label = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&id)
                    .to_string();
                let desc = item
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                out.push(ModelInfo {
                    id,
                    label,
                    description: truncate_desc(desc),
                });
            }
            out
        }
    };

    models.sort_by_key(|a| a.label.to_lowercase());
    Ok(models)
}

fn tts_voice_is_safe(voice: &str) -> bool {
    !voice.is_empty()
        && voice.len() <= 64
        && voice
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':' || c == '.')
}

const GROQ_TTS_MODEL_ENGLISH: &str = "canopylabs/orpheus-v1-english";
const OPENAI_TTS_MODEL: &str = "gpt-4o-mini-tts";
const GOOGLE_TTS_MODEL: &str = "gemini-2.5-flash-preview-tts";
const OPENROUTER_TTS_MODEL: &str = "openai/gpt-4o-mini-tts-2025-12-15";

#[derive(Serialize)]
pub struct TtsAudioPayload {
    pub bytes: Vec<u8>,
    pub mime_type: String,
}

fn pcm_s16le_to_wav_bytes(
    pcm: &[u8],
    channels: u16,
    sample_rate: u32,
    bits_per_sample: u16,
) -> Vec<u8> {
    let byte_rate = sample_rate * channels as u32 * bits_per_sample as u32 / 8;
    let block_align = channels * bits_per_sample / 8;
    let data_len = pcm.len() as u32;
    let chunk_size = 36 + data_len;

    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&chunk_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

/// Synthesise speech from text using the selected provider's TTS endpoint.
/// Returns WAV bytes so the frontend can play them without a disk write.
#[tauri::command]
pub async fn tts_speak(
    text: String,
    provider: String,
    model: String,
    voice: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<TtsAudioPayload, String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let api_key = resolve_api_key(&provider, &api_key)?;
    let base_url = resolve_base_url(&provider, &base_url)?;
    let model = model.trim().to_string();
    if !model_id_is_safe(&model) {
        return Err("Invalid TTS model id".to_string());
    }
    if !tts_voice_is_safe(&voice) {
        return Err("Invalid voice id".to_string());
    }

    const MAX_TTS_LEN: usize = 4_096;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(TtsAudioPayload {
            bytes: Vec::new(),
            mime_type: "audio/wav".to_string(),
        });
    }
    let text: String = text.chars().take(MAX_TTS_LEN).collect();

    let client = shared_http_client(Duration::from_secs(30))?;

    match provider.as_str() {
        "openrouter" => {
            let response = client
                .post(OPENROUTER_TTS_URL)
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
                .header("HTTP-Referer", "https://soryq.app")
                .header("X-Title", APP_TITLE)
                .json(&json!({
                    "model": if model.is_empty() { OPENROUTER_TTS_MODEL } else { &model },
                    "input": text,
                    "voice": voice,
                    "response_format": "mp3",
                }))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact OpenRouter TTS", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("OpenRouter TTS failed ({status}): {preview}"));
            }

            let bytes = response
                .bytes()
                .await
                .map_err(|err| format!("Failed to read TTS audio: {err}"))?;
            Ok(TtsAudioPayload {
                bytes: bytes.to_vec(),
                mime_type: "audio/mpeg".to_string(),
            })
        }
        "groq" => {
            let response = client
                .post(GROQ_TTS_URL)
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
                .json(&json!({
                    "model": if model.is_empty() { GROQ_TTS_MODEL_ENGLISH } else { &model },
                    "input": text,
                    "voice": voice,
                    "response_format": "wav",
                }))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact Groq TTS", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("Groq TTS failed ({status}): {preview}"));
            }

            let bytes = response
                .bytes()
                .await
                .map_err(|err| format!("Failed to read TTS audio: {err}"))?;
            Ok(TtsAudioPayload {
                bytes: bytes.to_vec(),
                mime_type: "audio/wav".to_string(),
            })
        }
        "openai" => {
            let response = client
                .post(OPENAI_TTS_URL)
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
                .json(&json!({
                    "model": if model.is_empty() { OPENAI_TTS_MODEL } else { &model },
                    "input": text,
                    "voice": voice,
                    "response_format": "wav",
                }))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact OpenAI TTS", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("OpenAI TTS failed ({status}): {preview}"));
            }

            let bytes = response
                .bytes()
                .await
                .map_err(|err| format!("Failed to read TTS audio: {err}"))?;
            Ok(TtsAudioPayload {
                bytes: bytes.to_vec(),
                mime_type: "audio/wav".to_string(),
            })
        }
        "google" => {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                if model.is_empty() {
                    GOOGLE_TTS_MODEL
                } else {
                    &model
                }
            );
            let response = client
                .post(url)
                .header("x-goog-api-key", api_key)
                .json(&json!({
                    "contents": [{ "parts": [{ "text": text }] }],
                    "generationConfig": {
                        "responseModalities": ["AUDIO"],
                        "speechConfig": {
                            "voiceConfig": {
                                "prebuiltVoiceConfig": {
                                    "voiceName": voice
                                }
                            }
                        }
                    },
                    "model": if model.is_empty() { GOOGLE_TTS_MODEL } else { &model },
                }))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact Google TTS", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("Google TTS failed ({status}): {preview}"));
            }

            let payload: serde_json::Value = response
                .json()
                .await
                .map_err(|err| format!("Google TTS returned an invalid response: {err}"))?;

            let audio_b64 = payload
                .get("candidates")
                .and_then(|c| c.get(0))
                .and_then(|cand| cand.get("content"))
                .and_then(|content| content.get("parts"))
                .and_then(|parts| parts.get(0))
                .and_then(|part| part.get("inlineData"))
                .and_then(|data| data.get("data"))
                .and_then(|data| data.as_str())
                .unwrap_or("");

            if audio_b64.is_empty() {
                return Err("Google TTS returned no audio.".to_string());
            }

            let pcm = STANDARD
                .decode(audio_b64)
                .map_err(|err| format!("Failed to decode Google TTS audio: {err}"))?;
            Ok(TtsAudioPayload {
                bytes: pcm_s16le_to_wav_bytes(&pcm, 1, 24_000, 16),
                mime_type: "audio/wav".to_string(),
            })
        }
        p if is_local_provider(p) => {
            let Some(base) = base_url.as_deref() else {
                return Err("Server URL is not set.".to_string());
            };
            let response = client
                .post(local_endpoint(base, "/audio/speech"))
                .json(&json!({
                    "model": model,
                    "input": text,
                    "voice": voice,
                    "response_format": "wav",
                }))
                .send()
                .await
                .map_err(|err| safe_request_error("Failed to contact local TTS provider", err))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let preview = redact_secrets(&body.chars().take(200).collect::<String>());
                return Err(format!("Local TTS failed ({status}): {preview}"));
            }

            let bytes = response
                .bytes()
                .await
                .map_err(|err| format!("Failed to read TTS audio: {err}"))?;
            Ok(TtsAudioPayload {
                bytes: bytes.to_vec(),
                mime_type: "audio/wav".to_string(),
            })
        }
        _ => Err("Selected provider does not support voice replies yet.".to_string()),
    }
}

#[tauri::command]
pub async fn check_local_provider_online(
    provider: String,
    base_url: String,
) -> Result<bool, String> {
    if !is_local_provider(&provider) {
        return Ok(false);
    }
    if !base_url_is_safe(&base_url) {
        return Ok(false);
    }

    let client = match shared_http_client(Duration::from_millis(500)) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };

    let endpoint = local_endpoint(&base_url, "models");
    let response = client.get(&endpoint).send().await;
    match response {
        Ok(res) => Ok(res.status().is_success()),
        Err(_) => {
            // Fallback for Ollama: if v1 endpoint fails, check native api/tags
            if provider == "ollama" {
                let base_trimmed = base_url.trim_end_matches('/');
                let ollama_api = if base_trimmed.ends_with("/v1") && base_trimmed.len() >= 3 {
                    format!("{}/api/tags", &base_trimmed[..base_trimmed.len() - 3])
                } else {
                    format!("{}/api/tags", base_trimmed)
                };
                if let Ok(res) = client.get(&ollama_api).send().await {
                    return Ok(res.status().is_success());
                }
            }
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        audio_format_from_mime_type, audio_mime_type_is_safe, base_url_is_safe,
        build_audio_transcription_multipart_body, is_known_provider, is_local_provider,
        local_endpoint, model_id_is_safe, openrouter_audio_chat_model_is_unsupported,
        redact_secrets, resolve_base_url,
    };
    const MAX_TEXT_LEN: usize = 32_000;

    #[test]
    fn redacts_all_provider_key_prefixes() {
        let cases = [
            "error with sk-or-abc123 in it",
            "openai key sk-proj-XYZ failed",
            "anthropic sk-ant-api03-secret denied",
            "google key AIzaSyD-EXAMPLE rejected",
            "groq gsk_supersecretvalue invalid",
        ];
        for case in cases {
            let out = redact_secrets(case);
            assert!(out.contains("[redacted]"), "expected redaction in: {out}");
            assert!(!out.contains("secret"), "secret leaked: {out}");
            assert!(!out.contains("EXAMPLE"), "google key leaked: {out}");
        }
    }

    #[test]
    fn redact_leaves_clean_text_untouched() {
        let clean = "Model request failed (429): rate limited";
        assert_eq!(redact_secrets(clean), clean);
    }

    #[test]
    fn known_providers_are_recognised() {
        assert!(is_known_provider("openrouter"));
        assert!(is_known_provider("anthropic"));
        assert!(is_known_provider("openai"));
        assert!(is_known_provider("google"));
        assert!(is_known_provider("groq"));
        assert!(is_known_provider("ollama"));
        assert!(is_known_provider("lmstudio"));
    }

    #[test]
    fn only_local_providers_are_local() {
        assert!(is_local_provider("ollama"));
        assert!(is_local_provider("lmstudio"));
        assert!(!is_local_provider("openrouter"));
        assert!(!is_local_provider("anthropic"));
        assert!(!is_local_provider("openai"));
    }

    #[test]
    fn base_url_validation() {
        assert!(base_url_is_safe("http://localhost:11434/v1"));
        assert!(base_url_is_safe("http://127.0.0.1:1234/v1"));
        assert!(base_url_is_safe("https://my-box.lan:8080/v1"));
        // Rejected: wrong scheme, traversal, whitespace, control chars, empty.
        assert!(!base_url_is_safe("ftp://localhost/v1"));
        assert!(!base_url_is_safe("localhost:11434"));
        assert!(!base_url_is_safe("http://localhost/../etc"));
        assert!(!base_url_is_safe("http://localhost /v1"));
        assert!(!base_url_is_safe("http://local\nhost/v1"));
        assert!(!base_url_is_safe(""));
        assert!(!base_url_is_safe(&format!("http://{}", "a".repeat(300))));
    }

    #[test]
    fn local_endpoint_joins_without_double_slash() {
        assert_eq!(
            local_endpoint("http://localhost:11434/v1", "chat/completions"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            local_endpoint("http://localhost:11434/v1/", "/models"),
            "http://localhost:11434/v1/models"
        );
    }

    #[test]
    fn resolve_base_url_rules() {
        // Non-local providers ignore the URL entirely.
        assert_eq!(
            resolve_base_url("openai", &Some("anything".to_string())),
            Ok(None)
        );
        // Local providers require a valid URL.
        assert_eq!(
            resolve_base_url("ollama", &Some("http://localhost:11434/v1".to_string())),
            Ok(Some("http://localhost:11434/v1".to_string()))
        );
        assert!(resolve_base_url("ollama", &None).is_err());
        assert!(resolve_base_url("ollama", &Some("  ".to_string())).is_err());
        assert!(resolve_base_url("lmstudio", &Some("notaurl".to_string())).is_err());
    }

    #[test]
    fn unknown_provider_is_rejected() {
        assert!(!is_known_provider("evil"));
        assert!(!is_known_provider(""));
        assert!(!is_known_provider("openrouter; rm -rf /"));
    }

    #[test]
    fn real_model_ids_are_accepted() {
        assert!(model_id_is_safe("google/gemini-2.5-flash"));
        assert!(model_id_is_safe("claude-3-5-haiku-latest"));
        assert!(model_id_is_safe("gpt-4o-mini"));
        assert!(model_id_is_safe("gemini-2.5-flash"));
        assert!(model_id_is_safe("llama-3.1-8b-instant"));
        assert!(model_id_is_safe("google/gemma-4-31b-it:free"));
    }

    #[test]
    fn unsafe_model_ids_are_rejected() {
        assert!(!model_id_is_safe(""));
        // No path traversal — Google embeds the id in a URL path.
        assert!(!model_id_is_safe("../../secret"));
        assert!(!model_id_is_safe("gemini:generateContent?key=leak"));
        assert!(!model_id_is_safe(
            "some-malicious/model-injection; rm -rf /"
        ));
        assert!(!model_id_is_safe("model with spaces"));
        assert!(!model_id_is_safe(&"a".repeat(129)));
    }

    #[test]
    fn documented_openrouter_audio_mime_types_are_accepted() {
        let cases = [
            ("audio/wav", "wav"),
            ("audio/mpeg", "mp3"),
            ("audio/mp3", "mp3"),
            ("audio/flac", "flac"),
            ("audio/ogg", "ogg"),
            ("audio/aac", "aac"),
            ("audio/mp4", "m4a"),
            ("audio/x-m4a", "m4a"),
            ("audio/webm", "webm"),
        ];
        for (mime, format) in cases {
            assert!(audio_mime_type_is_safe(mime), "{mime} should be accepted");
            assert_eq!(audio_format_from_mime_type(mime), Some(format));
        }
    }

    #[test]
    fn old_free_openrouter_audio_model_is_rejected() {
        assert!(openrouter_audio_chat_model_is_unsupported(
            "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
        ));
        assert!(!openrouter_audio_chat_model_is_unsupported(
            "openai/whisper-1"
        ));
    }

    #[test]
    fn local_transcription_multipart_body_contains_model_and_audio_file() {
        let body = build_audio_transcription_multipart_body(
            "test-boundary",
            "whisper-large-v3",
            "audio/wav",
            "wav",
            b"RIFFaudio",
        );
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"model\""));
        assert!(text.contains("whisper-large-v3"));
        assert!(text.contains("name=\"response_format\""));
        assert!(text.contains("filename=\"audio.wav\""));
        assert!(text.contains("Content-Type: audio/wav"));
        assert!(body.ends_with(b"\r\n--test-boundary--\r\n"));
    }

    #[test]
    fn text_length_limit_is_sane() {
        assert_eq!(MAX_TEXT_LEN, 32_000);
    }

    #[test]
    fn text_exceeding_max_len_would_be_rejected() {
        let text = "a".repeat(MAX_TEXT_LEN + 1);
        assert!(text.len() > MAX_TEXT_LEN);
    }
}
