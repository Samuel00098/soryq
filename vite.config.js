import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import svelteConfig from './svelte.config.js';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte(svelteConfig)],
  publicDir: 'static',
  resolve: {
    alias: {
      $lib: resolve('./src/lib'),
    },
    extensions: ['.svelte.ts', '.svelte.js', '.svelte', '.ts', '.js'],
  },
  clearScreen: false,
  build: {
    rollupOptions: {
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
    // Ignore directories the app itself writes into at runtime. Without this,
    // spawning an orchestrator agent — which writes .soryq/orchestrator.json and
    // creates .soryq/worktrees/* (full repo copies containing src/*.svelte) —
    // trips Vite's file watcher and triggers a full page reload of the app while
    // you're dogfooding inside the Soryq repo. .worktrees is the legacy location.
    watch: {
      ignored: ['**/src-tauri/**', '**/.soryq/**', '**/.worktrees/**'],
    },
  },
});
