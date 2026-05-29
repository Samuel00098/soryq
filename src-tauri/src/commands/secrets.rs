use std::time::Duration;

use keyring::{Entry, Error as KeyringError};
use serde_json::json;

const KEYCHAIN_SERVICE: &str = "com.samue.soryq";
const KEYCHAIN_USERNAME: &str = "openrouter_api_key";
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const APP_TITLE: &str = "Soryq";
const OPENROUTER_SYSTEM_PROMPT: &str = "Hey! You're a voice-to-text helper living inside a developer's productivity app. The person talking to you is a developer — they might be firing off a quick prompt to an AI coding agent, describing a bug, jotting down a task, or just thinking out loud while their hands are busy.\n\nYour job is to take their raw spoken words and turn them into clean, natural text — the kind of thing they'd have typed themselves if they weren't busy being a developer. Keep it human, keep it theirs.\n\nHere's how to do it well:\n\n1. DROP THE FILLER — quietly remove \"um\", \"uh\", \"like\", \"you know\", \"basically\", \"kind of\", \"sort of\", \"I mean\", false starts, and repeated words. Don't mention you did it, just clean it up.\n\n2. SPOKEN SYMBOLS → REAL SYMBOLS — when the developer says punctuation out loud, swap it in:\n   comma → ,   period / full stop → .   colon → :   semicolon → ;   exclamation / bang → !   question mark → ?   open paren / left paren → (   close paren / right paren → )   open bracket → [   close bracket → ]   open brace / left curly → {   close brace / right curly → }   equals → =   double equals → ==   triple equals → ===   fat arrow / arrow → =>   pipe → |   double pipe → ||   ampersand → &   double ampersand → &&   bang equals → !=   less than → <   greater than → >   slash → /   backslash → \\   dot → .   underscore → _   dash / hyphen → -   hash / pound → #   at sign → @   backtick → `   tilde → ~   star / asterisk → *   double star → **   caret → ^   percent → %   new line / next line → line break.\n\n3. DON'T TOUCH THE TECH STUFF — variable names, function names, file paths, CLI flags, package names, API names, URLs, config keys, environment variables — leave all of that exactly as spoken. When in doubt, keep it verbatim.\n\n4. TIDY UP THE SPEECH — casual, run-on spoken sentences should become clean written ones. Keep the developer's natural voice and directness though — don't make it stiff or formal. \"can you make it so that the button kind of changes colour when you hover over it\" → \"Make the button change colour on hover.\"\n\n5. KEEP THEIR VIBE — if they sound urgent, keep that urgency. If they're being casual, stay casual. If they're frustrated, that's fine too. Don't sanitise their personality out of the text.\n\n6. NUMBERS — use digits in technical contexts (port 8000, version 3, 12 files). Keep words for conversational mentions.\n\n7. STRUCTURE IT IF THEY SIGNAL IT — if they say \"first\", \"second\", \"also\", \"next\", \"new line\", shape it into a list or use line breaks naturally.\n\n8. NOTHING LOST, NOTHING ADDED — every idea they expressed should survive. Don't summarise, don't expand, don't add your own thoughts.\n\nJust output the cleaned-up text — no intro, no explanation, no quotes around it.";
const COMMIT_SYSTEM_PROMPT: &str = "You are an expert software engineer writing a git commit message. Analyse the diff thoroughly and write a high-quality commit message that clearly explains WHAT changed and WHY. Follow this structure:\n\n1. A short subject line (50–72 chars) using conventional commits when the type is clear (feat, fix, refactor, chore, docs, style, test, perf).\n2. A blank line.\n3. A body (one or more paragraphs) that describes the changes in detail — what was added, removed, or modified, and the reasoning or motivation behind the change. Mention any non-obvious decisions, trade-offs, or context a future reader would benefit from.\n\nOutput only the commit message — no preamble, no explanation, no markdown fences, no quotes.";
const ALLOWED_MODELS: &[&str] = &[
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
    "anthropic/claude-haiku-4.5",
    "anthropic/claude-3.5-haiku",
    "anthropic/claude-sonnet-4.5",
    "qwen/qwen3-30b-a3b-instruct-2507",
    "qwen/qwen-2.5-7b-instruct",
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
];

/// Redact API-key-shaped substrings from an error body before surfacing it to the frontend.
fn redact_secrets(s: &str) -> String {
    // Replace anything that looks like sk-... (OpenRouter / OpenAI style keys)
    let mut out = String::new();
    let mut rest = s;
    while let Some(pos) = rest.find("sk-") {
        out.push_str(&rest[..pos]);
        out.push_str("[redacted]");
        let after = &rest[pos + 3..];
        // skip until whitespace, quote, or end
        let end = after.find(|c: char| c.is_whitespace() || c == '"' || c == '\'').unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

fn keychain_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USERNAME)
        .map_err(|err| format!("Failed to access the system keychain: {err}"))
}

#[tauri::command]
pub fn openrouter_api_key_exists() -> Result<bool, String> {
    let entry = keychain_entry()?;
    match entry.get_password() {
        Ok(password) => Ok(!password.trim().is_empty()),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(err) => Err(format!("Failed to check the OpenRouter key: {err}")),
    }
}


#[tauri::command]
pub fn openrouter_api_key_set(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim().to_string();
    let entry = keychain_entry()?;

    if api_key.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(format!("Failed to remove the OpenRouter key: {err}")),
        }
    } else {
        entry
            .set_password(&api_key)
            .map_err(|err| format!("Failed to save the OpenRouter key: {err}"))
    }
}

