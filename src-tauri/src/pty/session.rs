use crate::pty::shell::ShellConfig;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::ipc::{Channel, Response};

#[derive(Clone)]
pub struct PtySession {
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    output_buffer: Arc<Mutex<Vec<u8>>>,
    data_subscribers: Arc<Mutex<Vec<Channel<Response>>>>,
    exit_code: Arc<Mutex<Option<i32>>>,
    exit_subscribers: Arc<Mutex<Vec<Channel<i32>>>>,
}

const MAX_REPLAY_BUFFER_BYTES: usize = 1024 * 1024;

pub fn spawn(
    cols: u16,
    rows: u16,
    shell: ShellConfig,
    cwd: String,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
    env: Option<std::collections::HashMap<String, String>>,
) -> Result<PtySession, String> {
    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&shell.program);
    for arg in &shell.args {
        cmd.arg(arg);
    }
    cmd.cwd(&cwd);
    if let Some(env_vars) = env {
        for (k, v) in env_vars {
            cmd.env(k, v);
        }
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let writer = Arc::new(Mutex::new(writer));
    let master = Arc::new(Mutex::new(pair.master));
    let killer = Arc::new(Mutex::new(child.clone_killer()));
    let output_buffer = Arc::new(Mutex::new(Vec::new()));
    let data_subscribers = Arc::new(Mutex::new(vec![on_data]));
    let exit_code = Arc::new(Mutex::new(None));
    let exit_subscribers = Arc::new(Mutex::new(vec![on_exit]));

    let reader_output_buffer = output_buffer.clone();
    let reader_data_subscribers = data_subscribers.clone();
    thread::Builder::new()
        .name("forge-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; 65536];
            let mut reader = reader;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        if let Ok(mut replay) = reader_output_buffer.lock() {
                            replay.extend_from_slice(&chunk);
                            let excess = replay.len().saturating_sub(MAX_REPLAY_BUFFER_BYTES);
                            if excess > 0 {
                                replay.drain(..excess);
                            }
                        }
                        if let Ok(mut subscribers) = reader_data_subscribers.lock() {
                            subscribers.retain(|channel| {
                                channel.send(Response::new(chunk.clone())).is_ok()
                            });
                        }
                    }
                    Err(_) => break,
                }
            }
        })
        .map_err(|e| e.to_string())?;

    let waiter_exit_code = exit_code.clone();
    let waiter_exit_subscribers = exit_subscribers.clone();
    thread::Builder::new()
        .name("forge-pty-waiter".into())
        .spawn(move || {
            let code = match child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(_) => -1,
            };
            if let Ok(mut stored_code) = waiter_exit_code.lock() {
                *stored_code = Some(code);
            }
            if let Ok(mut subscribers) = waiter_exit_subscribers.lock() {
                subscribers.retain(|channel| channel.send(code).is_ok());
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(PtySession {
        master,
        writer,
        killer,
        output_buffer,
        data_subscribers,
        exit_code,
        exit_subscribers,
    })
}

impl Drop for PtySession {
    fn drop(&mut self) {
        // Only kill when this is the last Arc holder (i.e. the canonical copy stored
        // in PtyManager). Clones returned by PtyManager::get() share the same Arc, so
        // their Drop must not kill the process — strong_count > 1 means another copy
        // still holds the session alive.
        if Arc::strong_count(&self.killer) == 1 {
            if let Ok(mut killer) = self.killer.lock() {
                let _ = killer.kill();
            }
        }
    }
}

impl PtySession {
    /// Subscribes the channels to live output and returns the buffered history
    /// instead of sending it down `on_data`. The history contains the child's
    /// past terminal queries (e.g. Codex's OSC 10/11 color probes); the frontend
    /// must feed it to xterm through its gated replay path so the re-answered
    /// queries are dropped rather than written back to the live PTY, where the
    /// running child would render them as literal `]10;rgb:…` input.
    pub fn attach(
        &self,
        on_data: Channel<Response>,
        on_exit: Channel<i32>,
    ) -> Result<Vec<u8>, String> {
        let replay = {
            let mut subscribers = self.data_subscribers.lock().map_err(|e| e.to_string())?;
            let replay = self
                .output_buffer
                .lock()
                .map_err(|e| e.to_string())?
                .clone();
            subscribers.push(on_data);
            replay
        };

        let maybe_exit_code = *self.exit_code.lock().map_err(|e| e.to_string())?;
        if let Some(code) = maybe_exit_code {
            let _ = on_exit.send(code);
            return Ok(replay);
        }

        self.exit_subscribers
            .lock()
            .map_err(|e| e.to_string())?
            .push(on_exit);

        Ok(replay)
    }

    pub fn close(&self) -> Result<(), String> {
        let mut killer = self.killer.lock().map_err(|e| e.to_string())?;
        killer.kill().map_err(|e| e.to_string())
    }

    pub fn write(&self, data: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let master = self.master.lock().map_err(|e| e.to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }
}
