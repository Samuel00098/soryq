use crate::workspace::project::Project;
use tauri::State;
use crate::state::AppState;
use std::path::PathBuf;
use std::process::Command;

/// Strip local path information from git error output before surfacing it to the frontend.
fn sanitize_git_error(stderr: &str) -> String {
    stderr
        .lines()
        .map(|line| {
            // Replace absolute path segments with a placeholder
            if line.contains(":\\") || line.contains('/') {
                "[path redacted]".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn validate_relative_path(file_path: &str) -> Result<(), String> {
    if file_path.contains('\0') {
        return Err("Invalid file path".to_string());
    }
    if file_path.starts_with("--") {
        return Err("Invalid file path".to_string());
    }
    if file_path.split(|c| c == '/' || c == '\\').any(|seg| seg == "..") {
        return Err("Path traversal is not allowed".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_open_project(path: String, state: State<AppState>) -> Result<Project, String> {
    let root_path = std::fs::canonicalize(PathBuf::from(&path))
        .map_err(|_| "Invalid path".to_string())?;
    let root_path = crate::commands::clean_path_buf(root_path);
    state.workspace_manager.open_project(root_path).map_err(|e| e.to_string())
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
pub fn workspace_get_recent(state: State<AppState>) -> Vec<crate::workspace::project::RecentProject> {
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
    let project = projects.iter().find(|p| p.id == project_id)
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
    let add_output = Command::new("git")
        .args(&add_args)
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to stage changes: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("Failed to stage changes: {}", sanitize_git_error(&stderr)));
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
    let commit_output = Command::new("git")
        .args(&commit_args)
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to commit changes: {}", e))?;

    let stdout = String::from_utf8_lossy(&commit_output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&commit_output.stderr).to_string();

    if commit_output.status.success() {
        Ok(format!("Successfully committed changes!\n{}{}", stdout, sanitize_git_error(&stderr)))
    } else {
        Err(format!("Commit failed:\n{}{}", sanitize_git_error(&stderr), stdout))
    }
}

#[tauri::command]
pub fn workspace_git_push(
    project_id: String,
    state: State<AppState>,
) -> Result<String, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects.iter().find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    // 1. Determine current branch
    let branch = Command::new("git")
        .args(&["branch", "--show-current"])
        .current_dir(root_path)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    // 2. Push to origin — use "--" separator to prevent branch names starting
    //    with "-" from being interpreted as git flags.
    let mut push_args: Vec<&str> = vec!["push", "origin"];
    let branch_owned = branch.clone();
    if !branch_owned.is_empty() {
        push_args.push("--");
        push_args.push(&branch_owned);
    }

    let output = Command::new("git")
        .args(&push_args)
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("Successfully pushed to GitHub!\n{}{}", stdout, sanitize_git_error(&stderr)))
    } else {
        Err(format!("Git push failed:\n{}{}", sanitize_git_error(&stderr), stdout))
    }
}

#[tauri::command]
pub fn workspace_git_fetch(
    project_id: String,
    state: State<AppState>,
) -> Result<String, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects.iter().find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    let output = Command::new("git")
        .args(&["fetch", "origin"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to execute git fetch: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("Successfully fetched from remote!\n{}{}", sanitize_git_error(&stdout), sanitize_git_error(&stderr)))
    } else {
        Err(format!("Git fetch failed:\n{}{}", sanitize_git_error(&stderr), sanitize_git_error(&stdout)))
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
        let too_large = std::fs::metadata(&package_json_path).map(|m| m.len() > 1_048_576).unwrap_or(false);
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
                if let Some(dependencies) = json.get("dependencies").and_then(|d| d.as_object()) {
                    if dependencies.contains_key("next") || dependencies.contains_key("nuxt") {
                        return 3000;
                    }
                    if dependencies.contains_key("astro") {
                        return 4321;
                    }
                }
                if let Some(dev_dependencies) = json.get("devDependencies").and_then(|d| d.as_object()) {
                    if dev_dependencies.contains_key("next") || dev_dependencies.contains_key("nuxt") {
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
            if trimmed.contains("*/") { in_block_comment = false; }
            continue;
        }
        if trimmed.starts_with("//") { continue; }
        if trimmed.starts_with("/*") {
            // Single-line block comment: /* ... */ — enter and immediately exit
            if trimmed.contains("*/") { continue; }
            in_block_comment = true;
            continue;
        }
        if let Some(pos) = trimmed.find("port:") {
            let after = &trimmed[pos + 5..];
            let num_str: String = after.chars()
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
    if !projects.iter().any(|p| root == p.root_path || root.starts_with(&p.root_path)) {
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
                        || name == ".svelte-kit"
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
                    
                    let relative_path = path.strip_prefix(root)
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
    let project = projects.iter().find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    // 1. Get branch name
    let branch = Command::new("git")
        .args(&["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "HEAD".to_string());

    // 2. Get porcelain status
    let output = Command::new("git")
        .args(&["status", "--porcelain"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut modified = Vec::new();
    let mut added = Vec::new();
    let mut deleted = Vec::new();
    let mut untracked = Vec::new();

    for line in stdout.lines() {
        if line.len() < 4 {
            continue;
        }
        let status_code = &line[0..2];
        let file_path = line[3..].trim().to_string();

        if status_code.contains('M') {
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

    let numstat_output = Command::new("git")
        .args(&["diff", "HEAD", "--numstat", "--no-renames"])
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
            let size = std::fs::metadata(&absolute_path).map(|m| m.len()).unwrap_or(u64::MAX);
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
    let project = projects.iter().find(|p| p.id == project_id)
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
    let status_output = Command::new("git")
        .args(&["status", "--porcelain", "--", &file_path])
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
        let _ = Command::new("git")
            .args(&["reset", "HEAD", "--", &file_path])
            .current_dir(root_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output();

        // Discard changes in worktree
        let checkout_output = Command::new("git")
            .args(&["checkout", "--", &file_path])
            .current_dir(root_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| format!("Failed to checkout file: {}", e))?;

        if !checkout_output.status.success() {
            // If checkout failed, it might be a new file that has been reset and is now untracked.
            // Let's check status again, or check if it's untracked now.
            let status_output2 = Command::new("git")
                .args(&["status", "--porcelain", "--", &file_path])
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
    state: State<AppState>,
) -> Result<(), String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects.iter().find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    // 1. Reset all tracked changes
    let reset_output = Command::new("git")
        .args(&["reset", "--hard", "HEAD"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git reset: {}", e))?;

    if !reset_output.status.success() {
        let stderr = String::from_utf8_lossy(&reset_output.stderr);
        return Err(format!("Discard all failed on reset: {}", stderr));
    }

    // 2. Clean untracked files
    let clean_output = Command::new("git")
        .args(&["clean", "-fd"])
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

#[tauri::command]
pub fn workspace_git_diff(
    project_id: String,
    file_path: Option<String>,
    state: State<AppState>,
) -> Result<String, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects.iter().find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    if let Some(ref path) = file_path {
        if !path.trim().is_empty() {
            validate_relative_path(path)?;
            // First check if the file is tracked in git.
            let is_tracked = Command::new("git")
                .args(&["ls-files", "--error-unmatch", "--", path])
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
                            let mut diff = format!("--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n", path, content.lines().count());
                            for line in content.lines() {
                                diff.push_str("+");
                                diff.push_str(line);
                                diff.push_str("\n");
                            }
                            return Ok(diff);
                        }
                        Err(e) => return Err(format!("Failed to read untracked file: {}", e)),
                    }
                }
            }

            // Otherwise, get git diff for this specific file
            let output = Command::new("git")
                .args(&["diff", "HEAD", "--", path])
                .current_dir(root_path)
                .env("GIT_TERMINAL_PROMPT", "0")
                .output()
                .map_err(|e| format!("Failed to run git diff: {}", e))?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            if output.status.success() {
                return Ok(stdout);
            } else {
                return Err(format!("Git diff failed:\n{}{}", sanitize_git_error(&stderr), sanitize_git_error(&stdout)));
            }
        }
    }

    // Default: get full repo git diff
    let output = Command::new("git")
        .args(&["diff", "HEAD"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("Git diff failed:\n{}{}", sanitize_git_error(&stderr), sanitize_git_error(&stdout)))
    }
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
    let project = projects.iter().find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let root_path = &project.root_path;

    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }

    let output = Command::new("git")
        .args(&[
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
            
            let hash = parts.get(0).map(|s| s.to_string());
            let author = parts.get(1).map(|s| s.to_string());
            let date = parts.get(2).map(|s| s.to_string());
            let refs = parts.get(3).map(|s| {
                let trimmed = s.trim();
                if trimmed.starts_with('(') && trimmed.ends_with(')') {
                    trimmed[1..trimmed.len()-1].to_string()
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
                refs: if refs.as_ref().map_or(true, |r| r.is_empty()) { None } else { refs },
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
    if name.is_empty() { return Err("Branch name cannot be empty".to_string()); }
    if name.starts_with('-') { return Err("Invalid branch name".to_string()); }
    if name.contains("..") { return Err("Invalid branch name".to_string()); }
    // Only allow safe characters
    if !name.chars().all(|c| c.is_alphanumeric() || "-_./".contains(c)) {
        return Err("Branch name contains invalid characters".to_string());
    }
    Ok(())
}

fn get_project_path(project_id: &str, state: &AppState) -> Result<std::path::PathBuf, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects.iter().find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;
    Ok(project.root_path.clone())
}

#[derive(serde::Serialize)]
pub struct GitBranchInfo {
    pub current: String,
    pub local: Vec<String>,
    pub remote: Vec<String>,
}

#[tauri::command]
pub fn workspace_git_branches(project_id: String, state: State<AppState>) -> Result<GitBranchInfo, String> {
    let root_path = get_project_path(&project_id, &state)?;
    if !root_path.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }
    let output = Command::new("git")
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
        if parts.len() < 2 { continue; }
        let name = parts[0].trim().to_string();
        let is_head = parts[1].trim() == "*";
        if name.starts_with("remotes/") {
            let short = name.trim_start_matches("remotes/").to_string();
            if !short.contains("/HEAD") { remote.push(short); }
        } else {
            if is_head { current = name.clone(); }
            local.push(name);
        }
    }
    Ok(GitBranchInfo { current, local, remote })
}

#[tauri::command]
pub fn workspace_git_checkout(project_id: String, branch: String, state: State<AppState>) -> Result<String, String> {
    validate_branch_name(&branch)?;
    let root_path = get_project_path(&project_id, &state)?;
    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }
    let output = Command::new("git")
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
pub fn workspace_git_branch_create(project_id: String, name: String, from: Option<String>, state: State<AppState>) -> Result<String, String> {
    validate_branch_name(&name)?;
    if let Some(ref f) = from { validate_branch_name(f)?; }
    let root_path = get_project_path(&project_id, &state)?;
    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }
    let mut args = vec!["checkout", "-b", &name];
    if let Some(ref f) = from { args.push(f); }
    let output = Command::new("git")
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
pub fn workspace_git_branch_delete(project_id: String, name: String, force: bool, state: State<AppState>) -> Result<String, String> {
    validate_branch_name(&name)?;
    let root_path = get_project_path(&project_id, &state)?;
    if !root_path.join(".git").exists() {
        return Err("This project is not a Git repository.".to_string());
    }
    let flag = if force { "-D" } else { "-d" };
    let output = Command::new("git")
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
pub fn workspace_set_active(project_id: Option<String>, state: State<AppState>) -> Result<(), String> {
    state.workspace_manager.set_active_project(project_id);
    Ok(())
}

#[tauri::command]
pub fn workspace_clear_recent(state: State<AppState>) -> Result<(), String> {
    state.workspace_manager.clear_recent_projects();
    Ok(())
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
        assert_eq!(result, "[path redacted]");
    }

    #[test]
    fn sanitize_git_error_redacts_unix_absolute_paths() {
        let input = "/home/user/project: not a git repository";
        let result = sanitize_git_error(input);
        assert_eq!(result, "[path redacted]");
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
