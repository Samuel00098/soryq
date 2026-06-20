use crate::state::AppState;
use crate::workspace::project::Project;
use std::path::PathBuf;
use std::process::Command;
use tauri::State;

pub(crate) fn sanitize_git_error(stderr: &str) -> String {
    stderr
        .lines()
        .map(|line| {
            line.split_whitespace()
                .map(|token| {
                    let trimmed = token.trim_matches(|c| matches!(c, '\'' | '"' | '`'));
                    let looks_like_path = trimmed.starts_with('/')
                        || trimmed.starts_with(r"\\")
                        || (trimmed.len() > 2
                            && trimmed.as_bytes()[1] == b':'
                            && matches!(trimmed.as_bytes()[2], b'\\' | b'/'))
                        || trimmed.contains('/')
                        || trimmed.contains('\\');
                    if looks_like_path {
                        "[path redacted]"
                    } else {
                        token
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Turn a failed `git push` stderr into a clear, actionable message. Without this,
/// auth failures surface as a cryptic blob (or, with prompts disabled, as a silent
/// "terminal prompts disabled" line) that's easy to miss — the user is left thinking
/// the push worked when it didn't.
pub(crate) fn classify_push_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();

    if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("terminal prompts disabled")
        || lower.contains("permission denied")
        || lower.contains("invalid username or password")
        || lower.contains("403")
    {
        return "Authentication failed — your changes were NOT pushed. Sign in to GitHub (Git Credential Manager) or check that your saved credentials / access token are still valid, then push again.".to_string();
    }

    if lower.contains("non-fast-forward")
        || lower.contains("fetch first")
        || lower.contains("[rejected]")
        || lower.contains("tip of your current branch is behind")
    {
        return "Push rejected — the remote has commits you don't have locally. Fetch and merge (or pull) first, then push again.".to_string();
    }

    if lower.contains("no configured push destination")
        || lower.contains("does not appear to be a git repository")
        || lower.contains("no such remote")
        || lower.contains("repository not found")
    {
        return "No remote to push to — check that an 'origin' remote is configured for this project.".to_string();
    }

    if lower.contains("could not resolve host")
        || lower.contains("failed to connect")
        || lower.contains("connection timed out")
    {
        return "Couldn't reach GitHub — check your internet connection and try again.".to_string();
    }

    format!("Git push failed:\n{}", sanitize_git_error(stderr))
}

/// Construct a `git` Command. On Windows this sets the CREATE_NO_WINDOW process
/// creation flag so the child git process doesn't flash a console window.
/// Without it, every git invocation pops up a terminal — and opening Source
/// Control fires several git commands back-to-back (status, branches, log),
/// so the user sees terminals opening repeatedly and the UI stutters.
///
/// Drop-in replacement for `git_base()`: callers add their own
/// `.args(..)`, `.current_dir(..)`, and env as before.
pub(crate) fn git_base() -> Command {
    let program = "git";
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Run a git command in `root` and return its trimmed stdout on success, or None.
fn git_capture(root: &std::path::Path, args: &[&str]) -> Option<String> {
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

fn validate_relative_path(file_path: &str) -> Result<(), String> {
    if file_path.contains('\0') {
        return Err("Invalid file path".to_string());
    }
    if file_path.starts_with("--") {
        return Err("Invalid file path".to_string());
    }
    if file_path.split(['/', '\\']).any(|seg| seg == "..") {
        return Err("Path traversal is not allowed".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_open_project(path: String, state: State<AppState>) -> Result<Project, String> {
    let root_path =
        std::fs::canonicalize(PathBuf::from(&path)).map_err(|_| "Invalid path".to_string())?;
    let root_path = crate::commands::clean_path_buf(root_path);
    state
        .workspace_manager
        .open_project(root_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_get_active(state: State<AppState>) -> Option<Project> {
    state.workspace_manager.get_active_project()
}

#[tauri::command]
pub fn workspace_list_projects(state: State<AppState>) -> Vec<Project> {
    state.workspace_manager.list_projects()
}

#[tauri::command]
pub fn workspace_get_recent(
    state: State<AppState>,
) -> Vec<crate::workspace::project::RecentProject> {
    state.workspace_manager.get_recent_projects()
}

#[tauri::command]
pub fn workspace_git_commit(
    project_id: String,
    message: String,
    files: Option<Vec<String>>,
    state: State<AppState>,
) -> Result<String, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    if message.trim().is_empty() {
        return Err("Commit message cannot be empty.".to_string());
    }
    if message.len() > 10_000 {
        return Err("Commit message is too long (limit 10 000 characters)".to_string());
    }
    if message.contains('\0') {
        return Err("Commit message contains invalid characters.".to_string());
    }

    // Determine whether to commit a selected subset or everything. An empty list
    // is treated as "no files selected" rather than "commit all".
    let selected: Option<Vec<String>> = match files {
        Some(list) if !list.is_empty() => {
            for path in &list {
                if path.is_empty() || path.contains('\0') {
                    return Err("A selected file path is invalid.".to_string());
                }
            }
            Some(list)
        }
        Some(_) => return Err("No files selected to commit.".to_string()),
        None => None,
    };

    // 1. Stage changes. With a selection, stage only those paths (the "--"
    //    separator stops paths that begin with "-" from being read as flags);
    //    otherwise stage everything. `git add -A -- <paths>` also records
    //    deletions and newly-tracked files within the selection.
    let mut add_args: Vec<&str> = vec!["add", "-A"];
    if let Some(ref list) = selected {
        add_args.push("--");
        for path in list {
            add_args.push(path);
        }
    }
    let add_output = git_base()
        .args(&add_args)
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to stage changes: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!(
            "Failed to stage changes: {}",
            sanitize_git_error(&stderr)
        ));
    }

    // 2. Commit changes. With a selection, restrict the commit to those paths so
    //    anything else already staged is left untouched.
    let mut commit_args: Vec<&str> = vec!["commit", "-m", &message];
    if let Some(ref list) = selected {
        commit_args.push("--");
        for path in list {
            commit_args.push(path);
        }
    }
    let commit_output = git_base()
        .args(&commit_args)
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to commit changes: {}", e))?;

    let stdout = String::from_utf8_lossy(&commit_output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&commit_output.stderr).to_string();

    if commit_output.status.success() {
        Ok(format!(
            "Successfully committed changes!\n{}{}",
            stdout,
            sanitize_git_error(&stderr)
        ))
    } else {
        Err(format!(
            "Commit failed:\n{}{}",
            sanitize_git_error(&stderr),
            stdout
        ))
    }
}

#[tauri::command]
pub fn workspace_git_push(project_id: String, state: State<AppState>) -> Result<String, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    // 1. Determine current branch
    let branch = git_base()
        .args(["branch", "--show-current"])
        .current_dir(root_path)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    // 2. Push to origin and set upstream (-u) so the branch tracks origin/<branch>
    //    afterward — that's what lets us show ahead/behind counts. The "--"
    //    separator prevents branch names starting with "-" from being read as flags.
    let mut push_args: Vec<&str> = vec!["push", "-u", "origin"];
    let branch_owned = branch.clone();
    if !branch_owned.is_empty() {
        push_args.push("--");
        push_args.push(&branch_owned);
    }

    let output = git_base()
        .args(push_args)
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        // git reports a no-op push ("Everything up-to-date") on stderr.
        if stderr.to_lowercase().contains("everything up-to-date") {
            Ok("Already up to date — nothing new to push.".to_string())
        } else {
            Ok(format!(
                "Successfully pushed to GitHub!\n{}{}",
                stdout,
                sanitize_git_error(&stderr)
            ))
        }
    } else {
        Err(classify_push_error(&stderr))
    }
}

#[tauri::command]
pub fn workspace_git_fetch(project_id: String, state: State<AppState>) -> Result<String, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    let output = git_base()
        .args(["fetch", "origin"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to execute git fetch: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!(
            "Successfully fetched from remote!\n{}{}",
            sanitize_git_error(&stdout),
            sanitize_git_error(&stderr)
        ))
    } else {
        Err(format!(
            "Git fetch failed:\n{}{}",
            sanitize_git_error(&stderr),
            sanitize_git_error(&stdout)
        ))
    }
}

#[tauri::command]
pub fn workspace_detect_port(path: String, state: State<AppState>) -> u16 {
    let root = match std::fs::canonicalize(std::path::PathBuf::from(&path)) {
        Ok(r) => crate::commands::clean_path_buf(r),
        Err(_) => return 5173,
    };
    // Only read files that belong to an open project
    let projects = state.workspace_manager.list_projects();
    if !projects.iter().any(|p| root.starts_with(&p.root_path)) {
        return 5173;
    }

    // 1. Try to read package.json (cap at 1MB to prevent DoS on malformed projects)
    let package_json_path = root.join("package.json");
    if package_json_path.is_file() {
        let too_large = std::fs::metadata(&package_json_path)
            .map(|m| m.len() > 1_048_576)
            .unwrap_or(false);
        if !too_large {
            if let Ok(content) = std::fs::read_to_string(&package_json_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    // If package.json has scripts:
                    if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                        for (_name, cmd_val) in scripts {
                            if let Some(cmd) = cmd_val.as_str() {
                                if let Some(port) = extract_port_from_cmd(cmd) {
                                    return port;
                                }
                            }
                        }
                    }

                    // If no port specified in scripts, check framework signatures
                    if let Some(dependencies) = json.get("dependencies").and_then(|d| d.as_object())
                    {
                        if dependencies.contains_key("next") || dependencies.contains_key("nuxt") {
                            return 3000;
                        }
                        if dependencies.contains_key("astro") {
                            return 4321;
                        }
                    }
                    if let Some(dev_dependencies) =
                        json.get("devDependencies").and_then(|d| d.as_object())
                    {
                        if dev_dependencies.contains_key("next")
                            || dev_dependencies.contains_key("nuxt")
                        {
                            return 3000;
                        }
                        if dev_dependencies.contains_key("astro") {
                            return 4321;
                        }
                    }
                }
            }
        } // end !too_large
    }

    // 2. Scan vite config if it exists
    for config_name in &["vite.config.ts", "vite.config.js"] {
        let config_path = root.join(config_name);
        if config_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                if let Some(port) = extract_port_from_vite_config(&content) {
                    return port;
                }
            }
        }
    }

    // Default fallback
    5173
}

fn extract_port_from_cmd(cmd: &str) -> Option<u16> {
    let parts: Vec<&str> = cmd.split_whitespace().collect();
    for i in 0..parts.len() {
        if (parts[i] == "--port" || parts[i] == "-p") && i + 1 < parts.len() {
            if let Ok(port) = parts[i + 1].parse::<u16>() {
                return Some(port);
            }
        }
    }
    None
}

fn extract_port_from_vite_config(content: &str) -> Option<u16> {
    // Parse line-by-line and skip comments to avoid false positives like `// port: 22`
    let mut in_block_comment = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if in_block_comment {
            if trimmed.contains("*/") {
                in_block_comment = false;
            }
            continue;
        }
        if trimmed.starts_with("//") {
            continue;
        }
        if trimmed.starts_with("/*") {
            // Single-line block comment: /* ... */ — enter and immediately exit
            if trimmed.contains("*/") {
                continue;
            }
            in_block_comment = true;
            continue;
        }
        if let Some(pos) = trimmed.find("port:") {
            let after = &trimmed[pos + 5..];
            let num_str: String = after
                .chars()
                .skip_while(|c| c.is_whitespace())
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if !num_str.is_empty() {
                if let Ok(port) = num_str.parse::<u16>() {
                    return Some(port);
                }
            }
        }
    }
    None
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchResult {
    pub file_path: String,
    pub relative_path: String,
    pub line_number: usize,
    pub line_content: String,
}

#[tauri::command]
pub fn workspace_search_codebase(
    project_path: String,
    query: String,
    state: State<AppState>,
) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let root = std::path::PathBuf::from(&project_path);
    if !root.exists() {
        return Err("Project path does not exist".to_string());
    }

    let root = std::fs::canonicalize(&root).map_err(|_| "Invalid project path".to_string())?;
    let root = crate::commands::clean_path_buf(root);

    // Verify the requested path is an open project (prevents arbitrary directory traversal)
    let projects = state.workspace_manager.list_projects();
    if !projects
        .iter()
        .any(|p| root == p.root_path || root.starts_with(&p.root_path))
    {
        return Err("Project path is not an open project".to_string());
    }

    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    // Scan recursively
    if let Err(e) = search_dir_recursive(&root, &root, &query_lower, &mut results) {
        return Err(format!("Search failed: {}", e));
    }

    Ok(results)
}

fn search_dir_recursive(
    dir: &std::path::Path,
    root: &std::path::Path,
    query: &str,
    results: &mut Vec<SearchResult>,
) -> std::io::Result<()> {
    if results.len() >= 150 {
        return Ok(());
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            // Skip symlinks to prevent escaping the project root
            if path.is_symlink() {
                continue;
            }
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.')
                        || name == "node_modules"
                        || name == "dist"
                        || name == "build"
                        || name == "target"
                        || name == "out"
                    {
                        continue;
                    }
                }
                search_dir_recursive(&path, root, query, results)?;
            } else if path.is_file() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.len() > 10 * 1024 * 1024 {
                        // Skip files larger than 10MB
                        continue;
                    }
                }

                // Read and check if it's text
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if content.contains('\0') {
                        continue; // binary
                    }

                    let relative_path = path
                        .strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();
                    let file_path = path.to_string_lossy().to_string();

                    for (idx, line) in content.lines().enumerate() {
                        if line.to_lowercase().contains(query) {
                            results.push(SearchResult {
                                file_path: file_path.clone(),
                                relative_path: relative_path.clone(),
                                line_number: idx + 1,
                                line_content: line.trim().chars().take(1024).collect(),
                            });
                            if results.len() >= 150 {
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub deleted: Vec<String>,
    pub untracked: Vec<String>,
    pub conflicted: Vec<String>,
    pub file_stats: std::collections::HashMap<String, (i32, i32)>,
    pub total_additions: i32,
    pub total_deletions: i32,
}

#[tauri::command]
pub fn workspace_git_status(
    project_id: String,
    state: State<AppState>,
) -> Result<GitStatus, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    // 1. Get branch name
    let branch = git_base()
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "HEAD".to_string());

    // 2. Get porcelain status
    let output = git_base()
        .args(["status", "--porcelain"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut modified = Vec::new();
    let mut added = Vec::new();
    let mut deleted = Vec::new();
    let mut untracked = Vec::new();
    let mut conflicted = Vec::new();

    for line in stdout.lines() {
        if line.len() < 4 {
            continue;
        }
        let status_code = &line[0..2];
        let file_path = line[3..].trim().to_string();

        // Unmerged paths (merge/rebase conflicts) come first: any 'U', or the
        // both-added / both-deleted cases, which the M/A/D checks would
        // otherwise misclassify.
        if status_code.contains('U') || status_code == "AA" || status_code == "DD" {
            conflicted.push(file_path);
        } else if status_code.contains('M') {
            modified.push(file_path);
        } else if status_code.contains('A') {
            added.push(file_path);
        } else if status_code.contains('D') {
            deleted.push(file_path);
        } else if status_code.contains('?') {
            untracked.push(file_path);
        }
    }

    // 3. Get additions/deletions stats from git diff HEAD --numstat
    let mut file_stats = std::collections::HashMap::new();
    let mut total_additions = 0;
    let mut total_deletions = 0;

    let numstat_output = git_base()
        .args(["diff", "HEAD", "--numstat", "--no-renames"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output();

    if let Ok(ref output) = numstat_output {
        let numstat_stdout = String::from_utf8_lossy(&output.stdout);
        for line in numstat_stdout.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                let additions = parts[0].parse::<i32>().unwrap_or(0);
                let deletions = parts[1].parse::<i32>().unwrap_or(0);
                let file_path = parts[2].to_string();
                file_stats.insert(file_path.clone(), (additions, deletions));
                total_additions += additions;
                total_deletions += deletions;
            }
        }
    }

    // 4. Manually add untracked file stats (since they aren't in numstat)
    for file in &untracked {
        if validate_relative_path(file).is_err() {
            continue;
        }
        let absolute_path = root_path.join(file);
        let additions = if absolute_path.exists() && absolute_path.is_file() {
            let size = std::fs::metadata(&absolute_path)
                .map(|m| m.len())
                .unwrap_or(u64::MAX);
            if size > 10 * 1024 * 1024 {
                0 // skip large files to avoid reading multi-GB binaries into memory
            } else {
                match std::fs::read_to_string(&absolute_path) {
                    Ok(content) => content.lines().count() as i32,
                    Err(_) => 0,
                }
            }
        } else {
            0
        };
        file_stats.insert(file.clone(), (additions, 0));
        total_additions += additions;
    }

    Ok(GitStatus {
        branch,
        modified,
        added,
        deleted,
        untracked,
        conflicted,
        file_stats,
        total_additions,
        total_deletions,
    })
}

#[tauri::command]
pub fn workspace_git_discard_file(
    project_id: String,
    file_path: String,
    state: State<AppState>,
) -> Result<(), String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    validate_relative_path(&file_path)?;

    // Verify the absolute path stays within the project root
    let absolute_check = root_path.join(&file_path);
    let canonical_check = if absolute_check.exists() {
        std::fs::canonicalize(&absolute_check).map_err(|_| "Invalid path".to_string())?
    } else if let Some(parent) = absolute_check.parent() {
        if parent.exists() {
            let cp = std::fs::canonicalize(parent).map_err(|_| "Invalid path".to_string())?;
            cp.join(absolute_check.file_name().unwrap_or_default())
        } else {
            absolute_check.clone()
        }
    } else {
        absolute_check.clone()
    };
    let canonical_check = crate::commands::clean_path_buf(canonical_check);
    if !canonical_check.starts_with(root_path) {
        return Err("Access denied: path is outside project root".to_string());
    }

    // 1. Get current git status to see if file is untracked
    let status_output = git_base()
        .args(["status", "--porcelain", "--", &file_path])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to check file status: {}", e))?;

    let stdout = String::from_utf8_lossy(&status_output.stdout);
    let is_untracked = stdout.lines().any(|line| line.starts_with("??"));

    if is_untracked {
        // Delete the file
        let absolute_path = root_path.join(&file_path);
        if absolute_path.exists() {
            if absolute_path.is_dir() {
                std::fs::remove_dir_all(&absolute_path)
                    .map_err(|e| format!("Failed to delete directory {}: {}", file_path, e))?;
            } else {
                std::fs::remove_file(&absolute_path)
                    .map_err(|e| format!("Failed to delete file {}: {}", file_path, e))?;
            }
        }
    } else {
        // Tracked file: unstage and discard changes
        // Unstage first (in case it was added/staged)
        let _ = git_base()
            .args(["reset", "HEAD", "--", &file_path])
            .current_dir(root_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output();

        // Discard changes in worktree
        let checkout_output = git_base()
            .args(["checkout", "--", &file_path])
            .current_dir(root_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| format!("Failed to checkout file: {}", e))?;

        if !checkout_output.status.success() {
            // If checkout failed, it might be a new file that has been reset and is now untracked.
            // Let's check status again, or check if it's untracked now.
            let status_output2 = git_base()
                .args(["status", "--porcelain", "--", &file_path])
                .current_dir(root_path)
                .env("GIT_TERMINAL_PROMPT", "0")
                .output();

            if let Ok(out) = status_output2 {
                let stdout2 = String::from_utf8_lossy(&out.stdout);
                if stdout2.lines().any(|line| line.starts_with("??")) {
                    let absolute_path = root_path.join(&file_path);
                    if absolute_path.exists() {
                        let _ = std::fs::remove_file(&absolute_path);
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn workspace_git_discard_all(
    project_id: String,
    confirmation: String,
    state: State<AppState>,
) -> Result<(), String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    if confirmation.trim() != "discard all changes" {
        return Err("Discard all requires explicit confirmation.".to_string());
    }

    // 1. Reset all tracked changes
    let reset_output = git_base()
        .args(["reset", "--hard", "HEAD"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git reset: {}", e))?;

    if !reset_output.status.success() {
        let stderr = String::from_utf8_lossy(&reset_output.stderr);
        return Err(format!("Discard all failed on reset: {}", stderr));
    }

    // 2. Clean untracked files
    let clean_output = git_base()
        .args(["clean", "-fd"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git clean: {}", e))?;

    if !clean_output.status.success() {
        let stderr = String::from_utf8_lossy(&clean_output.stderr);
        return Err(format!("Discard all failed on clean: {}", stderr));
    }

    Ok(())
}

// ── Agent worktree isolation ────────────────────────────────────────────────
// Each orchestrator agent works in its own git worktree on a dedicated branch,
// so multiple agents can edit the same repository concurrently without stepping
// on each other. Worktrees live in a sibling `.soryq-worktrees/<repo>` directory
// (outside the main tree) so they never appear in the project's own git status.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub base_branch: String,
    pub base_commit: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorktreeStatus {
    pub changed_files: u32,
    pub branch: String,
}

fn is_valid_branch_name(branch: &str) -> bool {
    !branch.is_empty()
        && !branch.starts_with('-')
        && !branch.starts_with('/')
        && !branch.ends_with('/')
        && !branch.contains("..")
        && !branch
            .contains(|c: char| matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\' | ' ' | '\0'))
}

/// Create an isolated git worktree on a fresh branch (forked from current HEAD)
/// for one agent. Returns the worktree's absolute path plus branch metadata, or
/// an error when the project isn't a git repo (the caller then runs the agent in
/// the project root instead).
#[tauri::command]
pub fn workspace_git_create_worktree(
    project_id: String,
    branch: String,
    state: State<AppState>,
) -> Result<WorktreeInfo, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;
    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    let branch = branch.trim();
    if !is_valid_branch_name(branch) {
        return Err("Invalid branch name".to_string());
    }

    let base_branch =
        git_capture(root_path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|| "HEAD".to_string());
    let base_commit = git_capture(root_path, &["rev-parse", "HEAD"])
        .ok_or_else(|| "Could not resolve HEAD — the repository has no commits yet.".to_string())?;

    let repo_name = root_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();
    let parent = root_path
        .parent()
        .ok_or_else(|| "Repository has no parent directory.".to_string())?;
    let safe_branch = branch.replace('/', "-");
    let worktree_path =
        crate::commands::clean_path_buf(parent.join(".soryq-worktrees").join(&repo_name).join(&safe_branch));
    let path_str = worktree_path.to_string_lossy().to_string();

    // Reuse an existing worktree at this path (idempotent on retry/relaunch).
    if worktree_path.join(".git").exists() {
        return Ok(WorktreeInfo {
            path: path_str,
            branch: branch.to_string(),
            base_branch,
            base_commit,
        });
    }

    if let Some(p) = worktree_path.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("Failed to create worktree directory: {}", e))?;
    }

    // Fresh branch from HEAD. If the branch already exists (a prior run), fall
    // back to checking it out into the new worktree path.
    let output = git_base()
        .args(["worktree", "add", "-b", branch, &path_str, "HEAD"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git worktree add: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let retry = git_base()
            .args(["worktree", "add", &path_str, branch])
            .current_dir(root_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| format!("Failed to run git worktree add: {}", e))?;
        if !retry.status.success() {
            return Err(format!("Failed to create worktree: {}", sanitize_git_error(&stderr)));
        }
    }

    // Defensive: only report success if the checkout actually materialized, so the
    // frontend can fall back to the project root rather than try to start a shell
    // in a directory that doesn't exist.
    if !worktree_path.is_dir() {
        return Err("Worktree directory was not created.".to_string());
    }

    Ok(WorktreeInfo {
        path: path_str,
        branch: branch.to_string(),
        base_branch,
        base_commit,
    })
}

/// Remove an agent worktree (and optionally delete its branch). Refuses to touch
/// anything outside the managed `.soryq-worktrees` area as a safety guard.
#[tauri::command]
pub fn workspace_git_remove_worktree(
    project_id: String,
    worktree_path: String,
    delete_branch: Option<bool>,
    branch: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;
    let root_path = &project.root_path;

    let cleaned = crate::commands::clean_path_buf(PathBuf::from(&worktree_path));
    if !cleaned.to_string_lossy().contains(".soryq-worktrees") {
        return Err("Refusing to remove a path outside the managed worktree area.".to_string());
    }

    let _ = git_base()
        .args(["worktree", "remove", "--force", &worktree_path])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output();
    let _ = git_base()
        .args(["worktree", "prune"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output();

    if delete_branch.unwrap_or(false) {
        if let Some(b) = branch {
            let b = b.trim();
            if is_valid_branch_name(b) {
                let _ = git_base()
                    .args(["branch", "-D", b])
                    .current_dir(root_path)
                    .env("GIT_TERMINAL_PROMPT", "0")
                    .output();
            }
        }
    }

    Ok(())
}

/// Live status for an agent worktree: number of changed files (staged, unstaged,
/// and untracked) plus the current branch. Used to surface review-readiness.
#[tauri::command]
pub fn workspace_git_worktree_status(worktree_path: String) -> Result<WorktreeStatus, String> {
    let path = crate::commands::clean_path_buf(PathBuf::from(&worktree_path));
    if !path.join(".git").exists() {
        return Err("Not a git worktree.".to_string());
    }

    let porcelain = git_capture(&path, &["status", "--porcelain"]).unwrap_or_default();
    let changed_files = porcelain.lines().filter(|l| !l.trim().is_empty()).count() as u32;
    let branch =
        git_capture(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|| "HEAD".to_string());

    Ok(WorktreeStatus {
        changed_files,
        branch,
    })
}

#[tauri::command]
pub fn workspace_git_diff(
    project_id: String,
    file_path: Option<String>,
    state: State<AppState>,
) -> Result<String, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    if let Some(ref path) = file_path {
        if !path.trim().is_empty() {
            validate_relative_path(path)?;
            // First check if the file is tracked in git.
            let is_tracked = git_base()
                .args(["ls-files", "--error-unmatch", "--", path])
                .current_dir(root_path)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);

            if !is_tracked {
                // Read the file and format as a diff where every line is an addition
                let absolute_path = root_path.join(path);
                // Verify path stays within project root before reading
                if let Ok(canonical) = std::fs::canonicalize(&absolute_path) {
                    let canonical = crate::commands::clean_path_buf(canonical);
                    if !canonical.starts_with(root_path) {
                        return Err("Access denied: path is outside project root".to_string());
                    }
                }
                if absolute_path.exists() {
                    match std::fs::read_to_string(&absolute_path) {
                        Ok(content) => {
                            let mut diff = format!(
                                "--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n",
                                path,
                                content.lines().count()
                            );
                            for line in content.lines() {
                                diff.push('+');
                                diff.push_str(line);
                                diff.push('\n');
                            }
                            return Ok(diff);
                        }
                        Err(e) => return Err(format!("Failed to read untracked file: {}", e)),
                    }
                }
            }

            // Otherwise, get git diff for this specific file
            let output = git_base()
                .args(["diff", "HEAD", "--", path])
                .current_dir(root_path)
                .env("GIT_TERMINAL_PROMPT", "0")
                .output()
                .map_err(|e| format!("Failed to run git diff: {}", e))?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            if output.status.success() {
                return Ok(stdout);
            } else {
                return Err(format!(
                    "Git diff failed:\n{}{}",
                    sanitize_git_error(&stderr),
                    sanitize_git_error(&stdout)
                ));
            }
        }
    }

    // Default: get full repo git diff
    let output = git_base()
        .args(["diff", "HEAD"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!(
            "Git diff failed:\n{}{}",
            sanitize_git_error(&stderr),
            sanitize_git_error(&stdout)
        ))
    }
}

/// Resolve a merge conflict in `file_path` by collapsing each conflict block to
/// a single side. `resolution` is "ours", "theirs", or "both". The file is
/// rewritten and staged with `git add` so Git treats the conflict as handled.
#[tauri::command]
pub fn workspace_resolve_conflict(
    project_id: String,
    file_path: String,
    resolution: String,
    state: State<AppState>,
) -> Result<(), String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;
    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }
    validate_relative_path(&file_path)?;

    let absolute_path = root_path.join(&file_path);
    if let Ok(canonical) = std::fs::canonicalize(&absolute_path) {
        let canonical = crate::commands::clean_path_buf(canonical);
        if !canonical.starts_with(root_path) {
            return Err("Access denied: path is outside project root".to_string());
        }
    }

    let content = std::fs::read_to_string(&absolute_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let resolved = resolve_conflict_markers(&content, &resolution)?;

    std::fs::write(&absolute_path, resolved)
        .map_err(|e| format!("Failed to write resolved file: {}", e))?;

    let output = git_base()
        .args(["add", "--", &file_path])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to stage resolved file: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("git add failed:\n{}", sanitize_git_error(&stderr)));
    }

    Ok(())
}

/// Collapse Git conflict blocks (`<<<<<<<` / `|||||||` / `=======` / `>>>>>>>`)
/// to a single side. Errors when no markers are present so the caller can tell
/// the user there was nothing to resolve.
fn resolve_conflict_markers(content: &str, resolution: &str) -> Result<String, String> {
    #[derive(PartialEq)]
    enum Section {
        None,
        Ours,
        Base,
        Theirs,
    }

    let mut out: Vec<&str> = Vec::new();
    let mut ours: Vec<&str> = Vec::new();
    let mut theirs: Vec<&str> = Vec::new();
    let mut section = Section::None;
    let mut found = false;

    for line in content.lines() {
        if line.starts_with("<<<<<<<") {
            found = true;
            section = Section::Ours;
            ours.clear();
            theirs.clear();
        } else if line.starts_with("|||||||") && section != Section::None {
            section = Section::Base;
        } else if line.starts_with("=======") && section != Section::None {
            section = Section::Theirs;
        } else if line.starts_with(">>>>>>>") && section != Section::None {
            match resolution {
                "ours" => out.extend(ours.iter().copied()),
                "theirs" => out.extend(theirs.iter().copied()),
                "both" => {
                    out.extend(ours.iter().copied());
                    out.extend(theirs.iter().copied());
                }
                other => return Err(format!("Unknown resolution '{}'", other)),
            }
            section = Section::None;
        } else {
            match section {
                Section::None => out.push(line),
                Section::Ours => ours.push(line),
                Section::Base => { /* base side is discarded */ }
                Section::Theirs => theirs.push(line),
            }
        }
    }

    if !found {
        return Err("No conflict markers found in this file.".to_string());
    }

    let mut result = out.join("\n");
    if content.ends_with('\n') {
        result.push('\n');
    }
    Ok(result)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GitLogEntry {
    pub graph: String,
    pub hash: Option<String>,
    pub author: Option<String>,
    pub date: Option<String>,
    pub refs: Option<String>,
    pub subject: Option<String>,
}

#[tauri::command]
pub fn workspace_git_log(
    project_id: String,
    state: State<AppState>,
) -> Result<Vec<GitLogEntry>, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    let output = git_base()
        .args([
            "log",
            "--graph",
            "--pretty=format:__DELIM__%h__DELIM__%an__DELIM__%ad (%ar)__DELIM__%d__DELIM__%s",
            "--date=format:%Y-%m-%d %H:%M",
            "--abbrev-commit",
            "-n",
            "50",
        ])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();

    for line in stdout.lines() {
        if let Some(idx) = line.find("__DELIM__") {
            let (graph, rest) = line.split_at(idx);
            let rest_clean = &rest[9..]; // "__DELIM__" is 9 chars
            let parts: Vec<&str> = rest_clean.split("__DELIM__").collect();

            let hash = parts.first().map(|s| s.to_string());
            let author = parts.get(1).map(|s| s.to_string());
            let date = parts.get(2).map(|s| s.to_string());
            let refs = parts.get(3).map(|s| {
                let trimmed = s.trim();
                if trimmed.starts_with('(') && trimmed.ends_with(')') {
                    trimmed[1..trimmed.len() - 1].to_string()
                } else {
                    trimmed.to_string()
                }
            });
            let subject = parts.get(4).map(|s| s.to_string());

            entries.push(GitLogEntry {
                graph: graph.to_string(),
                hash,
                author,
                date,
                refs: if refs.as_ref().is_none_or(|r| r.is_empty()) {
                    None
                } else {
                    refs
                },
                subject,
            });
        } else {
            entries.push(GitLogEntry {
                graph: line.to_string(),
                hash: None,
                author: None,
                date: None,
                refs: None,
                subject: None,
            });
        }
    }

    Ok(entries)
}

fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    if name.starts_with('-') {
        return Err("Invalid branch name".to_string());
    }
    if name.contains("..") {
        return Err("Invalid branch name".to_string());
    }
    // Only allow safe characters
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || "-_./".contains(c))
    {
        return Err("Branch name contains invalid characters".to_string());
    }
    Ok(())
}

fn get_project_path(project_id: &str, state: &AppState) -> Result<std::path::PathBuf, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;
    Ok(project.root_path.clone())
}

#[derive(serde::Serialize)]
pub struct GitBranchInfo {
    pub current: String,
    pub local: Vec<String>,
    pub remote: Vec<String>,
    /// Tracking branch (e.g. "origin/main"), or None if the current branch isn't
    /// published / has no upstream configured.
    pub upstream: Option<String>,
    /// Local commits not yet on the upstream (i.e. waiting to be pushed).
    pub ahead: usize,
    /// Upstream commits not yet pulled into the local branch.
    pub behind: usize,
    /// Whether any remote is configured at all.
    pub has_remote: bool,
}

#[tauri::command]
pub fn workspace_git_branches(
    project_id: String,
    state: State<AppState>,
) -> Result<GitBranchInfo, String> {
    let root_path = get_project_path(&project_id, &state)?;
    if !root_path.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }
    let output = git_base()
        .args(["branch", "-a", "--format=%(refname:short)|||%(HEAD)"])
        .current_dir(&root_path)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut current = String::new();
    let mut local = Vec::new();
    let mut remote = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(2, "|||").collect();
        if parts.len() < 2 {
            continue;
        }
        let name = parts[0].trim().to_string();
        let is_head = parts[1].trim() == "*";
        if name.starts_with("remotes/") {
            let short = name.trim_start_matches("remotes/").to_string();
            if !short.contains("/HEAD") {
                remote.push(short);
            }
        } else {
            if is_head {
                current = name.clone();
            }
            local.push(name);
        }
    }

    // Remote / upstream tracking info. `@{u}` resolves the current branch's
    // upstream; rev-list --left-right --count prints "<behind>\t<ahead>".
    let has_remote = git_capture(&root_path, &["remote"])
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    let upstream = git_capture(
        &root_path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .filter(|s| !s.is_empty());
    let (mut ahead, mut behind) = (0usize, 0usize);
    if let Some(ref up) = upstream {
        let spec = format!("{}...HEAD", up);
        if let Some(counts) =
            git_capture(&root_path, &["rev-list", "--left-right", "--count", &spec])
        {
            let mut it = counts.split_whitespace();
            behind = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            ahead = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        }
    }

    Ok(GitBranchInfo {
        current,
        local,
        remote,
        upstream,
        ahead,
        behind,
        has_remote,
    })
}

#[tauri::command]
pub fn workspace_git_checkout(
    project_id: String,
    branch: String,
    state: State<AppState>,
) -> Result<String, String> {
    validate_branch_name(&branch)?;
    let root_path = get_project_path(&project_id, &state)?;
    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }
    let output = git_base()
        .args(["switch", &branch])
        .current_dir(&root_path)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(format!("Switched to branch '{}'", branch))
    } else {
        Err(sanitize_git_error(&String::from_utf8_lossy(&output.stderr)))
    }
}

#[tauri::command]
pub fn workspace_git_branch_create(
    project_id: String,
    name: String,
    from: Option<String>,
    state: State<AppState>,
) -> Result<String, String> {
    validate_branch_name(&name)?;
    if let Some(ref f) = from {
        validate_branch_name(f)?;
    }
    let root_path = get_project_path(&project_id, &state)?;
    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }
    let mut args = vec!["checkout", "-b", &name];
    if let Some(ref f) = from {
        args.push(f);
    }
    let output = git_base()
        .args(&args)
        .current_dir(&root_path)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(format!("Created and switched to branch '{}'", name))
    } else {
        Err(sanitize_git_error(&String::from_utf8_lossy(&output.stderr)))
    }
}

