# Changelog

All notable changes to Soryq will be documented here.


## [v0.2.4] - 2026-06-03

### Added

- **Publish a project to GitHub from Source Control** — a new "Publish to GitHub" flow turns an un-versioned folder, or a local repo with no remote, into a GitHub repository without leaving the app. When the active project has no `origin`, the Source Control panel offers a Publish button that opens an inline form: a one-time personal-access-token field (with a deep link to GitHub's token page pre-scoped to `repo`), the repository name (pre-filled from the folder name and sanitised to GitHub's allowed characters), an optional description, and a Private/public toggle. Creating the repo runs the whole sequence end-to-end — it calls the GitHub API to create the repository under your account, runs `git init` if needed, makes an `Initial commit` when the project has no commits yet, wires up `origin`, pushes the first commit, and opens the new repo in your browser. Backed by a new Rust `github` command module (`workspace_github_create_repo`) and a `src/lib/services/github.ts` client.
- **Unpushed-commit visibility** — Source Control now shows when you have local commits that haven't reached GitHub. The branch bar carries a sync badge (`↑N` ahead / `↓N` behind, or an `unpublished` pill when the branch has no upstream), and the Push button shows the outstanding count (e.g. `Push (2)`) and highlights in the accent colour whenever there's something to push. `workspace_git_branches` now also returns `ahead`, `behind`, `upstream`, and `has_remote` (computed via `git rev-list --left-right --count @{u}...HEAD`), and these counts refresh after every commit, push, and fetch.
- **Frontend unit tests (Vitest)** — the project now has a Vitest setup (`vitest.config.ts`, `npm test` / `npm run test:watch`) with the first suites covering the preview store's navigation/history (including the Back/Forward localhost regression below), the terminal store's command-block lifecycle, and the new proxy-URL extraction helper.

### Changed

- **Push is clearer and harder to get wrong** — `git push` now sets the upstream (`-u`) on the first push so the branch tracks `origin/<branch>` afterward (which is what powers the new ahead/behind counts), reports a friendly "Already up to date — nothing new to push" for no-op pushes, and translates failures into actionable messages instead of a raw git blob. The common silent-failure case — where the app disables interactive credential prompts (`GIT_TERMINAL_PROMPT=0`) and a push fails authentication without surfacing a login dialog — now reports "Authentication failed — your changes were NOT pushed. Sign in to GitHub…", with similarly specific guidance for rejected (fetch-first), missing-remote, and offline cases.
- **Model picker search bar stays pinned** — in Settings → Models, the model-list dropdown is now its own scroll container so its height hugs the available options up to the cap, and the filter input sticks to the top while you scroll, sitting on a translucent blurred backdrop that preserves the glass aesthetic instead of an opaque strip.
- **Simpler, more reliable agent pane titles** — the heuristic `summarizeAgentResponse` routine, which tried to guess a one-line summary by regex-scanning the tail of an agent's terminal output, has been removed along with the summarisation step in `finalizeCommandBlockWithExit`. Pane titles now come from the agent-emitted terminal title and task summary (the helpers added in v0.2.2), avoiding mislabelled panes built from noisy shell output.

### Fixed

- **Proxied dev-server pages render with their styles** — pages served through the Preview proxy could appear completely unstyled (the "Dev: On strips the CSS" problem), most visibly with Next.js 15. The proxy now advertises a `localhost` Origin/Referer to the dev server so its cross-origin guard (e.g. Next.js `allowedDevOrigins`, which trusts `localhost` but blocks `127.0.0.1`) accepts the subresource requests for chunks, modules, and stylesheets, and it strips the target's embedding/security headers (`Content-Security-Policy`, `X-Frame-Options`, the `Cross-Origin-*` policies) before re-serving inside the iframe, since those were authored for the dev origin and otherwise block the page from loading its own assets under the proxy origin.
- **Preview address bar shows the real URL** — when viewing an external site through the background proxy, the address bar now displays the actual external URL instead of the internal `http://127.0.0.1:<port>/proxy/…` form, via a new `extractExternalUrlFromProxyUrl` helper that decodes both the structured (`/proxy/<scheme>/<authority>/…`) and `?url=`-fallback proxy formats.
- **Back/Forward no longer truncates preview history** — returning to a typed-in `http://localhost:PORT/...` history entry no longer rewrote that entry to a bare relative path and discarded the forward history. When the iframe re-loads the page you're already on, the app now only syncs the address bar instead of pushing a new navigation entry.
- **Preview proxy is ready before the iframe loads** — entering a URL that routes through the proxy now starts the background proxy before the store update and iframe `src` binding fire, so the first load no longer races an unset proxy port.

### Security

