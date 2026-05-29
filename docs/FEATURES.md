# Soryq Feature Reference

This document covers every user-facing feature in Soryq. It is organized by surface area. Settings defaults are shown in parentheses.

---

## Table of Contents

1. [Workspaces](#1-workspaces)
2. [File Explorer](#2-file-explorer)
3. [Code Editor](#3-code-editor)
4. [Terminal](#4-terminal)
5. [Floating Prompt Bar](#5-floating-prompt-bar)
6. [Preview Panel](#6-preview-panel)
7. [Git Integration](#7-git-integration)
8. [Themes](#8-themes)
9. [Keyboard Shortcuts](#9-keyboard-shortcuts)
10. [Command Palette and Codebase Search](#10-command-palette-and-codebase-search)
11. [Settings](#11-settings)
12. [UI Zoom and Scaling](#12-ui-zoom-and-scaling)
13. [State Persistence](#13-state-persistence)
14. [Sidebar Panels](#14-sidebar-panels)
15. [Notifications](#15-notifications)

---

## 1. Workspaces

Soryq organizes your work around **workspaces**. A workspace is a named container that can hold one or more open project folders. Workspaces are displayed in the welcome screen and in the project switcher at the top of the sidebar.

### Welcome Screen

When no workspace is active, Soryq shows the welcome screen. From here you can:

- **Open a folder** — opens a system folder picker and creates a new workspace for that folder
- **New workspace** (`Ctrl+N`) — creates an empty workspace ready for you to add projects
- **Resume a recent workspace** — click any card in the recent list to re-open it

Recent workspace cards show:
- Workspace name (editable inline)
- Project folder paths (shortened to last two segments)
- Last-opened timestamp ("3h ago", "just now", etc.)
- A remove button to delete the entry from the list

### Multiple Projects per Workspace

Inside a workspace you can open several project folders simultaneously. Each project gets its own tab in the project switcher. The currently active project determines:
- Which folder the file explorer shows
- Which git repository is used for Source Control operations
- Which path the codebase search is scoped to
- Which port `workspace_detect_port` reads when auto-detecting a dev server

### Workspace Naming

Click the workspace label in the sidebar header (or the pencil icon beside it) to rename the workspace inline. Press `Enter` to save or `Escape` to cancel.

---

## 2. File Explorer

The file explorer lives in the sidebar's **Files** tab.

### Reading Directories

The backend reads directory contents via `fs_read_dir`, which:
- Returns files sorted with **directories first**, then files, both alphabetically (case-insensitive)
- Exposes `name`, `path`, `is_dir`, `size` (bytes), and `modified` (Unix timestamp in ms) for each entry
- Only returns entries inside at least one open project root (path scoping enforced in Rust)

### Hidden Files

By default, hidden files (names starting with `.`) are not shown. Toggle them with the **Show Hidden Files** setting in Settings > General.

### File Operations

Right-click any file or folder in the tree to access the context menu:

| Action | Description |
|---|---|
| New File | Creates a new empty file in the selected directory |
| New Folder | Creates a new directory |
| Rename | Renames the file or folder inline; press `Enter` to confirm, `Escape` to cancel |
| Delete | Permanently removes the file or folder (and all its contents if a directory) |
| Copy | Copies a file or entire directory tree to a new location |

All operations are path-scoped: the Rust backend rejects any path that falls outside an open project root.

### File Size Limits

- **Read**: Files larger than 50 MB cannot be opened in the editor
- **Write**: Writes are rejected if the content exceeds 100 MB

---

## 3. Code Editor

The editor uses **CodeMirror 6** and opens whenever you click a file in the explorer.

### Language Support

Syntax highlighting and language-aware behaviour is available for:

| Language | Extension(s) |
|---|---|
| JavaScript / JSX | `.js`, `.jsx`, `.mjs`, `.cjs` |
| TypeScript / TSX | `.ts`, `.tsx` |
| CSS | `.css` |
| SCSS / Sass | `.scss`, `.sass` |
| HTML | `.html`, `.htm` |
| JSON | `.json`, `.jsonc` |
| Markdown | `.md`, `.mdx` |
| Python | `.py` |
| Rust | `.rs` |
| Go | `.go` |
| Java | `.java` |
| C / C++ | `.c`, `.cpp`, `.h`, `.hpp` |
| PHP | `.php` |
| SQL | `.sql` |
| YAML | `.yml`, `.yaml` |
| XML | `.xml` |

### Editor Settings

All editor settings are accessible via **Settings > General**.

| Setting | Default | Description |
|---|---|---|
| Font Size | `14` | Editor font size in px |
| Font Family | Auto-detected | Checked against a list of popular monospace fonts installed on the system; falls back to Consolas/monospace |
| Tab Size | `2` | Number of spaces per indent level |
| Word Wrap | Off | Wraps long lines instead of scrolling horizontally |
| Minimap | Off | Shows a scaled-down overview of the file on the right edge |
| Vim Mode | Off | Enables a full Vim key binding layer via `@replit/codemirror-vim` |
| Format on Save | On | Runs the built-in formatter when you save (`Ctrl+S`) |

### Font Auto-Detection

When the app starts, Soryq probes a list of preferred monospace fonts using the Canvas API's `measureText`. The first font detected as installed becomes the default. The full candidate list, in priority order:

JetBrains Mono, Fira Code, Cascadia Code, Cascadia Mono, Victor Mono, IBM Plex Mono, Source Code Pro, Consolas, Monaco, Menlo, DejaVu Sans Mono, Liberation Mono, Courier New.

### Saving Files

Press `Ctrl+S` to save. If **Format on Save** is enabled, the file is formatted first. The file is written to disk via `fs_write_file`, which enforces project-root scoping.

### Tabs

Multiple files can be open simultaneously. Each open file gets a tab above the editor. Click a tab to switch to it; middle-click or click the close button to close it.

### Format Document

Press `Alt+Shift+F` (or open the command palette and choose **Format Document**) to manually trigger formatting on the active file.

---

## 4. Terminal

The terminal is the primary surface in Soryq — it occupies the left/main section of the workspace and is always visible.

### PTY Sessions

Each terminal tab is backed by a native PTY session created with the `portable-pty` Rust crate. Sessions are real processes — not simulated — so programs behave identically to a native terminal.

### Shell Detection

Soryq automatically detects the best available shell for your platform:

**Windows (in priority order):**
1. PowerShell 7 (`pwsh`) — launched with `-NoLogo -NoProfile`
2. Windows PowerShell 5 (`powershell`) — launched with `-NoLogo -NoProfile`
3. Command Prompt (`cmd.exe` / `%COMSPEC%`)
4. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
5. WSL (`wsl`)

**macOS / Linux (in priority order):**
1. The user's configured login shell (`$SHELL` environment variable)
2. `/bin/zsh`
3. `/bin/bash`
4. `/bin/sh`
5. `fish` (if found in `PATH`)

You can override the shell in **Settings > Terminal**.

### Multi-Pane Layouts

Click the layout picker in the terminal panel to choose from:

| Layout | Panes |
|---|---|
| Single | 1 (default) |
| 2 Horizontal | 2 side by side |
| 2 Vertical | 2 stacked |
| 3 Horizontal | 3 side by side |
| 3 Vertical | 3 stacked |
| 4-grid | 2x2 grid |
| 9-grid | 3x3 grid |

Each pane can hold a different terminal session. Click a pane to focus it (the focused pane receives keyboard input). Sessions can be reassigned to different panes.

### Session Lifecycle

- **Create** — `Ctrl+Shift+`` opens a new terminal tab; the session starts in the current project directory (or the home directory if no project is open)
- **Close** — Click the × button on the session tab or type `exit` in the shell
- **Kill all** — Handled automatically on app close/reload; all PTY child processes are killed

Exit notifications appear as toasts in the bottom-right corner:
- Clean exit (code 0): brief "closed" info toast
- Non-zero exit: "process died (exit N)" error toast (6 s)

### Scrollback Buffer

The xterm.js scrollback buffer defaults to **5000 lines**. Change this in Settings > Terminal.

### Terminal Renderer

Two rendering modes are available:

| Mode | Description |
|---|---|
| `dom` (default) | Renders using DOM elements; compatible with all systems |
| `canvas` | Hardware-accelerated canvas renderer; may offer smoother scrolling on high-DPI displays |

The app automatically migrates `webgl` settings from older versions to `dom` on first launch.

### Terminal Font

Terminal font size defaults to **13 px** and inherits the same font family detected for the code editor. Configurable separately in Settings > Terminal.

### Cursor Styles

Three cursor styles are available: `bar` (default), `block`, and `underline`. Change in Settings > Terminal.

### Session Roles

Each pane can be tagged with a role label (Server, Tests, Agent, or a custom string). This helps you identify what each terminal is doing at a glance. Duplicate role names are numbered automatically ("Agent 1", "Agent 2").

### Command Blocks

When you run commands via the Floating Prompt Bar, Soryq tracks the command and its output in collapsible "command blocks" displayed above the terminal. Blocks auto-collapse when the command finishes, keeping the interface tidy. Up to 10 blocks are kept per session; output is capped at 4000 characters.

### Working Directory Tracking

The terminal pane tracks the current working directory via shell integration (OSC sequences or heuristic parsing) and exposes it to the rest of the app. The detected CWD is used when spinning up the preview proxy auto-detection.

---

## 5. Floating Prompt Bar

The Floating Prompt Bar is a semi-transparent input overlay that sits at the bottom of the terminal area. It provides a clean way to compose commands or messages before sending them to a terminal session.

### Opening the Prompt Bar

The prompt bar is always visible at the bottom of the terminal panel. Click it to focus it, or use the keyboard shortcut defined in your shortcuts.

### Target Selection

Use the target picker in the prompt bar to choose which terminal session receives the input. The picker lists all open sessions by their role or title.

### Drag-and-Drop Files

Drag one or more files from your operating system's file manager and drop them onto the prompt bar. Each file's absolute path is appended to the current input text, separated by spaces. This is useful for passing file arguments to CLI tools without typing long paths.

### Sending Input

Press `Enter` to send the current text to the selected terminal session. The text is appended to the session's command history (up to 100 entries, persisted in `localStorage`).

---

## 6. Preview Panel

The preview panel loads your running dev server inside a sandboxed iframe, proxied through Soryq's built-in HTTP server. Open it with `Ctrl+Shift+V` or click the globe icon in the sidebar view tabs.

### Proxy System

When you start the proxy (`Ctrl+Alt+P` or the Start button in the panel), Soryq:

1. Binds an Axum HTTP server on a random free port (the "proxy port")
2. Forwards all HTTP requests to your dev server at the configured "target port" (default: 5173)
3. Injects the inspector script into every HTML response
4. Transparently proxies WebSocket connections (required for HMR in Vite, webpack-dev-server, etc.)

The proxy automatically tries both `127.0.0.1` and `localhost` as the upstream host, in the order configured by **Preferred Local Host** setting.

### Port Auto-Detection

When you open a project, Soryq reads `package.json` scripts and `vite.config.ts` / `vite.config.js` to determine the most likely dev server port:

| Source | Detected port |
|---|---|
| `--port N` or `-p N` in any npm script | N |
| `port: N` in vite config | N |
| `next` or `nuxt` in dependencies | 3000 |
| `astro` in dependencies | 4321 |
| Fallback | 5173 |

You can override the detected port manually in the preview panel.

### Browser Tabs

The preview panel supports multiple browser-style tabs. Each tab maintains its own:
- URL and navigation history (back/forward)
- Load state (loading indicator, slow-load feedback)

Common ports are listed as quick-navigate shortcuts: 3000, 3001, 4173, 4200, 5000, 5173, 6006, 7000, 8000, 8080, 8081, 8888, 9000, and more.

### Device Viewports

Three viewport modes are available via the toolbar:

| Mode | Width |
|---|---|
| Responsive | Full panel width |
| Tablet | 768 px |
| Mobile | 375 px |

In tablet and mobile modes, the iframe is displayed inside a device-shaped chrome to simulate how your app looks on smaller screens.

### DOM Inspector

Activate the inspector by clicking the crosshair icon in the preview toolbar. While active:
- The cursor changes to a crosshair
- Hovering over any element shows a blue highlight overlay with a label
- Clicking an element sends its full details to the Soryq inspector pane

The inspector reports:
- CSS selector path
- Tag name
- Inner text (up to 500 characters)
- Outer HTML (up to 3000 characters)
- All HTML attributes
- CSS classes
- Computed styles (display, position, color, backgroundColor, font, margin, padding, width, height)
- Ancestor path (up to 6 levels)
- Page URL and title
- Bounding rect (x, y, width, height)

The inspector works via a small script injected into every proxied HTML response. It does **not** modify your source files.

### Preview Console

Click the console button in the preview toolbar to open the in-panel console log. The injected script intercepts `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug` in the previewed page and forwards each message (with level, text, URL, and timestamp) to the Soryq console pane. Uncaught errors and unhandled promise rejections are also captured.

### Screenshot

Click the camera icon to capture the current preview as a PNG. The capture mechanism is platform-specific:
- **Windows**: uses GDI `BitBlt` to copy the screen region matching the preview panel
- **macOS / Linux**: captures the webview content directly and crops to the panel bounds

The PNG is saved to a location of your choice via the system save dialog.

### Opening in Browser

Click the external-link icon to open the current preview URL in your default system browser.

### External URL Proxy

You can enter any `http://` or `https://` URL in the URL bar to proxy an external site through Soryq. This strips `X-Frame-Options` and `Content-Security-Policy` headers so the page can load in the iframe. External URLs that point to private IP ranges (RFC 1918, loopback, link-local) are blocked.

---

## 7. Git Integration

Git operations use the system `git` binary. Soryq requires `git` to be installed and available in `PATH`.

### Source Control Sidebar Tab

Click the git icon in the sidebar to open the Source Control panel for the active project. The panel displays:

**Branch name** — shown at the top

**Changed files** — grouped into:
- Modified (tracked files with changes)
- Added (newly staged files)
- Deleted
- Untracked (new files not yet tracked by git)

Each file entry shows:
- Relative path
- Addition/deletion line counts from `git diff HEAD --numstat`

**Total additions and deletions** — summed across all changed files

### Viewing Diffs

Click any file in the changed list to open its diff in the diff viewer. Untracked files are shown as an all-additions diff (every line prefixed with `+`).

### Committing

1. Type a commit message in the text area at the bottom of the Source Control panel
2. Press `Ctrl+Enter` or click **Commit**

Soryq stages all changes (`git add -A`) then runs `git commit -m "..."`. Commit messages have a maximum length of 10,000 characters.

### Pushing

Click the **Push** button to push the current branch to `origin`. The branch name is determined via `git branch --show-current`.

### Fetching

Click the **Fetch** button to run `git fetch origin`.

### Discarding Changes

- **Discard file** — right-click a file and choose Discard. For untracked files this deletes the file. For tracked files this runs `git reset HEAD -- <file>` then `git checkout -- <file>`.
- **Discard all** — click the discard-all button to run `git reset --hard HEAD` followed by `git clean -fd`. **This is destructive and cannot be undone.**

### Commit History (Log)

Click the **History** tab in the Source Control panel to see the last 50 commits as an ASCII graph (`git log --graph`). Each entry shows:
- Abbreviated commit hash
- Author name
- Date and relative time ("2 hours ago")
- Refs (branch/tag labels)
- Commit subject

---

## 8. Themes

### Built-in Preset Themes

Soryq ships with several built-in themes selectable from **Settings > Themes**:

| Theme | Style |
|---|---|
| Default Dark | Dark background, muted accents |
| Default Light | Light background |
| Terax Dark | Deep dark with purple accents |

Additional presets may be added in future releases.

### Custom Theme Editor

The custom theme editor (Settings > Themes > Custom) lets you edit any CSS custom property that drives the UI. Editable color fields include:

- Background layers (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-hover`, `--bg-active`)
- Text colors (`--text-primary`, `--text-secondary`, `--text-muted`)
- Border colors (`--border`, `--border-subtle`)
- Accent and interactive colors (`--accent`, `--accent-hover`, `--accent-light`)
- Status colors (`--success`, `--warning`, `--error`, `--info`)
- Sidebar, titlebar, and editor backgrounds
- Terminal colors (foreground, background, and the full 16-color ANSI palette)

Changes are applied live as you type in the color pickers.

### Importing and Exporting Themes

- **Export** — saves the current custom theme as a JSON file via the system save dialog
- **Import** — loads a previously exported JSON theme file

The theme JSON file is a flat object mapping CSS variable names to color values.

### Theme Persistence

Themes are stored in the platform config directory under `soryq/themes/`. The active theme name is persisted in app state. Custom themes are saved as JSON files in the same directory.

---

## 9. Keyboard Shortcuts

All shortcuts are configurable. The defaults are:

| Action | Default Shortcut | Category |
|---|---|---|
| Command Palette | `Ctrl+Shift+P` | View |
| Open Settings | `Ctrl+,` | View |
| New Workspace | `Ctrl+N` | Workspace |
| Go to Terminal | `Ctrl+\`` | View |
| Go to Editor | `Ctrl+E` | View |
| Go to Preview | `Ctrl+Shift+V` | View |
| Toggle Sidebar | `Ctrl+B` | View |
| Save File | `Ctrl+S` | File |
| Open Folder | `Ctrl+O` | Workspace |
| New Terminal Tab | `Ctrl+Shift+\`` | Terminal |
| Toggle Editor + Preview Split | `Ctrl+\` | Editor |
| Format Document | `Alt+Shift+F` | Editor |
| Start Preview Proxy | `Ctrl+Alt+P` | Preview |
| Stop Preview Proxy | `Ctrl+Alt+O` | Preview |
| Zoom In | `Ctrl+=` | Window |
| Zoom Out | `Ctrl+-` | Window |
| Reset Zoom | `Ctrl+0` | Window |

### Contextual Shortcuts (not configurable)

| Keys | Action | Context |
|---|---|---|
| `Left Alt` | Toggle voice input | Prompt bar, Tasks, Notes |
| `Ctrl+Enter` | Commit changes | Source Control commit message box |
| `Enter` | Confirm create or rename | Explorer inputs |
| `Escape` | Cancel create, rename, or recording | Explorer inputs, shortcut recorder |

### Customizing Shortcuts

Open Settings > Shortcuts. Click the binding for any action and press the key combination you want. The recorder listens for the next key event and saves it. Click **Reset to Defaults** to restore all defaults at once.

You can also add entirely new bindings for the same action by clicking the + button beside it.

---

## 10. Command Palette and Codebase Search

### Title Bar Search

The search box in the title bar doubles as the codebase search:

1. Click the search box (or press `Ctrl+Shift+P`)
2. Start typing — Soryq searches all text files in the active project with a 200 ms debounce
3. Results appear in a dropdown showing the relative file path, line number, and a snippet of the matching line
4. Click a result (or press `Enter` for the first one) to jump directly to that file and line in the editor

**Search limits:**
- Maximum 150 results returned
- Files larger than 10 MB are skipped
- Binary files (containing null bytes) are skipped
- The following directories are excluded: `.git`, `node_modules`, `dist`, `build`, `target`, `out`, `.svelte-kit`

### Command Palette

When no project is open, the title bar search filters the recent workspace list instead of searching code.

---

## 11. Settings

Open with `Ctrl+,` or the gear icon in the title bar. The settings modal has five tabs.

### General Tab

| Setting | Default | Type | Description |
|---|---|---|---|
| Font Size | `14` | Number | Code editor font size (px) |
| Font Family | Auto-detected | String | Monospace font stack for the editor |
| Tab Size | `2` | Number | Spaces per indent level |
| Word Wrap | Off | Boolean | Wrap long lines in editor |
| Minimap | Off | Boolean | Show code minimap in editor |
| Vim Mode | Off | Boolean | Enable Vim key bindings |
| Show Hidden Files | Off | Boolean | Show dotfiles in the explorer |
| Format on Save | On | Boolean | Auto-format when saving |
| Appearance | `dark` | `system` / `light` / `dark` | Color scheme preference |
| Notifications | On | Boolean | Enable desktop notification toasts |
| UI Zoom | `100` | Number (50–200) | Global UI scale percentage |

### Terminal Tab

| Setting | Default | Type | Description |
|---|---|---|---|
| Shell | Auto-detect | String | Override the shell program (leave empty for auto-detection) |
| Font Size | `13` | Number | Terminal font size (px) |
| Cursor Style | `bar` | `bar` / `block` / `underline` | Terminal cursor shape |
| Scrollback Lines | `5000` | Number | Number of lines kept in scrollback buffer |
| Renderer | `dom` | `dom` / `canvas` | xterm.js rendering mode |

### Shortcuts Tab

Lists all configurable shortcuts with their current bindings. Bindings can be recorded or reset individually. A separate section documents contextual shortcuts that are always active in specific UI surfaces.

### Themes Tab

Shows preset theme swatches and the custom theme color editor. See [Themes](#8-themes) above.

### About Tab

Shows the Soryq version (0.1.0) and a button to check for updates.

---

## 12. UI Zoom and Scaling

Soryq supports global UI scaling via the CSS `zoom` property applied to the main content wrapper.

| Action | Shortcut | Description |
|---|---|---|
| Zoom in | `Ctrl+=` | Increases zoom by 10% |
| Zoom out | `Ctrl+-` | Decreases zoom by 10% |
| Reset zoom | `Ctrl+0` | Returns zoom to 100% |

**Range:** 50% – 200% (enforced by the slider in Settings > General).

Zoom affects the layout engine: at higher zoom levels the sidebar will auto-collapse sooner (to avoid overflow), and the auxiliary panel width is clamped to prevent it from exceeding the available space.

The current zoom level is stored in `localStorage` and restored on next launch.

---

## 13. State Persistence

Soryq persists a significant amount of state across sessions using `localStorage`. All keys are prefixed with `forge_setting_` (settings) or `forge_ws_` (workspace state) or `soryq_layout` (layout).

### Persisted Settings

All values in the Settings modal (font, tab size, vim mode, shortcuts, theme selection, terminal options, notifications, zoom level, etc.) are persisted individually under `forge_setting_<key>`.

### Persisted Layout

The full layout state (`soryq_layout`) includes:
- Sidebar visibility and width
- Active view (terminal / editor / preview / review)
- Editor/preview split mode
- Active sidebar tab (files / git / tasks / notes / runs / snapshots)

### Persisted Workspace State

Per-workspace state is stored under `forge_ws_<key>`:
- Active workspace ID
- Recent workspaces list (name, project paths, last-opened timestamp)
- Open project IDs within each workspace

### Per-Project State

When you switch away from a project, Soryq snapshots and restores:
- Open files and active file in the editor
- Active line and column position
- Terminal session count, grid layout, and pane assignments
- Preview proxy state (target port, proxy port, current URL, preferred host)
- File explorer expanded paths and selected path

### Terminal Command History

The last 100 commands sent via the Floating Prompt Bar are stored under `forge_terminal_history` in `localStorage`.

---

## 14. Sidebar Panels

The sidebar contains six tabs, accessible via icon buttons in the header:

### Files

The standard file tree for the active project. See [File Explorer](#2-file-explorer).

### Source Control (Git)

The git diff, status, and history view for the active project. See [Git Integration](#7-git-integration).

### Tasks

A simple task list scoped to the current workspace. Tasks can be created, checked off, and deleted.

### Notes

A freeform rich-text scratchpad scoped to the current workspace. Content is stored in `localStorage`.

### Quick Run

A panel for configuring and running frequently-used commands. Commands are stored per-workspace and can be triggered with a single click, sending them to the active terminal session.

### Workspace Snapshots

Snapshots capture the current workspace state (open files, terminal layout, preview state) and allow you to restore it later. Useful for switching between different contexts within the same project.

---

## 15. Notifications

Soryq shows two kinds of notifications:

### In-App Toasts

Toast notifications appear in the bottom-right corner. They are categorized:

| Type | Default Duration | Color |
|---|---|---|
| Info | 3 s | Blue |
| Success | 3 s | Green |
| Warning | 3 s | Amber |
| Error | 6 s | Red |

Duplicate toasts (same message + type) are suppressed while a matching toast is already visible.

Toasts can have an action button (e.g., "Open File") that triggers a callback when clicked.

### Desktop Notifications

Some events (terminal exit, agent completion) also trigger OS-level desktop notifications, provided:
1. The **Notifications** setting is enabled (default: on)
2. The browser/WebView has been granted notification permission

Soryq requests notification permission on startup.
