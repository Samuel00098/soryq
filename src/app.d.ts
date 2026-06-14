/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional build-time override for the public site base URL (no trailing
  // slash needed). Lets the in-app "View Changelog" link follow a custom domain
  // without code edits. Falls back to the live production URL when unset.
  readonly VITE_SITE_URL?: string;
}

declare module '*.css' {
  const content: string;
  export default content;
}

declare module 'prettier-plugin-svelte/browser';
