# Changelog

All notable changes to Soryq will be documented here.

## [0.1.0] - 2026-05-28

### Initial public release

**Terminal**
- Full PTY terminal with xterm.js — real shell, not a simulated one
- Multi-pane layouts: 1, 2, 3, 4, and 9-pane grids with split-right and split-below
- Pane role labels (Server, Tests, Build, Agent, Git, Custom)
- Floating prompt bar with drag-and-drop and paste-image file attachment
- Command output blocks (Warp-style history strip per pane)
- Smart dev server detection — auto-offers to open in Preview
- Run history with search, filter, replay, and output capture
- Session persistence — terminal roles and layouts restored on reopen
- Per-project terminal isolation — switching projects restores the correct shell state without destroying live sessions or leaking another project's panes

**Editor**
- CodeMirror 6 with syntax highlighting for 15+ languages
- Vim mode, minimap, format-on-save, word wrap
- Codebase full-text search with 200 ms debounce

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
- Multi-root file explorer with immediate folder-expand repainting
- Workspace snapshots — save and restore layout state
- Floating scratchpad (Markdown, per-project)
- Customisable keyboard shortcuts
- Per-project layout isolation — panel visibility, active view, sidebar state, and dimensions are fully scoped per project
- Home navigation preserves project state — clicking the home button no longer clears open project data

**Settings**
- Theme persistence — selected theme correctly restored on restart
- Reset App Data button in Settings → About with two-click confirmation to prevent accidental resets
- UI zoom (keyboard-driven, persisted)
- Multiple built-in themes + custom theme editor with import/export

**Auto-updater**
- In-app update check with correct Tauri v2 capability configuration
- Signed update verification via minisign
- App relaunches automatically after update installs

**Notifications**
- Toast notifications with slide-in / slide-out animations
- System desktop notifications (opt-in)
- Duplicate suppression — same message+type won't stack
- Maximum of 5 visible toasts to prevent viewport overflow

**Security**
- Path traversal prevention via canonicalization throughout all filesystem commands
- Null-byte path injection blocked in git file operations
- Shell path quoting hardened — attached file paths use single-quote escaping to prevent terminal injection
- HTTP client confirms before sending requests to private/loopback addresses
- Preview proxy inspector script only injected into local dev server responses, never external sites
- PTY write rate limiting — 1 MB/s per session
- All `{@html}` output sanitised with DOMPurify
- Signed auto-updates with minisign public key verification

**App**
- Tauri v2 (Rust + Svelte 5) — no Electron, no Node.js runtime
