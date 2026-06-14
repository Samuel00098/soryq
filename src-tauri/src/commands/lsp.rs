use crate::lsp::registry;
use crate::state::AppState;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use tauri::ipc::Channel;
use tauri::State;

/// Result of probing whether a language server is installed for a language.
#[derive(Serialize)]
pub struct ServerStatus {
    pub language: String,
    /// Whether LSP is supported for this language at all.
    pub supported: bool,
    /// Whether the server binary was found on PATH.
    pub available: bool,
    /// Base command we look for (e.g. "rust-analyzer").
    pub command: String,
    /// Shown to the user when the server is missing.
    pub install_hint: String,
}

/// The connection details the frontend needs to open the LSP WebSocket.
#[derive(Serialize)]
pub struct LspConnection {
    /// localhost port of the bridge WebSocket server.
    pub port: u16,
    /// Single-use token authorizing this connection.
    pub token: String,
    /// The `file://` URI of the workspace root (canonicalized).
    pub root_uri: String,
}

/// Resolve and canonicalize a workspace root, confined to an open project.
fn resolve_root(root: String, state: &AppState) -> Result<PathBuf, String> {
    let raw = PathBuf::from(root.trim());
    if raw.as_os_str().is_empty() {
        return Err("Empty workspace root".to_string());
    }
    let canonical =
        std::fs::canonicalize(&raw).map_err(|_| "Invalid workspace root".to_string())?;
    let clean = crate::commands::clean_path_buf(canonical);
    crate::commands::file_system::require_in_project(&clean, state)?;
    if !clean.is_dir() {
        return Err("Workspace root must be a directory".to_string());
    }
    Ok(clean)
}

fn path_to_file_uri(path: &std::path::Path) -> String {
    // url::Url handles platform-specific (e.g. Windows drive-letter) encoding.
    url::Url::from_directory_path(path)
        .map(|u| u.to_string())
        .unwrap_or_else(|_| format!("file://{}", path.to_string_lossy()))
}

/// Probe whether a language server is available for the given language.
#[tauri::command]
pub fn lsp_check_server(language: String) -> ServerStatus {
    match registry::lookup(&language) {
        Some(def) => {
            let available = registry::resolve(def).is_some();
            ServerStatus {
                language,
                supported: true,
                available,
                command: def.command.to_string(),
                install_hint: def.install_hint.to_string(),
            }
        }
        None => ServerStatus {
            language,
            supported: false,
            available: false,
            command: String::new(),
            install_hint: String::new(),
        },
    }
}

/// Authorize a language server for `(root, language)` and return the WebSocket
/// connection details. The frontend connects CodeMirror's `WebSocketTransport`
/// to `ws://127.0.0.1:{port}/lsp?token={token}`; the bridge then spawns the
/// server and pipes LSP messages over the socket.
#[tauri::command]
pub fn lsp_start(
    root: String,
    language: String,
    state: State<AppState>,
) -> Result<LspConnection, String> {
    let def = registry::lookup(&language)
        .ok_or_else(|| format!("No language server configured for '{language}'"))?;
    let cmd = registry::resolve(def).ok_or_else(|| {
        format!(
            "Language server '{}' not found. Install it with: {}",
            def.command, def.install_hint
        )
    })?;

    let clean_root = resolve_root(root, &state)?;
    let root_uri = path_to_file_uri(&clean_root);

    let port = state.lsp_bridge.ensure_started()?;
    let token = state
        .lsp_bridge
        .create_token(cmd, clean_root.to_string_lossy().to_string());

    Ok(LspConnection {
        port,
        token,
        root_uri,
    })
}

/// Install the language server for a language by running its known install
/// command (e.g. `npm install -g …`). Output lines stream over `on_output`; the
/// process exit code arrives on `on_done` (0 = success). The command is a fixed,
/// trusted constant per language — never user-supplied.
#[tauri::command]
pub fn lsp_install_server(
    language: String,
    on_output: Channel<String>,
    on_done: Channel<i32>,
) -> Result<(), String> {
    let def = registry::lookup(&language)
        .ok_or_else(|| format!("No language server configured for '{language}'"))?;
    let install = registry::resolve_install(def).ok_or_else(|| {
        format!(
            "Can't install automatically: '{}' is not on PATH. Install it first, then run: {}",
            def.install_program, def.install_hint
        )
    })?;

    let cwd = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    let mut command = Command::new(&install.program);
    command
        .args(&install.args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start installer '{}': {e}", install.program))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Merge stdout + stderr line-by-line onto the output channel.
    for stream in [stdout.map(Stream::Out), stderr.map(Stream::Err)]
        .into_iter()
        .flatten()
    {
        let out = on_output.clone();
        thread::Builder::new()
            .name("soryq-lsp-install".into())
            .spawn(move || {
                let reader: Box<dyn std::io::Read + Send> = match stream {
                    Stream::Out(s) => Box::new(s),
                    Stream::Err(s) => Box::new(s),
                };
                let mut lines = BufReader::new(reader).lines();
                while let Some(Ok(line)) = lines.next() {
                    if out.send(line).is_err() {
                        break;
                    }
                }
            })
            .ok();
    }

    // Wait for completion off-thread and report the exit code.
    thread::Builder::new()
        .name("soryq-lsp-install-wait".into())
        .spawn(move || {
            let code = child
                .wait()
                .ok()
                .and_then(|s| s.code())
                .unwrap_or(-1);
            let _ = on_done.send(code);
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

enum Stream {
    Out(std::process::ChildStdout),
    Err(std::process::ChildStderr),
}
