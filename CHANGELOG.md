# Changelog

All notable changes to Soryq will be documented here.

## [0.1.1] - 2026-05-28

### Bug Fixes

- **Theme persistence** — selected theme is now correctly restored on app restart. The appearance subscriber was racing against `loadThemes()` on startup and overwriting the saved theme preference.
- **Per-project layout isolation** — panel visibility (preview, editor, review, HTTP client), active view, auxiliary panel dimensions, sidebar width, sidebar visibility, and sidebar tab are now fully isolated per project in a workspace. Previously, toggling the browser preview or resizing a panel in one project would affect all other projects.

---

## [0.1.0] - 2026-05-27

### Initial public release

**Terminal**
- Full PTY terminal with xterm.js — real shell, not a fake one
- Multi-pane layouts: 1, 2, 3, 4, and 9-pane grids
- Pane role labels (Server, Tests, Build, Agent, Git, Custom)
- Floating prompt bar with drag-and-drop file attachment
- Command output blocks (Warp-style history strip per pane)
- Smart dev server detection — auto-offers to open in Preview
- Run history with search, filter, replay, and output capture
- Session persistence — terminal roles and layouts restored on reopen

**Editor**
- CodeMirror 6 with syntax highlighting for 15+ languages
- Vim mode, minimap, format-on-save, word wrap
- Codebase full-text search (200 ms debounce)

**Preview**
- Built-in HTTP/WebSocket proxy — routes local dev server through a managed port
- DOM inspector — click any element to inspect styles, attributes, and ancestors
- Markdown preview with syntax highlighting

**Git**
- Status, staged/unstaged diffs, commit history with graph
- Commit, push, fetch, discard changes
- Branch management — create, checkout, delete local and remote branches
- Branch display in status bar

**HTTP Client**
- Save and replay HTTP requests per project
- Full headers, body (JSON/text/form), method selection
- Response viewer with pretty-print and copy

**Workspace**
- Named workspaces with multiple open projects
- Multi-root file explorer
- Workspace snapshots — save and restore layout state
- Floating scratchpad (Markdown, per-project)
- Customisable keyboard shortcuts

**App**
- Tauri v2 (Rust + Svelte 5) — no Electron, no Node.js runtime
- Auto-updater — notified in-app when a new version is available
- Multiple built-in themes + custom theme editor with import/export
- UI zoom (keyboard-driven, persisted)
