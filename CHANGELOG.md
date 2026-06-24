# Changelog

All notable changes to Soryq will be documented here.


## [v0.4.4] - 2026-06-24

This release is a large rebuild of the Soryq interface on React, with a new infinite-canvas workspace, on-device voice, and a substantially upgraded Sketch Canvas and Settings experience.

### Added

- **Infinite-canvas workspace** — the workspace is now an interactive, pan-and-zoom infinite canvas (the "gallery" layout) where editor, terminal, preview, and tool panels live as cards you arrange spatially rather than in fixed slots. It's the default layout and your choice persists. The canvas supports camera zoom/pan controls, cluster-based panel sizing, a 3-row grid auto-arrange that fits both dimensions, and a centred "reset layout" that re-fits everything in the viewport. `Ctrl+Alt+L` cycles the ambient layout mode.

- **Left utility drawer & right tool drawer** — the file explorer and Source Control now live in a slide-out left utility drawer, and the secondary tools (Toolbox, HTTP Client, Database, Containers) live in a right slide-over drawer instead of taking over the main view. DevPet and the YouTube panel are now free-floating overlays you can position over the workspace.

- **On-device offline voice** — local Kokoro (text-to-speech) and Parakeet (speech-to-text) models now run fully on your machine as in-browser WASM, no cloud round-trip required. The model downloader moved into the AI Models settings tab, and Cross-Origin Isolation headers are enabled to unlock multi-threaded WASM for fast local synthesis.

- **Voice personalities** — choose a customizable voice personality in Settings that's injected into the assistant's system prompt, with a voice preview button to hear each option before committing.

- **Custom terminal command shortcuts** — create your own named terminal command shortcuts in Settings and run them on demand.

- **Sketch Canvas overhaul** — multi-selection, grouping, deep selection, and proportional resizing; copy, paste, and duplicate for elements and whole drawings; image import (with high-quality smoothing and aspect-ratio lock during corner resize); multiple fonts and font-size selection; brush and eraser size presets; toggleable sharp/curved rectangle edges with an edge-radius slider; and a fixed custom stroke-colour picker. The renderer now matches the Excalidraw-style hand-drawn look across every shape.

- **Preview remembers more** — preview tabs, plus video and audio playback positions, now persist across project and workspace switches, and the preview panel stays mounted across layout changes so it doesn't reload.

- **Smarter Settings** — model dropdowns gain an interactive search/filter input and live catalog loading (including for the inline-completion provider), agents moved to a dedicated Settings tab with live model fetching, and you can hide preset agents you don't use while keeping your custom CLI agents.

### Changed

- **React interface rebuild** — the UI has been ported from Svelte to React, with a redesigned glassmorphic Settings modal (custom Dropdown components in place of native selects, interactive tab accents), a redesigned, centralized Welcome screen, a redesigned Assistant Orchestrator panel, and smooth global CSS View Transitions for layout and modal animations.

- **Voice mode lives in the prompt bar** — speaking/listening indicators are integrated directly into the floating prompt bar instead of a separate overlay, and the left-Alt key toggles voice mode.

- **Cleaner title bar** — the search bar and brand text were removed from the TitleBar, and the Settings icon now lives there.

- **Default local STT is Parakeet** — the default offline speech-to-text model is now Parakeet; the unimplemented Whisper path returns a clear error instead of failing silently.

- **Diff views consolidated** — inline and split diff views are now unified in the Review panel.

- **Workspace Snapshots hidden by default** — the Snapshots tab is off by default and can be re-enabled with a settings toggle; the sidebar room title now renames itself to match the active tab.

- **Version bumped to 0.4.4** — app metadata and native package metadata now point at v0.4.4.

### Fixed

- **Voice agent audio glitches** — fixed the VAD startup click/pop, inline-code being dropped from TTS, and `flushSync` lifecycle warnings; VAD speech detection was refined with a 0.025 RMS threshold and consecutive-frame validation to cut false triggers.

- **Terminal on Windows** — fixed resize truncation, optimised the fit debounce, corrected the canvas-addon loading lifecycle order, synced `windowsPty` options, and added a warning notification when PowerShell 7 is missing.

- **Layout & canvas stability** — resolved view-transition residue and layout-switch animation flicker via a global transition guard, fixed database tab switching, DevPet height queries, YouTube PIP resizing, duplicate-image double-rendering on the canvas, and a DevPet animation glitch on rapid clicks.

- **Settings scrolling** — contained Settings scrolling and disabled the elastic overscroll bounce, and the settings modal now positions correctly below the title bar.

## [v0.4.3] - 2026-06-16

### Fixed

- **Local dev previews no longer fail behind a VPN or system proxy** — previewing `http://localhost:…` could error with a TLS `BadRecordMac` or "localhost refused to connect" when a corporate/VPN proxy was active, because the loopback request was being routed through that proxy (your normal browser bypasses proxies for localhost, which is why it worked there). The preview now connects straight to your dev server.

