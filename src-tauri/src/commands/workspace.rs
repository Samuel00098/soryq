use crate::workspace::project::Project;
use tauri::State;
use crate::state::AppState;
use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
pub fn workspace_open_project(path: String, state: State<AppState>) -> Result<Project, String> {
    let root_path = PathBuf::from(&path);
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
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

    // 2. Push to origin
    let mut push_args: Vec<&str> = vec!["push", "origin"];
    let branch_owned = branch.clone();
    if !branch_owned.is_empty() {
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
    let root = std::path::PathBuf::from(&path);
    
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
) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let root = std::path::PathBuf::from(&project_path);
    if !root.exists() {
        return Err(format!("Project path does not exist: {}", project_path));
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
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub deleted: Vec<String>,
    pub untracked: Vec<String>,
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

    Ok(GitStatus {
        modified,
        added,
        deleted,
        untracked,
    })
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