- **GitHub token is keychain-only** — the personal access token used to create repositories is stored exclusively in the OS keychain via the `keyring` crate and read directly by the Rust backend. Unlike the AI provider keys (which live in `localStorage`), the GitHub token is never passed through the frontend, persisted to `localStorage`, or returned to the WebView.
- **No token leakage during the initial push** — the first push to a freshly created repo authenticates with the token injected through per-invocation `GIT_CONFIG_*` environment variables rather than the command line or `.git/config`. The credential never persists to the repository config and never appears in a process listing, while still guaranteeing the push succeeds even when no git credential helper is configured.
- **Hardened repo-creation inputs and errors** — repository names are validated against GitHub's character rules before any request, the publish flow refuses to act when an `origin` remote already exists (so it can't silently repoint an existing repo at a new empty one), and GitHub API failures are mapped to safe, specific messages (invalid token → 401, missing `repo` scope → 403, name already taken → 422) without echoing raw response bodies.

## [v0.2.3] - 2026-06-03

### Fixed

- **Release version metadata is now kept in sync** — the Tauri app version used by the native About screen and packaged release asset names is now aligned with the npm package version again. This resolves the bad `v0.2.2` release state where GitHub showed the `v0.2.2` tag but the generated installers and updater metadata were still stamped as `0.2.1`.
- **Version sync hook accepts this repo's changelog format** — the release helper now recognises changelog headings written as `[vX.Y.Z]` as well as `[X.Y.Z]`, preventing `npm version` from leaving `src-tauri/tauri.conf.json` behind when preparing a release.

## [v0.2.2] - 2026-06-03

### Added

- **Terminal pane display-title helpers** — three new exported functions in the terminal store:
  `getSessionPaneDisplayTitle` returns the agent-emitted pane title, falling back to the task summary and then to the role-based session label;
  `getSessionPaneSecondaryTitle` returns the task summary only when a distinct pane title is already shown, avoiding duplicate text;
  `getSessionDisplayName` combines the agent display name with the pane display title for use in pane headers and target labels.
- **Prompt-target label for agent sessions** — `getSessionPromptTargetLabel` shows the agent display name (e.g. `Claude Code`) for agent sessions, numbered when multiple instances of the same agent are running, giving clearer labels in the prompt bar's target picker and sent-toast messages.

### Changed

- **Terminal pane title area refactored** — the pane header now uses the dedicated `getSessionPaneDisplayTitle` and `getSessionPaneSecondaryTitle` helpers instead of inline `$derived` logic. The agent badge is rendered as a separate pill (`.pane-agent-badge`) before the main title, styled with a rounded accent-tinted background and a `132px` max-width. The old `.pane-title-main` class has been replaced.
- **Prompt bar target labels use the new helpers** — the floating prompt bar's target picker, target pill, and sent-toast messages now call `getSessionPromptTargetLabel` instead of `getSessionLabel`, so active agent sessions show the agent name instead of a generic session title.

## [v0.2.1] - 2026-06-03

### Added

- **CI build workflow** — the repository now includes `.github/workflows/build.yml` that runs on push and pull-request to `main` across Windows, macOS, and Linux. The pipeline typechecks the Svelte frontend, builds the Vite bundle, runs `cargo check` on the Tauri/Rust backend, and produces a debug build on every supported platform, keeping cross-platform regressions out of main.

### Changed

- **Preview toolbar reorganised into nav groups** — the device-toolbar controls have been split from a single flat `.nav-controls` into three logical groups: main navigation, utility actions, and viewport controls. The viewport divider that previously separated navigation from proxy/device controls has been removed, and the proxy button text is now wrapped in styled `<span>` elements so labels stay readable in cramped layouts. An obsolete `@container (max-width: 480px)` media query for `.preview-tabs` that conflicted with the restructured toolbar has also been removed.
- **Auxiliary panel default width increased** — the default `auxPanelWidth` has been raised from 500 px to 550 px for a more spacious right-panel experience. The new default is applied consistently across the layout store initial state, sanitisation/clamp bounds in the workspace store, and the project-restore fallback path.
- **Editor panel markdown toggle responsive layout** — the markdown preview toggle button now uses `white-space: nowrap` to keep its label on one line, and the editor panel has `container-type: inline-size` so a `@container (max-width: 480px)` query hides the button's text label and compacts its padding when the panel is narrow, preventing the toggle from overflowing the toolbar.
## [0.2.0] - 2026-06-03

### Added

