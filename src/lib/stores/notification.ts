import { writable } from '$lib/stores/storeCompat';
import { useNotificationStore, type Toast, requestNotificationPermission } from './zustand/notification';

export { requestNotificationPermission };

export const toasts = writable<Toast[]>([]);

// Keep the writable in sync with the Zustand store
useNotificationStore.subscribe((state) => {
  toasts.set(state.toasts);
});


export function showToast(
  message: string,
  type: Toast['type'] = 'info',
  duration?: number,
  notifySystem = false,
  action?: { label: string; onClick: () => void }
) {
  useNotificationStore.getState().showToast(message, type, duration, notifySystem, action);
}

export function dismissToast(id: string) {
  useNotificationStore.getState().dismissToast(id);
}
