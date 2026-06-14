use crate::lsp::registry::ResolvedCommand;
use crate::lsp::server::LspServer;
use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long a freshly minted connection token stays valid before the WebSocket
/// must connect.
const TOKEN_TTL: Duration = Duration::from_secs(30);

/// A server resolved and authorized by `lsp_start`, waiting for its WebSocket to
/// connect. The token carries the (already project-confined) launch parameters so
/// the WebSocket client can't inject an arbitrary command or working directory.
struct PendingSession {
    cmd: ResolvedCommand,
    cwd: String,
    created: Instant,
}

struct BridgeInner {
    tokens: DashMap<String, PendingSession>,
}

/// Owns the localhost WebSocket server that bridges CodeMirror's
/// `WebSocketTransport` to language-server child processes. One server process is
/// spawned per WebSocket connection; the frontend caches one client (hence one
/// connection) per (root, language).
pub struct LspBridge {
    port: Mutex<Option<u16>>,
    inner: Arc<BridgeInner>,
}

impl Default for LspBridge {
    fn default() -> Self {
        Self {
            port: Mutex::new(None),
            inner: Arc::new(BridgeInner {
                tokens: DashMap::new(),
            }),
        }
    }
}

impl LspBridge {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start the bridge server if it isn't already running, returning its port.
    pub fn ensure_started(&self) -> Result<u16, String> {
        let mut port_guard = self.port.lock().map_err(|e| e.to_string())?;
        if let Some(port) = *port_guard {
            return Ok(port);
        }

        let port = get_free_port().ok_or_else(|| "Could not find a free port".to_string())?;
        let inner = self.inner.clone();
        let addr = SocketAddr::from(([127, 0, 0, 1], port));

        tauri::async_runtime::spawn(async move {
            let app = Router::new()
                .route("/lsp", get(ws_handler))
                .with_state(inner);
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("Failed to bind LSP bridge server: {e}");
                    return;
                }
            };
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("LSP bridge server error: {e}");
            }
        });

        *port_guard = Some(port);
        Ok(port)
    }

    /// Authorize a launch and return a single-use connection token.
    pub fn create_token(&self, cmd: ResolvedCommand, cwd: String) -> String {
        // Drop any tokens that were never connected.
        self.inner
            .tokens
            .retain(|_, s| s.created.elapsed() < TOKEN_TTL);

        let token = uuid::Uuid::new_v4().to_string();
        self.inner.tokens.insert(
            token.clone(),
            PendingSession {
                cmd,
                cwd,
                created: Instant::now(),
            },
        );
        token
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(inner): State<Arc<BridgeInner>>,
) -> Response {
    let token = params.get("token").cloned().unwrap_or_default();
    let pending = inner.tokens.remove(&token).map(|(_, v)| v);

    match pending {
        Some(p) if p.created.elapsed() < TOKEN_TTL => {
            ws.on_upgrade(move |socket| bridge_socket(socket, p))
        }
        _ => (StatusCode::FORBIDDEN, "invalid or expired LSP token").into_response(),
    }
}

/// Pump messages between a WebSocket and a freshly spawned language server until
/// either side closes, then kill the server.
async fn bridge_socket(socket: WebSocket, pending: PendingSession) {
    let (server, mut rx) = match LspServer::spawn(pending.cmd, &pending.cwd) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("LSP server spawn failed: {e}");
            return;
        }
    };
    let server = Arc::new(server);
    let (mut sink, mut stream) = socket.split();

    // server -> client
    let to_client = async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    };

    // client -> server
    let server_in = server.clone();
    let from_client = async move {
        while let Some(Ok(msg)) = stream.next().await {
            match msg {
                Message::Text(t) => {
                    if server_in.send(t.as_str()).is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    };

    tokio::select! {
        _ = to_client => {},
        _ = from_client => {},
    }
    server.kill();
}

fn get_free_port() -> Option<u16> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .ok()
}
