//! GitHub integration: store a personal access token in the OS keychain and use
//! it to create a new repository on the user's account, then publish the current
//! project to it. The token lives only in the keychain — it is never passed
//! through the frontend or written to `.git/config`.

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use keyring::{Entry, Error as KeyringError};
use tauri::State;

use crate::commands::workspace::{classify_push_error, git_base, sanitize_git_error};
use crate::state::AppState;

const KEYCHAIN_SERVICE: &str = "com.samue.soryq";
const GITHUB_TOKEN_USERNAME: &str = "github_token";
const GITHUB_API: &str = "https://api.github.com";

fn token_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, GITHUB_TOKEN_USERNAME)
        .map_err(|e| format!("Failed to access the system keychain: {e}"))
}

/// Save (or, when empty, clear) the GitHub personal access token in the keychain.
#[tauri::command]
pub fn github_token_set(token: String) -> Result<(), String> {
    let token = token.trim().to_string();
    let entry = token_entry()?;
    if token.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to remove the token: {e}")),
        };
    }
    if token.len() > 512 || token.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("That doesn't look like a valid token.".to_string());
    }
    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to save the token: {e}"))
}

#[tauri::command]
pub fn github_token_exists() -> Result<bool, String> {
    let entry = token_entry()?;
    match entry.get_password() {
        Ok(p) => Ok(!p.trim().is_empty()),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to check the token: {e}")),
    }
}

#[tauri::command]
pub fn github_token_delete() -> Result<(), String> {
    let entry = token_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to remove the token: {e}")),
    }
}

fn read_token() -> Result<String, String> {
    let entry = token_entry()?;
    match entry.get_password() {
        Ok(p) if !p.trim().is_empty() => Ok(p.trim().to_string()),
        Ok(_) | Err(KeyringError::NoEntry) => Err(
            "No GitHub token saved. Add a personal access token in Settings to create repositories."
                .to_string(),
        ),
        Err(e) => Err(format!("Failed to read the token: {e}")),
    }
}

/// GitHub repository names allow letters, digits, '-', '_', and '.'.
fn validate_repo_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 100 {
        return Err("Repository name must be 1–100 characters.".to_string());
    }
    if name == "." || name == ".." {
        return Err("Invalid repository name.".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(
            "Repository name may only contain letters, numbers, '-', '_', and '.'.".to_string(),
        );
    }
    Ok(())
}

/// Run a git command, mapping failure to a sanitized error string.
fn run_git(root: &Path, args: &[&str]) -> Result<(), String> {
    let out = git_base()
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(sanitize_git_error(&String::from_utf8_lossy(&out.stderr)))
    }
}

