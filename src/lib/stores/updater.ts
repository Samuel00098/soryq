import { writable } from '$lib/stores/storeCompat';
import { useUpdaterStore, type UpdateInfo } from './zustand/updater';

export type { UpdateInfo };

export const pendingUpdate = writable<UpdateInfo | null>(null);
export const updateChecking = writable(false);
export const updateDownloading = writable(false);
export const updateProgress = writable(0); // 0–100

// Sync with Zustand store
useUpdaterStore.subscribe((state) => {
  pendingUpdate.set(state.pendingUpdate);
  updateChecking.set(state.updateChecking);
  updateDownloading.set(state.updateDownloading);
  updateProgress.set(state.updateProgress);
});

export async function checkForUpdate() {
  await useUpdaterStore.getState().checkForUpdate();
}

export async function installUpdate() {
  await useUpdaterStore.getState().installUpdate();
}

