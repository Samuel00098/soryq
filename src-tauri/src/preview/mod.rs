use axum::{
    body::Body,
    extract::{FromRequestParts, State, WebSocketUpgrade},
    http::{Request, Response, StatusCode},
    response::IntoResponse,
    routing::any,
    Router,
};
use reqwest::Client;
use std::net::{SocketAddr, TcpListener};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;
use tauri::async_runtime;
use url::form_urlencoded;

#[derive(Clone)]
pub struct ProxyState {
    pub target_port: Arc<Mutex<u16>>,
    pub active_external_origins: Arc<Mutex<std::collections::HashMap<String, Option<String>>>>,
    pub active_project_id: Arc<std::sync::RwLock<Option<String>>>,
    pub client: Client,
}

pub struct PreviewManager {
    target_port: Arc<Mutex<u16>>,
    proxy_port: Arc<Mutex<Option<u16>>>,
    pub active_external_origins: Arc<Mutex<std::collections::HashMap<String, Option<String>>>>,
    pub active_project_id: Arc<std::sync::RwLock<Option<String>>>,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl PreviewManager {
    pub fn new(active_project_id: Arc<std::sync::RwLock<Option<String>>>) -> Self {
        PreviewManager {
            target_port: Arc::new(Mutex::new(5173)),
            proxy_port: Arc::new(Mutex::new(None)),
            active_external_origins: Arc::new(Mutex::new(std::collections::HashMap::new())),
            active_project_id,
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start_proxy(&self) -> Result<u16, String> {
        let mut shutdown_tx_lock = self.shutdown_tx.lock().unwrap();
        if shutdown_tx_lock.is_some() {
            if let Some(port) = *self.proxy_port.lock().unwrap() {
                return Ok(port);
            }
        }

        let proxy_port = get_free_port().ok_or_else(|| "Could not find a free port".to_string())?;
        *self.proxy_port.lock().unwrap() = Some(proxy_port);

        let (tx, rx) = oneshot::channel::<()>();
        *shutdown_tx_lock = Some(tx);

        let state = ProxyState {
            target_port: self.target_port.clone(),
            active_external_origins: self.active_external_origins.clone(),
            active_project_id: self.active_project_id.clone(),
            client: Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
                .gzip(true)
                .brotli(true)
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    let url = attempt.url();
                    let url_str = url.as_str();
                    if is_private_target(url_str) {
                        return attempt.error("redirect to private IP blocked");
                    }
                    if let Some(port) = url.port() {
                        if is_restricted_port(port) {
                            return attempt.error("redirect to restricted port blocked");
                        }
                    }
                    attempt.follow()
                }))
                .build()
                .unwrap_or_default(),
        };

        let app = Router::new()
            .fallback(any(proxy_handler))
            .with_state(state);

        let addr = SocketAddr::from(([127, 0, 0, 1], proxy_port));

        async_runtime::spawn(async move {
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("Failed to bind preview server: {}", e);
                    return;
                }
            };

            let serve = axum::serve(listener, app);

            tokio::select! {
                res = serve => {
                    if let Err(e) = res {
                        eprintln!("Preview server error: {}", e);
                    }
                }
                _ = rx => {
                    println!("Preview server shutdown signal received");
                }
            }
        });

        Ok(proxy_port)
    }

    pub fn stop_proxy(&self) -> Result<(), String> {
        let mut shutdown_tx = self.shutdown_tx.lock().unwrap();
        if let Some(tx) = shutdown_tx.take() {
            let _ = tx.send(());
        }
        *self.proxy_port.lock().unwrap() = None;
        Ok(())
    }

    pub fn set_target_port(&self, port: u16) -> Result<(), String> {
        *self.target_port.lock().unwrap() = port;
        Ok(())
    }

    pub fn get_target_port(&self) -> u16 {
        *self.target_port.lock().unwrap()
    }

    pub fn get_proxy_port(&self) -> Option<u16> {
        *self.proxy_port.lock().unwrap()
    }

    pub fn clear_proxy_target(&self) -> Result<(), String> {
        let active_project = self.active_project_id.read().unwrap().clone();
        if let Some(project_id) = active_project {
            let mut origins = self.active_external_origins.lock().unwrap();
            origins.insert(project_id, None);
        }
        Ok(())
    }
}