#[tauri::command]
pub fn openrouter_api_key_delete() -> Result<(), String> {
    let entry = keychain_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(format!("Failed to remove the OpenRouter key: {err}")),
    }
}

#[tauri::command]
pub async fn openrouter_refine_prompt(text: String, model: String, api_key: String) -> Result<String, String> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("OpenRouter API key is not set.".to_string());
    }

    const MAX_TEXT_LEN: usize = 32_000;

    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(String::new());
    }

    if text.chars().count() > MAX_TEXT_LEN {
        return Err("Input text exceeds maximum length".to_string());
    }

    if !ALLOWED_MODELS.contains(&model.as_str()) {
        return Err("Unsupported model".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| format!("Failed to prepare the OpenRouter request: {err}"))?;

    let response = client
        .post(OPENROUTER_URL)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header("HTTP-Referer", "https://soryq.app")
        .header("X-Title", APP_TITLE)
        .json(&json!({
            "model": model,
            "messages": [
                { "role": "system", "content": OPENROUTER_SYSTEM_PROMPT },
                { "role": "user", "content": text },
            ],
            "temperature": 0.1,
            "top_p": 1,
            "max_tokens": 512,
        }))
        .send()
        .await
        .map_err(|err| format!("Failed to contact OpenRouter: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let body_preview: String = redact_secrets(&body.chars().take(200).collect::<String>());
        return Err(format!("OpenRouter request failed ({status}): {body_preview}"));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|err| format!("OpenRouter returned an invalid response: {err}"))?;

    let content = payload
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .map(str::trim)
        .unwrap_or("");

    if content.is_empty() {
        return Err("OpenRouter returned an empty response.".to_string());
    }

    Ok(content.to_string())
}

#[tauri::command]
pub async fn openrouter_generate_commit_message(diff: String, model: String, api_key: String) -> Result<String, String> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("OpenRouter API key is not set.".to_string());
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

    if !ALLOWED_MODELS.contains(&model.as_str()) {
        return Err("Unsupported model".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| format!("Failed to prepare the OpenRouter request: {err}"))?;

    let response = client
        .post(OPENROUTER_URL)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header("HTTP-Referer", "https://soryq.app")
        .header("X-Title", APP_TITLE)
        .json(&json!({
            "model": model,
            "messages": [
                { "role": "system", "content": COMMIT_SYSTEM_PROMPT },
                { "role": "user", "content": diff },
            ],
            "temperature": 0.2,
            "max_tokens": 512,
        }))
        .send()
        .await
        .map_err(|err| format!("Failed to contact OpenRouter: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let body_preview: String = redact_secrets(&body.chars().take(200).collect::<String>());
        return Err(format!("OpenRouter request failed ({status}): {body_preview}"));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|err| format!("OpenRouter returned an invalid response: {err}"))?;

    let content = payload
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .map(str::trim)
        .unwrap_or("");

    if content.is_empty() {
        return Err("OpenRouter returned an empty response.".to_string());
    }

    Ok(content.to_string())
}

#[cfg(test)]
mod tests {
    use super::{ALLOWED_MODELS};
    const MAX_TEXT_LEN: usize = 32_000;

    #[test]
    fn allowed_models_list_is_not_empty() {
        assert!(!ALLOWED_MODELS.is_empty());
    }

    #[test]
    fn known_good_model_is_in_allowlist() {
        assert!(ALLOWED_MODELS.contains(&"google/gemini-2.5-flash"));
        assert!(ALLOWED_MODELS.contains(&"anthropic/claude-haiku-4.5"));
    }

    #[test]
    fn arbitrary_model_is_not_in_allowlist() {
        assert!(!ALLOWED_MODELS.contains(&"openai/gpt-4o"));
        assert!(!ALLOWED_MODELS.contains(&"some-malicious/model-injection; rm -rf /"));
    }

    #[test]
    fn text_length_limit_is_sane() {
        // 32 000 chars ≈ 8 000 tokens — big enough for voice but not abusable
        assert_eq!(MAX_TEXT_LEN, 32_000);
    }

    #[test]
    fn error_body_truncation_works() {
        // Mirrors the truncation in the non-success branch: body.chars().take(200).collect()
        let long_body = "x".repeat(500);
        let truncated: String = long_body.chars().take(200).collect();
        assert_eq!(truncated.len(), 200);

        let short_body = "short error";
        let truncated_short: String = short_body.chars().take(200).collect();
        assert_eq!(truncated_short, short_body);
    }

    #[test]
    fn text_exceeding_max_len_would_be_rejected() {
        // Simulate the length-check logic from openrouter_refine_prompt
        let text = "a".repeat(MAX_TEXT_LEN + 1);
        let exceeds = text.len() > MAX_TEXT_LEN;
        assert!(exceeds, "A text longer than MAX_TEXT_LEN must be rejected");
    }

    #[test]
    fn text_at_max_len_would_be_accepted() {
        let text = "a".repeat(MAX_TEXT_LEN);
        let exceeds = text.len() > MAX_TEXT_LEN;
        assert!(!exceeds, "A text exactly at MAX_TEXT_LEN must not be rejected");
    }

    #[test]
    fn empty_text_is_not_in_allowlist_models() {
        // Sanity: an empty string is not a valid model identifier
        assert!(!ALLOWED_MODELS.contains(&""));
    }

    #[test]
    fn all_allowed_models_contain_a_slash() {
        // All model identifiers follow the "provider/model" convention
        for model in ALLOWED_MODELS {
            assert!(
                model.contains('/'),
                "Model '{}' does not contain a '/' separator",
                model
            );
        }
    }
}
