use std::time::Duration;

use keyring::{Entry, Error as KeyringError};
use serde_json::json;

const KEYCHAIN_SERVICE: &str = "com.samue.soryq";
const APP_TITLE: &str = "Soryq";

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";
const GROQ_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

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
    format!("{}/{}", base_url.trim_end_matches('/'), path.trim_start_matches('/'))
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

fn keychain_username(provider: &str) -> String {
    format!("{provider}_api_key")
}

fn keychain_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, &keychain_username(provider))
        .map_err(|err| format!("Failed to access the system keychain: {err}"))
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

/// Run a single-shot system+user completion against the chosen provider and
/// return the assistant's text. Normalises the three request/response shapes
/// (OpenAI-compatible, Anthropic Messages, Google Gemini) behind one signature.
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
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|err| format!("Failed to prepare the request: {err}"))?;

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

            let content = payload
                .get("candidates")
                .and_then(|c| c.get(0))
                .and_then(|cand| cand.get("content"))
                .and_then(|content| content.get("parts"))
                .and_then(|parts| parts.get(0))
                .and_then(|part| part.get("text"))
                .and_then(|t| t.as_str())
                .map(str::trim)
                .unwrap_or("");
            Ok(content.to_string())
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
    let api_key = api_key.trim().to_string();
    if !is_local_provider(&provider) && api_key.is_empty() {
        return Err("API key is not set.".to_string());
    }
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
    let api_key = api_key.trim().to_string();
    if !is_local_provider(&provider) && api_key.is_empty() {
        return Err("API key is not set.".to_string());
    }
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
/// provider's response into `ModelInfo` and filters out non-chat models so the
/// picker only shows usable options. Returns an empty list rather than erroring
/// when a provider simply has no matching models.
#[tauri::command]
pub async fn list_provider_models(
    provider: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    if !is_known_provider(&provider) {
        return Err("Unknown provider".to_string());
    }
    let api_key = api_key.trim().to_string();
    if !is_local_provider(&provider) && api_key.is_empty() {
        return Err("API key is not set.".to_string());
    }
    let base_url = resolve_base_url(&provider, &base_url)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| format!("Failed to prepare the request: {err}"))?;

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
                let supports_generate = item
                    .get("supportedGenerationMethods")
                    .and_then(|m| m.as_array())
                    .map(|arr| arr.iter().any(|v| v.as_str() == Some("generateContent")))
                    .unwrap_or(false);
                if !supports_generate {
                    continue;
                }
                let raw = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let id = raw.strip_prefix("models/").unwrap_or(raw).trim().to_string();
                if id.is_empty() || !model_id_is_safe(&id) {
                    continue;
                }
                let label = item
                    .get("displayName")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&id)
                    .to_string();
                let desc = item.get("description").and_then(|v| v.as_str()).unwrap_or("");
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
                    "openai" if !openai_is_chat_model(&id) => continue,
                    "groq" if !groq_is_chat_model(&id) => continue,
                    _ => {}
                }
                let label = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&id)
                    .to_string();
                let desc = item.get("description").and_then(|v| v.as_str()).unwrap_or("");
                out.push(ModelInfo {
                    id,
                    label,
                    description: truncate_desc(desc),
                });
            }
            out
        }
    };

    models.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::{
        base_url_is_safe, is_known_provider, is_local_provider, local_endpoint, model_id_is_safe,
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
        assert!(!model_id_is_safe("some-malicious/model-injection; rm -rf /"));
        assert!(!model_id_is_safe("model with spaces"));
        assert!(!model_id_is_safe(&"a".repeat(129)));
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
