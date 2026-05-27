# Soryq

**A lightweight, terminal-first developer workspace for professionals who move fast.**

Soryq is a cross-platform desktop application that combines a real PTY terminal, a CodeMirror code editor, a live web preview proxy, and git integration — all in a single, keyboard-driven window. Built with Tauri 2 (Rust) and Svelte 5, it stays lean: no Electron, no Node.js runtime, no background cloud services.

---

## Screenshots

> _Screenshots coming soon. Contributions welcome._

---

## Key Features

- **Multi-pane Terminal** — Full PTY sessions with xterm.js, configurable layouts (1/2/3/4/9 panes), and automatic shell detection per platform
- **Code Editor** — CodeMirror 6 with syntax highlighting for 15+ languages, Vim mode, minimap, format-on-save, and word wrap
- **Live Preview Proxy** — Built-in HTTP/WebSocket proxy that routes your local dev server through a managed port; injects the DOM inspector automatically
- **DOM Inspector** — Click any element in the preview panel to inspect its tag, CSS selector, computed styles, attributes, and ancestor path
- **Git Integration** — View status, staged/unstaged diffs, commit history (with graph), commit, push, fetch, and discard changes — all without leaving the app
- **File Explorer** — Full project tree with create, rename, delete, copy, and hidden-file toggle
- **Workspaces** — Named workspaces with multiple open projects per workspace; recent workspace list on the welcome screen
- **Floating Prompt Bar** — Keyboard-driven command input bar that floats above the terminal; drag-and-drop files to attach paths
- **Themes** — Several built-in preset themes plus a fully custom theme editor with import/export
- **Keyboard Shortcuts** — All actions are fully configurable; record new bindings with a single keypress
- **Codebase Search** — Full-text search across all project files from the title bar, with 200 ms debounce
- **Sidebar Panels** — Files, Source Control, Tasks, Notes, Quick Run, and Workspace Snapshots
- **UI Zoom** — Global scaling from the keyboard; state persisted across sessions

---

## Tech Stack

![Tauri](https://img.shields.io/badge/Tauri-2-blue?logo=tauri)
![Rust](https://img.shields.io/badge/Rust-2021-orange?logo=rust)
![Svelte](https://img.shields.io/badge/Svelte-5-red?logo=svelte)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)
![CodeMirror](https://img.shields.io/badge/CodeMirror-6-green)
![xterm.js](https://img.shields.io/badge/xterm.js-5-black)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Backend language | Rust (2021 edition) |
| Frontend framework | Svelte 5 |
| UI language | TypeScript 5.6 |
| Code editor | CodeMirror 6 |
| Terminal renderer | xterm.js 5 |
| PTY | `portable-pty` crate |
| Preview proxy | Axum 0.8 + reqwest 0.13 |
| Build tool | Vite 5 |

---

## System Requirements

| Platform | Minimum Version | Notes |
|---|---|---|
| Windows | Windows 10 (build 1903+) | Windows 11 recommended; WebView2 required (bundled by Tauri) |
| macOS | macOS 11 (Big Sur) | Universal binary (Intel + Apple Silicon) |
| Linux | Ubuntu 22.04 / Fedora 37+ | GTK 3 + WebKit2GTK required |

Soryq has a minimum window size of **960 x 640 px**.

---

## Installation

### Download a release binary

Pre-built installers for Windows (`.msi`), macOS (`.dmg`), and Linux (`.AppImage` / `.deb`) will be available on the [Releases](../../releases) page.

### Build from source

See **[docs/BUILDING.md](docs/BUILDING.md)** for full instructions.

Quick start for experienced Tauri developers:

```bash
git clone https://github.com/Samuel00098/soryq.git
cd soryq
npm install
npm run tauri dev
```

---

## Quick Start

1. **Open Soryq.** The Welcome Screen shows your recent workspaces.
2. **Create a new workspace** (`Ctrl+N`) or open an existing folder (`Ctrl+O`).
3. **Work in the terminal.** One or more PTY sessions open automatically in your project directory.
4. **Open a file** from the sidebar Files tab to launch the code editor alongside the terminal.
5. **Start the preview proxy** (`Ctrl+Alt+P`) and navigate to your dev server port to see a live preview with the DOM inspector.
6. **Commit and push** from the Source Control sidebar tab or the git button in the title bar.

---

## Documentation

| Document | Description |
|---|---|
| [docs/FEATURES.md](docs/FEATURES.md) | Detailed guide to every feature |
| [docs/BUILDING.md](docs/BUILDING.md) | Building from source, project structure, architecture |
| [docs/SECURITY.md](docs/SECURITY.md) | Security model, capability restrictions, data storage |

---

## Contributing

Pull requests are welcome. For large changes, open an issue first to discuss the approach.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Follow the build instructions in [docs/BUILDING.md](docs/BUILDING.md)
4. Run `npm run check` before submitting
5. Open a pull request with a clear description

---

## License

MIT — see [LICENSE](LICENSE) for details.
