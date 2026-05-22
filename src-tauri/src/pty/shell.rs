use std::path::Path;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ShellConfig {
    pub program: String,
    pub args: Vec<String>,
}

/// Returns available shells on this system
pub fn available_shells() -> Vec<ShellConfig> {
    let mut shells = Vec::new();

    if cfg!(target_os = "windows") {
        // PowerShell 7 (pwsh)
        if which("pwsh").is_some() {
            shells.push(ShellConfig {
                program: "pwsh".into(),
                args: vec![
                    "-NoLogo".into(),
                    "-NoProfile".into(),
                ],
            });
        }
        // Windows PowerShell 5
        if which("powershell").is_some() || which("powershell.exe").is_some() {
            shells.push(ShellConfig {
                program: "powershell".into(),
                args: vec![
                    "-NoLogo".into(),
                    "-NoProfile".into(),
                ],
            });
        }
        // CMD
        shells.push(ShellConfig {
            program: std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()),
            args: vec![],
        });
        // Git Bash
        for git_bash in &[
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ] {
            if Path::new(git_bash).exists() {
                shells.push(ShellConfig {
                    program: git_bash.to_string(),
                    args: vec!["--login".into(), "-i".into()],
                });
                break;
            }
        }
        // WSL bash
        if which("wsl").is_some() {
            shells.push(ShellConfig {
                program: "wsl".into(),
                args: vec![],
            });
        }
    } else {
        for sh in &["/bin/zsh", "/bin/bash", "/bin/sh"] {
            if Path::new(sh).exists() {
                shells.push(ShellConfig {
                    program: sh.to_string(),
                    args: vec!["-l".into()],
                });
            }
        }
        if let Some(p) = which("fish") {
            shells.push(ShellConfig { program: p, args: vec!["-l".into()] });
        }
    }

    shells
}

fn which(prog: &str) -> Option<String> {
    let prog_path = Path::new(prog);
    if prog_path.is_absolute() || prog_path.components().count() > 1 {
        if prog_path.is_file() {
            return Some(prog.to_string());
        }
        if cfg!(target_os = "windows") {
            for ext in &[".exe", ".cmd", ".bat"] {
                let p_ext = prog_path.with_extension(ext.trim_start_matches('.'));
                if p_ext.is_file() {
                    return Some(p_ext.to_string_lossy().to_string());
                }
            }
        }
        return None;
    }

    let path_var = std::env::var_os("PATH")?;
    let paths = std::env::split_paths(&path_var);
    for dir in paths {
        let p = dir.join(prog);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
        if cfg!(target_os = "windows") {
            for ext in &[".exe", ".cmd", ".bat"] {
                let p_ext = dir.join(format!("{}{}", prog, ext));
                if p_ext.is_file() {
                    return Some(p_ext.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

pub fn get_shell_by_program(program: &str, args: Option<Vec<String>>) -> ShellConfig {
    // Find matching shell from available list, or construct one with provided args
    let available = available_shells();
    if let Some(found) = available.iter().find(|s| {
        s.program.to_lowercase().contains(&program.to_lowercase())
            || program.to_lowercase().contains(
                Path::new(&s.program)
                    .file_stem()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase()
                    .as_str(),
            )
    }) {
        return found.clone();
    }
    ShellConfig { program: program.to_string(), args: args.unwrap_or_default() }
}

pub fn detect_shell() -> ShellConfig {
    available_shells().into_iter().next().unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            ShellConfig {
                program: std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()),
                args: vec![],
            }
        } else {
            ShellConfig { program: "/bin/sh".into(), args: vec!["-l".into()] }
        }
    })
}

pub fn get_default_cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
                "C:\\".to_string()
            } else {
                "/".to_string()
            }
        })
}
