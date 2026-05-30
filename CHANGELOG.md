# Changelog

All notable changes to Soryq will be documented here.

## [0.1.5] - 2026-05-30

### Added

- **Choose which files go into a commit** — the Source Control panel now shows a checkbox beside every changed file. Uncheck the ones you want to leave out of the next commit; a header checkbox toggles all of them (with an indeterminate state when only some are selected). Newly-appeared changes default to selected and your choices persist as the status refreshes, and the commit button stays disabled until at least one file is selected. Under the hood, `workspace_git_commit` now takes an optional list of paths and stages/commits only those (using a `--` separator so paths beginning with `-` aren't read as flags, plus per-path validation); passing no list keeps the previous "commit everything" behaviour.

### Changed

- **Prompt bar follows the focused terminal** — the floating prompt bar now targets whichever terminal you last clicked or focused, rather than tracking its own separate selection. The "pinned" indicator only shows when you deliberately aim the bar at a different terminal via the target picker; otherwise it auto-follows the active pane and falls back to the most recently used agent when no pane is focused.
- **Multi-line prompts to every agent** — the bracketed-paste send path, which keeps multi-line prompts intact and stops the agent REPL from swallowing the Enter key, now applies to all agent presets instead of only Codex.

### Fixed

- **Pane rearrangement persists per project** — swapping two terminal panes is now written to the active project's saved state, so the new arrangement survives switching workspaces and reopening the project instead of living only in transient state.

## [0.1.4] - 2026-05-30

### Added

- **Multiple workspaces** — a workspace switcher now lives in the sidebar header. Click it to switch between your workspaces (the active one is marked with a coloured dot and a check), rename the current workspace inline with the pencil button, or create a new one. Each workspace keeps its own set of project folders.
- **Named workspace creation** — creating a workspace now opens a dialog to name it (Enter to create, Esc to cancel) instead of generating a placeholder name. Reachable from the welcome screen, the switcher, the command palette, and the `Ctrl+N` shortcut.
- **Spawn agents from the prompt bar** — a new spawn button in the floating prompt bar opens a panel of AI-agent presets. Dial in how many of each agent you want, and they launch together — each into its own available terminal pane — with a count badge while you queue them up.
- **Drag to rearrange terminal panes** — grab a pane's title bar to reposition it within the grid. Uses a pointer-based drag (not native HTML5 drag-and-drop, which is unreliable inside the Tauri webview).
- **Agent name in pane titles** — a terminal running a detected agent CLI now shows the agent's display name (e.g. `· Claude Code`) next to its label.
- **"What is a workspace?" card** — the welcome screen now explains the workspace-groups-projects model with a small diagram.

### Changed

- **Quick Run moved out of the sidebar** — the dedicated Quick Run sidebar tab and panel have been removed; launching agents now flows through the prompt bar's spawn panel. Persisted layouts that still pointed at the `runs` tab fall back to the file explorer.
- **Terminal pane allocation** — when no empty pane is available, opening a terminal now appends a new pane slot instead of overwriting the active pane, which previously orphaned the session already running there.
- **Trimmed agent preset list** — removed the Gemini, Aider, and Cursor entries from the built-in agent presets, keeping the actively used set (Codex, Claude Code, Antigravity, OpenCode, Pi, Dev Server, GitHub Copilot).

### Changed — License

- **Relicensed to AGPL-3.0-only** — Soryq is now licensed under the GNU Affero General Public License v3.0 (reverting the brief Apache-2.0 switch). The `LICENSE` file, README, `package.json`, and `Cargo.toml` are updated to match.

## [0.1.3] - 2026-05-29

### Fixed

- **Workspace persistence — state lost on reopen (root cause)** — every time a folder was opened the backend assigned it a brand-new random project ID, but all per-project state (terminal sessions, layout, open files) is keyed by that ID. So reopening a workspace — whether after switching to another workspace or restarting the app — produced a new ID that could never be matched back to the saved state, leaving you with a fresh, empty workspace. Project IDs are now derived deterministically from the canonicalized folder path, so the same folder always maps to the same ID. Coming back to a workspace now restores its terminals, layout, and open files; within the same app session the live terminal (PTY) processes are still running and are reattached.
- **Workspace persistence — terminals restored into wrong slots** — restored sessions are now recreated only for panes that actually held one and are placed back in their original pane slot, leaving previously-empty panes empty (legacy saved state is treated as occupied for backward compatibility).
- **Workspace persistence — closing via Home** — the Home button now explicitly saves the active project's state before returning to the welcome screen, so nothing captured in the last moment before closing is lost.
- **Quick Run — clicking Run toggled the right panel** — launching an agent from the Run tab called the terminal-view toggle, which closed the right-hand auxiliary panel (or reopened it on a second click). The terminal is always visible, so running a command now focuses the target pane without disturbing the auxiliary panel.
- **Quick Run — agents launched into busy/active terminals** — agent runs now target a terminal that is genuinely idle and not the active/focused one, preferring empty or idle non-active panes. When every pane is busy or already running an agent, a brand-new terminal is opened instead of hijacking one that's in use. The confirmation toast now names the terminal the agent actually launched in.
- **Terminal "in use" detection for manual commands** — a non-empty command typed directly into a terminal now flags that session as busy (previously only prompt-bar/agent runs did). Agent runs no longer target a terminal that is actively running a hand-started command such as a dev server or test watcher.

## [0.1.2] - 2026-05-29

### Added

- **Microphone permission dialog** — replaced the WebView2 browser-bar permission prompt with a native-feeling in-app dialog. The dialog appears before `getUserMedia` is called when microphone access hasn't been granted yet, then remembers the decision so it never interrupts again.
- **File explorer — inline rename** — right-clicking a file or folder and choosing Rename now shows an inline focused input directly in the tree, pre-filled with the current name. Confirm with Enter or by clicking away; cancel with Escape.
- **File explorer — editor tab integration** — renaming a file that is open in the editor silently updates its tab path and cache entry so work isn't lost. Deleting a file (or a folder) closes any open editor tabs for that path automatically.
- **File explorer — operation feedback** — rename and delete now show success and error toast notifications instead of failing silently.

### Fixed

- **Workspace switching — state loss on return** — switching to a different workspace no longer wipes the previous workspace's state. Terminal sessions, open editor files, layout, and preview state are all saved before the switch and fully restored when you return. Live PTY processes continue running in the background throughout.
- **Workspace switching — duplicate terminal sessions** — returning to a project that still had live sessions in memory no longer spawns a second set of sessions on top of the existing ones.
- **Snapshot restore — wrong view** — loading a snapshot saved while in terminal view incorrectly toggled to the last aux panel instead of staying on terminal. The restore path now writes directly to the layout store, bypassing the toggle logic in `setActiveView`.
- **Snapshot restore — sidebar width ignored** — `sidebarWidth` was captured in every snapshot but never applied on restore. It is now restored correctly.

### Security

- **Input validation for file rename** — the rename input now rejects filenames containing path separators (`/`, `\`) or null bytes, and enforces the 255-character POSIX limit, preventing path traversal attempts from reaching the Rust layer.
- **Persisted state sanitisation** — `loadProjectStateFromStorage` now validates all fields before they flow to Tauri invoke calls: file paths reject null bytes and control characters (`\x00–\x1f`), terminal role values are restricted to `/^[\w\-. ]{0,63}$/` (blocking terminal escape-code injection), and the layout sub-object has its numeric fields range-clamped (`sidebarWidth` 100–600, `auxPanelWidth` 700–2000, `auxEditorHeight` 10–90).
- **Snapshot value validation** — `sidebarWidth` clamped to `[100, 600]`; `targetPort` validated to `[1024, 65535]`; `previewUrl` restricted to relative paths or `localhost`/`127.0.0.1` URLs, preventing a crafted snapshot from redirecting the preview proxy to an unintended port.
- **Layout store allowlists** — `sanitiseActiveView()` and `sanitiseSidebarTab()` added as explicit Set-based allowlist validators, applied at all three restore paths (snapshot restore, cached project restore, persisted project restore). Unknown values fall back to safe defaults rather than being applied as-is.
- **Scoped localStorage clear** — "Reset App Data" now removes only `soryq_*` and `forge_*` prefixed keys instead of calling `localStorage.clear()`, which would have wiped any other data stored under the same WebView origin.
- **Snapshot IDs** — replaced `Math.random()` with `crypto.randomUUID()` for cryptographically random snapshot identifiers.
- **Error messages** — rename and delete error toasts now use `err?.message` instead of the raw error object, preventing potential path disclosure in error strings.
- **Permission request race condition** — calling `requestPermission` a second time before the user responds to the first no longer leaves the original promise permanently unresolved; the in-flight request is now auto-denied before the new one is shown.

## [0.1.1] - 2026-05-29

### Added

- **AI commit message generation** — sparkle button in the Source Control panel generates a conventional commits message (subject line + body) from the current diff and untracked file list using OpenRouter. Uses the same model selected for voice refinement.
- **Quick Capture** — Ctrl+Shift+Space opens a modal to rapidly capture notes into the current project without switching panels.
- **Daily Notes** — Ctrl+Shift+D opens a per-project daily note. Notes are stored in `.soryq/` alongside other project data.
- **Onboarding walkthrough** — first-time users see an interactive guide covering the key panels and shortcuts.
- **Tasks panel — Kanban layout** — Tasks moved from the sidebar into a full right-panel Kanban board with three columns (To Do, In Progress, Done), colour-coded badges, and drag-and-drop support. Tasks are persisted per-project in `.soryq/tasks.json`.
- **Voice refinement** — AI-powered cleanup of dictated voice transcripts using OpenRouter. Strips filler words, converts spoken symbols to their character equivalents (`fat arrow` → `=>`, `double equals` → `==`, etc.), preserves technical identifiers verbatim, and structures multi-step instructions into lists. Falls back to local cleanup when no API key is set.
- **OpenRouter API key management** — new AI & Voice section in Settings for saving the OpenRouter key, picking the preferred model, and toggling voice refinement on/off.
- **Voice refinement feedback** — mic button shows a teal spinner while the AI is processing (distinct from the red recording state). A "Prompt refined by AI" toast confirms when the AI call succeeded vs fell back to local cleanup.
- **Preview → prompt bar image injection** — clicking the inspector's screenshot button in the Preview panel inserts the captured element image directly as an image chip in the floating prompt bar.

### Changed

- **Auxiliary panel architecture** — right panel now supports three concurrent views (editor, preview, tasks, HTTP client, review) with tabbed switching and animated pill-style active indicator. Default panel width increased from 400 px to 700 px.
- **Sidebar navigation** — active tab now has an animated pill indicator.
- **OpenRouter key storage** — moved from OS keychain (unreliable on Windows) to `localStorage`, which is sandboxed to the app and works consistently. The key migrates automatically from the old `forge_openrouter_api_key` key to `soryq_openrouter_api_key` on first launch.
- **Voice refinement prompt** — completely rewritten for developer context: understands prompts directed at AI coding agents, terminal commands, and technical notes. Tone is direct and friendly.
- **Commit message prompt** — generates a proper subject line + blank line + detailed body instead of a single line. Token limit raised to 512.
- **Settings — AI & Voice** — key description updated to reflect localStorage storage. Status text updated ("Key saved. AI features are ready." / "No key saved yet."). Key input now accepts Enter to save.
- **Source control empty states** — animated SVG illustrations for clean working tree and no commit history.
- **Source control loading** — shimmer skeleton loaders while status and history are fetching.
- **Floating prompt bar** — text injected programmatically is now appended to existing input rather than replacing it.
- **Vite config port parsing** — block comments on single lines no longer confuse the port extractor.

### Fixed

- Floating prompt bar inflated to the wrong height on first app launch because `scrollHeight` was measured before the custom editor font loaded. Height is now pinned to the minimum when the input is empty.
- `git add` stderr was not sanitised before reaching the frontend, leaking absolute repository paths in commit error messages.
- OpenRouter error response bodies are now scrubbed for `sk-...` shaped strings before being shown to the user.
- Voice prompt length check used byte count (`str.len()`) instead of character count, incorrectly handling multi-byte UTF-8 input near the 32 000 limit.
- `TasksPanel`, `NotesPanel`, and `FloatingNotepad` were not updated when `refineVoicePrompt` return type changed from `string` to `RefinementResult`.

### Security

- **Path traversal protection** — new `validate_relative_path()` in the file system command module rejects `../`, null bytes, and `--` prefix patterns.
- **Branch name validation** — `validate_branch_name()` rejects empty names, special characters, and double-dot patterns before any git subprocess is spawned.
- **Secrets module** — dedicated Rust module for OpenRouter API key operations. Keys are never logged or returned to the frontend; error bodies are scrubbed before surfacing.
- **`git add` stderr sanitisation** — absolute paths in staging errors are now redacted consistently with all other git error paths.

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
