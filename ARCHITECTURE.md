# Forge Architecture Document

## Application Overview

**Forge** — a lightweight developer workspace inspired by Terax, built with Tauri 2 + Rust + Svelte 5 + TypeScript. No AI agents. Features split panels, multi-project workspaces, theming, terminal, code editor, file explorer, and web preview.

---

## 1. Project Structure

```
forge/
├── src-tauri/                          # Rust backend (Tauri 2)
│   ├── Cargo.toml
│   ├── tauri.conf.json                 # Tauri configuration
│   ├── build.rs
│   ├── capabilities/
│   │   ├── default.json                # Default capability set
│   │   └── file-system.json            # File system permissions
│   ├── src/
│   │   ├── main.rs                     # Entry point, app setup
│   │   ├── lib.rs                      # Library exports for testing
│   │   ├── commands/                   # Tauri command handlers
│   │   │   ├── mod.rs
│   │   │   ├── terminal.rs             # PTY session management
│   │   │   ├── file_system.rs          # File/directory operations
│   │   │   ├── workspace.rs            # Multi-project workspace management
│   │   │   ├── preview.rs              # Web preview server management
│   │   │   └── theme.rs                # Theme configuration
│   │   ├── pty/                        # PTY backend abstraction
│   │   │   ├── mod.rs
│   │   │   ├── session.rs              # PTY session lifecycle
│   │   │   ├── manager.rs              # Session registry & routing
│   │   │   └── shell.rs                # Shell detection & config
│   │   ├── workspace/                  # Workspace domain logic
│   │   │   ├── mod.rs
│   │   │   ├── project.rs              # Project model & state
│   │   │   ├── manager.rs              # Multi-project orchestration
│   │   │   └── settings.rs             # Per-project settings
│   │   ├── preview/                    # Web preview subsystem
│   │   │   ├── mod.rs
│   │   │   ├── server.rs               # Local dev server proxy
│   │   │   └── browser.rs              # Embedded preview state
│   │   ├── theme/                      # Theme system
│   │   │   ├── mod.rs
│   │   │   ├── models.rs               # Theme data structures
│   │   │   ├── loader.rs               # Theme file parsing (JSON/TOML)
│   │   │   └── registry.rs             # Theme registry & switching
│   │   ├── state.rs                    # Tauri managed state (AppState)
│   │   └── error.rs                    # Unified error types
│   ├── themes/                         # Bundled themes
│   │   ├── default-dark.json
│   │   ├── default-light.json
│   │   └── terax-dark.json
│   └── icons/
│       ├── icon.png
│       └── icon.ico
│
├── src/                                # Svelte + TypeScript frontend
│   ├── app.html                        # SvelteKit entry HTML
│   ├── app.d.ts                        # TypeScript declarations
│   ├── routes/                         # SvelteKit routes
│   │   └── +layout.svelte
│   ├── lib/
│   │   ├── components/                 # UI components
│   │   │   ├── layout/
│   │   │   │   ├── AppShell.svelte     # Main app shell (sidebar, panels)
│   │   │   │   ├── TitleBar.svelte     # Custom title bar
│   │   │   │   ├── StatusBar.svelte    # Bottom status bar
│   │   │   │   └── ActivityBar.svelte  # Left icon activity bar
│   │   │   ├── terminal/
│   │   │   │   ├── TerminalPanel.svelte
│   │   │   │   ├── TerminalTab.svelte
│   │   │   │   ├── TerminalTabs.svelte
│   │   │   │   └── TerminalInput.svelte
│   │   │   ├── editor/
│   │   │   │   ├── EditorPanel.svelte
│   │   │   │   ├── EditorTab.svelte
│   │   │   │   ├── EditorTabs.svelte
│   │   │   │   ├── CodeEditor.svelte       # CodeMirror 6 wrapper
│   │   │   │   ├── Minimap.svelte
│   │   │   │   └── Breadcrumbs.svelte
│   │   │   ├── explorer/
│   │   │   │   ├── FileExplorer.svelte
│   │   │   │   ├── FileTree.svelte
│   │   │   │   ├── FileNode.svelte
│   │   │   │   └── FileIcon.svelte
│   │   │   ├── preview/
│   │   │   │   ├── PreviewPanel.svelte
│   │   │   │   ├── PreviewToolbar.svelte
│   │   │   │   └── PreviewFrame.svelte
│   │   │   ├── panels/
│   │   │   │   ├── SplitPane.svelte        # Resizable split container
│   │   │   │   ├── SplitHandle.svelte      # Drag handle
│   │   │   │   ├── PanelGroup.svelte       # Group of panels
│   │   │   │   └── PanelTab.svelte         # Panel type selector
│   │   │   ├── workspace/
│   │   │   │   ├── WorkspaceSwitcher.svelte
│   │   │   │   ├── ProjectSettings.svelte
│   │   │   │   └── WelcomeScreen.svelte
│   │   │   ├── theme/
│   │   │   │   ├── ThemePicker.svelte
│   │   │   │   └── ThemeCustomizer.svelte
│   │   │   └── shared/
│   │   │       ├── Icon.svelte
│   │   │       ├── Modal.svelte
│   │   │       ├── Dropdown.svelte
│   │   │       ├── ContextMenu.svelte
│   │   │       ├── Tooltip.svelte
│   │   │       ├── Input.svelte
│   │   │       ├── Button.svelte
│   │   │       └── Resizer.svelte
│   │   ├── stores/                     # Svelte stores
│   │   │   ├── workspace.ts
│   │   │   ├── terminal.ts
│   │   │   ├── editor.ts
│   │   │   ├── explorer.ts
│   │   │   ├── preview.ts
│   │   │   ├── theme.ts
│   │   │   ├── layout.ts
│   │   │   ├── settings.ts
│   │   │   └── commands.ts
│   │   ├── services/                   # Frontend services
│   │   │   ├── tauri.ts                # Tauri invoke wrappers
│   │   │   ├── terminal.ts
│   │   │   ├── file-icons.ts
│   │   │   └── keybindings.ts
│   │   ├── types/                      # TypeScript type definitions
│   │   │   ├── workspace.ts
│   │   │   ├── terminal.ts
│   │   │   ├── editor.ts
│   │   │   ├── theme.ts
│   │   │   └── layout.ts
│   │   └── utils/                      # Shared utilities
│   │       ├── path.ts
│   │       ├── debounce.ts
│   │       └── color.ts
│   └── styles/
│       ├── global.css                  # Global styles, CSS variables
│       ├── themes/                     # CSS theme definitions
│       │   ├── base.css
│       │   ├── dark.css
│       │   └── light.css
│       └── components/                 # Component-specific styles
│           ├── terminal.css
│           ├── editor.css
│           └── explorer.css
│
├── package.json
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

## 2. Rust Backend Architecture

### 2.1 Core Crates

| Crate | Purpose |
|-------|---------|
| `tauri` | Desktop app framework (v2) |
| `tauri-plugin-shell` | Shell command execution |
| `tauri-plugin-fs` | File system access |
| `tauri-plugin-dialog` | File/folder dialogs |
| `portable-pty` | Cross-platform PTY backend |
| `serde` / `serde_json` | Serialization |
| `tokio` | Async runtime |
| `uuid` | Session/project IDs |
| `notify` | File system watching |
| `dirs` | Platform-specific config/cache dirs |
| `anyhow` | Error handling |
| `thiserror` | Custom error types |
| `dashmap` | Concurrent HashMap for session registry |
| `axum` | Local HTTP proxy for web preview |
| `toml` | Theme/settings file parsing |

### 2.2 AppState Structure

```
AppState (managed via tauri::State)
├── workspace_manager: WorkspaceManager
│   ├── projects: DashMap<Uuid, Project>
│   ├── active_project_id: RwLock<Option<Uuid>>
│   └── recent_projects: Vec<RecentProjectEntry>
├── pty_manager: PtyManager
│   ├── sessions: DashMap<String, PtySession>
│   └── shell_config: ShellConfig
├── preview_manager: PreviewManager
│   ├── proxies: DashMap<String, PreviewProxy>
│   └── server_handle: Option<ServerHandle>
├── theme_registry: ThemeRegistry
│   ├── themes: HashMap<String, Theme>
│   ├── active_theme: RwLock<String>
│   └── custom_themes_path: PathBuf
└── settings: RwLock<AppSettings>
```

### 2.3 PTY Architecture

Actor model with async channels. Each terminal tab gets a `PtySession` with its own tokio task for non-blocking I/O. Output streamed via Tauri events.

### 2.4 File System Operations

- Use `tauri-plugin-fs` for basic operations
- Custom commands for workspace-aware operations
- `notify` crate for file watching → emit events to frontend
- Binary file detection via magic bytes

### 2.5 Web Preview System

- Rust runs a lightweight HTTP proxy (axum) on a random available port
- Proxy forwards requests to user's dev server (configurable port)
- Frontend loads preview in a `<webview>` or `<iframe>`
- Proxy handles CORS, WebSocket proxying (for HMR), and path rewriting

### 2.6 Theme System

Theme files stored as JSON with colors and syntax tokens. Commands: `theme_list`, `theme_activate`, `theme_get_active`, `theme_create`, `theme_delete`.

---

## 3. Svelte Frontend Architecture

### 3.1 Store Structure

All stores use Svelte 5 runes (`$state`, `$derived`).

- **workspaceStore**: projects map, active project ID, recent projects
- **terminalStore**: sessions map, active session, visible sessions per project
- **editorStore**: open files, active file, dirty state, cursor position
- **explorerStore**: file tree, selected path, expanded paths, context menu
- **previewStore**: URL, loading state, error, history
- **themeStore**: active theme, available themes, custom colors
- **layoutStore**: panel config, split config, sidebar state
- **settingsStore**: font size, family, tab size, word wrap, keybindings

### 3.2 Multi-Project State Isolation

- Each project has its own namespace in stores
- Switching projects changes `visibleSessions`, `visibleFiles`, etc.
- Terminal sessions and editor tabs persist but are hidden when not active
- Layout state is per-project and restored on switch

### 3.3 Key Technical Decisions

- **Tauri 2**: ~10MB binary, system WebView, Rust backend
- **Svelte 5**: Fine-grained reactivity, smaller bundle, built-in stores
- **CodeMirror 6**: Modular, tree-shakeable, easier theming than Monaco
- **portable-pty**: Cross-platform PTY (ConPTY on Windows, pts on Unix)
- **BSP tree for layouts**: Each split is a node with direction and children

---

## 4. Phased Implementation Plan

### Phase 1: Foundation (Weeks 1-2)
- Tauri 2 + Svelte 5 scaffold
- Custom title bar (frameless window)
- Activity bar with placeholder icons
- Basic theme system (dark/light toggle)
- CSS variable-based theming
- App shell layout
- Settings persistence

### Phase 2: File Explorer (Weeks 3-4)
- Open folder dialog
- File tree with recursive expansion
- File/folder icons
- File operations (create, rename, delete, copy)
- File watching with auto-refresh
- Project state persistence

### Phase 3: Terminal (Weeks 5-7)
- xterm.js integration
- PTY session creation (portable-pty)
- Terminal I/O bridge (Tauri events)
- Multi-tab support
- Terminal resize
- Shell detection
- Terminal theming

### Phase 4: Code Editor (Weeks 8-10)
- CodeMirror 6 integration
- Multi-tab editor with dirty state
- Syntax highlighting
- File save, find/replace
- Language detection
- Editor theme mapping
- External change detection

### Phase 5: Split Panels & Layout (Weeks 11-12)
- SplitPane component (horizontal/vertical)
- Drag-to-resize handles
- Nested splits
- Layout serialization
- Per-project layout persistence

### Phase 6: Multi-Project Workspaces (Weeks 13-14)
- Workspace switcher UI
- Project state isolation
- State persistence per project
- Recent projects list
- Welcome screen
- Project settings panel

### Phase 7: Web Preview (Weeks 15-16)
- HTTP proxy server (axum)
- Preview panel with webview/iframe
- URL bar with navigation
- WebSocket proxy (for HMR)
- Auto-detect dev server

### Phase 8: Polish & Command Palette (Weeks 17-18)
- Command palette (Ctrl+Shift+P)
- Keyboard shortcut system
- Status bar with rich info
- Loading states and error handling
- Toast notifications

### Phase 9: Theme Customization & Extras (Weeks 19-20)
- Theme customizer UI
- Import/export themes
- Syntax highlighting theme mapping
- Font settings
- Final testing and documentation

---

## 5. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| portable-pty on Windows | High | Test early; fallback to conpty directly |
| xterm.js performance with large output | Medium | Implement scrollback limits |
| CodeMirror 6 theme mapping | Medium | Start basic, iterate |
| File watching on large projects | Medium | Implement exclusion patterns |
| Split panel layout complexity | Medium | Start with 2-panel splits, add nesting |