#[tauri::command]
pub fn workspace_git_branch_delete(
    project_id: String,
    name: String,
    force: bool,
    state: State<AppState>,
) -> Result<String, String> {
    validate_branch_name(&name)?;
    let root_path = get_project_path(&project_id, &state)?;
    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }
    let flag = if force { "-D" } else { "-d" };
    let output = git_base()
        .args(["branch", flag, &name])
        .current_dir(&root_path)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(format!("Deleted branch '{}'", name))
    } else {
        Err(sanitize_git_error(&String::from_utf8_lossy(&output.stderr)))
    }
}

#[tauri::command]
pub fn workspace_set_active(
    project_id: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    state.workspace_manager.set_active_project(project_id);
    Ok(())
}

#[tauri::command]
pub fn workspace_clear_recent(state: State<AppState>) -> Result<(), String> {
    state.workspace_manager.clear_recent_projects();
    Ok(())
}

fn parse_daily_note_markdown(content: &str) -> (Vec<String>, Vec<String>) {
    let mut focus = Vec::new();
    let mut done = Vec::new();
    let mut current_section = ""; // "focus", "done" or ""

    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_prefix("##") {
            let section_name = stripped.trim().to_lowercase();
            if section_name.contains("focus") {
                current_section = "focus";
            } else if section_name.contains("done") {
                current_section = "done";
            } else {
                current_section = "";
            }
            continue;
        }

        if current_section == "focus" || current_section == "done" {
            if trimmed.starts_with('-')
                || trimmed.starts_with('*')
                || (trimmed.len() > 2
                    && trimmed.chars().next().unwrap().is_ascii_digit()
                    && trimmed.contains('.'))
            {
                let item = trimmed
                    .trim_start_matches([
                        '-', '*', ' ', '.', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
                    ])
                    .trim()
                    .to_string();
                if !item.is_empty() {
                    if current_section == "focus" {
                        focus.push(item);
                    } else {
                        done.push(item);
                    }
                }
            } else if !trimmed.is_empty() && !trimmed.starts_with('#') {
                if current_section == "focus" {
                    focus.push(trimmed.to_string());
                } else {
                    done.push(trimmed.to_string());
                }
            }
        }
    }

    (focus, done)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DailyNoteSummary {
    pub project_name: String,
    pub project_path: String,
    pub date: String,
    pub filepath: String,
    pub focus: Vec<String>,
    pub done: Vec<String>,
}