fn get_free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .ok()
}

fn get_target_url(query: &str) -> Option<String> {
    form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| key == "url")
        .map(|(_, value)| value.into_owned())
}

fn is_private_target(url: &str) -> bool {
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            if host == "127.0.0.1" || host == "localhost" || host == "0.0.0.0" {
                return true;
            }
            if let Ok(addr) = host.parse::<std::net::IpAddr>() {
                return match addr {
                    std::net::IpAddr::V4(v4) => {
                        v4.is_loopback()
                            || v4.is_private()
                            || v4.is_link_local()
                            || v4.is_multicast()
                            || v4.octets()[0] == 169 && v4.octets()[1] == 254
                    }
                    std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_multicast() || v6.is_unspecified(),
                };
            }
        }
    }
    false
}

fn is_restricted_port(port: u16) -> bool {
    matches!(port, 22 | 23 | 25 | 53 | 110 | 135 | 139 | 143 | 445 | 993 | 995 | 3306 | 3389 | 5432 | 6379 | 27017)
}

async fn proxy_handler(
    State(state): State<ProxyState>,
    req: Request<Body>,
) -> Response<Body> {
    let (mut parts, body) = req.into_parts();
    let target_port = *state.target_port.lock().unwrap();

    let path = parts.uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/").to_string();

    // If request contains upgrade websocket headers, handle as websocket connection
    let is_ws = parts.headers.get("upgrade")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_lowercase()) == Some("websocket".to_string());

    if is_ws {
        if path.starts_with("/proxy") {
            return StatusCode::BAD_REQUEST.into_response();
        }
        // Validate WebSocket origin
        let ws_origin_valid = parts.headers.get("origin")
            .and_then(|v| v.to_str().ok())
            .map(|o| {
                o == "http://127.0.0.1" || o.starts_with("http://127.0.0.1:")
                || o == "http://localhost" || o.starts_with("http://localhost:")
            })
            .unwrap_or(false);
        if !ws_origin_valid {
            return StatusCode::FORBIDDEN.into_response();
        }
        let ws_url = format!("ws://127.0.0.1:{}{}", target_port, path);

        match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
            Ok(ws) => {
                return ws.on_upgrade(move |socket| handle_websocket(socket, ws_url)).into_response();
            }
            Err(_) => {
                return StatusCode::BAD_REQUEST.into_response();
            }
        }
    }

    // External URL proxy
    if path.starts_with("/proxy") {
        let query = parts.uri.query().unwrap_or("");
        let target_url = get_target_url(query);
        match target_url {
            Some(url) if !url.is_empty() => {
                if !url.starts_with("http://") && !url.starts_with("https://") {
                    return (StatusCode::BAD_REQUEST, "Only HTTP(S) URLs are allowed").into_response();
                }
                if is_private_target(&url) {
                    return (StatusCode::FORBIDDEN, "Access to private/internal resources is not allowed").into_response();
                }
                if let Ok(parsed) = url::Url::parse(&url) {
                    if let Some(port) = parsed.port() {
                        if is_restricted_port(port) {
                            return (StatusCode::FORBIDDEN, "Access to restricted ports is not allowed").into_response();
                        }
                    }
                }

                let mut origin_to_store = None;
                if let Ok(target) = url.parse::<url::Url>() {
                    let scheme = target.scheme();
                    let host = target.host_str().unwrap_or("");
                    let origin = match target.port() {
                        Some(port) => format!("{}://{}:{}", scheme, host, port),
                        None => format!("{}://{}", scheme, host),
                    };
                    origin_to_store = Some(origin);
                }
                
                let active_project = state.active_project_id.read().unwrap().clone();
                if let Some(ref project_id) = active_project {
                    let mut origins = state.active_external_origins.lock().unwrap();
                    origins.insert(project_id.clone(), origin_to_store.clone());
                }
                
                return proxy_external_url(
                    state.client.clone(),
                    &url,
                    state.active_external_origins.clone(),
                    state.active_project_id.clone(),
                    parts,
                    body
                ).await;
            }
            _ => {
                return (StatusCode::BAD_REQUEST, "Missing 'url' query parameter").into_response();
            }
        }
    }

    // Check if we have active external origin
    let active_project = state.active_project_id.read().unwrap().clone();
    let opt_origin = if let Some(ref project_id) = active_project {
        let origins = state.active_external_origins.lock().unwrap();
        origins.get(project_id).cloned().flatten()
    } else {
        None
    };

    if let Some(origin) = opt_origin {
        let full_url = format!("{}{}", origin, path);
        return proxy_external_url(
            state.client.clone(),
            &full_url,
            state.active_external_origins.clone(),
            state.active_project_id.clone(),
            parts,
            body
        ).await;
    }

    // Local dev server proxying (original behavior)
    let url_str = format!("http://127.0.0.1:{}{}", target_port, path);
    let url = match url_str.parse::<reqwest::Url>() {
        Ok(u) => u,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    let method = parts.method.clone();
    let mut reqwest_req = reqwest::Request::new(method, url);

    *reqwest_req.headers_mut() = parts.headers.clone();
    reqwest_req.headers_mut().remove("host");

    // Retrieve request body
    let bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    *reqwest_req.body_mut() = Some(reqwest::Body::from(bytes));

    match state.client.execute(reqwest_req).await {
        Ok(res) => {
            let mut builder = Response::builder().status(res.status());

            for (key, value) in res.headers() {
                builder = builder.header(key, value);
            }

            let body_stream = res.bytes_stream();
            let body = Body::from_stream(body_stream);
            builder.body(body).unwrap_or_else(|_| {
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response body").into_response()
            })
        }
        Err(err) => {
            (StatusCode::BAD_GATEWAY, format!("Proxy error: {}", err)).into_response()
        }
    }
}

