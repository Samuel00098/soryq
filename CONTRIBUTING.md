# Contributing to Soryq

Thanks for taking the time to contribute! Whether it's a bug report, a feature idea, or a pull request — all contributions are welcome.

## Reporting bugs

Open an issue and include:
- What you were doing when the bug happened
- What you expected vs what actually happened
- Your OS and Soryq version
- Any error messages or screenshots

## Suggesting features

Open an issue with the `enhancement` label. Describe the problem you're trying to solve, not just the solution — it helps a lot with discussion.

## Pull requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Make sure `npm run check` passes (Svelte type-check)
4. Make sure `cargo test` passes (Rust unit tests)
5. Open a pull request with a clear description of what you changed and why

### Dev setup

**Prerequisites:** Node.js 20+, Rust (stable), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/Samuel00098/soryq.git
cd soryq
npm install
npm run tauri dev
```

### Project structure

```
src/                  # Svelte 5 frontend
src-tauri/            # Rust backend (Tauri commands)
src-tauri/src/commands/   # All Tauri IPC commands
src/lib/components/   # UI components
src/lib/stores/       # Svelte stores (app state)
src/lib/services/     # Frontend services (voice, keychain, etc.)
```

## Code style

- Rust: standard `rustfmt` formatting (`cargo fmt`)
- TypeScript/Svelte: Prettier defaults
- Keep commits focused — one logical change per commit

## Licence

Soryq is proprietary software (see [LICENSE](LICENSE)). By contributing, you assign all right, title, and interest in your contributions to the copyright owner, Samuel Solesi, and agree they may be used under the project's proprietary terms.
