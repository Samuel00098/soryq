import { create } from 'zustand';
import type { Update } from '@tauri-apps/plugin-updater';

export interface UpdateInfo {
  version: string;
  body: string | null;
}

interface UpdaterState {
  pendingUpdate: UpdateInfo | null;
  updateChecking: boolean;
  updateDownloading: boolean;
  updateProgress: number;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

let cachedUpdate: Update | null = null;

export const useUpdaterStore = create<UpdaterState>((set) => ({
  pendingUpdate: null,
  updateChecking: false,
  updateDownloading: false,
  updateProgress: 0,

  checkForUpdate: async () => {
    set({ updateChecking: true });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      cachedUpdate = update ?? null;
      if (update?.available) {
        set({ pendingUpdate: { version: update.version, body: update.body ?? null } });
      } else {
        set({ pendingUpdate: null });
      }
    } catch {
      cachedUpdate = null;
      set({ pendingUpdate: null });
      throw new Error('Failed to check for updates');
    } finally {
      set({ updateChecking: false });
    }
  },

  installUpdate: async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');

    set({ updateDownloading: true, updateProgress: 0 });

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
          if (total > 0) set({ updateProgress: Math.round((downloaded / total) * 100) });
        } else if (event.event === 'Finished') {
          set({ updateProgress: 100 });
        }
      });

      set({ pendingUpdate: null });
      await relaunch();
    } catch (e) {
      console.error('Update install failed:', e);
    } finally {
      set({ updateDownloading: false });
    }
  },
}));