- **Multi-provider AI model support** — the old OpenRouter-only AI flow has been replaced with a provider-based setup that supports OpenRouter, Anthropic, OpenAI, Google Gemini, Groq, Ollama, and LM Studio. Each provider now has its own configuration card in Settings, its own remembered model choice, and its own API-key or local-server configuration path.
- **Live model catalogues** — Settings can now fetch the live model list exposed by the selected provider instead of relying on a fixed allowlist. Cloud providers load the models your key actually unlocks, while local providers query their own OpenAI-compatible `/models` endpoint.
- **Local AI providers** — Ollama and LM Studio can now power voice refinement and AI commit-message generation through user-configurable local server URLs, without requiring a cloud API key.
- **File explorer multi-select** — the tree now supports standard explorer-style multi-selection: plain click selects one item, `Ctrl`/`Cmd` toggles individual items, and `Shift` selects a visible range. Delete actions deduplicate nested selections and remove the whole selection in one pass.
- **More built-in agent presets** — the prompt bar's spawn list now recognises `Oh My Pi` (`omp`) and `Cursor` (`agent`) alongside the existing agent commands.

### Changed

- **Settings → Models overhauled** — the AI & Voice settings area has been redesigned around provider cards, per-provider readiness states, live/curated catalog status pills, provider-specific key labels, and local-provider server URL management.
- **Voice refinement and AI commit messages now follow the selected provider** — both features use the active provider/model pair from Settings, retry other curated models from the same provider when appropriate, and no longer silently depend on OpenRouter.
- **AI key handling generalized** — provider keys are now stored per provider in `localStorage` as the app's primary store, with a best-effort mirror into the OS keychain. Existing OpenRouter keys migrate forward automatically.
- **Terminal pane titles are smarter** — agent panes now track a dedicated pane title, parse terminal-title escape sequences, and prefer actual response summaries over generic labels when deciding what to show in the floating pill header.
- **Aux panel sizing relaxed** — the right-hand auxiliary panel now defaults to `500px` wide instead of `700px`, and restored layouts are clamped with a much lower minimum width so compact layouts survive reopen/restore more gracefully.
- **Agent focus actions are more reliable** — terminal attention/focus actions now use an unconditional terminal-view helper, so jumping back to a waiting agent always lands on the terminal instead of toggling the previous aux panel back open.

### Fixed

- **File explorer click-away dismissal** — inline new-file/new-folder inputs, inline rename inputs, and the file-explorer context menu now dismiss cleanly when you click elsewhere. They no longer linger onscreen or implicitly confirm from a blur.
- **Agent conversation summaries in pane headers** — when an agent run completes, Soryq now flushes any buffered terminal output before finalizing the command block, summarizes the completed response, and writes that summary back into session state. This fixes panes getting stuck on generic project-folder titles like `Freedom` instead of the agent's actual conversation summary.
- **Pasted and injected image attachments under CSP** — prompt-bar image chips now decode `data:` URLs locally instead of trying to `fetch(dataUrl)`, which Chromium routed through `connect-src` and blocked. Images inserted from paste or preview capture now attach reliably under the app's CSP.
- **Source Control AI actions now respect provider configuration** — commit-message generation now shows the correct setup guidance for the selected provider, including missing local server URLs for Ollama and LM Studio.
- **Explorer selection state is cleaned up correctly across restores/resets** — workspace restore and full-store resets now rebuild and clear the multi-selection set consistently instead of only tracking the single active path.

### Security

- **Provider-aware request validation** — the Rust AI backend now validates provider IDs, local server URLs, and model IDs before sending requests, including stricter safeguards for URL-based local providers and Google models whose IDs are embedded in request paths.
- **Broader secret redaction** — backend error handling now redacts `sk-`, `sk-ant-`, `AIza`, and `gsk_` style credentials, and provider request errors are stripped of sensitive request URLs before they reach the frontend.
- **Safer Google provider requests** — Google API keys are now sent via headers instead of query-string URLs, reducing the chance of accidental key leakage through logs or surfaced transport errors.

## [0.1.9] - 2026-06-02

### Added

- **Attach images from the file picker** — picking an image through the prompt bar's attach-files dialog now adds it as a preview chip (the same thumbnails you get from pasting or drag-and-drop) instead of inserting a raw path string. The chip references the exact file on disk, so the agent reads the original image rather than a re-saved copy, and images can be attached even with no project open (only pasted images, which must be written to `.soryq/attachments`, still require one). Non-image files are still inserted as plain paths, now routed through the shared quoting helper so they're only quoted when the path contains spaces. Backed by `img-src blob:` in the Content-Security-Policy so the in-memory preview can render.
- **Wider image-format coverage** — the image detector and MIME mapping now recognise APNG, SVG, the `.jpe`/`.jfif` JPEG aliases, and `.cur` cursors, and pasted clipboard images map their MIME type to a clean file extension (so `image/svg+xml` saves as `.svg` instead of a mangled `svgxml`).

### Changed

- **Responsive title bar** — the centre breadcrumb is now a real flex item that shrinks and truncates with an ellipsis between the navigation and the right-hand controls, instead of being absolutely centred where it overlapped the search bar at medium window widths. As the window narrows the bar progressively condenses: the brand label and search hint trim first, then the note-taking trio (daily note, quick capture, scratchpad), then back/forward navigation and source control, leaving the essentials (home, sidebar toggle, search, settings, window controls) visible the longest. Every hidden action still has a keyboard shortcut, so nothing becomes unreachable.

