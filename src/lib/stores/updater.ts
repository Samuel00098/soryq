import { writable } from 'svelte/store';

export interface UpdateInfo {
  version: string;
  body: string | null;
}

export const pendingUpdate = writable<UpdateInfo | null>(null);
export const updateChecking = writable(false);
export const updateDownloading = writable(false);
export const updateProgress = writable(0); // 0–100

export async function checkForUpdate() {
  updateChecking.set(true);
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (update?.available) {
      pendingUpdate.set({ version: update.version, body: update.body ?? null });
    }
  } catch {
    // Silently ignore — no network, no update server, dev mode, etc.
  } finally {
    updateChecking.set(false);
  }
}

export async function installUpdate() {
  const { check } = await import('@tauri-apps/plugin-updater');
  const { relaunch } = await import('@tauri-apps/plugin-process');

  updateDownloading.set(true);
  updateProgress.set(0);

  try {
    const update = await check();
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

    await relaunch();
  } catch (e) {
    console.error('Update install failed:', e);
  } finally {
    updateDownloading.set(false);
  }
}
