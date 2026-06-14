use crate::lsp::registry::ResolvedCommand;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

/// A single running language server process. The reader thread strips the LSP
/// `Content-Length` framing and pushes each complete JSON message onto an
/// unbounded channel consumed by the WebSocket bridge; `send` adds the framing
/// back when writing client messages to the child's stdin.
pub struct LspServer {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
}

impl LspServer {
    /// Spawn the resolved server command in `cwd`. Returns the handle plus a
    /// receiver of outbound (server -> client) LSP messages as unframed JSON
    /// strings.
    pub fn spawn(
        cmd: ResolvedCommand,
        cwd: &str,
    ) -> Result<(Self, UnboundedReceiver<String>), String> {
        let mut command = Command::new(&cmd.program);
        command
            .args(&cmd.args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Don't pop a console window for the child on Windows.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start language server '{}': {e}", cmd.program))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Language server stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Language server stdout unavailable".to_string())?;
        let stderr = child.stderr.take();

        let (tx, rx) = unbounded_channel::<String>();

        // Reader thread: parse the LSP framing and forward each message. Stops
        // when the child closes stdout or the receiver (WebSocket) is dropped.
        thread::Builder::new()
            .name("soryq-lsp-reader".into())
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    match read_message(&mut reader) {
                        Ok(Some(msg)) => {
                            if tx.send(msg).is_err() {
                                break; // bridge gone
                            }
                        }
                        Ok(None) | Err(_) => break, // EOF or parse error
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        // Stderr drain: language servers can block if stderr fills up, so we must
        // always read it even though we only log it.
        if let Some(mut stderr) = stderr {
            thread::Builder::new()
                .name("soryq-lsp-stderr".into())
                .spawn(move || {
                    let mut buf = [0u8; 8192];
                    loop {
                        match stderr.read(&mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        }
                    }
                })
                .ok();
        }

        Ok((
            LspServer {
                stdin: Arc::new(Mutex::new(stdin)),
                child: Arc::new(Mutex::new(child)),
            },
            rx,
        ))
    }

    /// Send a raw LSP message (a complete JSON-RPC object as a string) to the
    /// server, adding the `Content-Length` framing.
    pub fn send(&self, message: &str) -> Result<(), String> {
        let framed = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        stdin
            .write_all(framed.as_bytes())
            .map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())
    }

    pub fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for LspServer {
    fn drop(&mut self) {
        // The WebSocket task owns the only handle; dropping it kills the process.
        if Arc::strong_count(&self.child) == 1 {
            self.kill();
        }
    }
}

/// Read one LSP message off the stream: parse `Content-Length` headers, then the
/// exact byte body. Returns `Ok(None)` on a clean EOF.
fn read_message<R: BufRead>(reader: &mut R) -> Result<Option<String>, String> {
    let mut content_length: Option<usize> = None;

    // Header block: lines terminated by \r\n, ended by a blank line.
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(None); // EOF
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break; // end of headers
        }
        if let Some(value) = trimmed
            .strip_prefix("Content-Length:")
            .or_else(|| trimmed.strip_prefix("Content-length:"))
        {
            content_length = value.trim().parse::<usize>().ok();
        }
        // Other headers (e.g. Content-Type) are ignored.
    }

    let len = content_length.ok_or_else(|| "LSP message missing Content-Length".to_string())?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    String::from_utf8(body)
        .map(Some)
        .map_err(|e| e.to_string())
}
