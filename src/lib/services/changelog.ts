import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '$lib/utils/tauri';

const SITE_URL = (import.meta.env.VITE_SITE_URL ?? 'https://site-flame-phi.vercel.app').replace(/\/+$/, '');

export const CHANGELOG_URL = `${SITE_URL}/changelog`;

export async function openChangelogPage() {
  if (!isTauriRuntime()) {
    window.open(CHANGELOG_URL, '_blank', 'noopener,noreferrer');
    return;
  }

  await invoke('preview_open_in_browser', { url: CHANGELOG_URL });
}
