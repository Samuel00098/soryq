import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react({ include: '**/*.tsx' })],
  publicDir: 'static',
  resolve: {
    alias: {
      $lib: resolve('./src/lib'),
    },
    extensions: ['.ts', '.tsx', '.js'],
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      // `main` is the live React app (index.html). `pilot` is an isolated
      // harness for rendering components in a browser during migration checks.
      input: {
        main: resolve('./index.html'),
        pilot: resolve('./pilot.html'),
      },
      output: {
        // Split the largest third-party libraries into their own vendor chunks
        // so they stay cached across app-code changes and parse independently.
        // A vendor chunk is only fetched when something that imports it loads —
        // CodeMirror is used solely by the lazy editor, so its chunk stays
        // deferred; xterm rides with the (eager) terminal at first paint.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules[\\/](@codemirror|@lezer|@replit[\\/]codemirror|codemirror|codemirror-languageserver|vscode-languageserver)/.test(id)) {
            return 'vendor-codemirror';
          }
          if (id.includes('node_modules/@xterm') || id.includes('node_modules\\@xterm')) {
            return 'vendor-xterm';
          }
          if (/node_modules[\\/](marked|dompurify)/.test(id)) {
            return 'vendor-markdown';
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    // NOTE: COOP/COEP (cross-origin isolation) headers are intentionally NOT set
    // here. They would let Kokoro TTS run multi-threaded WASM (SharedArrayBuffer),
    // but cross-origin isolation BLOCKS cross-origin iframes that don't send their
    // own COEP header — which breaks the web preview (127.0.0.1 proxy) and YouTube
    // embeds (youtube-nocookie.com can't opt in). Kokoro already falls back to
    // single-threaded synthesis when not isolated (see kokoro-local.ts), so we
    // favour working web/YouTube embedding over a TTS speed-up. If multi-threaded
    // TTS is needed later, isolate a dedicated WASM host context instead of the
    // whole app document.
    // Ignore directories the app itself writes into at runtime. Without this,
    // spawning an orchestrator agent — which writes .soryq/orchestrator.json and
    // creates .soryq/worktrees/* (full repo copies) — trips Vite's file watcher
    // and triggers a full page reload of the app while you're dogfooding inside
    // the Soryq repo. .worktrees is the legacy location.
    watch: {
      ignored: ['**/src-tauri/**', '**/.soryq/**', '**/.worktrees/**'],
    },
  },
});