#[tauri::command]
pub fn workspace_get_recent_daily_notes(
    state: State<AppState>,
) -> Result<Vec<DailyNoteSummary>, String> {
    let recents = state.workspace_manager.get_recent_projects();
    let mut summaries = Vec::new();

    for project in recents {
        let daily_dir = project.root_path.join(".soryq").join("daily");
        let daily_notes_dir = project.root_path.join(".soryq").join("daily-notes");

        let dir_to_read = if daily_dir.is_dir() {
            Some(daily_dir)
        } else if daily_notes_dir.is_dir() {
            Some(daily_notes_dir)
        } else {
            None
        };

        if let Some(dir) = dir_to_read {
            if let Ok(entries) = std::fs::read_dir(dir) {
                let mut note_files = Vec::new();
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().map(|s| s == "md").unwrap_or(false) {
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            note_files.push((stem.to_string(), path));
                        }
                    }
                }

                note_files.sort_by(|a, b| b.0.cmp(&a.0));

                for (date, path) in note_files.into_iter().take(3) {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let (focus, done) = parse_daily_note_markdown(&content);
                        summaries.push(DailyNoteSummary {
                            project_name: project.name.clone(),
                            project_path: project.root_path.to_string_lossy().to_string(),
                            date,
                            filepath: path.to_string_lossy().to_string(),
                            focus,
                            done,
                        });
                    }
                }
            }
        }
    }

    Ok(summaries)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- sanitize_git_error ---

    #[test]
    fn sanitize_git_error_passes_clean_lines() {
        let input = "remote: Counting objects: 5, done.\nremote: Total 5";
        let result = sanitize_git_error(input);
        assert_eq!(result, input);
    }

    #[test]
    fn sanitize_git_error_redacts_windows_absolute_paths() {
        let input = "error: could not read C:\\Users\\sam\\project\\.git\\config";
        let result = sanitize_git_error(input);
        assert_eq!(result, "error: could not read [path redacted]");
    }

    #[test]
    fn sanitize_git_error_redacts_unix_absolute_paths() {
        let input = "/home/user/project: not a git repository";
        let result = sanitize_git_error(input);
        assert_eq!(result, "[path redacted] not a git repository");
    }

    #[test]
    fn sanitize_git_error_redacts_mixed_output() {
        // The function redacts a line when it starts with '/' (unix absolute path).
        // Here the first line starts with '/' and the second is clean.
        let input = "/home/user/project/.git: not a git repository\nUsage: git fetch <remote>";
        let result = sanitize_git_error(input);
        assert!(result.contains("[path redacted]"));
        assert!(result.contains("Usage: git fetch <remote>"));
    }

    #[test]
    fn sanitize_git_error_handles_empty_string() {
        assert_eq!(sanitize_git_error(""), "");
    }

    // --- validate_relative_path ---

    #[test]
    fn validate_relative_path_accepts_normal_paths() {
        assert!(validate_relative_path("src/main.rs").is_ok());
        assert!(validate_relative_path("README.md").is_ok());
        assert!(validate_relative_path("a/b/c/d.txt").is_ok());
    }

    #[test]
    fn validate_relative_path_rejects_null_bytes() {
        assert!(validate_relative_path("file\0name").is_err());
    }

    #[test]
    fn validate_relative_path_rejects_double_dash_prefix() {
        assert!(validate_relative_path("--malicious").is_err());
    }

    #[test]
    fn validate_relative_path_rejects_path_traversal_unix() {
        assert!(validate_relative_path("../outside").is_err());
        assert!(validate_relative_path("a/../../outside").is_err());
    }

    #[test]
    fn validate_relative_path_rejects_path_traversal_windows() {
        assert!(validate_relative_path("a\\..\\outside").is_err());
    }

    // --- validate_branch_name ---

    #[test]
    fn validate_branch_name_accepts_valid_names() {
        assert!(validate_branch_name("main").is_ok());
        assert!(validate_branch_name("feature/my-branch").is_ok());
        assert!(validate_branch_name("fix_bug_123").is_ok());
    }

    #[test]
    fn validate_branch_name_rejects_empty() {
        assert!(validate_branch_name("").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_leading_dash() {
        assert!(validate_branch_name("-bad-branch").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_double_dot() {
        assert!(validate_branch_name("branch..name").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_special_characters() {
        assert!(validate_branch_name("branch name").is_err());
        assert!(validate_branch_name("branch@name").is_err());
        assert!(validate_branch_name("branch;name").is_err());
    }

    // --- extract_port_from_cmd ---

    #[test]
    fn extract_port_from_cmd_finds_port_flag() {
        assert_eq!(extract_port_from_cmd("vite --port 5174"), Some(5174));
    }

    #[test]
    fn extract_port_from_cmd_finds_short_port_flag() {
        assert_eq!(extract_port_from_cmd("node server.js -p 8080"), Some(8080));
    }

    #[test]
    fn extract_port_from_cmd_returns_none_when_absent() {
        assert_eq!(extract_port_from_cmd("vite --host 0.0.0.0"), None);
    }

    #[test]
    fn extract_port_from_cmd_returns_none_for_empty() {
        assert_eq!(extract_port_from_cmd(""), None);
    }

    // --- extract_port_from_vite_config ---

    #[test]
    fn extract_port_from_vite_config_parses_port() {
        let config = "export default defineConfig({\n  server: {\n    port: 3001,\n  }\n})";
        assert_eq!(extract_port_from_vite_config(config), Some(3001));
    }

    #[test]
    fn extract_port_from_vite_config_skips_line_comments() {
        let config = "// port: 22\nexport default defineConfig({ server: { port: 4000 } })";
        assert_eq!(extract_port_from_vite_config(config), Some(4000));
    }

    #[test]
    fn extract_port_from_vite_config_skips_block_comments() {
        // The parser opens a block comment on "/*" and closes it on a later line containing "*/".
        // A single-line "/* ... */" is NOT closed within the same line (the parser `continue`s
        // after setting in_block_comment = true), so this test uses a proper multi-line form.
        let config = "/*\n  port: 22\n*/\nexport default defineConfig({ server: { port: 4321 } })";
        assert_eq!(extract_port_from_vite_config(config), Some(4321));
    }

    #[test]
    fn extract_port_from_vite_config_returns_none_when_absent() {
        let config = "export default defineConfig({ server: { host: true } })";
        assert_eq!(extract_port_from_vite_config(config), None);
    }
}
