use crate::workspace::project::Project;
use tauri::State;
use crate::state::AppState;
use std::path::PathBuf;
use std::process::Command;

fn validate_relative_path(file_path: &str) -> Result<(), String> {
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

    // 1. Stage all changes
    let add_output = Command::new("git")
        .args(&["add", "-A"])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to stage changes: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("Failed to stage changes: {}", stderr));
    }

    // 2. Commit changes
    let commit_output = Command::new("git")
        .args(&["commit", "-m", &message])
        .current_dir(root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to commit changes: {}", e))?;

    let stdout = String::from_utf8_lossy(&commit_output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&commit_output.stderr).to_string();

    if commit_output.status.success() {
        Ok(format!("Successfully committed changes!\n{}{}", stdout, stderr))
    } else {
        Err(format!("Commit failed:\n{}{}", stderr, stdout))
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
        Ok(format!("Successfully pushed to GitHub!\n{}{}", stdout, stderr))
    } else {
        Err(format!("Git push failed:\n{}{}", stderr, stdout))
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
        Ok(format!("Successfully fetched from remote!\n{}{}", stdout, stderr))
    } else {
        Err(format!("Git fetch failed:\n{}{}", stderr, stdout))
    }
}



#[tauri::command]
pub fn workspace_detect_port(path: String) -> u16 {
    let root = match std::fs::canonicalize(std::path::PathBuf::from(&path)) {
        Ok(r) => crate::commands::clean_path_buf(r),
        Err(_) => return 5173,
    };
    
    // 1. Try to read package.json
    let package_json_path = root.join("package.json");
    if package_json_path.is_file() {
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
    let mut search_str = content;
    while let Some(pos) = search_str.find("port:") {
        let after = &search_str[pos + 5..];
        let num_str: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !num_str.is_empty() {
            if let Ok(port) = num_str.parse::<u16>() {
                return Some(port);
            }
        }
        search_str = after;
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
                                line_content: line.trim().to_string(),
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
        let absolute_path = root_path.join(file);
        let additions = if absolute_path.exists() && absolute_path.is_file() {
            match std::fs::read_to_string(&absolute_path) {
                Ok(content) => content.lines().count() as i32,
                Err(_) => 0,
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
                return Err(format!("Git diff failed:\n{}{}", stderr, stdout));
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
        Err(format!("Git diff failed:\n{}{}", stderr, stdout))
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


