/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional build-time override for the public site base URL.
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'prettier-plugin-svelte/browser';

declare module '*.css' {
  const content: string;
  export default content;
}
