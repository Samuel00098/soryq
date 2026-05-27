# Devdock Architecture Document

## Application Overview

**Soryq** — a lightweight developer workspace inspired by Terax, built with Tauri 2 + Rust + Svelte 5 + TypeScript. No AI agents. Features split panels, multi-project workspaces, git integration with a side-by-side/inline code reviewer, custom command palette, built-in terminal, code editor, file explorer, and live web preview.

---

## 1. Project Structure

```
soryq/
├── src-tauri/                          # Rust backend (Tauri 2)
│   ├── Cargo.toml
│   ├── tauri.conf.json                 # Tauri configuration
│   ├── build.rs
│   ├── capabilities/
│   │   ├── default.json                # Default capability set
│   │   └── file-system.json            # File system permissions
│   ├── src/
│   │   ├── main.rs                     # Entry point, app setup
│   │   ├── lib.rs                      # Tauri invoke setup & app initialization
│   │   ├── commands/                   # Tauri command handlers
│   │   │   ├── mod.rs
│   │   │   ├── terminal.rs             # PTY session management
│   │   │   ├── file_system.rs          # File/directory operations
│   │   │   ├── workspace.rs            # Multi-project workspace & Git operations
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
│   ├── App.svelte                      # Main application entry component
│   ├── app.d.ts                        # TypeScript declarations
│   ├── main.ts                         # Svelte initialization & global style imports
│   ├── lib/
│   │   ├── components/                 # UI components
│   │   │   ├── layout/
│   │   │   │   ├── AppShell.svelte     # Main app shell (sidebar, split panels)
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
│   │   │   │   ├── FileIcon.svelte
│   │   │   │   ├── SourceControl.svelte    # Git changes, log graph, & commit manager
│   │   │   │   └── EmptyWorkspace.svelte
│   │   │   ├── preview/
│   │   │   │   ├── PreviewPanel.svelte
│   │   │   │   ├── PreviewToolbar.svelte
│   │   │   ├── review/
│   │   │   │   └── ReviewPanel.svelte      # Code Review interface (inline diff viewer)
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
│   │   │       ├── Tooltip.svelte
│   │   │       ├── Button.svelte
│   │   │       └── Resizer.svelte
│   │   ├── stores/                     # Svelte stores (using Svelte 5 runes / custom states)
│   │   │   ├── workspace.ts            # Active projects, workspace state
│   │   │   ├── terminal.ts             # PTY sessions state
│   │   │   ├── editor.ts               # Open files, active file, content cache
│   │   │   ├── explorer.ts             # Selected and expanded tree paths
│   │   │   └── keybindings.ts
│   │   ├── types/                      # TypeScript type definitions
│   │   │   ├── workspace.ts
│   │   │   └── layout.ts
│   │   └── utils/                      # Shared utilities
│   │       ├── path.ts
├── package.json
├── vite.config.ts                      # SPA build & alias configuration
├── tsconfig.json
└── README.md
|-------|---------|
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

- Use `tauri-plugin-fs` for basic operations.
- Custom commands for workspace-aware operations (e.g. listing, file metadata).
- `notify` crate for file watching → emits events to the frontend.
- Binary file detection via magic bytes.

### 2.5 Web Preview System

- Rust runs a lightweight HTTP proxy (axum) on a random available port.
- Proxy forwards requests to the user's dev server (configurable port).
- Frontend loads preview in a `<webview>` or `<iframe>`.
- Proxy handles CORS, WebSocket proxying (for HMR), and path rewriting.

### 2.6 Theme System

Theme files stored as JSON with colors and syntax tokens. Commands: `theme_list`, `theme_activate`, `theme_get_active`, `theme_save`.

### 2.7 Git Integration Commands

Forge interacts directly with the host system's installed Git executable through Tauri's command dispatch.
- `workspace_git_status`: Runs `git status --porcelain` and checks `git diff HEAD --numstat` to structure a project's modified, added, deleted, and untracked files list alongside aggregate commit metrics.
- `workspace_git_diff`: Obtains raw unified git diffs for a file or the whole workspace. Untracked files are automatically resolved by reading the file and formatting it as a complete addition block for the reviewer.
- `workspace_git_commit`: Stages all workspace changes and performs a commit.
- `workspace_git_push` / `workspace_git_fetch`: Syncs state with remote origins.
- `workspace_git_discard_file` / `workspace_git_discard_all`: Undoes modifications safely via checkout/clean.
- `workspace_git_log`: Fetches Git history logs for rendering the workspace commit log graph.

---

## 3. Svelte Frontend Architecture

### 3.1 Store Structure

All stores use Svelte 5 runes (`$state`, `$derived`) or Svelte's reactive stores for modular cross-component communication.

- **workspaceStore**: active projects map, currently active project ID, and recent workspaces.
- **terminalStore**: maps PTY terminal sessions, the active session, and active shells.
- **editorStore**: open file tabs list, active file, dirty flag registry, scroll coordinates, and document content cache.
- **explorerStore**: file tree visual state, expanded folders, and context menu actions.
- **previewStore**: web preview proxy settings, dev server target port, and history navigation.
- **themeStore**: active UI colors, custom syntax styles, and CSS custom property injector.
- **layoutStore**: visibility of side panels (`editorVisible`, `previewVisible`, `reviewVisible`), sidebar status, and selected tabs.
- **settingsStore**: editor custom settings (e.g. font-family, word wrap) and user keybindings.
- **commandPaletteStore**: registers default workspace actions and holds state for search and visibility of the Command Palette modal.
- **notificationStore**: manages self-dismissing custom toast alerts (success, info, warning, error).

### 3.2 Multi-Project State Isolation

- Each project has its own namespace and layout state stored in local/memory repositories.
- Switching projects updates active views, editor tabs, and terminal sessions, hiding background tasks while keeping them running.
- Layout preferences (split proportions, pane counts) are remembered per-project.

### 3.3 Key Technical Decisions

- **Tauri 2**: Fast performance, system-default webview (WebView2 on Windows, WebKit on macOS/Linux), and secure Rust backend wrappers.
- **Svelte 5**: Modern fine-grained reactivity using runes, leading to a much smaller javascript footprint and faster UI updates than traditional frameworks.
- **CodeMirror 6**: Modular editor setup. Custom extensions like `scrollPastEnd()` (from `@codemirror/view`) allow VS Code-style scrolling below the file contents.
- **Overscroll & Boundary Protection**: Enforced app-wide scroll boundary limits (`overscroll-behavior: none` applied to `.cm-scroller`, `.sc-scrollable`, `.review-body`, and scrollable panels) to prevent WebView overscroll bounce, elastic rubber-banding, and focus leakage.
- **Layout Shift Prevention**: Strict scrollable containers use `scrollbar-gutter: stable` to ensure side panels, trees, and diff structures do not shift horizontally when a scrollbar appears or disappears.
- **Sticky Section Layout**: Sidebars and lists (e.g. in `SourceControl.svelte`) leverage contextual sticky headers (`position: sticky; top: 0`) that scroll inline inside panels, preserving category context similar to premium IDEs.
- **Unified Diff Review Panel**: Rather than using external heavy dependencies, Forge implements a custom diff renderer inside `ReviewPanel.svelte` that parses unified git diff outputs on the fly, rendering changes with inline additions, deletions, line-number comparisons, and file-by-file collapsibility.

---

## 4. Phased Implementation Plan

- **Phase 1: Foundation** `[Completed]` - Tauri 2 scaffolding, frameless Custom TitleBar, and styling tokens.
- **Phase 2: File Explorer** `[Completed]` - Watchers, folder tree navigation, and FS operations.
- **Phase 3: Terminal** `[Completed]` - PTY manager, tab multiplexing, and xterm.js integration.
- **Phase 4: Code Editor** `[Completed]` - CodeMirror 6, syntax highlighting, and Tab management.
- **Phase 5: Split Panels** `[Completed]` - SplitPane resizers and nested views layout.
- **Phase 6: Workspaces** `[Completed]` - WelcomeScreen, Workspace Switcher, and state persistence.
- **Phase 7: Web Preview** `[Completed]` - Axum dev proxy, dev port auto-detection, and HMR proxying.
- **Phase 8: Git Integration & Code Review** `[Completed]` - Git commands, SourceControl panel, history log graphs, and ReviewPanel inline diff viewer.
- **Phase 9: Command Palette & UI Polish** `[Completed]` - Search modal, Toast alerts, overscroll locking, and layout improvements.

---

## 5. Risk Assessment & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PTY Compatibility | High | Used `portable-pty` with ConPTY fallback for robust Windows shell support. |
| Scrolling Freeze in Webviews | Medium | Replaced hardware-accelerated composite tricks (`transform: translateZ(0)`) with clean WebView overscroll limits (`overscroll-behavior: none`). |
| Layout Shifts on Toggle | Low | Integrated `scrollbar-gutter: stable` globally to eliminate horizontal panel jitter. |
| Git Untracked File review | Medium | Custom Rust command wraps untracked files as standard insertions, allowing side-by-side reviews before commits. |
| Workspace State Clashes | Medium | Implemented project-isolated namespaces within Svelte stores. |
