# DevDock Security Model

This document explains what DevDock can and cannot do on your system, how it isolates operations, what data it stores locally, and how the preview proxy is protected against abuse.

---

## Table of Contents

1. [Capability Model](#1-capability-model)
2. [File System Access](#2-file-system-access)
3. [Terminal Security Model](#3-terminal-security-model)
4. [Preview Proxy Security](#4-preview-proxy-security)
5. [No Telemetry](#5-no-telemetry)
6. [Local Data Storage](#6-local-data-storage)
7. [Network Access](#7-network-access)
8. [Content Security Policy](#8-content-security-policy)

---

## 1. Capability Model

DevDock is built on **Tauri 2**, which uses a capability-based permission system. All communication between the Svelte frontend (running in a sandboxed WebView) and the Rust backend goes through Tauri's IPC channel. The frontend cannot call arbitrary OS APIs directly.

The plugins loaded at runtime are:

| Plugin | Purpose |
|---|---|
| `tauri-plugin-shell` | Open URLs in the system browser; shell access is limited to this single use |
| `tauri-plugin-fs` | Used for icon loading only; all project file I/O goes through custom commands |
| `tauri-plugin-dialog` | File/folder picker dialogs for opening projects and saving screenshots |

Custom Tauri commands (the `invoke_handler` list in `lib.rs`) are the only surface through which the frontend can trigger backend actions. Each command independently validates its inputs before acting.

---

## 2. File System Access

### Project Root Scoping

All file-system operations — `read_dir`, `read_file`, `write_file`, `create_file`, `create_dir`, `rename`, `delete`, `copy` — are **gated behind a path validation step** implemented in `commands/file_system.rs`:

```rust
fn require_in_project(path: &Path, state: &AppState) -> Result<(), String> {
    // ...
    if !projects.iter().any(|p| canonical.starts_with(&p.root_path)) {
        return Err("Access denied: path is outside any open project".to_string());
    }
    Ok(())
}
```

The resolved canonical path of every requested path must begin with the canonical root path of at least one open project. If no project is open, all file operations are rejected immediately.

### Path Traversal Protection

Before resolving a path, the backend:
- Canonicalizes the path using `std::fs::canonicalize` (follows symlinks, resolves `..`)
- Rejects any path whose components include `..` literals
- Rejects paths that start with `--` (which could be misinterpreted as command flags)

### Symlink Handling

When copying directories, symlinks are **skipped entirely**. Following a symlink during a copy could escape the project root (e.g., a symlink pointing to `/etc`).

### Error Message Redaction

IO error messages returned to the frontend have absolute path information removed:

```rust
fn redact_path(path: &str) -> String {
    let p = Path::new(path);
    p.file_name()
        .map(|n| format!("[redacted]/{}", n.to_string_lossy()))
        .unwrap_or_else(|| "[redacted]".to_string())
}
```

This prevents local directory structure from leaking through error messages displayed in the UI.

### File Size Limits

| Operation | Limit |
|---|---|
| Read file | 50 MB maximum |
| Write file (text) | 100 MB maximum |
| Write file (binary) | 100 MB maximum |
| Codebase search (per file) | 10 MB maximum (larger files skipped) |

---

## 3. Terminal Security Model

### Full Shell Access — by Design

The terminal provides a genuine PTY session running your configured shell (`bash`, `zsh`, `pwsh`, `cmd.exe`, etc.). **This is intentional** — DevDock is a developer tool, and the terminal is its most important surface. The shell process runs with the same permissions as the user who launched DevDock.

**What this means in practice:**
- The user can run any command the OS permits, including `sudo`, `rm -rf`, network tools, etc.
- DevDock does not attempt to sandbox or filter shell commands
- No command history or output is sent to any remote server

### Shell Selection

When a user specifies a shell program in Settings, the backend validates the program name against the list returned by `available_shells()`. Unrecognized shell programs are rejected with an error:

```
Unrecognized shell program: <name>. Available shells: pwsh, powershell, cmd.exe, ...
```

This prevents the frontend from passing arbitrary executable paths to the PTY spawner.

### PTY Cleanup

When a terminal session is closed or when the app window is closing, all PTY child processes are killed via `ChildKiller::kill()`. This prevents orphaned processes from persisting after DevDock exits. The `Drop` implementation on `PtySession` ensures cleanup even in error paths.

### Working Directory

Terminal sessions start in the current project root (if a project is open) or the OS default working directory. The working directory passed to the PTY is canonicalized and path-cleaned before use.

---

## 4. Preview Proxy Security

The preview proxy is an Axum HTTP server that listens on `127.0.0.1` only. It is never exposed on a public interface.

### SSRF Protections

The proxy differentiates between two types of requests:

1. **Local dev server requests** — forwarded to `127.0.0.1:<target-port>` or `localhost:<target-port>`
2. **External URL requests** — triggered via `/proxy/{scheme}/{host}/path` or `?url=...` query params

For external URL requests, the following protections apply:

**Private IP blocking:** The proxy refuses to forward requests to private IP ranges:
- IPv4: `127.0.0.0/8` (loopback), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918), `169.254.0.0/16` (link-local)
- IPv6: loopback (`::1`), ULA (`fc00::/7`), link-local (`fe80::/10`), multicast, unspecified

```
HTTP/1.1 403 Forbidden
Access to private/internal resources is not allowed
```

**Restricted port blocking:** The proxy refuses to connect to ports associated with sensitive services:

| Port | Service |
|---|---|
| 22 | SSH |
| 23 | Telnet |
| 25 | SMTP |
| 53 | DNS |
| 110 | POP3 |
| 135 | RPC |
| 139 | NetBIOS |
| 143 | IMAP |
| 445 | SMB |
| 993 | IMAPS |
| 995 | POP3S |
| 2375 | Docker daemon (unauthenticated) |
| 3306 | MySQL |
| 3389 | RDP |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 6443 | Kubernetes API |
| 8500 | Consul |
| 9090 | Prometheus |
| 27017 | MongoDB |

**Redirect following:** The proxy follows redirects but re-checks each redirected URL against the private-IP and restricted-port rules. A redirect that would land on a private resource is blocked mid-chain.

### CSP and Frame-Header Stripping

When proxying **external** URLs, the proxy strips the following response headers to allow the page to render in the DevDock iframe:
- `X-Frame-Options`
- `Content-Security-Policy`
- `Content-Security-Policy-Report-Only`

This stripping only happens for external URLs routed via the `/proxy/` path. Local dev server responses have their headers passed through unchanged (except for headers that break chunked streaming).

### WebSocket Proxy

WebSocket connections are only proxied for local dev server traffic (not external URLs). Origin validation is enforced:

```rust
let ws_origin_valid = parts.headers.get("origin")
    .and_then(|v| v.to_str().ok())
    .map(|o| {
        o == "null" || o == "http://127.0.0.1" || o.starts_with("http://127.0.0.1:")
        || o == "http://localhost" || o.starts_with("http://localhost:")
    })
    .unwrap_or(false);
```

Only connections originating from `127.0.0.1` or `localhost` are accepted.

### Inspector Script Injection

The inspector script injected into HTML responses:
- Posts messages to `window.parent` only via `parent.postMessage(...)` targeting `window.location.origin` — it cannot communicate with arbitrary origins
- Never reads or modifies files
- Never makes network requests of its own
- Captures and forwards only console output and click-selection data to the DevDock UI
- Sanitizes values before JSON serialization to avoid prototype pollution

The injected script is idempotent: if it detects it has already been injected (by checking for its own marker), it does not inject again.

### Proxy Request Body Limit

Incoming request bodies are capped at **10 MB** before being forwarded. Larger bodies receive a `400 Bad Request` response.

### Proxy TLS

The reqwest client used by the proxy does **not** use `danger_accept_invalid_certs` for loopback destinations — that option is explicitly set to `false`. Connections to local servers (which typically serve over plain HTTP) are made over plain HTTP.

---

## 5. No Telemetry

DevDock collects **no telemetry, analytics, or crash reports**. No data is sent to any remote server by the application itself. The only outbound network connections made by DevDock are:

- Connections to your own dev server (via the preview proxy)
- Connections to external URLs you explicitly enter in the preview URL bar
- `git fetch` / `git push` / `git pull` operations you explicitly trigger (these go directly through the system `git` binary, not through DevDock's network stack)
- `preview_open_in_browser` — this hands a URL to the OS shell opener; the actual request is made by your browser

---

## 6. Local Data Storage

### Configuration Directory

App configuration is stored in the platform-standard config directory:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\devdock\` |
| macOS | `~/Library/Application Support/devdock/` |
| Linux | `~/.config/devdock/` |

The config directory is created on first launch. Contents include custom theme JSON files and saved app state.

### localStorage

User settings, workspace state, and layout preferences are stored in the WebView's `localStorage`. This data lives inside the Tauri WebView data directory:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\com.samue.devdock\` (WebView2 profile) |
| macOS | `~/Library/WebKit/com.samue.devdock/` |
| Linux | `~/.local/share/com.samue.devdock/` |

**What is stored in localStorage:**
- All settings values (font, tab size, shortcuts, zoom, etc.)
- Workspace list and active workspace ID
- Layout state (sidebar width, active view, split mode)
- Editor open files and cursor positions (per project)
- Terminal command history (last 100 entries)
- Preview proxy state (target port, current URL)
- File explorer expanded paths

### No Cloud Sync

None of the above data leaves your machine. There is no account system, no sync service, and no remote backup.

---

## 7. Network Access

Beyond the preview proxy (described above), DevDock makes the following network calls:

| What | When | Protocol |
|---|---|---|
| Preview proxy upstream request | When you view a page in the preview panel | HTTP/1.1 or HTTP/2 to `localhost` |
| External URL proxy | When you manually navigate to an external URL | HTTPS to the target host |
| WebSocket proxy | When the proxied dev server opens a WebSocket | ws:// to `localhost` |
| `git` remote operations | When you click Fetch or Push | Delegated entirely to the system git binary |
| System browser open | When you click "Open in Browser" | Only HTTP/HTTPS URLs are accepted |

The `preview_open_in_browser` command validates that the URL begins with `http://` or `https://` before passing it to the OS shell opener. Non-HTTP schemes (file://, javascript://, etc.) are rejected.

---

## 8. Content Security Policy

The Tauri app window's CSP (defined in `tauri.conf.json`) is:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: http://127.0.0.1:*;
font-src 'self';
connect-src 'self' http://127.0.0.1:*;
frame-src 'self' http://127.0.0.1:*;
```

Key points:
- Scripts can only be loaded from the app bundle itself (`'self'`)
- Images and fetch connections from external origins (including `https://`) are blocked by the app shell CSP — external content only appears inside the proxied iframe, which loads from `http://127.0.0.1:<proxy-port>`
- Inline styles are permitted (`'unsafe-inline'`) to support dynamic theme application via CSS custom properties
