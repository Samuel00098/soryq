import { get, writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { backgroundImageEnabled, interfaceTransparency, backgroundImageOpacity, backgroundImageBlur } from './settings';
import { showToast } from './notification';

// The current background image as a data URL (held in memory, not persisted in
// localStorage — the file lives on disk in the app data dir). `null` = none set.
let currentDataUrl: string | null = null;

/** Reactive flag for the UI: whether a background image is stored on disk. */
export const backgroundImagePresent = writable<boolean>(false);

function setCurrent(dataUrl: string | null) {
  currentDataUrl = dataUrl;
  backgroundImagePresent.set(dataUrl !== null);
}

/** Load saved settings on startup: apply the global frost, then any stored image. */
export async function initBackground(): Promise<void> {
  // Interface transparency is global — apply it whether or not an image loads.
  applyInterfaceFrost(get(interfaceTransparency));
  applyBackgroundAppearance(get(backgroundImageOpacity), get(backgroundImageBlur));
  try {
    const storedBackground = await invoke<string | null>('background_image_get');
    setCurrent(storedBackground);
    // If a wallpaper is stored on disk, restore it as active on startup so the
    // background doesn't disappear after relaunching the app.
    backgroundImageEnabled.set(storedBackground !== null);
  } catch (e) {
    console.error('Failed to load background image:', e);
    setCurrent(null);
  }
  applyBackgroundImage();
}

/** Open a file picker, copy the chosen image into the app data dir, and show it. */
export async function chooseBackgroundImage(): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico', 'tiff', 'tif', 'heic', 'heif'] }],
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

/** Remove the stored background image (frost/transparency is unaffected). */
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

/** True when an image is present (regardless of the enabled toggle). */
export function hasBackgroundImage(): boolean {
  return currentDataUrl !== null;
}

/**
 * Apply (or remove) just the background image layer based on current settings.
 * Frost/transparency is handled separately by applyInterfaceFrost so it works
 * even with no image set.
 */
export function applyBackgroundImage(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const active = get(backgroundImageEnabled) && currentDataUrl !== null;

  if (active) {
    root.style.setProperty('--user-bg-image', `url("${currentDataUrl}")`);
    root.classList.add('has-bg-image');
  } else {
    root.style.removeProperty('--user-bg-image');
    root.classList.remove('has-bg-image');
  }
}

/**
 * Map a 0–100 transparency value onto the glass tokens for the entire UI.
 * 0 = solid/opaque surfaces; 100 = most see-through (desktop or background image
 * shows strongly). 50 ≈ the app's built-in frosted defaults. The
 * base < chrome < surface opacity hierarchy is preserved so panel depth stays
 * intact. Applied globally — independent of any background image.
 */
let frostTimeout: any = null;
let lastFrostRun = 0;

/**
 * Map a 0–100 transparency value onto the glass tokens for the entire UI.
 * 0 = solid/opaque surfaces; 100 = most see-through (desktop or background image
 * shows strongly). 50 ≈ the app's frosted defaults. The
 * base < chrome < surface opacity hierarchy is preserved so panel depth stays
 * intact. Applied globally — independent of any background image.
 */
export function applyInterfaceFrost(transparency: number): void {
  if (typeof document === 'undefined') return;

  const now = Date.now();
  const throttleMs = 40; // ~25 FPS max update rate

  const run = () => {
    const root = document.documentElement;
    if (transparency === 0) {
      root.classList.add('solid-theme');
      root.style.setProperty('--frost-base', '1.000');
      root.style.setProperty('--frost-chrome', '1.000');
      root.style.setProperty('--frost-surface', '1.000');
      root.style.setProperty('--glass-blur', '0px');
    } else {
      root.classList.remove('solid-theme');
      const t = Math.min(100, Math.max(0, transparency)) / 100;

      const base = 0.9 - t * 0.78;             // t0 → 0.90 (solid), t1 → 0.12 (clear)
      const chrome = Math.min(0.98, base + 0.1);
      const surface = Math.min(0.99, base + 0.2);
      const blur = 30 - t * 16;                // t0 → 30px, t0.5 → 22px, t1 → 14px

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

/**
 * Apply the background-image appearance (Terax-style): opacity 0–100 dims the
 * image, blur 0–60px softens it. Pure CSS on the html::before layer; independent
 * of the global interface frost so the wallpaper can be tuned for legibility.
 */
export function applyBackgroundAppearance(opacityPct: number, blurPx: number): void {
  if (typeof document === 'undefined') return;

  const now = Date.now();
  const throttleMs = 40; // ~25 FPS max update rate

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