/// True when the git command exits 0 (used as a predicate, output ignored).
fn git_ok(root: &Path, args: &[&str]) -> bool {
    git_base()
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Trimmed stdout of a successful git command, else None.
fn git_capture(root: &Path, args: &[&str]) -> Option<String> {
    let out = git_base()
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

/// Push `branch` to origin authenticated with the token. The credential is
/// injected via per-invocation config env vars (GIT_CONFIG_*) rather than the
/// command line or `.git/config`, so it never persists and never appears in a
/// process listing. This guarantees the first push works even when no git
/// credential helper is configured.
fn push_with_token(root: &Path, token: &str, branch: &str) -> Result<(), String> {
    let cred = base64::engine::general_purpose::STANDARD.encode(format!("x-access-token:{token}"));
    let out = git_base()
        .args(["push", "-u", "origin", "--", branch])
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "http.https://github.com/.extraheader")
        .env("GIT_CONFIG_VALUE_0", format!("AUTHORIZATION: basic {cred}"))
        .output()
        .map_err(|e| format!("Failed to run git push: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(classify_push_error(&String::from_utf8_lossy(&out.stderr)))
    }
}

fn github_api_error(status: reqwest::StatusCode, body: &serde_json::Value, name: &str) -> String {
    let msg = body.get("message").and_then(|v| v.as_str()).unwrap_or("");
    match status.as_u16() {
        401 => "GitHub rejected the token (401). Check that your personal access token is valid and not expired.".to_string(),
        403 => "GitHub denied the request (403). Your token may lack the 'repo' scope needed to create repositories.".to_string(),
        422 if body.to_string().contains("already exists") => {
            format!("A repository named '{name}' already exists on your account.")
        }
        422 => format!(
            "GitHub couldn't create the repository: {}",
            if msg.is_empty() { "validation failed" } else { msg }
        ),
        _ => format!(
            "GitHub returned an error ({status}): {}",
            if msg.is_empty() { "unknown error" } else { msg }
        ),
    }
}

#[derive(serde::Serialize)]
pub struct CreateRepoResult {
    pub html_url: String,
    pub full_name: String,
    /// Whether an initial commit was pushed (false for an empty project — the
    /// remote is wired up but there was nothing to push yet).
    pub pushed: bool,
}

/// Create a new repository on the authenticated user's GitHub account, wire it up
/// as `origin` for the project, and push the current branch (creating an initial
/// commit if the project has none yet).
#[tauri::command]
pub async fn workspace_github_create_repo(
    project_id: String,
    name: String,
    description: Option<String>,
    private: bool,
    state: State<'_, AppState>,
) -> Result<CreateRepoResult, String> {
    let name = name.trim().to_string();
    validate_repo_name(&name)?;
    let description = description.unwrap_or_default();
    if description.len() > 1000 {
        return Err("Description is too long (limit 1000 characters).".to_string());
    }

    let root_path = {
        let projects = state.workspace_manager.list_projects();
        let project = projects
            .iter()
            .find(|p| p.id == project_id)
            .ok_or_else(|| "Project not found".to_string())?;
        project.root_path.clone()
    };

    let token = read_token()?;

    // Refuse to hijack a project that already points somewhere — avoids
    // silently repointing an existing origin to a brand-new empty repo.
    if git_ok(&root_path, &["remote", "get-url", "origin"]) {
        return Err("This project already has an 'origin' remote. Remove it first if you want to publish to a new repository.".to_string());
    }

    // 1. Create the repository on GitHub.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Soryq")
        .build()
        .map_err(|e| format!("Failed to prepare the request: {e}"))?;

    let resp = client
        .post(format!("{GITHUB_API}/user/repos"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "name": name,
            "description": description,
            "private": private,
            "auto_init": false,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to contact GitHub: {}", e.without_url()))?;

    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        return Err(github_api_error(status, &body, &name));
    }

    let clone_url = body
        .get("clone_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let html_url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let full_name = body
        .get("full_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if clone_url.is_empty() {
        return Err("GitHub created the repository but returned no clone URL.".to_string());
    }

    // 2. Ensure a local git repository exists (default branch: main).
    if !root_path.join(".git").exists() {
        run_git(&root_path, &["init", "-b", "main"])?;
    }

    // 3. Ensure there is at least one commit so there's something to push. Only
    //    commit when files actually staged (an empty folder stays empty).
    if !git_ok(&root_path, &["rev-parse", "--verify", "HEAD"]) {
        run_git(&root_path, &["add", "-A"])?;
        // `diff --cached --quiet` exits non-zero when something is staged.
        if !git_ok(&root_path, &["diff", "--cached", "--quiet"]) {
            run_git(&root_path, &["commit", "-m", "Initial commit"])?;
        }
    }

    // 4. Point origin at the new repository.
    run_git(&root_path, &["remote", "add", "origin", &clone_url])?;

    // 5. Push the initial commit, if there is one.
    let branch = git_capture(&root_path, &["branch", "--show-current"]).unwrap_or_default();
    let mut pushed = false;
    if git_ok(&root_path, &["rev-parse", "--verify", "HEAD"]) && !branch.is_empty() {
        if let Err(e) = push_with_token(&root_path, &token, &branch) {
            // The repo was created and origin wired up; report the push problem
            // without losing that context so the user can retry the push.
            return Err(format!(
                "Repository '{full_name}' was created, but the initial push failed: {e}"
            ));
        }
        pushed = true;
    }

    Ok(CreateRepoResult {
        html_url,
        full_name,
        pushed,
    })
}
