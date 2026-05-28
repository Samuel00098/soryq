import { writable } from 'svelte/store';
import type { Update } from '@tauri-apps/plugin-updater';

export interface UpdateInfo {
  version: string;
  body: string | null;
}

export const pendingUpdate = writable<UpdateInfo | null>(null);
export const updateChecking = writable(false);
export const updateDownloading = writable(false);
export const updateProgress = writable(0); // 0–100

let cachedUpdate: Update | null = null;

export async function checkForUpdate() {
  updateChecking.set(true);
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    cachedUpdate = update ?? null;
    if (update?.available) {
      pendingUpdate.set({ version: update.version, body: update.body ?? null });
    } else {
      pendingUpdate.set(null);
    }
  } catch {
    cachedUpdate = null;
    pendingUpdate.set(null);
    throw new Error('Failed to check for updates');
  } finally {
    updateChecking.set(false);
  }
}

export async function installUpdate() {
  const { relaunch } = await import('@tauri-apps/plugin-process');

  updateDownloading.set(true);
  updateProgress.set(0);

  try {
    const update = cachedUpdate;
    if (!update?.available) return;

    let downloaded = 0;
    let total = 0;

    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        if (total > 0) updateProgress.set(Math.round((downloaded / total) * 100));
      } else if (event.event === 'Finished') {
        updateProgress.set(100);
      }
    });

    pendingUpdate.set(null);
    await relaunch();
  } catch (e) {
    console.error('Update install failed:', e);
  } finally {
    updateDownloading.set(false);
  }
}
