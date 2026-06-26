import { get, writable } from '$lib/stores/storeCompat';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { backgroundImageEnabled, interfaceTransparency, backgroundImageOpacity, backgroundImageBlur } from './settings';
import { showToast } from './notification';
import { useBackgroundStore, type BackgroundMedia, type BackgroundMediaKind } from './zustand/background';

export type { BackgroundMediaKind, BackgroundMedia } from './zustand/background';

function syncWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  const zustandVal = (useBackgroundStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;
  const store = writable<T>(initial);
  void useBackgroundStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) store.set(next);
  });
  return {
    subscribe: store.subscribe,
    set(value: T) { (useBackgroundStore.getState() as any).__set(key, value); },
    update(fn: (val: T) => T) {
      const current = (useBackgroundStore.getState() as any)[key] as T;
      (useBackgroundStore.getState() as any).__set(key, fn(current));
    },
  };
}

export const backgroundImagePresent = syncWritable<boolean>('backgroundImagePresent', false);
export const backgroundMedia = syncWritable<BackgroundMedia | null>('backgroundMedia', null);

let currentAssetUrl: string | null = null;
let currentMediaKind: BackgroundMediaKind | null = null;

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv']);

function withCacheToken(assetUrl: string, token: string): string {
  return `${assetUrl}${assetUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(token)}`;
}

function getMediaKind(filePath: string): BackgroundMediaKind {
  const cleanPath = filePath.split(/[?#]/, 1)[0] ?? filePath;
  const ext = cleanPath.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image';
}

function setCurrent(filePath: string | null, cacheToken = `${Date.now()}`) {
  currentAssetUrl = filePath ? withCacheToken(convertFileSrc(filePath), cacheToken) : null;
  currentMediaKind = filePath ? getMediaKind(filePath) : null;
  backgroundImagePresent.set(filePath !== null);
  backgroundMedia.set(
    currentAssetUrl && currentMediaKind
      ? { url: currentAssetUrl, kind: currentMediaKind }
      : null
  );
}

export async function initBackground(): Promise<void> {
  applyInterfaceFrost(get(interfaceTransparency));
  applyBackgroundAppearance(get(backgroundImageOpacity), get(backgroundImageBlur));
  try {
    const storedBackground = await invoke<string | null>('background_image_get');
    setCurrent(storedBackground);
    // Load the stored media but DON'T force the enabled toggle on. Whether the
    // background shows is the user's persisted choice (set true by
    // chooseBackgroundImage, false by the Settings toggle / removeBackgroundImage)
    // — overriding it here from "a file exists on disk" is what made a toggled-off
    // background reappear on every restart. If the file went missing, fall the
    // toggle off so a stale "on" doesn't leave the app trying to show nothing.
    if (storedBackground === null) {
      backgroundImageEnabled.set(false);
    }
  } catch (e) {
    console.error('Failed to load background image:', e);
    setCurrent(null);
  }
  applyBackgroundImage();
}

export async function chooseBackgroundImage(): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: 'Background media',
        extensions: ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'apng', 'bmp', 'svg', 'avif', 'ico', 'tiff', 'tif', 'heic', 'heif', 'mp4', 'webm', 'm4v', 'mov', 'ogv']
      }
    ],
  });
  if (!selected || typeof selected !== 'string') return;

  try {
    setCurrent(await invoke<string>('background_image_set', { srcPath: selected }));
    backgroundImageEnabled.set(true);
    applyBackgroundImage();
    showToast('Background image applied', 'success');
  } catch (e: any) {
    showToast(`Failed to set background: ${e?.message || e}`, 'error');
  }
}

export async function removeBackgroundImage(): Promise<void> {
  try {
    await invoke('background_image_clear');
  } catch (e) {
    console.error('Failed to clear background image:', e);
  }
  setCurrent(null);
  backgroundImageEnabled.set(false);
  applyBackgroundImage();
}

export function hasBackgroundImage(): boolean {
  return currentAssetUrl !== null;
}

export function applyBackgroundImage(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const active = get(backgroundImageEnabled) && currentAssetUrl !== null;
  const imageActive = active && currentMediaKind === 'image';

  if (imageActive) {
    root.style.setProperty('--user-bg-image', `url("${currentAssetUrl}")`);
    root.classList.add('has-bg-image');
  } else {
    root.style.removeProperty('--user-bg-image');
    root.classList.remove('has-bg-image');
  }

  root.classList.toggle('has-bg-media', active);
}

let frostTimeout: any = null;
let lastFrostRun = 0;

export function applyInterfaceFrost(transparency: number): void {
  if (typeof document === 'undefined') return;

  const now = Date.now();
  const throttleMs = 40;

  const run = () => {
    const root = document.documentElement;
    if (transparency === 0) {
      root.classList.add('solid-theme');
      root.style.setProperty('--frost-base', '1.000');
      root.style.setProperty('--frost-chrome', '1.000');
      root.style.setProperty('--frost-surface', '1.000');
      root.style.setProperty('--glass-blur', '0px');
      root.style.setProperty('--glass-saturate', '100%');
    } else {
      root.classList.remove('solid-theme');
      const t = Math.min(100, Math.max(0, transparency)) / 100;

      const base = 0.88 - t * 0.74;
      const chrome = Math.min(0.96, base + 0.1);
      const surface = Math.min(0.98, base + 0.2);

      const FROST_MAX = 40;
      const blur = t <= 0.4
        ? FROST_MAX
        : FROST_MAX * (1 - (t - 0.4) / 0.6);

      root.style.setProperty('--frost-base', base.toFixed(3));
      root.style.setProperty('--frost-chrome', chrome.toFixed(3));
      root.style.setProperty('--frost-surface', surface.toFixed(3));
      root.style.setProperty('--glass-blur', `${blur.toFixed(1)}px`);
    }
    lastFrostRun = Date.now();
    frostTimeout = null;
  };

  if (frostTimeout) {
    clearTimeout(frostTimeout);
    frostTimeout = null;
  }

  const timeSinceLastRun = now - lastFrostRun;
  if (timeSinceLastRun >= throttleMs) {
    run();
  } else {
    frostTimeout = setTimeout(run, throttleMs - timeSinceLastRun);
  }
}

let appearanceTimeout: any = null;
let lastAppearanceRun = 0;

export function applyBackgroundAppearance(opacityPct: number, blurPx: number): void {
  if (typeof document === 'undefined') return;

  const now = Date.now();
  const throttleMs = 40;

  const run = () => {
    const root = document.documentElement;
    const o = Math.min(100, Math.max(0, opacityPct)) / 100;
    const b = Math.min(60, Math.max(0, blurPx));
    root.style.setProperty('--user-bg-opacity', o.toFixed(3));
    root.style.setProperty('--user-bg-blur', `${b}px`);
    lastAppearanceRun = Date.now();
    appearanceTimeout = null;
  };

  if (appearanceTimeout) {
    clearTimeout(appearanceTimeout);
    appearanceTimeout = null;
  }

  const timeSinceLastRun = now - lastAppearanceRun;
  if (timeSinceLastRun >= throttleMs) {
    run();
  } else {
    appearanceTimeout = setTimeout(run, throttleMs - timeSinceLastRun);
  }
}