## [0.1.8] - 2026-06-01

### Added

- **Image viewer in the editor** — opening an image file (PNG, JPG, GIF, WebP, BMP, ICO, AVIF, TIFF) now renders it in a dedicated viewer instead of loading raw bytes into the code editor. A metadata bar shows the file name, format, pixel dimensions, and file size, and the image sits on a checkerboard stage so transparency is visible. Backed by a new `fs_read_binary` Tauri command (capped at 50 MB) that streams the file into an in-memory object URL; editor files now carry a `kind` (`text` | `image`) and those URLs are revoked when the tab closes or the editor reloads so nothing leaks. Markdown preview, formatting, save, and the cursor/encoding readouts in the status bar are all suppressed for image tabs.

### Changed

- **Drag a terminal pane to split, not just swap** — dragging a pane by its title bar now drops it onto an edge (left, right, top, or bottom) of the pane under the cursor and inserts it there, rather than only swapping the two panes' positions. The drop target is chosen from where the cursor sits within the hovered pane, and column/cell percentages are renormalised so the grid stays balanced.
- **Layout picker fills every pane** — choosing a split layout now opens a live terminal in each newly revealed pane (using the project's starting directory) instead of leaving empty "Open terminal" placeholders; panes that already hold a session keep it.
- **Editor tab icons** — file-type tabs now show compact text badges (IMG / RS / TXT) in place of the previous emoji glyphs.

### Fixed

- **Closing a pane reclaims its space** — closing a terminal pane now removes its cell from the mosaic so the surrounding panes expand to fill the gap, instead of leaving a dead "Open terminal" placeholder behind. Emptied columns are dropped and the remaining panes rebalanced; the very last pane is always kept (reset to an empty placeholder) so the grid can never end up with zero panes.
- **Ghost panes when closing several terminals quickly** — `killSession` now updates the authoritative project state synchronously, before the asynchronous PTY teardown. Previously the slower teardown let a stale pane-assignment array re-broadcast, and the add-only mosaic reconcile would resurrect undismissable "Open terminal" placeholders when several panes were closed in quick succession.
- **Pasted image attachments** — images pasted into the prompt bar now get a unique name (timestamp plus a random suffix) with their real file extension, so simultaneous pastes can't collide or be misread by the agent. Saved paths are only quoted when they contain spaces (cleaner for agent TUIs than always single-quoting), and failures now surface an error toast — plus a warning when no project is open — instead of silently dropping the image.

## [0.1.7] - 2026-05-31

### Added

- **File explorer — inline new file / folder** — creating a file or folder now shows a focused inline input nested directly beneath the target folder, rather than a single input pinned to the workspace root. The target folder auto-expands so the input is visible, and the create state now lives in the explorer store so it behaves identically from the header buttons, the right-click context menu, and the keyboard. Confirm with Enter or by clicking away; cancel with Escape.
- **Native desktop notifications** — background notifications now go through the Tauri notification plugin (`@tauri-apps/plugin-notification`) instead of the WebView's `Notification` API, with the matching `notification:default` capability and Rust plugin registration. OS notifications are raised only when the app window is unfocused — when Soryq is in the foreground the in-app toast already covers it — and the granted permission is cached so the OS isn't re-queried on every toast.

### Fixed

- **File explorer — new files and folders appear instantly** — creating a file or folder no longer requires a manual refresh before it shows up in the tree. `refreshParent` and its path helpers normalised paths to forward slashes in some places but compared them against the OS's native backslash paths in others, so on Windows the in-place tree update silently matched nothing and the entry stayed hidden until a reload. Path comparisons are now separator-insensitive, and the parent folder is rebuilt in place (preserving the expansion state of any nested folders), so the new entry appears immediately.

## [0.1.6] - 2026-05-31

### Added

- **Frosted glass transparency (Warp-style)** — implemented a premium semi-transparent frosted glass aesthetic throughout the application. Users can adjust interface transparency using the global slider. All panels (Scratchpad, HTTP Client, Tasks, Run History, Merge/Review, Snapshots) and popups/menus (Workspace and Project Switchers, File Explorer context menu, Microphone Permission dialog, Command Palette, and Terminal panes/title bars) are now fully styled and aligned with this transparent aesthetic.
- **Opaque performance mode** — when the transparency slider is set to 0, transparency is completely disabled (using solid backgrounds and disabling all backdrop blurs) for maximum performance and legibility.
- **High-contrast readability tweaks** — automatically boosted secondary and muted text/icon color contrast and added a subtle readability-enhancing drop shadow to non-code text elements when transparency is enabled (excluding CodeMirror editors, xterm terminals, and Markdown code blocks to ensure text remain pixel-sharp).

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
