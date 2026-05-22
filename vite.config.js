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
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
