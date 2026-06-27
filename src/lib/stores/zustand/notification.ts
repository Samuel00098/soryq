import { create } from 'zustand';
import { get } from '$lib/stores/storeCompat';
import { notificationsEnabled } from '../settings';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface NotificationState {
  toasts: Toast[];
  showToast: (
    message: string,
    type?: Toast['type'],
    duration?: number,
    notifySystem?: boolean,
    action?: { label: string; onClick: () => void }
  ) => void;
  dismissToast: (id: string) => void;
}

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
  } catch {}

  try {
    if (!permissionGranted) {
      permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        permissionGranted = (await requestPermission()) === 'granted';
      }
    }
    if (!permissionGranted) return;

    const titles: Record<Toast['type'], string> = {
      error: 'Soryq - Error',
      warning: 'Soryq - Warning',
      success: 'Soryq - Done',
      info: 'Soryq',
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

export const useNotificationStore = create<NotificationState>((set, getState) => ({
  toasts: [],

  showToast: (
    message: string,
    type: Toast['type'] = 'info',
    duration?: number,
    notifySystem = false,
    action?: { label: string; onClick: () => void }
  ) => {
    const defaultDuration = type === 'error' ? 6000 : 3000;
    const actualDuration = duration ?? defaultDuration;

    const activeToasts = getState().toasts;
    if (activeToasts.some((t) => t.message === message && t.type === type)) return;

    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = { id, message, type, duration: actualDuration, action };

    set((s) => {
      const next = [...s.toasts, newToast];
      return { toasts: next.length > 5 ? next.slice(next.length - 5) : next };
    });

    if (notifySystem) {
      void showDesktopNotification(message, type);
    }

    if (actualDuration > 0) {
      setTimeout(() => {
        getState().dismissToast(id);
      }, actualDuration);
    }
  },

  dismissToast: (id: string) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
