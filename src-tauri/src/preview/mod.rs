use axum::{
    body::Body,
    extract::{FromRequestParts, State, WebSocketUpgrade},
    http::{Request, Response, StatusCode},
    response::IntoResponse,
    routing::any,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use std::net::{SocketAddr, TcpListener};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::async_runtime;
use tokio::sync::oneshot;
use tokio_tungstenite::connect_async;
use url::form_urlencoded;

const INSPECTOR_FLAG: &str = "forge-inspect=1";
const INSPECTOR_SNIPPET: &str = r#"<script>
(() => {
    const active = () => location.hash.includes('forge-inspect=1');
    let state = { enabled: false, hovered: null, selected: null };
    let overlay = null;
    let label = null;
    const originalConsole = {};
    // Captured from the first forge-inspector:set handshake so replies go to the right origin.
    let parentOrigin = '*';

    const serializeValue = (value) => {
        try {
            if (value instanceof Error) {
                return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
            }
            if (typeof value === 'string') return value;
            if (value === undefined) return 'undefined';
            return JSON.stringify(value, (_key, nested) => {
                if (nested instanceof Element) return `<${nested.tagName.toLowerCase()}>`;
                if (nested instanceof Error) return `${nested.name}: ${nested.message}`;
                return nested;
            });
        } catch {
            return String(value);
        }
    };

    const postConsole = (level, args) => {
        if (parentOrigin === '*') return;
        try {
            const safeUrl = (() => { try { const u = new URL(location.href); return u.origin + u.pathname; } catch { return ''; } })();
            parent.postMessage({
                type: 'forge-preview:console',
                payload: {
                    level,
                    message: Array.from(args).map(serializeValue).join(' '),
                    url: safeUrl,
                    timestamp: new Date().toISOString()
                }
            }, parentOrigin);
        } catch {}
    };

    ['log', 'info', 'warn', 'error', 'debug'].forEach((level) => {
        const original = console[level];
        if (typeof original !== 'function') return;
        originalConsole[level] = original.bind(console);
        console[level] = (...args) => {
            postConsole(level, args);
            originalConsole[level](...args);
        };
    });

    window.addEventListener('error', (event) => {
        postConsole('error', [event.message || 'Uncaught error', event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '', event.error || '']);
    });

    window.addEventListener('unhandledrejection', (event) => {
        postConsole('error', ['Unhandled promise rejection', event.reason]);
    });

    const escapeCss = (value) => {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    };

    const buildSelector = (element) => {
        if (!element || element.nodeType !== 1) return '';
        if (element.id) return `#${escapeCss(element.id)}`;

        const parts = [];
        let node = element;
        while (node && node.nodeType === 1 && node !== document.body) {
            let part = node.tagName.toLowerCase();
            if (node.classList && node.classList.length) {
                part += '.' + Array.from(node.classList).slice(0, 3).map(escapeCss).join('.');
            }
            const parent = node.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
                if (siblings.length > 1) {
                    part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
                }
            }
            parts.unshift(part);
            node = node.parentElement;
            if (parts.length >= 4) break;
        }
        return parts.join(' > ');
    };

    const getAttributes = (element) => {
        const attrs = {};
        for (const attr of Array.from(element.attributes || [])) {
            attrs[attr.name] = attr.value;
        }
        return attrs;
    };

    const getStyles = (element) => {
        const computed = window.getComputedStyle(element);
        return {
            display: computed.display,
            position: computed.position,
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            font: computed.font,
            margin: computed.margin,
            padding: computed.padding,
            width: computed.width,
            height: computed.height
        };
    };

    const getAncestorPath = (element) => {
        const path = [];
        let node = element;
        while (node && node.nodeType === 1 && path.length < 6) {
            path.unshift(buildSelector(node));
            node = node.parentElement;
        }
        return path;
    };

    const ensureOverlay = () => {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '2147483646';
        overlay.style.border = '2px solid #7c6af7';
        overlay.style.background = 'rgba(124, 106, 247, 0.12)';
        overlay.style.borderRadius = '4px';
        overlay.style.boxSizing = 'border-box';
        overlay.style.display = 'none';

        label = document.createElement('div');
        label.style.position = 'fixed';
        label.style.zIndex = '2147483647';
        label.style.padding = '6px 8px';
        label.style.borderRadius = '999px';
        label.style.background = 'rgba(16, 16, 20, 0.92)';
        label.style.color = '#fff';
        label.style.font = '12px system-ui, sans-serif';
        label.style.pointerEvents = 'none';
        label.style.display = 'none';

        document.documentElement.appendChild(overlay);
        document.documentElement.appendChild(label);
    };

    const hidePreview = () => {
        if (overlay) overlay.style.display = 'none';
        if (label) label.style.display = 'none';
    };

    const renderPreview = (element) => {
        if (!overlay || !label || !element) return;
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) {
            hidePreview();
            return;
        }
        overlay.style.display = 'block';
        overlay.style.left = `${Math.max(0, rect.left)}px`;
        overlay.style.top = `${Math.max(0, rect.top)}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        label.style.display = 'block';
        label.textContent = `${element.tagName.toLowerCase()} ${buildSelector(element)}`.trim();
        label.style.left = `${Math.max(8, rect.left)}px`;
        label.style.top = `${Math.max(8, rect.top - 30)}px`;
    };

    const setEnabled = (enabled) => {
        state.enabled = enabled;
        document.documentElement.style.cursor = enabled ? 'crosshair' : '';
        if (enabled) ensureOverlay(); else hidePreview();
    };

    document.addEventListener('mousemove', (event) => {
        if (!state.enabled) return;
        const element = event.target instanceof Element ? event.target : null;
        state.hovered = element;
        renderPreview(element);
    }, true);

    document.addEventListener('click', (event) => {
        if (!state.enabled) return;
        const element = event.target instanceof Element ? event.target : null;
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = element.getBoundingClientRect();
        const selector = buildSelector(element);
        state.selected = {
            selector,
            tag: element.tagName.toLowerCase(),
            text: (element.innerText || element.textContent || '').trim().slice(0, 500),
            html: (element.outerHTML || '').slice(0, 3000),
            attributes: getAttributes(element),
            classes: Array.from(element.classList || []),
            styles: getStyles(element),
            ancestorPath: getAncestorPath(element),
            page: { url: location.href, title: document.title },
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        };
        parent.postMessage({ type: 'forge-inspector:selected', payload: state.selected }, parentOrigin);
    }, true);

    window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        const data = event.data || {};
        if (data.type !== 'forge-inspector:set') return;
        if (data.parentOrigin) parentOrigin = data.parentOrigin;
        setEnabled(Boolean(data.enabled));
    });

    window.addEventListener('hashchange', () => setEnabled(active()));
    setEnabled(active());
})();
</script>"#;

#[derive(Clone)]
pub struct ProxyState {
    pub target_port: Arc<Mutex<u16>>,
    pub preferred_local_host: Arc<Mutex<Option<String>>>,
    pub active_external_origins: Arc<Mutex<std::collections::HashMap<String, Option<String>>>>,
    pub active_project_id: Arc<std::sync::RwLock<Option<String>>>,
    pub client: Client,
}

pub struct PreviewManager {
    target_port: Arc<Mutex<u16>>,
    preferred_local_host: Arc<Mutex<Option<String>>>,
    proxy_port: Arc<Mutex<Option<u16>>>,
    pub active_external_origins: Arc<Mutex<std::collections::HashMap<String, Option<String>>>>,
    pub active_project_id: Arc<std::sync::RwLock<Option<String>>>,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl PreviewManager {
    pub fn new(active_project_id: Arc<std::sync::RwLock<Option<String>>>) -> Self {
        PreviewManager {
            target_port: Arc::new(Mutex::new(5173)),
            preferred_local_host: Arc::new(Mutex::new(None)),
            proxy_port: Arc::new(Mutex::new(None)),
            active_external_origins: Arc::new(Mutex::new(std::collections::HashMap::new())),
            active_project_id,
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start_proxy(&self) -> Result<u16, String> {
        let mut shutdown_tx_lock = self.shutdown_tx.lock().unwrap_or_else(|e| e.into_inner());
        if shutdown_tx_lock.is_some() {
            if let Some(port) = *self.proxy_port.lock().unwrap_or_else(|e| e.into_inner()) {
                return Ok(port);
            }
        }

        let proxy_port = get_free_port().ok_or_else(|| "Could not find a free port".to_string())?;
        *self.proxy_port.lock().unwrap_or_else(|e| e.into_inner()) = Some(proxy_port);

        let (tx, rx) = oneshot::channel::<()>();
        *shutdown_tx_lock = Some(tx);

        let state = ProxyState {
            target_port: self.target_port.clone(),
            preferred_local_host: self.preferred_local_host.clone(),
            active_external_origins: self.active_external_origins.clone(),
            active_project_id: self.active_project_id.clone(),
            client: Client::builder()
                .user_agent(concat!(
                    "soryq/",
                    env!("CARGO_PKG_VERSION"),
                    " (preview-proxy)"
                ))
                .gzip(true)
                .brotli(true)
                .connect_timeout(Duration::from_millis(800))
                .timeout(Duration::from_secs(20))
                // Only bypass TLS for loopback; external certs are validated normally
                .danger_accept_invalid_certs(false)
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    let url = attempt.url();
                    let url_str = url.as_str();
                    if !is_loopback_target(url_str) && is_private_target(url_str) {
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

        let app = Router::new().fallback(any(proxy_handler)).with_state(state);

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
        let mut shutdown_tx = self.shutdown_tx.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(tx) = shutdown_tx.take() {
            let _ = tx.send(());
        }
        *self.proxy_port.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(())
    }

    pub fn set_target_port(&self, port: u16) -> Result<(), String> {
        *self.target_port.lock().unwrap_or_else(|e| e.into_inner()) = port;
        Ok(())
    }

    pub fn get_target_port(&self) -> u16 {
        *self.target_port.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_preferred_local_host(&self, host: Option<String>) -> Result<(), String> {
        let normalized = host
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| matches!(value.as_str(), "127.0.0.1" | "localhost" | "0.0.0.0"));
        *self
            .preferred_local_host
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = normalized;
        Ok(())
    }

    pub fn get_proxy_port(&self) -> Option<u16> {
        *self.proxy_port.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn clear_proxy_target(&self) -> Result<(), String> {
        let active_project = self
            .active_project_id
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Some(project_id) = active_project {
            let mut origins = self
                .active_external_origins
                .lock()
                .unwrap_or_else(|e| e.into_inner());
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

fn get_target_url_from_proxy_path(path: &str, query: Option<&str>) -> Option<String> {
    let proxy_path = path.strip_prefix("/proxy/")?;
    let mut segments = proxy_path.splitn(3, '/');
    let scheme = segments.next()?;
    let authority = segments.next()?;
    if scheme != "http" && scheme != "https" {
        return None;
    }

    let remainder = segments.next().unwrap_or("");
    let mut target = if remainder.is_empty() {
        format!("{scheme}://{authority}/")
    } else {
        format!("{scheme}://{authority}/{remainder}")
    };

    if let Some(query) = query.filter(|value| !value.is_empty()) {
        target.push('?');
        target.push_str(query);
    }

    Some(target)
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
                    std::net::IpAddr::V6(v6) => {
                        let segs = v6.segments();
                        v6.is_loopback()
                            || v6.is_multicast()
                            || v6.is_unspecified()
                            // ULA: fc00::/7
                            || (segs[0] & 0xfe00) == 0xfc00
                            // Link-local: fe80::/10
                            || (segs[0] & 0xffc0) == 0xfe80
                    }
                };
            }
        }
    }
    false
}

async fn has_private_resolved_ip(host: &str, port: u16) -> bool {
    use std::net::IpAddr;
    let addr_str = format!("{}:{}", host, port);
    match tokio::net::lookup_host(addr_str).await {
        Ok(addrs) => addrs.into_iter().any(|sa| {
            match sa.ip() {
                IpAddr::V4(v4) => {
                    v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_multicast()
                }
                IpAddr::V6(v6) => {
                    let segs = v6.segments();
                    v6.is_loopback() || v6.is_multicast() || v6.is_unspecified()
                        || (segs[0] & 0xfe00) == 0xfc00  // ULA fc00::/7
                        || (segs[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                }
            }
        }),
        Err(_) => false,
    }
}

fn is_loopback_target(url: &str) -> bool {
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            return host == "127.0.0.1" || host == "localhost";
        }
    }
    false
}

fn is_restricted_port(port: u16) -> bool {
    matches!(
        port,
        22     // SSH
        | 23   // Telnet
        | 25   // SMTP
        | 53   // DNS
        | 110  // POP3
        | 135  // RPC
        | 139  // NetBIOS
        | 143  // IMAP
        | 445  // SMB
        | 993  // IMAPS
        | 995  // POP3S
        | 2375 // Docker daemon (unauthenticated)
        | 3306 // MySQL
        | 3389 // RDP
        | 5432 // PostgreSQL
        | 6379 // Redis
        | 6443 // Kubernetes API
        | 8500 // Consul
        | 9090 // Prometheus
        | 27017 // MongoDB
    )
}

fn local_dev_hosts(preferred_host: Option<&str>) -> Vec<&'static str> {
    let mut hosts = vec!["127.0.0.1", "localhost"];
    match preferred_host {
        Some("localhost") => hosts.swap(0, 1),
        Some("0.0.0.0") => {}
        Some("127.0.0.1") => {}
        _ => {}
    }
    hosts
}

async fn proxy_handler(State(state): State<ProxyState>, req: Request<Body>) -> Response<Body> {
    let (mut parts, body) = req.into_parts();
    let target_port = *state.target_port.lock().unwrap_or_else(|e| e.into_inner());
    let preferred_local_host = state
        .preferred_local_host
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();

    let path = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .to_string();

    // If request contains upgrade websocket headers, handle as websocket connection
    let is_ws = parts
        .headers
        .get("upgrade")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_lowercase())
        == Some("websocket".to_string());

    if is_ws {
        if path.starts_with("/proxy") {
            return StatusCode::BAD_REQUEST.into_response();
        }
        // Validate WebSocket origin
        let ws_origin_valid = parts
            .headers
            .get("origin")
            .and_then(|v| v.to_str().ok())
            .map(|o| {
                o == "null"
                    || o == "http://127.0.0.1"
                    || o.starts_with("http://127.0.0.1:")
                    || o == "http://localhost"
                    || o.starts_with("http://localhost:")
            })
            .unwrap_or(false);
        if !ws_origin_valid {
            return StatusCode::FORBIDDEN.into_response();
        }
        match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
            Ok(ws) => {
                let ws_path = path.clone();
                let preferred_host = preferred_local_host.clone();
                return ws
                    .on_upgrade(move |socket| {
                        handle_websocket(socket, target_port, ws_path, preferred_host)
                    })
                    .into_response();
            }
            Err(_) => {
                return StatusCode::BAD_REQUEST.into_response();
            }
        }
    }

    // External URL proxy
    if path.starts_with("/proxy") {
        let query = parts.uri.query().unwrap_or("");
        let target_url = get_target_url_from_proxy_path(parts.uri.path(), parts.uri.query())
            .or_else(|| get_target_url(query));
        match target_url {
            Some(url) if !url.is_empty() => {
                if !url.starts_with("http://") && !url.starts_with("https://") {
                    return (StatusCode::BAD_REQUEST, "Only HTTP(S) URLs are allowed")
                        .into_response();
                }
                if is_private_target(&url) {
                    return (
                        StatusCode::FORBIDDEN,
                        "Access to private/internal resources is not allowed",
                    )
                        .into_response();
                }
                if let Ok(parsed) = url::Url::parse(&url) {
                    if let Some(port) = parsed.port() {
                        if is_restricted_port(port) {
                            return (
                                StatusCode::FORBIDDEN,
                                "Access to restricted ports is not allowed",
                            )
                                .into_response();
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

                let active_project = state
                    .active_project_id
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                if let Some(ref project_id) = active_project {
                    let mut origins = state
                        .active_external_origins
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    origins.insert(project_id.clone(), origin_to_store.clone());
                }

                return proxy_external_url(
                    state.client.clone(),
                    &url,
                    state.active_external_origins.clone(),
                    state.active_project_id.clone(),
                    parts,
                    body,
                )
                .await;
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    "Missing target URL. Use /proxy/{scheme}/{host}/path or provide a 'url' query parameter",
                )
                    .into_response();
            }
        }
    }

    // Check if we have active external origin
    let active_project = state
        .active_project_id
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let opt_origin = if let Some(ref project_id) = active_project {
        let origins = state
            .active_external_origins
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
            body,
        )
        .await;
    }

    // Retrieve request body
    let bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    match proxy_local_dev_request(
        &state.client,
        parts,
        bytes,
        target_port,
        preferred_local_host.as_deref(),
    )
    .await
    {
        Ok(res) => build_preview_response(res, false).await,
        Err(err) => (StatusCode::BAD_GATEWAY, format!("Proxy error: {}", err)).into_response(),
    }
}

async fn proxy_local_dev_request(
    client: &Client,
    parts: axum::http::request::Parts,
    body: axum::body::Bytes,
    target_port: u16,
    preferred_host: Option<&str>,
) -> Result<reqwest::Response, reqwest::Error> {
    let path = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .to_string();

    let mut last_err: Option<reqwest::Error> = None;

    for host in local_dev_hosts(preferred_host) {
        let url_str = format!("http://{}:{}{}", host, target_port, path);
        let url = match url_str.parse::<reqwest::Url>() {
            Ok(u) => u,
            Err(_) => continue,
        };

        let method = parts.method.clone();
        let mut reqwest_req = reqwest::Request::new(method, url.clone());
        *reqwest_req.headers_mut() = parts.headers.clone();

        // Make the forwarded request look first-party to the dev server. The
        // browser issues subresource requests (/_next/* chunks, CSS, modules)
        // against the proxy origin (127.0.0.1:{proxy_port}); dev servers like
        // Next.js 15 (allowedDevOrigins) block those as cross-origin, which makes
        // the page render unstyled. We advertise `localhost` (not the loopback IP
        // we actually connect to) because that is the host these dev servers trust
        // by default — Next.js, for example, allows `localhost` out of the box but
        // blocks `127.0.0.1`. The check only inspects the Origin/Referer host, not
        // the TCP target, so this is safe regardless of which host we connect to.
        // Origin is set unconditionally because many chunk/module requests omit it.
        let advertised_origin = format!("http://localhost:{}", target_port);
        reqwest_req.headers_mut().remove("accept-encoding");
        if let Ok(val) = advertised_origin.parse() {
            reqwest_req.headers_mut().insert("origin", val);
        }
        let proxy_host = parts
            .headers
            .get("host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("127.0.0.1");
        let proxy_origin = format!("http://{}", proxy_host);
        let new_referer = match reqwest_req
            .headers()
            .get("referer")
            .and_then(|r| r.to_str().ok())
        {
            // Preserve the path the browser was actually on, just swap the host.
            Some(referer_str) => referer_str.replace(&proxy_origin, &advertised_origin),
            // Subresource request with no referer — point it at the dev root.
            None => format!("{}/", advertised_origin),
        };
        if let Ok(val) = new_referer.parse() {
            reqwest_req.headers_mut().insert("referer", val);
        }

        reqwest_req.headers_mut().remove("host");
        *reqwest_req.body_mut() = Some(reqwest::Body::from(body.clone()));

        match client.execute(reqwest_req).await {
            Ok(response) => return Ok(response),
            Err(err) => last_err = Some(err),
        }
    }

    Err(last_err.expect("at least one local dev host should have been attempted"))
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
        return (
            StatusCode::FORBIDDEN,
            "Access to private/internal resources is not allowed",
        )
            .into_response();
    }
    // DNS rebinding protection: resolve hostname and check resolved IPs
    if let Some(host) = target.host_str() {
        if host.parse::<std::net::IpAddr>().is_err() {
            // Only do DNS check for domain names — IPs were already checked above
            let port = target.port_or_known_default().unwrap_or(80);
            if has_private_resolved_ip(host, port).await {
                return (
                    StatusCode::FORBIDDEN,
                    "Access to private/internal resources is not allowed",
                )
                    .into_response();
            }
        }
    }
    if let Some(port) = target.port() {
        if is_restricted_port(port) {
            return (
                StatusCode::FORBIDDEN,
                "Access to restricted ports is not allowed",
            )
                .into_response();
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

            let active_project = active_project_id
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if let Some(project_id) = active_project {
                let mut origins = active_external_origins
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                origins.insert(project_id, Some(origin));
            }

            build_preview_response(res, true).await
        }
        Err(err) => (StatusCode::BAD_GATEWAY, format!("Proxy error: {}", err)).into_response(),
    }
}

/// Headers that must be dropped before re-serving a proxied page inside the
/// preview iframe. The body is always re-framed by the proxy (length/encoding
/// change), and the security/embedding headers are authored for the target's
/// real origin — re-applying them under the proxy origin (127.0.0.1:{proxy_port})
/// blocks the page from embedding or, more subtly, blocks it from loading its own
/// stylesheets and scripts (the page renders but appears unstyled).
fn should_strip_preview_header(key_lower: &str) -> bool {
    matches!(
        key_lower,
        // Body framing — the proxy re-emits the (decompressed) body itself.
        "content-length"
            | "content-encoding"
            | "transfer-encoding"
            // Embedding guards — would prevent the iframe from rendering at all.
            | "x-frame-options"
            // CSP authored for the dev origin breaks asset loading under the proxy
            // origin (this is the usual cause of "Dev: On" stripping the CSS).
            | "content-security-policy"
            | "content-security-policy-report-only"
            // COEP/CORP can block cross-origin subresources (fonts, CDN CSS).
            | "cross-origin-embedder-policy"
            | "cross-origin-opener-policy"
            | "cross-origin-resource-policy"
    )
}

async fn build_preview_response(
    res: reqwest::Response,
    strip_embed_headers: bool,
) -> Response<Body> {
    let is_html = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.contains("text/html") || value.contains("application/xhtml+xml"))
        .unwrap_or(false);

    let status = res.status();
    let headers = res.headers().clone();

    if is_html {
        let body_bytes = match res.bytes().await {
            Ok(bytes) => bytes,
            Err(err) => {
                return (StatusCode::BAD_GATEWAY, format!("Proxy error: {}", err)).into_response()
            }
        };
        let html = String::from_utf8_lossy(&body_bytes);
        // Only inject inspector into local dev server responses, never external sites.
        let injected = if !strip_embed_headers {
            inject_inspector_script(html.as_ref())
        } else {
            html.into_owned()
        };

        let mut builder = Response::builder().status(status);
        for (key, value) in headers.iter() {
            let key_lower = key.as_str().to_lowercase();
            // HTML is buffered and rewritten, so range/validator headers no longer apply.
            if matches!(key_lower.as_str(), "etag" | "content-md5" | "accept-ranges") {
                continue;
            }
            if should_strip_preview_header(&key_lower) {
                continue;
            }
            builder = builder.header(key, value);
        }

        return builder.body(Body::from(injected)).unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to build response body",
            )
                .into_response()
        });
    }

    let mut builder = Response::builder().status(status);
    for (key, value) in headers.iter() {
        let key_lower = key.as_str().to_lowercase();
        if should_strip_preview_header(&key_lower) {
            continue;
        }
        builder = builder.header(key, value);
    }

    let body_stream = res.bytes_stream();
    let body = Body::from_stream(body_stream);
    builder.body(body).unwrap_or_else(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build response body",
        )
            .into_response()
    })
}

fn inject_inspector_script(html: &str) -> String {
    let marker = INSPECTOR_SNIPPET;
    if html.contains(INSPECTOR_FLAG) || html.contains(marker) {
        return html.to_string();
    }

    let injection = format!("{}\n<!-- forge-inspector -->", marker);

    if let Some(index) = html.rfind("</head>") {
        let mut output = String::with_capacity(html.len() + injection.len() + 16);
        output.push_str(&html[..index]);
        output.push_str(&injection);
        output.push_str(&html[index..]);
        return output;
    }

    if let Some(index) = html.rfind("</body>") {
        let mut output = String::with_capacity(html.len() + injection.len() + 16);
        output.push_str(&html[..index]);
        output.push_str(&injection);
        output.push_str(&html[index..]);
        return output;
    }

    format!("{}{}", injection, html)
}

async fn handle_websocket(
    client_ws: axum::extract::ws::WebSocket,
    target_port: u16,
    path: String,
    preferred_host: Option<String>,
) {
    let (mut client_write, mut client_read) = client_ws.split();

    let mut target_conn = None;
    let mut last_error = None;
    for host in local_dev_hosts(preferred_host.as_deref()) {
        let target_ws_url = format!("ws://{}:{}{}", host, target_port, path);
        match connect_async(&target_ws_url).await {
            Ok((conn, _)) => {
                target_conn = Some(conn);
                break;
            }
            Err(err) => {
                last_error = Some((target_ws_url, err));
            }
        }
    }

    let target_conn = match target_conn {
        Some(conn) => conn,
        None => {
            if let Some((target_ws_url, err)) = last_error {
                eprintln!(
                    "Failed to connect to target WS server {}: {}",
                    target_ws_url, err
                );
            }
            return;
        }
    };
    let (mut target_write, mut target_read) = target_conn.split();

    let client_to_target = async {
        while let Some(msg) = client_read.next().await {
            if let Ok(msg) = msg {
                let tung_msg = match msg {
                    axum::extract::ws::Message::Text(t) => {
                        tokio_tungstenite::tungstenite::Message::Text(t.to_string().into())
                    }
                    axum::extract::ws::Message::Binary(b) => {
                        tokio_tungstenite::tungstenite::Message::Binary(b)
                    }
                    axum::extract::ws::Message::Ping(p) => {
                        tokio_tungstenite::tungstenite::Message::Ping(p)
                    }
                    axum::extract::ws::Message::Pong(p) => {
                        tokio_tungstenite::tungstenite::Message::Pong(p)
                    }
                    axum::extract::ws::Message::Close(c) => {
                        let cf =
                            c.map(
                                |frame| tokio_tungstenite::tungstenite::protocol::CloseFrame {
                                    code: frame.code.into(),
                                    reason: frame.reason.to_string().into(),
                                },
                            );
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
                    tokio_tungstenite::tungstenite::Message::Text(t) => {
                        axum::extract::ws::Message::Text(t.to_string().into())
                    }
                    tokio_tungstenite::tungstenite::Message::Binary(b) => {
                        axum::extract::ws::Message::Binary(b)
                    }
                    tokio_tungstenite::tungstenite::Message::Ping(p) => {
                        axum::extract::ws::Message::Ping(p)
                    }
                    tokio_tungstenite::tungstenite::Message::Pong(p) => {
                        axum::extract::ws::Message::Pong(p)
                    }
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
