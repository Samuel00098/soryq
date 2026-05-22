import { writable, get } from 'svelte/store';

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

export const toasts = writable<Toast[]>([]);

export function showToast(message: string, type: Toast['type'] = 'info', duration?: number) {
  // Error toasts default to 6 seconds; other toasts default to 3 seconds
  const defaultDuration = type === 'error' ? 6000 : 3000;
  const actualDuration = duration ?? defaultDuration;

  // Prevent duplicate concurrent notifications of the same message and type
  const activeToasts = get(toasts);
  if (activeToasts.some((t) => t.message === message && t.type === type)) {
    return;
  }

  const id = Math.random().toString(36).substring(2, 9);
  const newToast: Toast = { id, message, type, duration: actualDuration };
  
  toasts.update((list) => [...list, newToast]);
  
  if (actualDuration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, actualDuration);
  }
}

export function dismissToast(id: string) {
  toasts.update((list) => list.filter((t) => t.id !== id));
}
