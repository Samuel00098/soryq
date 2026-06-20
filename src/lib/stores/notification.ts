import { writable, get } from '$lib/stores/storeCompat';
import { notificationsEnabled } from './settings';
import {
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useNotificationStore, type Toast } from './zustand/notification';

export const toasts = writable<Toast[]>([]);

// Keep the writable in sync with the Zustand store
useNotificationStore.subscribe((state) => {
  toasts.set(state.toasts);
});

// Cached permission state so we don't re-query the OS on every notification.
let permissionGranted = false;

/** Call once on app startup to prompt the user for notification permission. */
export async function requestNotificationPermission() {
  if (!get(notificationsEnabled)) return;

  try {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      permissionGranted = (await requestPermission()) === 'granted';
    }
  } catch (err) {
    console.error('Failed to initialize notification permission:', err);
  }
}

async function focusCurrentWindow() {
  try {
    const win = getCurrentWindow();
    await win.show();
    await win.unminimize();
    await win.setFocus();
    window.focus();
  } catch (err) {
    console.error('Failed to focus window on notification click:', err);
  }
}

function showBrowserNotification(title: string, message: string) {
  const notification = new window.Notification(title, { body: message });

  notification.onclick = () => {
    void focusCurrentWindow();
    notification.close();
  };
}

async function showDesktopNotification(message: string, type: Toast['type']) {
  if (!get(notificationsEnabled)) return;

  try {
    const win = getCurrentWindow();
    const [focused, visible, minimized] = await Promise.all([
      win.isFocused(),
      win.isVisible(),
      win.isMinimized(),
    ]);
    if (focused || (visible && !minimized)) return;
  } catch {
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
      error:   'Soryq - Error',
      warning: 'Soryq - Warning',
      success: 'Soryq - Done',
      info:    'Soryq',
    };

    try {
      await invoke('notification_show', {
        title: titles[type],
        body: message,
      });
    } catch (err) {
      console.warn('Native notification command failed, falling back to Web Notification:', err);
      showBrowserNotification(titles[type], message);
    }
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
  useNotificationStore.getState().showToast(message, type, duration, notifySystem, action);
}

export function dismissToast(id: string) {
  useNotificationStore.getState().dismissToast(id);
}
