import { isTauriRuntime } from '$lib/utils/tauri';

/**
 * Thin wrapper over the backend `app_flag_*` commands, which persist small
 * one-time flags to a JSON file on disk. Unlike WebView `localStorage` (flushed
 * lazily, so recent writes can vanish on an abrupt shutdown), this is written
 * through immediately and survives — use it as the durable source of truth for
 * flags whose loss is user-visible, e.g. "onboarding completed".
 */

export async function getAppFlag(key: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string | null>('app_flag_get', { key })) ?? null;
  } catch {
    return null;
  }
}

export async function setAppFlag(key: string, value: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('app_flag_set', { key, value });
  } catch {
    // Best-effort: localStorage still holds the value for this session.
  }
}