async fn proxy_external_url(
    client: Client,
    target_url: &str,
    active_external_origins: Arc<Mutex<std::collections::HashMap<String, Option<String>>>>,
    active_project_id: Arc<std::sync::RwLock<Option<String>>>,
    parts: axum::http::request::Parts,
    body: axum::body::Body,
) -> Response<Body> {
    let target = match target_url.parse::<url::Url>() {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid target URL").into_response(),
    };

    if is_private_target(target_url) {
        return (StatusCode::FORBIDDEN, "Access to private/internal resources is not allowed").into_response();
    }
    if let Some(port) = target.port() {
        if is_restricted_port(port) {
            return (StatusCode::FORBIDDEN, "Access to restricted ports is not allowed").into_response();
        }
    }

    let method = parts.method.clone();
    let mut reqwest_req = reqwest::Request::new(method, target.clone());

    {
        let headers = reqwest_req.headers_mut();
        // Start with the incoming headers but strip proxy-revealing ones
        *headers = parts.headers.clone();
        headers.remove("host");
        headers.remove("origin");
        headers.remove("referer");
        headers.remove("x-forwarded-for");
        headers.remove("x-forwarded-host");
        headers.remove("x-forwarded-proto");
        headers.remove("via");
        headers.remove("forwarded");

        // Set Accept headers if not already present
        if !headers.contains_key("accept") {
            headers.insert(
                reqwest::header::ACCEPT,
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
                    .parse().unwrap(),
            );
        }
        if !headers.contains_key("accept-language") {
            headers.insert(
                reqwest::header::ACCEPT_LANGUAGE,
                "en-US,en;q=0.9".parse().unwrap(),
            );
        }
    }

    let bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    *reqwest_req.body_mut() = Some(reqwest::Body::from(bytes));

    match client.execute(reqwest_req).await {
        Ok(res) => {
            // Update active_external_origins with the final redirected URL
            let final_url = res.url();
            let scheme = final_url.scheme();
            let host = final_url.host_str().unwrap_or("");
            let origin = match final_url.port() {
                Some(port) => format!("{}://{}:{}", scheme, host, port),
                None => format!("{}://{}", scheme, host),
            };
            
            let active_project = active_project_id.read().unwrap().clone();
            if let Some(project_id) = active_project {
                let mut origins = active_external_origins.lock().unwrap();
                origins.insert(project_id, Some(origin));
            }

            let mut builder = Response::builder().status(res.status());

            for (key, value) in res.headers() {
                let key_lower = key.as_str().to_lowercase();
                // Strip headers that prevent iframe embedding
                if key_lower == "x-frame-options"
                    || key_lower == "content-security-policy"
                    || key_lower == "content-security-policy-report-only"
                {
                    continue;
                }
                builder = builder.header(key, value);
            }

            let body_stream = res.bytes_stream();
            let body = Body::from_stream(body_stream);
            builder.body(body).unwrap_or_else(|_| {
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response body").into_response()
            })
        }
        Err(err) => {
            (StatusCode::BAD_GATEWAY, format!("Proxy error: {}", err)).into_response()
        }
    }
}

