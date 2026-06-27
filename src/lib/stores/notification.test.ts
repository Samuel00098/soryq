import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from '$lib/stores/storeCompat';

const mockInvoke = vi.hoisted(() => vi.fn());
const mockIsPermissionGranted = vi.hoisted(() => vi.fn());
const mockRequestPermission = vi.hoisted(() => vi.fn());

const mockWindow = {
  isFocused: vi.fn(),
  isVisible: vi.fn(),
  isMinimized: vi.fn(),
  show: vi.fn(),
  unminimize: vi.fn(),
  setFocus: vi.fn(),
};

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mockWindow,
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: mockIsPermissionGranted,
  requestPermission: mockRequestPermission,
}));

// Mock browser Notification class
class MockNotification {
  static clickCallbacks: (() => void)[] = [];
  body: string;
  onclick: (() => void) | null = null;
  close = vi.fn();

  constructor(title: string, options: { body: string }) {
    this.body = options.body;
    MockNotification.instances.push(this);
  }

  static instances: MockNotification[] = [];
  static reset() {
    MockNotification.instances = [];
  }
}

// Attach MockNotification to global window object
global.window = {
  Notification: MockNotification as any,
  focus: vi.fn(),
} as any;

import { notificationsEnabled } from './settings';
import { showToast, dismissToast, toasts, requestNotificationPermission } from './notification';
import { useNotificationStore } from './zustand/notification';

describe('Notification & Toast Stores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockNotification.reset();
    notificationsEnabled.set(true);
    
    // Clear Zustand store toasts
    useNotificationStore.setState({ toasts: [] });
    // Reset permissions
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue('granted');
  });

  it('adds and dismisses toasts in the store', () => {
    showToast('Hello world', 'info', 5000);
    const activeToasts = get(toasts);
    expect(activeToasts).toHaveLength(1);
    expect(activeToasts[0].message).toBe('Hello world');
    expect(activeToasts[0].type).toBe('info');

    dismissToast(activeToasts[0].id);
    expect(get(toasts)).toHaveLength(0);
  });

  it('enforces maximum limit of 5 toasts', () => {
    for (let i = 0; i < 7; i++) {
      showToast(`Toast ${i}`, 'info', 5000);
    }
    const activeToasts = get(toasts);
    expect(activeToasts).toHaveLength(5);
    expect(activeToasts[0].message).toBe('Toast 2');
    expect(activeToasts[4].message).toBe('Toast 6');
  });

  it('triggers desktop notification if notifySystem is true and window is unfocused', async () => {
    // Window is hidden/minimized
    mockWindow.isFocused.mockResolvedValue(false);
    mockWindow.isVisible.mockResolvedValue(false);
    mockWindow.isMinimized.mockResolvedValue(true);
    
    mockIsPermissionGranted.mockResolvedValue(true);
    
    // Request permission is checked/requested
    await requestNotificationPermission();

    // Trigger toast with notifySystem = true
    showToast('Task finished!', 'success', 3000, true);

    // Wait for async promises in showDesktopNotification to resolve
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockInvoke).toHaveBeenCalledWith('notification_show', {
      title: 'Soryq - Done',
      body: 'Task finished!',
    });
  });

  it('falls back to browser Web Notification if native Tauri invoke fails', async () => {
    mockWindow.isFocused.mockResolvedValue(false);
    mockWindow.isVisible.mockResolvedValue(false);
    mockWindow.isMinimized.mockResolvedValue(true);
    mockIsPermissionGranted.mockResolvedValue(true);

    mockInvoke.mockRejectedValue(new Error('Tauri command not found'));

    // Trigger toast
    showToast('Browser alert!', 'error', 3000, true);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].body).toBe('Browser alert!');

    // Simulate clicking on the notification
    if (MockNotification.instances[0].onclick) {
      MockNotification.instances[0].onclick();
    }

    // Wait for async calls inside focusCurrentWindow to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.unminimize).toHaveBeenCalled();
    expect(mockWindow.setFocus).toHaveBeenCalled();
  });
});
