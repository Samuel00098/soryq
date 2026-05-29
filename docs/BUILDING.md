# Building Soryq from Source

This guide covers everything you need to build, run, and understand the Soryq codebase.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone and Install](#2-clone-and-install)
3. [Development Mode](#3-development-mode)
4. [Production Build](#4-production-build)
5. [Project Structure](#5-project-structure)
6. [Architecture Overview](#6-architecture-overview)
7. [Key Data Flows](#7-key-data-flows)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Prerequisites

### All Platforms

| Dependency | Version | Installation |
|---|---|---|
| Node.js | 20 LTS or newer | https://nodejs.org |
| Rust | 1.77+ (stable) | https://rustup.rs |
| Tauri CLI | v2 (included in `devDependencies`) | `npm install` installs it |

### Windows

| Dependency | Notes |
|---|---|
| WebView2 | Usually pre-installed on Windows 11; download from Microsoft if missing |
| Microsoft C++ Build Tools | Required by Rust; install via Visual Studio Installer |
| `windows-sys` crate dependencies | Pulled in automatically by `cargo` |

Run in an **x64 Native Tools Command Prompt** or ensure MSVC is in your PATH.

### macOS

| Dependency | Notes |
|---|---|
| Xcode Command Line Tools | `xcode-select --install` |
| Rosetta 2 (Apple Silicon only) | `softwareupdate --install-rosetta` |

### Linux (Ubuntu / Debian)

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### Linux (Fedora / RHEL)

```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

---

## 2. Clone and Install

```bash
git clone https://github.com/Samuel00098/soryq.git
cd soryq
npm install
```

`npm install` installs both the JavaScript dependencies and pulls in `@tauri-apps/cli` as a dev dependency.

Cargo dependencies are downloaded automatically on the first build. This can take a few minutes on the initial run as the Rust ecosystem packages compile.

---

## 3. Development Mode

```bash
npm run tauri dev
```

This command (defined in `tauri.conf.json` as `beforeDevCommand`) runs two processes concurrently:

1. **Vite dev server** (`npm run dev`) — serves the Svelte frontend on `http://localhost:1420` with hot module replacement
2. **Tauri dev process** — compiles the Rust backend and opens a native window pointed at the Vite dev server

Changes to `.svelte` and `.ts` files are reflected immediately via HMR without restarting the Rust process. Changes to `.rs` files trigger a Rust recompile and window reload.

### First Build

The first `cargo` compile takes several minutes. Subsequent incremental builds are much faster (typically 5–15 seconds for small changes).

### Development Tips

- Tauri DevTools can be opened with `F12` or `Ctrl+Shift+I` in dev mode
- Rust `println!` output appears in the terminal where you ran `npm run tauri dev`
- Svelte store changes are visible in the browser console inside DevTools

---

## 4. Production Build

```bash
npm run tauri build
```

This runs `npm run build` (Vite production bundle) then compiles the Rust binary in release mode and bundles the final installer.

Output artifacts appear in:

```
src-tauri/target/release/bundle/
  ├── msi/          # Windows installer (.msi)
  ├── nsis/         # Windows installer (.exe, NSIS)
  ├── dmg/          # macOS disk image
  ├── macos/        # macOS app bundle (.app)
  ├── appimage/     # Linux portable app
  └── deb/          # Debian package
```

### Release Build Flags

By default `tauri build` compiles with `--release`. Symbols are stripped and optimizations are enabled. The output binary is significantly smaller and faster than the dev build.

### Cross-Compilation

Cross-compiling between platforms is not currently supported by this project's setup. Build on the target platform.

---

## 5. Project Structure

```
soryq/
├── src-tauri/                  # Rust backend
│   ├── Cargo.toml              # Rust dependencies
│   ├── Cargo.lock
│   ├── tauri.conf.json         # Tauri configuration (window size, CSP, bundle targets)
│   ├── build.rs                # Tauri build script
│   ├── capabilities/
│   │   ├── default.json        # Tauri capability set
│   │   └── file-system.json    # File system plugin permissions
│   └── src/
│       ├── main.rs             # Binary entry point
│       ├── lib.rs              # Tauri builder, plugin registration, invoke handler
│       ├── state.rs            # AppState (shared across all Tauri commands)
│       ├── error.rs            # Unified error types
│       ├── commands/
│       │   ├── mod.rs          # Shared helpers (clean_path_buf)
│       │   ├── file_system.rs  # fs_read_dir, fs_create_file, fs_write_file, etc.
│       │   ├── terminal.rs     # terminal_create, terminal_write, terminal_resize, etc.
│       │   ├── workspace.rs    # workspace_open_project, git operations, search
│       │   ├── preview.rs      # preview_start_proxy, preview_capture_screenshot, etc.
│       │   └── theme.rs        # theme_list, theme_activate, theme_save
│       ├── pty/
│       │   ├── mod.rs
│       │   ├── session.rs      # PtySession: spawn, write, resize, close
│       │   ├── manager.rs      # PtyManager: DashMap-based session registry
│       │   └── shell.rs        # Shell detection (available_shells, detect_shell)
│       ├── preview/
│       │   └── mod.rs          # PreviewManager + Axum proxy handler + inspector injection
│       ├── workspace/
│       │   ├── mod.rs
│       │   ├── project.rs      # Project and RecentProject data models
│       │   ├── manager.rs      # WorkspaceManager
│       │   └── settings.rs     # Per-project settings persistence
│       └── theme/
│           └── mod.rs          # Theme loading and persistence
│
├── src/                        # Svelte + TypeScript frontend
│   ├── main.ts                 # App entry: mounts App.svelte
│   ├── App.svelte              # Root component
│   └── lib/
│       ├── components/
│       │   ├── layout/
│       │   │   ├── AppShell.svelte       # Main layout: sidebar + terminal + aux panels
│       │   │   ├── TitleBar.svelte       # Custom frameless title bar + search
│       │   │   ├── StatusBar.svelte      # Bottom status bar
│       │   │   └── SnapshotsPanel.svelte # Workspace snapshot UI
│       │   ├── terminal/
│       │   │   ├── TerminalPanel.svelte  # Terminal panel host + layout picker
│       │   │   ├── TerminalPane.svelte   # Individual xterm.js instance
│       │   │   └── FloatingPromptBar.svelte
│       │   ├── editor/
│       │   │   ├── EditorPanel.svelte    # Editor host + tabs
│       │   │   └── CodeEditor.svelte     # CodeMirror 6 wrapper
│       │   ├── preview/
│       │   │   └── PreviewPanel.svelte   # Preview iframe + inspector + console
│       │   ├── explorer/
│       │   │   ├── FileExplorer.svelte   # File tree
│       │   │   └── SourceControl.svelte  # Git diff/status/log
│       │   ├── workspace/
│       │   │   ├── WelcomeScreen.svelte  # Recent workspaces landing page
│       │   │   ├── ProjectSwitcher.svelte
│       │   │   ├── TasksPanel.svelte
│       │   │   ├── NotesPanel.svelte
│       │   │   ├── QuickRunPanel.svelte
│       │   │   └── ReviewPanel.svelte
│       │   └── shared/
│       │       ├── SettingsModal.svelte  # Settings modal (5 tabs)
│       │       └── Toasts.svelte         # Toast notification renderer
│       ├── stores/
│       │   ├── settings.ts     # Editor, terminal, shortcut, zoom settings
│       │   ├── layout.ts       # Panel visibility, sidebar state
│       │   ├── workspace.ts    # Projects, workspaces, per-project state snapshots
│       │   ├── terminal.ts     # PTY sessions, grid layout, command blocks
│       │   ├── editor.ts       # Open files, active file, file cache
│       │   ├── preview.ts      # Proxy state, preview tabs, current URL
│       │   ├── theme.ts        # Active theme, custom theme editing
│       │   ├── presetThemes.ts # Built-in theme definitions
│       │   ├── notification.ts # Toast queue + desktop notification bridge
│       │   ├── explorer.ts     # Expanded paths, selected path
│       │   ├── commandpalette.ts # Search query, palette open state
│       │   ├── tasks.ts        # Workspace task list
│       │   ├── notes.ts        # Workspace notes
│       │   ├── runs.ts         # Quick run command configurations
│       │   └── snapshot.ts     # Workspace snapshot save/restore
│       ├── services/
│       │   └── pty-bridge.ts   # TypeScript wrapper around terminal Tauri commands
│       └── types/
│           ├── layout.ts       # LayoutState, ActiveView, SidebarTab types
│           ├── terminal.ts     # TerminalSessionInfo, GridLayout types
│           └── workspace.ts    # Project, Workspace, RecentProject types
│
├── static/
│   └── icon.png                # App icon (used in titlebar)
├── index.html                  # Vite entry HTML
├── vite.config.ts              # Vite build configuration
├── svelte.config.js            # Svelte compiler configuration
├── tsconfig.json               # TypeScript configuration
└── package.json
```

---

## 6. Architecture Overview

### Communication Model

```
┌─────────────────────────────────────────────────────────────┐
│  WebView (Svelte 5 + TypeScript)                            │
│                                                             │
│  Stores ──► Components ──► invoke("command_name", args)     │
│     ^                              │                        │
│     └──────── IPC response ────────┘                        │
└─────────────────────────────────────────────────────────────┘
                    │  Tauri IPC (JSON serialization)
┌─────────────────────────────────────────────────────────────┐
│  Rust Backend (Tauri + Axum + portable-pty)                 │
│                                                             │
│  AppState                                                   │
│  ├── WorkspaceManager   (project registry)                  │
│  ├── PtyManager         (DashMap<u32, PtySession>)          │
│  └── PreviewManager     (Axum proxy + state)                │
└─────────────────────────────────────────────────────────────┘
```

### Frontend Stores

All application state in the frontend is managed by **Svelte 5 stores** in `src/lib/stores/`. Stores communicate with each other through subscriptions and derived stores. They communicate with the Rust backend through Tauri's `invoke` function.

Stores that need persistence call `localStorage` directly inside a `store.subscribe()` callback, using a `forge_setting_` or `forge_ws_` key prefix.

### Rust Backend — AppState

`AppState` (in `state.rs`) is the single shared state object injected into every Tauri command handler via `tauri::State<AppState>`:

```rust
pub struct AppState {
    pub workspace_manager: WorkspaceManager,
    pub pty_manager: PtyManager,
    pub preview_manager: PreviewManager,
    // ...
}
```

All fields use `Arc<Mutex<...>>` or `Arc<DashMap<...>>` for safe concurrent access from Tauri's async command handlers.

### PTY Layer

The PTY subsystem uses the `portable-pty` crate, which provides a cross-platform abstraction over:
- **Windows**: ConPTY (Windows 10 build 1903+)
- **macOS / Linux**: POSIX PTY (`openpty`)

Each session spawns two threads:
1. **Reader thread** (`forge-pty-reader`) — reads from the PTY master and sends chunks to the frontend via a Tauri IPC `Channel<Response>`
2. **Waiter thread** (`forge-pty-waiter`) — waits for the child process to exit and sends the exit code

The 64 KB read buffer in the reader thread allows the terminal to handle large bursts of output (e.g., `cat` on a big file) without blocking.

### Preview Proxy Layer

The preview proxy is an **Axum 0.8 HTTP server** running inside Tauri's async runtime (`tauri::async_runtime::spawn`). It listens on a random free loopback port and:

1. Receives HTTP requests from the WebView iframe
2. Classifies them as local dev server requests or external URL requests
3. Forwards them via `reqwest` with appropriate header rewrites
4. For HTML responses, injects the inspector `<script>` before `</head>`
5. WebSocket upgrade requests are proxied bidirectionally using `tokio-tungstenite`

The proxy can be started, stopped, and reconfigured (target port, preferred local host) at any time via Tauri commands.

### Theme System

Themes are stored as JSON files in the config directory. The active theme's CSS variables are applied to the `:root` element of the WebView via JavaScript, which allows themes to affect all CSS throughout the app including the CodeMirror editor and xterm.js terminal colors.

---

## 7. Key Data Flows

### Opening a File

```
User clicks file in FileExplorer
  → explorer store calls invoke("fs_read_file", { path })
  → Rust: require_in_project() check → read_to_string()
  → returns file content as String
  → editor store adds file to openFiles, sets content in fileCache
  → EditorPanel renders CodeMirror with the content
```

### Creating a Terminal Session

```
User opens terminal tab
  → terminal store calls openPty(cols, rows, { onData, onExit }, cwd, shell)
  → pty-bridge.ts calls invoke("terminal_create", { cols, rows, cwd, shellProgram, onData, onExit })
  → Rust: detect_shell() or validate named shell
  → portable-pty spawns child process
  → reader thread starts forwarding bytes via onData channel
  → frontend registers data callback → xterm.js Terminal.write(bytes)
```

### Preview Proxy Request Flow

```
User opens preview, proxy started at port P
  → iframe loads http://127.0.0.1:P/
  → Axum proxy_handler receives request
  → tries http://127.0.0.1:<target>/ then http://localhost:<target>/
  → reqwest fetches from dev server
  → if HTML: inject inspector script
  → return response to iframe
```

---

## 8. Troubleshooting

### Rust compile errors on first build

Make sure your Rust toolchain is up to date:

```bash
rustup update stable
```

On Windows, ensure the MSVC toolchain (not the GNU toolchain) is active:

```bash
rustup default stable-x86_64-pc-windows-msvc
```

### "WebView2 not found" on Windows

Download and install the WebView2 Evergreen Runtime from:
https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### PTY sessions not working on Linux

Ensure `DISPLAY` or `WAYLAND_DISPLAY` is set if you are running inside a desktop session. PTY creation does not require a display, but some shells (zsh, bash with readline) may behave differently in a headless context.

### Preview proxy not connecting

1. Confirm your dev server is actually running (`npm run dev`, `cargo run`, etc.)
2. Check the target port in the preview panel matches the port your server is listening on
3. Try toggling "Preferred Local Host" between `127.0.0.1` and `localhost` — some servers bind to only one
4. Check that your dev server is not binding to `0.0.0.0` only (some servers reject `localhost` requests in that case — use `127.0.0.1` in that scenario)

### `npm run check` reports Svelte type errors

```bash
npm run check
```

TypeScript and Svelte type checks are run with `svelte-check`. Fix any reported errors before submitting a PR. The checks do not run automatically during `tauri dev` to keep startup fast.

### Changing Tauri configuration

If you change `tauri.conf.json`, you must restart the `npm run tauri dev` process for the changes to take effect (a Vite HMR reload is not sufficient for Tauri config changes).