- **Authentication-gated apps now load and let you sign in inside the preview** — apps that hand off to a hosted auth provider (Clerk, Auth0, NextAuth, Supabase, and similar) previously broke with a blocked frame or a connection error, because the provider's sign-in handshake bounced the page off the proxy to your raw dev origin, whose embedding policy then refused the frame. The preview now lets the browser perform the handshake itself and keeps the whole flow on the proxy origin (where embedding restrictions are stripped), so the app renders and the login round-trip completes.

- **Copy buttons work inside previewed apps** — clipboard access (used by things like the Next.js dev overlay) was blocked by the preview frame's permissions policy. The preview iframe now grants clipboard read/write, so in-app copy actions succeed instead of throwing.

### Changed

- **Version bumped to 0.4.3** — app metadata and native package metadata now point at v0.4.3.

## [v0.4.2] - 2026-06-15

### Added

- **New "Cream" light theme** — a warm, paper-like light theme that swaps the stark white background for a soft cream, so dark text reads with less glare and better contrast than on pure white. Available in Settings → Themes.

- **Preview remembers where you were** — the web preview now restores your per-page scroll position when you return to a page, and a new history dropdown (clock icon in the preview toolbar) lets you jump back to pages you've visited. Scroll positions and browsing history persist across sessions.

- **"Local & development previews work best" indicator** — the Web Preview empty state now makes clear it's built primarily for previewing your local dev server. External pages still open, but the copy sets expectations up front (many full websites block embedding and won't load in an embedded view), so trying to browse a normal site isn't a surprise.

### Changed

- **Graphite-grey brand refresh** — the accent palette moved from teal/sky to a calmer light graphite grey across the app's default light/dark themes, logo and icons, and the marketing site. On-disk custom themes built on the previous defaults are migrated once to the new palette (key-aware, so any colour you customised and the semantic `warning` colour are left untouched).

- **Voice refinement is now off by default** — the AI voice-refinement step starts disabled on fresh installs and after "Reset to default"; enable it in Settings if you want it.

- **App window icon follows the installed version** — the in-app logo's cache-buster is now tied to the app version, so the window/About icon refreshes correctly after an update instead of showing a stale image.

- **Faster marketing site** — removed per-frame shape re-rasterisation on the landing page's blurred background orbs (transform-only animation stays on the GPU) and batched the scroll-progress handler into a single rAF, smoothing out scroll lag.

### Fixed

- **Onboarding no longer re-appears after an abrupt shutdown** — the "onboarding completed" flag is now mirrored to a durable backend file (`app_flags.json`), because WebView2 flushes `localStorage` to disk lazily and could lose the write when the machine was switched off. On startup the flag is reconciled from the durable store, so the walkthrough stays dismissed once you've finished it.

