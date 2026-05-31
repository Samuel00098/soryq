import { writable, get } from 'svelte/store';
import { notificationsEnabled } from './settings';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export const toasts = writable<Toast[]>([]);

// Cached permission state so we don't re-query the OS on every notification.
let permissionGranted = false;

/** Call once on app startup to prompt the user for notification permission. */
export async function requestNotificationPermission() {
  try {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      permissionGranted = (await requestPermission()) === 'granted';
    }
  } catch (err) {
    console.error('Failed to initialize notification permission:', err);
  }
}

async function showDesktopNotification(message: string, type: Toast['type']) {
  if (!get(notificationsEnabled)) return;

  // Only raise an OS notification when the app is in the background — if the
  // window is focused the in-app toast already tells the user everything.
  try {
    if (await getCurrentWindow().isFocused()) return;
  } catch {
    // If focus can't be determined, fall through and notify anyway.
  }

  try {
    if (!permissionGranted) {
      permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        permissionGranted = (await requestPermission()) === 'granted';
      }
    }
    if (!permissionGranted) return;

    const titles: Record<Toast['type'], string> = {
      error:   'Soryq — Error',
      warning: 'Soryq — Warning',
      success: 'Soryq — Done',
      info:    'Soryq',
    };

    sendNotification({ title: titles[type], body: message });
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

  toasts.update((list) => {
    const next = [...list, newToast];
    return next.length > 5 ? next.slice(next.length - 5) : next;
  });

  if (notifySystem) {
    void showDesktopNotification(message, type);
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
