import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from '$lib/stores/storeCompat';

const mockCheck = vi.hoisted(() => vi.fn());
const mockRelaunch = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mockRelaunch,
}));

import { useUpdaterStore } from './zustand/updater';
import { checkForUpdate, installUpdate, pendingUpdate, updateChecking, updateDownloading, updateProgress } from './updater';

describe('Updater Store & Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpdaterStore.setState({
      pendingUpdate: null,
      updateChecking: false,
      updateDownloading: false,
      updateProgress: 0,
    });
  });

  it('initially has null pendingUpdate and false states', () => {
    expect(get(pendingUpdate)).toBeNull();
    expect(get(updateChecking)).toBe(false);
    expect(get(updateDownloading)).toBe(false);
    expect(get(updateProgress)).toBe(0);
  });

  it('checks for update and sets state if update is available', async () => {
    const mockUpdate = {
      available: true,
      version: '1.2.3',
      body: 'New features and improvements',
    };
    mockCheck.mockResolvedValue(mockUpdate);

    const checkPromise = checkForUpdate();
    expect(get(updateChecking)).toBe(true);

    await checkPromise;

    expect(get(updateChecking)).toBe(false);
    expect(get(pendingUpdate)).toEqual({
      version: '1.2.3',
      body: 'New features and improvements',
    });
  });

  it('checks for update and sets null if no update is available', async () => {
    mockCheck.mockResolvedValue(null);

    await checkForUpdate();

    expect(get(pendingUpdate)).toBeNull();
  });

  it('downloads and installs update then relaunches app', async () => {
    const mockDownloadAndInstall = vi.fn(async (cb) => {
      // Simulate download progress events asynchronously
      cb({ event: 'Started', data: { contentLength: 100 } });
      await new Promise((r) => setTimeout(r, 10));
      cb({ event: 'Progress', data: { chunkLength: 50 } });
      await new Promise((r) => setTimeout(r, 10));
      cb({ event: 'Progress', data: { chunkLength: 50 } });
      await new Promise((r) => setTimeout(r, 10));
      cb({ event: 'Finished' });
    });

    const mockUpdate = {
      available: true,
      version: '1.2.3',
      body: 'Notes',
      downloadAndInstall: mockDownloadAndInstall,
    };
    mockCheck.mockResolvedValue(mockUpdate);

    // Call check first to cache the update object
    await checkForUpdate();

    const installPromise = installUpdate();
    
    // Wait a short time for the async download to start and set downloading to true
    await new Promise((resolve) => setTimeout(resolve, 5));
    
    expect(get(updateDownloading)).toBe(true);

    await installPromise;

    expect(get(updateDownloading)).toBe(false);
    expect(get(updateProgress)).toBe(100);
    expect(mockDownloadAndInstall).toHaveBeenCalled();
    expect(mockRelaunch).toHaveBeenCalled();
  });
});