async fn handle_websocket(client_ws: axum::extract::ws::WebSocket, target_ws_url: String) {
    let (mut client_write, mut client_read) = client_ws.split();

    let target_conn = match connect_async(&target_ws_url).await {
        Ok((conn, _)) => conn,
        Err(e) => {
            eprintln!("Failed to connect to target WS server {}: {}", target_ws_url, e);
            return;
        }
    };
    let (mut target_write, mut target_read) = target_conn.split();

    let client_to_target = async {
        while let Some(msg) = client_read.next().await {
            if let Ok(msg) = msg {
                let tung_msg = match msg {
                    axum::extract::ws::Message::Text(t) => tokio_tungstenite::tungstenite::Message::Text(t.to_string().into()),
                    axum::extract::ws::Message::Binary(b) => tokio_tungstenite::tungstenite::Message::Binary(b.into()),
                    axum::extract::ws::Message::Ping(p) => tokio_tungstenite::tungstenite::Message::Ping(p.into()),
                    axum::extract::ws::Message::Pong(p) => tokio_tungstenite::tungstenite::Message::Pong(p.into()),
                    axum::extract::ws::Message::Close(c) => {
                        let cf = c.map(|frame| tokio_tungstenite::tungstenite::protocol::CloseFrame {
                            code: frame.code.into(),
                            reason: frame.reason.to_string().into(),
                        });
                        tokio_tungstenite::tungstenite::Message::Close(cf)
                    }
                };
                if let Err(e) = target_write.send(tung_msg).await {
                    eprintln!("WS error forwarding client -> target: {}", e);
                    break;
                }
            } else {
                break;
            }
        }
    };

    let target_to_client = async {
        while let Some(msg) = target_read.next().await {
            if let Ok(msg) = msg {
                let axum_msg = match msg {
                    tokio_tungstenite::tungstenite::Message::Text(t) => axum::extract::ws::Message::Text(t.to_string().into()),
                    tokio_tungstenite::tungstenite::Message::Binary(b) => axum::extract::ws::Message::Binary(b.into()),
                    tokio_tungstenite::tungstenite::Message::Ping(p) => axum::extract::ws::Message::Ping(p.into()),
                    tokio_tungstenite::tungstenite::Message::Pong(p) => axum::extract::ws::Message::Pong(p.into()),
                    tokio_tungstenite::tungstenite::Message::Close(c) => {
                        let cf = c.map(|frame| axum::extract::ws::CloseFrame {
                            code: frame.code.into(),
                            reason: frame.reason.to_string().into(),
                        });
                        axum::extract::ws::Message::Close(cf)
                    }
                    _ => continue,
                };
                if let Err(e) = client_write.send(axum_msg).await {
                    eprintln!("WS error forwarding target -> client: {}", e);
                    break;
                }
            } else {
                break;
            }
        }
    };

    tokio::select! {
        _ = client_to_target => {},
        _ = target_to_client => {},
    }
}