- **Preview Back/Forward returns to the previous page, not the main menu** — in-page navigations (a site's own search box, pagination, local-dev route changes) are now recorded without reloading the iframe, so Back returns to the page you were actually on instead of jumping to the last typed URL or the blank placeholder. `PreviewTab` tracks the displayed `url` and the committed `loadUrl` separately.

- **DuckDuckGo search returns results again** — the preview's search and "Browse Web" button now use the server-rendered `html.duckduckgo.com/html/` endpoint. The main DuckDuckGo SPA fetches results over a cross-origin request the preview proxy can't serve, which left the results page blank.

- **Preview console panel captures local-dev logs from the first call** — the injected console hook no longer waits for a parent handshake before forwarding messages, so logs emitted during page load are captured instead of being dropped (which made the panel look empty). Console capture remains scoped to local-dev pages.

- **Terminal text stays readable in light mode** — in light themes the ANSI `white` and `bright-white` colors were mapped to near-white, so shell output drawn in those colors (e.g. command tokens like `cd`) rendered white-on-light and was invisible. They now map to dark, readable tones in light mode (dark themes are unchanged).

- **Settings no longer rubber-bands when scrolling** — taller Settings tabs used to overscroll past the top/bottom with an elastic "over-pull" bounce (and could chain the scroll to the page behind). The Settings body now contains its own scroll, so it stops cleanly at each edge.

- **Sketch Canvas rectangles honor the hand-drawn roughness** — rounded rectangles ignored the Pencil/Loose roughness and always rendered CAD-clean (the rounded-rect path used a no-op jitter hook), while circles, diamonds, and arrows were correctly sketchy. Rectangles now draw with the same perturbed double-stroke edges (keeping smooth rounded corners), so the Pencil style is consistent across every shape.

## [v0.4.1] - 2026-06-14

### Changed

- **Faster release-site experience** - optimized the landing page load path and runtime responsiveness.

- **Version bumped to 0.4.1** - app metadata, native package metadata, and release-site version references now point at v0.4.1.

### Fixed

- **Linux release build** - corrected the WebKitGTK `WebViewExt` import so the Linux AppImage build can compile preview screenshots successfully.

## [v0.4.0] - 2026-06-14

### Added

- **Update banner changelog link** - the signed update banner now includes a "View Changelog" action next to the inline "What's new" notes, opening the same public changelog page used by Settings.

### Changed

- **Apple Silicon-only macOS builds** - release and CI workflows now build macOS artifacts for Apple Silicon (`aarch64-apple-darwin`) only, alongside Windows and Linux.

- **Version bumped to 0.4.0** - app metadata, native package metadata, and release-site version references now point at v0.4.0.

### Fixed

- **Cross-platform CI typecheck script** - added the missing `npm run check` script expected by the Windows/macOS/Linux build workflow.

## [v0.3.9] - 2026-06-14

### Added

- **Type-aware code intelligence (LSP)** — the editor now offers real completion, diagnostics, and hover backed by language servers (rust-analyzer, typescript-language-server, pyright, gopls), bridged to CodeMirror over a single-use-token-authed loopback WebSocket. Servers are detected on PATH, with one-click install for the ones you're missing. On by default, per language.

- **AI ghost text ("Cursor Tab")** — faded inline code predictions you accept with Tab, powered by a dedicated fast completion provider/model (default Groq) chosen independently of your main AI provider. Opt-in (off by default) since it streams the surrounding code to the provider on each typing pause.

- **Custom CLI agents** — add your own coding-agent commands under Settings → Terminal and they become first-class citizens: they show up in the spawn picker, can be dispatched by the orchestrator (and get a friendly assistant name to address), are auto-detected and adopted when you type them into a plain shell, and receive the standing brief via CLAUDE.md / AGENTS.md when they read a rules file.

- **Language badges on editor tabs** — each tab shows a short, colour-coded language badge instead of a generic "TXT".

### Changed

- **Much faster startup** — the app used to ship as one ~4.5 MB JavaScript bundle. The editor (CodeMirror plus ~20 language packs), Settings, the Sketch Canvas, the preview, and every auxiliary panel now load on demand, cutting the startup bundle by ~40% so the shell and terminal paint sooner. The largest third-party libraries are split into their own vendor chunks.

- **Built-in browser searches with DuckDuckGo** — the preview's "Browse Web" button and the address-bar search fallback now use DuckDuckGo instead of Google, which serves a CAPTCHA wall through the local preview proxy and was effectively unusable in the embedded browser.

- **Cool teal/sky brand carries to saved themes** — on-disk custom themes built on the old amber defaults are migrated once to the new teal/sky palette. The migration is key-aware, so any value you customised is left untouched, and the semantic amber `warning` colour is deliberately preserved.

- **Cross-platform preview screenshots** — capturing the preview region now works via WKWebView (macOS) and WebKitGTK (Linux) in addition to WebView2 (Windows).

### Fixed

- **Terminal input is no longer silently dropped** — a stuck input gate on panes that weren't yet visible/attached (a background tab, or reattaching on app open) could swallow every keystroke. A timeout now guarantees input is re-enabled.

### Security

- **The preview proxy rejects cross-origin requests** — the loopback proxy now requires each request to carry no `Origin`, or a first-party one (loopback / `*.localhost`), so a page open in your normal browser can't drive the proxy to reach your dev server and other loopback services or use it as an SSRF request-forwarder. `Origin: null` (sandboxed / `data:` documents) is rejected too.

## [v0.3.8] - 2026-06-13

### Added

- **The orchestrator is now a full in-app assistant** — beyond dispatching coding agents, it can see and answer questions about the whole application (the active page, open editor files and cursor, unsaved changes, every terminal and what it's running, the preview URL, the git branch, and your run presets) and act on it directly: switch pages/panels, open files and jump to a line, point the preview at a route, run commands, and manage the task board. Actual code changes are still delegated to spawned agents.

- **Live content awareness** — the assistant also sees the contents of the file you're viewing, your current editor selection, and the recent output of every terminal (not just agents), so it can reason about the real code and what your processes are printing. File contents and selection are only shared while the editor is the focused view.

- **Manually-launched agents are adopted automatically** — when you start an agent CLI yourself by typing it into a terminal (e.g. `claude`, `codex`), the orchestrator now recognises it, tracks it as a running agent you can address by name, reads its output, and can send it follow-ups or close it — exactly like agents it spawned itself.

- **Clear preview cookies & cache** — a new preview-toolbar button (backed by the `preview_clear_browsing_data` command) clears the embedded preview's cookies, disk cache, cache storage, and service workers — handy when stale auth (e.g. a clock-skewed JWT) or cached assets break a local app. The app's own persisted state (settings, sketches) is deliberately left untouched. (Windows / WebView2.)

### Changed

- **Sketch Canvas grid and background follow the app theme** — in transparent and grid background modes the canvas grid, dots, and backdrop now read the active Soryq theme palette (and match it on export), and the canvas no longer stacks an opaque slab over the frosted wallpaper.

- **Embedded commands open their own terminal** — Arduino / PlatformIO / Raspberry Pi commands now run in a fresh, project-scoped terminal session instead of reusing whatever pane is focused, so they can't interrupt something you're already running.

- **Orchestrator memory tracks freshness** — remembered task summaries now carry an age / last-confirmed label and mark themselves stale once old, so the assistant weights recent work over old context.

- **About tab cleanup** — removed the redundant descriptive "Updates" note from the updater section.

### Fixed

- **Agents no longer spawn on top of a busy terminal** — clicking "+" to launch an agent (and orchestrator dispatch) now skips any pane running a detected dev server or build, opening a new pane instead of clobbering the running process. The reuse check previously relied only on an output-quiescence flag, so a server that had gone quiet read as an idle shell and got overwritten.

## [v0.3.7] - 2026-06-12

### Security

- **Provider keys never leave the OS keychain** — the frontend no longer reads or caches full AI provider API keys. The `provider_api_key_get` command is removed entirely; the UI now tracks only a configured / not-configured flag (`provider_api_key_exists`), and every AI request (orchestration, commit messages, voice input/refinement, TTS, model listing) sends an empty key while the backend resolves the real key from the keychain at call time. Settings copy is updated to say keys are kept in the OS keychain and never displayed back.

- **Write queries in the Database Explorer require explicit confirmation** — `db_execute_query` now takes an `allow_write` flag and rejects any non-`SELECT`/`PRAGMA`/`EXPLAIN` statement unless the user confirms it in the UI, so an accidental or injected `UPDATE`/`DELETE`/`DROP` can't run silently.

- **"Discard all changes" requires a confirmation token** — `workspace_git_discard_all` now only runs its `git reset --hard` + clean when the caller passes the literal `discard all changes` confirmation string, guarding the most destructive Source Control action against a stray invocation.

- **Terminals are confined to the open project** — new terminal sessions resolve their working directory through `resolve_terminal_cwd`, which canonicalises the path and requires it to live inside an open project folder. The old fallback that spawned shells in an arbitrary process-current directory is gone.

### Changed

- **Trust and scope cues across the workspace** — the Source Control, Review, Database Explorer, and Containers panels now show a "Project" scope note clarifying that their actions apply to the currently open project; the Preview toolbar gains a "Sandboxed preview" pill, the update banner shows a "signed release" badge, and Settings gains key-storage, active-project, secrets, network, and update security notes so it's clear what each surface can touch.

## [v0.3.6] - 2026-06-12

### Added

- **Containers panel** — a new Docker / Compose toolbox panel (its own activity-bar view) with one-click actions that run straight into a terminal session: check Docker & Compose availability, `compose up --build`, `compose down`, list running containers, and tail compose logs.

- **Orchestrator memory** — the agent orchestrator now keeps a per-project memory of completed work in `.soryq/orchestrator-memory.json`. Finished task summaries are remembered (capped at 40 entries, deduplicated), loaded when a project opens, and folded into the brain's context so follow-up requests build on what's already been done instead of starting cold.

- **Task-panel awareness for the orchestrator** — the brain now reads your Kanban board (In progress / To do / Done) as project truth. When you ask "what should I do next?" it recommends what to tackle and what can wait, prioritising in-progress work over the backlog, and dispatched agents receive a compact task-panel context block so they share the same picture without you re-explaining it.

- **Hand-drawn sketch rendering** — the Sketch Canvas gains a dependency-free "rough" renderer (`roughSketch`) for the Excalidraw-style sketchy look: perturbed double-stroke outlines and jittered hachure / cross-hatch fills, deterministic per shape so a drawing looks identical across redraws, zoom, and export.

### Changed

- **Sketch Canvas small-screen polish** — the canvas toolbar and controls reflow more gracefully on narrow windows, the native font picker is replaced with a custom styled font dropdown, and the settings popover z-index is fixed so it no longer renders behind other canvas chrome.

- **Tab strips no longer over-scroll** — a new `clampHorizontalScroll` action keeps horizontally scrollable strips (editor tabs and panel headers) pinned within their content bounds instead of drifting past the last item.

## [v0.3.5] - 2026-06-12

### Added

- **Dev Pet companion** — a gamified workspace companion (cat, slime, or robo) that levels up as you code. It earns XP and coins from characters typed and commits made, tracks your WPM, and reacts with status animations (typing, sleeping, committing, eating). State persists locally, and a new pet panel surfaces its level, inventory, and skins.

- **Custom backgrounds and live wallpapers** — set a workspace background image or a looping video wallpaper. The backend validates and stores a single background file with format allowlists (PNG/JPG/WebP/GIF/AVIF/etc. up to 10 MB, MP4/WebM/MOV/etc. up to 100 MB), and the new `BackgroundMedia` layer honours `prefers-reduced-motion` and pauses video when the window is hidden.

- **Embedded hardware panel** — a new toolbox panel for embedded workflows (Arduino, PlatformIO, Raspberry Pi) that runs common board commands straight into a terminal session.

- **Native agent rules-file delivery** — the standing agent brief is now written into the rules file each CLI reads on startup (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex / Cursor / OpenCode / Antigravity) inside a delimited managed block, instead of racing a bracketed paste into the live REPL. This removes the readiness heuristics and paste races that left the brief unregistered on Ink-style and first-run/trust-screen CLIs. Agents that don't read a rules file still fall back to the paste path.

### Changed

- **Settings overhaul** — the settings modal gains substantial new configuration surface across backgrounds, the dev pet, and workspace preferences.

- **Native desktop notifications** — notifications now route through a dedicated backend command for reliable click-to-focus behaviour.

## [v0.3.4] - 2026-06-11

### Added

- **Svelte, TOML, and C# syntax highlighting** — the editor now highlights `.svelte` files (via `@replit/codemirror-lang-svelte`), `.toml`, and `.cs`. C# files previously fell back to the C/C++ grammar; they now use a dedicated C# mode and are detected as their own language.

- **Format-on-save for more file types** — Prettier now handles `.svelte`, `.yaml`/`.yml`, `.scss`, `.less`, `.mjs`/`.cjs`, and `.htm` in addition to the existing JS/TS/JSON/CSS/HTML/Markdown set. The Svelte path loads the browser build of `prettier-plugin-svelte` alongside the embedded JS and CSS parsers.

### Fixed

- **Preview leaked the previous project's content on switch** — the shared preview proxy's target port is process-global, so mounting a project's preview iframes while the backend still pointed at the prior project's dev server piped the wrong app into the panel (and it stuck, because the iframe never re-requested once the port caught up). The proxy is now repointed at the incoming project's dev server *before* its tabs are restored or the panel is shown.

- **Agent TUI showed a stale frame after a project switch** — when a terminal pane reattaches to a still-running session, its fresh xterm fits to the size the PTY already has, so no resize event reaches the running full-screen TUI (e.g. the Claude Code agent) and it renders a stale frame until you manually drag to resize. The pane now reproduces that resize — briefly shrinking the PTY by one row and restoring it — to force an immediate repaint on reattach.

- **Saved pane layout clobbered when closing a project** — closing a project now switches the visible terminal state to the fallback project synchronously, before `restoreProjectState`, so `gridLayout` and `activeProject` update in the same effect flush and the fallback project's saved pane layout isn't overwritten by a stale preset re-apply. This mirrors the existing `switchToProject` / `openProjectByPath` ordering.

## [v0.3.3] - 2026-06-11

### Fixed

- **Preview screenshots came out blank on Windows** — capture now uses WebView2's native `CapturePreview` API instead of GDI `BitBlt`. GDI read the hardware-composited WebView2 surface as an all-black frame, so both full-preview screenshots and per-element captures produced empty images. The native path grabs the real rendered pixels and crops to the requested DOM rectangle.

- **"Add Element to Chat" closed the preview** — selecting an element in the preview (and the screenshot-to-prompt fallback) no longer switches to the terminal view, which was hiding the preview panel. The floating prompt bar overlays every view, so it is now simply focused while the preview stays open.

- **Deleting a folder didn't close its open files on Windows** — `onFileDeleted` now normalises path separators before matching, so editor tabs for files inside a removed directory are detected and closed regardless of `\` vs `/`.

- **Desktop notification clicks** — notifications now use the Web Notifications API with an `onclick` that shows and focuses the window, replacing the previous plugin `sendNotification`/`onAction` path.

### Changed

- **Agent charter prompt-injection hardening** — a spawned agent's task text is now wrapped in tamper-evident `<<<SORYQ_TASK … SORYQ_TASK>>>` delimiters, escaped so embedded text can't forge them, and explicitly labelled untrusted. A new "Injection Safety" rule instructs the agent to ignore any instruction inside the task that tries to override the brief, reveal secrets, change scope, or weaken the git/file safety rules.

- **New preview tab opens blank** — opening a new preview browser tab now starts at `about:blank` instead of the dev root, and `about:blank` is handled cleanly throughout URL normalisation and the iframe sandbox.

- **Charter delivery simplified** — removed the single-line compact-paste special case for Claude / OpenCode / Antigravity. Every agent now receives the charter through the standard bracketed-paste path.

- **Per-tab iframe registration** — preview iframes register through a Svelte action (`registerIframe`) instead of `bind:this` into a record, so each tab's element is tracked correctly as tabs are created, switched, and closed.

### Internal

- Backend-wide `cargo fmt` and Clippy cleanup across the command, preview proxy, PTY, theme, and workspace modules — formatting and lint fixes only, no behaviour change.

- Expanded unit-test coverage for the editor, preview, terminal, and agent-charter stores.

## [v0.3.2] - 2026-06-11

### Added

- **Agent Charter** — every spawned agent now receives a standing operating brief the moment it starts. The brief enforces scope (do only the assigned task, note unrelated issues rather than fixing them), git safety rules (no destructive commands, no branch-switching, no force-push, commit only your own files), and execution discipline (begin immediately, verify before done, end with a summary). This prevents agents sharing a workspace from clobbering each other's edits or wandering outside their task.

- **Voice overlay compact mode** — `VoiceConversationOverlay` gains a `compact` prop that renders it as a small docked panel above the floating bar rather than a full-screen takeover, so the workspace stays visible while you talk.

- **Voice conversation mode in the orchestrator brain** — `routeOrchestratorRequest` now accepts a `conversational` flag. When set, the brain defaults to chatting (empty actions) and only dispatches agents when you explicitly say so ("open an agent and…", "spawn Claude to fix…"). Running agents' recent terminal output is surfaced in replies so status questions get useful answers. The LLM system prompt gains a dedicated voice-mode section reinforcing the same bias.

- **Idle agent spawn** — saying "open Claude" or "spawn an agent" without a real task now opens a ready terminal without inventing a meaningless task prompt for the agent. `EXPLICIT_SPAWN_RE` distinguishes idle-open from task-dispatch intents.

- **Background-project session exit tracking** — a new `onSessionExit` broadcast in `terminal.ts` fires for every session exit in every project, not just the active one. The orchestrator subscribes to it so an agent that exits while its project is in the background is reconciled immediately, instead of being stranded in-progress until the user reopens that project.

- **TTS chunked streaming** — `speak()` splits text into sentence-level chunks and plays them in a pipeline: the first chunk (≤140 chars) begins playing the moment it is synthesised, while the rest are synthesised in the background. This dramatically reduces time-to-first-audio on long replies. A per-call `speakToken` ensures a superseded or cancelled pipeline tears down cleanly without lingering audio.

### Changed

- **Agent mode on by default** — the floating prompt bar now opens in agent mode (`isAgentMode` defaults to `true`), so it is always ready for an orchestrator message without an extra click.

- **Voice overlay positioning and appearance** — the overlay now uses `position: fixed` (was `position: absolute`) and sits below the title bar so window controls remain reachable. The background switches to a translucent glass effect (`backdrop-filter: blur`) so the workspace stays faintly visible behind it.

- **Agent Command Center simplified** — the task management panels (running / blocked / in-review task lists, approve/reject controls, agent picker) are removed from the Agent Command Center. It now focuses purely on the conversational chat interface.

- **Prompt delivery timeout extended** — `PASTE_SUBMIT_MAX_WAIT_MS` raised from 2 500 ms to 6 000 ms so slow-starting TUI agents (Ink/React REPLs) are not short-circuited. Test-environment timing constants stay fast.

- **Spawn UI reset on project switch** — `spawnOpen` and `spawnCounts` are reset when the active project changes so stale spawn state from a previous project never leaks into the new one.

### Removed

- **Per-task git worktrees** — `workspace_git_worktree_create` and `workspace_git_worktree_remove` Rust commands removed; `worktree-manager.ts` and its tests deleted. The Agent Charter's scope and git rules replace isolation at the filesystem level: agents coordinate by convention rather than by being locked to separate trees.

- **`in-review` task status** — the intermediate review gate is gone. Tasks transition directly from `in-progress` to `complete`, `failed`, or `blocked`. Legacy persisted `in-review` tasks are normalised to `todo` on load.

- **`ExecutionMode` (`direct` / `worktree`)** — removed from task records, `createTaskRecord`, and `createOrchestratorTask`. `inferExecutionMode()` removed along with it.

- **`approveTask()` / `requestTaskChanges()`** — task review/approval functions and their UI controls removed.

- **`OrchestratorWorktree` / `OrchestratorReviewState` types** — removed from the task model.

- **Broadcast-to-all-agents mode** — the floating bar's "broadcast" toggle (send one message to every running agent at once) removed.

## [v0.3.1] - 2026-06-09

### Added

- **Project-wide search (Ctrl+Shift+F)** — a new `Search` tab in the sidebar (`SearchPanel`) finds text across every open project root. Searches honour `.gitignore` (but never descend into `.git`), support case-sensitive, whole-word, and regular-expression modes, and take an optional comma-separated include-glob filter (e.g. `*.rs, src/**/*.ts`). Results are grouped by file with line/column positions. Backed by a new Rust `search_in_project` command built on the `ignore` walker, with caps on file size (2 MB), per-file matches (200), total matches (5 000), and line length (500 chars) so a pathological query can't lock up the UI.

- **Environment variable manager (Ctrl+Shift+E)** — a new `EnvManager` overlay stores per-project environment variables in the OS keychain (namespaced by project id under the same `com.samue.soryq` service as the AI and GitHub secrets). Variables can be added, edited, removed, or imported in bulk from the project's root `.env` file. Backed by new Rust commands `env_vault_get`, `env_vault_set`, and `env_vault_import_dotenv`, with variable-name validation and a minimal `.env` parser (handles `export`, `#` comments, and quoted values).

- **HTTP Client variable substitution** — requests now expand `{{VAR}}` placeholders from the active project's environment vault in the URL, headers, and body before sending. Unknown placeholders are left intact so a typo is visible rather than silently blanked.

- **Inline diff viewer in Source Control** — every changed file in the Source Control panel gains a hover "View diff" button that opens a `DiffViewer` overlay for that file, instead of having to open it in the editor.

- **Merge-conflict resolution** — `workspace_git_status` now reports a separate `conflicted` list (unmerged paths: any `U` state plus the both-added/both-deleted cases), shown in Source Control with a `!` badge. A new `workspace_resolve_conflict` command collapses each conflict block in a file to a single side — "ours", "theirs", or "both" — then stages the result so Git treats the conflict as handled.

### Changed

- **Responsive Welcome screen** — the welcome screen's three-column layout now narrows its side rails before collapsing, uses fluid `clamp()`-based padding/gaps/heights, and progressively reflows to two columns, then one, then a compact phone layout (with the daily-notes and shortcuts rails sitting side by side at intermediate widths). The whole page scrolls instead of clipping on small windows.

- **Responsive HTTP Client panel** — the panel now drives its internal layout off its own width (`container-type: inline-size`) rather than the viewport, shrinking the saved-request rail in steps and collapsing it entirely below ~340 px so the request editor is never clipped inside a narrow aux panel.

- **Command palette height** — capped at `min(400px, 70vh)` so it never overflows short windows.

### Fixed

- **Aux panel no longer clipped on smaller windows** — the auxiliary-panel max-width clamp under-reserved horizontal space, cutting the panel off on the right at smaller window sizes. The calculation now reserves the terminal's minimum width plus the surrounding chrome (app-body padding, inter-panel gaps, and resize handles) through a single shared `auxMaxWidth()` helper used by both the clamp effect and the drag handler. The width effects also bail out for very narrow or hidden windows to avoid spurious reclamps.

- **API-key cache isn't poisoned by a startup read error** — `initApiKeyCache` no longer caches `null` for a provider whose key failed to read at startup. The provider is left absent from the cache so `providerApiKeyExists` falls through to a live keychain query instead of incorrectly reporting "no key".

### Security

- **HTTP Client blocks SSRF to link-local and cloud-metadata addresses** — `http_send_request` now rejects requests whose host is, or resolves to, a link-local or cloud-metadata address (notably the `169.254.169.254` IMDS endpoint and the `metadata.google.internal` / `metadata.goog` hostnames), including IPv6 link-local and IPv4-mapped forms. The check runs on the initial URL and is re-evaluated on every redirect hop, so a redirect can't smuggle the request to a blocked address. Loopback and private ranges stay allowed on purpose (hitting your own dev server is the point).

- **HTTP Client caps response size** — response bodies are now streamed in chunks and aborted once they exceed 50 MB, so an oversized or never-ending response can't exhaust memory.

- **Destructive SQL queries require confirmation** — the Database Explorer now warns and asks for confirmation before running a `DROP`, `TRUNCATE`, or a `DELETE`/`UPDATE` with no `WHERE` clause. Line comments are stripped before the check so a commented-out `WHERE` can't mask a full-table mutation.

- **Environment vault is keychain-only** — project environment variables are stored exclusively in the OS keychain, never written to `localStorage` or the project folder, and variable names are validated (letters, digits, underscores, not starting with a digit) before being saved.

## [v0.3.0] - 2026-06-08

### Added

- **Agent Command Center** — a new conversational AI panel (the Agents tab) powers project-wide chat with AI agents. Messages go through the orchestrator and replies stream back in a thread view. The floating prompt bar gains an "Agent mode" button that switches it from a terminal-command dispatcher to a conversational input for the command center, with its own send/cancel flow and a live preview of the last assistant reply.

- **Voice conversation loop** — activating voice mode in Agent mode opens a full conversational loop: voice is captured and transcribed (Google or OpenRouter), sent to the active agent, and the response is read back via TTS. The loop auto-continues after each reply. A new animated overlay shows the speaking/listening state, and stop controls halt both TTS playback and the mic.

- **TTS backend** — `tts_speak` synthesises speech from text using the selected provider (OpenRouter, Groq, OpenAI, Google, or any local OpenAI-compatible server). Google audio is decoded from raw PCM and re-wrapped into a standard WAV container server-side; all other providers return their native format. A 4 096-character cap prevents accidental large requests.

- **Audio transcription backend** — `ai_transcribe_audio` transcribes recorded audio using Google or OpenRouter's transcription APIs, with per-provider validation and secret redaction before errors reach the frontend.

- **Database Explorer** — a new `db` panel in the right rail lists every SQLite database detected in the open project, lets you browse tables, and run arbitrary SQL queries with a full column/row results viewer. Backed by new Rust commands (`db_list_tables`, `db_execute_query`) using the bundled `rusqlite` dependency.

- **Dev Toolbox** — a new `toolbox` panel in the activity bar, grouping developer utility tools in one place.

- **Terminal Snippets sidebar** — a new `Snippets` tab in the left sidebar (`TerminalSnippetsPanel`) for managing and inserting reusable shell snippets.

- **Sketch Canvas** — a freehand drawing overlay toggled from the bottom of the activity bar, for quick scratch diagrams alongside the workspace.

- **Activity Bar** — the left rail is now a permanent activity bar with icon buttons for every sidebar tab (Files, Source Control, Snapshots, Snippets) and every right-panel view (Editor, Terminal, Preview, Code Review, HTTP Client, Tasks, Database, Toolbox). Clicking an already-active sidebar tab closes it. Clicking an active aux view toggles it off and returns to terminal.

- **Git worktrees** — two new Rust commands (`workspace_git_worktree_create`, `workspace_git_worktree_remove`) for creating and pruning Git worktrees from within the app.

- **Recent Daily Notes** — `workspace_get_recent_daily_notes` surfaces recently edited per-project daily note files for display in the welcome screen and navigation.

- **`check_local_provider_online`** — probes local AI provider servers (Ollama, LM Studio) with a 500 ms timeout; Ollama falls back from the `/v1/models` path to the native `/api/tags` endpoint when the OpenAI-compatible route isn't reachable.

- **`provider_api_key_get` command** — complements `provider_api_key_exists` with an actual key-read command, used by the keychain cache system.

- **`ai_complete` command** — generic Tauri command for direct prompt completions outside the voice and commit-message flows.

- **HTTP Client requests moved to Rust** — the HTTP Client panel now sends requests through `http_send_request` in the Rust backend instead of `fetch()` in the WebView, eliminating CORS errors and allowing requests to any URL regardless of the app's Content-Security-Policy.

- **Navigation history store** — `initNavigationHistory` initialises browser-style back/forward history for the preview panel.

- **`VoiceInputProviderId` type** — `'webspeech' | 'google' | 'openrouter'` for the voice-input provider setting.

### Changed

- **AI API keys moved from localStorage to OS keychain** — `ai-keychain.ts` is fully rewritten around an in-memory cache backed by the OS keychain. On startup the app migrates any keys still in `localStorage` to the keychain and populates the cache; all subsequent reads are synchronous Map lookups with no IPC round-trip. The old pattern — localStorage as primary store, keychain as mirror — is reversed. Keychain is now authoritative.

- **Background images served via asset protocol** — background images are no longer base64-encoded over IPC. The Rust backend now returns the stored file path; the frontend converts it to a webview-safe URL using `convertFileSrc`. This removes large IPC payloads, drops the base64 encode/decode overhead, and makes image loads faster.

- **`setSidebarTab` opens the sidebar** — calling `setSidebarTab` now also sets `sidebarVisible: true`, so switching tabs programmatically always makes the result visible.

- **`toggleSidebarTab` added** — closes the sidebar when the given tab is already active, or switches to and opens it otherwise. The activity bar uses this for all sidebar-tab buttons.

- **Layout state extended** — `LayoutState` gains `orchestratorVisible`, `dbVisible`, and `toolboxVisible` booleans. All existing toggle functions (`setActiveView`, `showTerminal`, `toggleTerminal`, `toggleEditorVisible`, etc.) are updated to clear the new flags when switching views so only one aux panel is ever visible.

- **Provider definitions carry `ttsSupport`** — `AiProviderDef` now includes an optional `ttsSupport` field (`'native' | 'self-hosted' | 'none'`) indicating TTS support. OpenRouter is marked `'native'`.

- **App startup hardening** — the config-directory creation now uses `expect` to surface failures immediately instead of silently ignoring them, and the main webview window retrieval uses a proper `None` guard that returns an error rather than an unwrap panic.

### Fixed

- **Interface transparency migration** — users whose transparency was silently reset to `0` by the opaque-default change in v0.2.5 have it automatically restored to `50` on next launch, gated by a one-time `forge_setting_interfaceTransparency_migrated_v1` marker in `localStorage`.

### Security

- **API keys are keychain-only** — keys are never written to `localStorage` as a primary store. The in-memory cache is populated from the OS keychain at startup; `localStorage` is only touched during the one-time migration and is cleared afterward.

- **HTTP Client bypasses WebView CSP safely** — routing HTTP Client requests through the Rust backend keeps the app's Content-Security-Policy tight (no wildcard `connect-src`) without blocking any developer tool requests.

- **Database queries are project-scoped** — `db_list_tables` and `db_execute_query` call `require_in_project` before opening any SQLite connection, preventing the panel from accessing databases outside the open project roots.

## [v0.2.5] - 2026-06-04

### Changed

- **Interface starts opaque by default** — the `interfaceTransparency` default (used by fresh installs and "Reset to default") is now `0` instead of `50`, so Soryq launches in the solid-background, blur-disabled performance mode out of the box. Existing users keep whatever transparency level they've already set; only new profiles and explicit resets are affected.
- **Release builds publish on tag push** — the release workflow now triggers automatically on a tag push and is pinned to npm. `bun.lock` was removed so `tauri-action` no longer auto-detects Bun (which the CI runners don't install), and `tauriScript` explicitly invokes npm so the release build matches the `npm ci` / `npm run build` path used everywhere else.

### Fixed

- **Agent detection keys off the executable, not any word in the line** — terminal agent-preset detection no longer regex-scans the whole command for an agent keyword. It now extracts the basename of the executable actually being launched — skipping a leading PowerShell call operator (`&`), env-var assignments (`FOO=bar codex`), and launcher prefixes (`npx`, `bunx`, `pnpx`, `sudo`, `command`, `exec`, `time`, `nice`), then stripping any path and Windows extension (`.exe`/`.cmd`/`.bat`/`.ps1`) — and matches that against each preset's known executable names. This fixes commands like `omp agent …` being misattributed to Cursor's bare `agent` CLI, and adds recognition for the `agy` (Antigravity) and `cursor-agent`/`cursor` executables.

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
