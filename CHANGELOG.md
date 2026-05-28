# Changelog

All notable changes to Soryq will be documented here.

## [0.1.4] - 2026-05-28

### Bug Fixes

- **Updater â€” "Check for Updates" now works** â€” the button in Settings â†’ About was previously a simulation that always reported "up to date" regardless of the actual release. It now calls the real Tauri updater and correctly shows whether an update is available.
- **Floating bar â€” arrow keys move cursor in multi-line input** â€” pressing Up/Down in the floating prompt bar always hijacked cursor movement to navigate command history, even mid-sentence. Up now only goes to history when the cursor is already on the first line; Down only when on the last line.
- **Floating bar â€” messages auto-send to all agent CLIs** â€” prompts sent to Claude Code and Gemini CLI sessions were being written directly to the PTY in a single raw write, which interactive readline-based CLIs don't process reliably. All agent sessions (Claude Code, Gemini CLI, Codex CLI) now use the correct two-step path: paste text through xterm, then send Enter 80 ms later.

- **Workspace isolation â€” projects now keep separate live terminal, explorer, preview, and editor state** â€” switching projects no longer leaks shell panes, folder state, or preview/session state across projects. Each project restores its own snapshot and keeps its own terminal sessions so you can switch away and come back later.
- **Explorer â€” folder clicks repaint immediately** â€” tree expansion now updates immutably instead of waiting for a different tab switch to force a rerender, so folder toggles respond on the first click.
- **Terminal â€” sessions stay tied to their project** â€” switching projects now restores the matching shell state instead of destroying live sessions or leaking another project's terminal into the active view.
- **Source control â€” responses stay project-scoped** â€” branch, status, and review updates are now guarded so a slow git response from one project cannot overwrite another.
- **Run history â€” responsive and scrollable** â€” the panel now fits narrow layouts correctly and keeps its own scroll area so entries remain usable in tight sidebars.

---


## [0.1.3] - 2026-05-28

### Changes

- **Workspace navigation fixed** â€” clicking the home button now returns to the welcome screen without clearing project state. Previously it wiped all open project data, which was unintended.
- **Reset App moved to Settings** â€” a dedicated "Reset App Data" button is now in Settings â†’ About. It requires two clicks (first click asks for confirmation) to prevent accidental resets. Removing a workspace from the welcome screen no longer resets the entire app.

---

## [0.1.2] - 2026-05-28

### Bug Fixes

- **Auto-updater restart** â€” after installing an update the app now correctly relaunches. The wrong process capability (`allow-restart` instead of `allow-relaunch`) was causing the restart to silently fail, leaving users on the old version until they manually quit and reopened.

---

## [0.1.1] - 2026-05-28

### Bug Fixes

- **Theme persistence** â€” selected theme is now correctly restored on app restart. The appearance subscriber was racing against `loadThemes()` on startup and overwriting the saved theme preference.
- **Per-project layout isolation** â€” panel visibility (preview, editor, review, HTTP client), active view, auxiliary panel dimensions, sidebar width, sidebar visibility, and sidebar tab are now fully isolated per project in a workspace. Previously, toggling the browser preview or resizing a panel in one project would affect all other projects.

---

## [0.1.0] - 2026-05-27

### Initial public release

**Terminal**
- Full PTY terminal with xterm.js â€” real shell, not a fake one
- Multi-pane layouts: 1, 2, 3, 4, and 9-pane grids
- Pane role labels (Server, Tests, Build, Agent, Git, Custom)
- Floating prompt bar with drag-and-drop file attachment
- Command output blocks (Warp-style history strip per pane)
- Smart dev server detection â€” auto-offers to open in Preview
- Run history with search, filter, replay, and output capture
- Session persistence â€” terminal roles and layouts restored on reopen

**Editor**
- CodeMirror 6 with syntax highlighting for 15+ languages
- Vim mode, minimap, format-on-save, word wrap
- Codebase full-text search (200 ms debounce)

**Preview**
- Built-in HTTP/WebSocket proxy â€” routes local dev server through a managed port
- DOM inspector â€” click any element to inspect styles, attributes, and ancestors
- Markdown preview with syntax highlighting

**Git**
- Status, staged/unstaged diffs, commit history with graph
- Commit, push, fetch, discard changes
- Branch management â€” create, checkout, delete local and remote branches
- Branch display in status bar

**HTTP Client**
- Save and replay HTTP requests per project
- Full headers, body (JSON/text/form), method selection
- Response viewer with pretty-print and copy

**Workspace**
- Named workspaces with multiple open projects
- Multi-root file explorer
- Workspace snapshots â€” save and restore layout state
- Floating scratchpad (Markdown, per-project)
- Customisable keyboard shortcuts

**App**
- Tauri v2 (Rust + Svelte 5) â€” no Electron, no Node.js runtime
- Auto-updater â€” notified in-app when a new version is available
- Multiple built-in themes + custom theme editor with import/export
- UI zoom (keyboard-driven, persisted)
