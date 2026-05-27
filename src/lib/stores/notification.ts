import { writable, get } from 'svelte/store';
import { notificationsEnabled } from './settings';

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export const toasts = writable<Toast[]>([]);

/** Call once on app startup to prompt the user for notification permission. */
export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function showDesktopNotification(message: string, type: Toast['type']) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (!get(notificationsEnabled)) return;
  if (Notification.permission !== 'granted') return;

  const titles: Record<Toast['type'], string> = {
    error:   'DevDock — Error',
    warning: 'DevDock — Warning',
    success: 'DevDock — Done',
    info:    'DevDock',
  };

  try {
    new Notification(titles[type], { body: message, silent: false });
  } catch (err) {
    console.error('Failed to show desktop notification:', err);
  }
}

export function showToast(
  message: string,
  type: Toast['type'] = 'info',
  duration?: number,
  notifySystem = false,
  action?: { label: string; onClick: () => void }
) {
  // Error toasts default to 6 seconds; other toasts default to 3 seconds
  const defaultDuration = type === 'error' ? 6000 : 3000;
  const actualDuration = duration ?? defaultDuration;

  // Prevent duplicate concurrent notifications of the same message and type
  const activeToasts = get(toasts);
  if (activeToasts.some((t) => t.message === message && t.type === type)) {
    return;
  }

  const id = Math.random().toString(36).substring(2, 9);
  const newToast: Toast = { id, message, type, duration: actualDuration, action };
  
  toasts.update((list) => [...list, newToast]);

  if (notifySystem) {
    showDesktopNotification(message, type);
  }
  
  if (actualDuration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, actualDuration);
  }
}

export function dismissToast(id: string) {
  toasts.update((list) => list.filter((t) => t.id !== id));
}
