import { writable, get } from '$lib/stores/storeCompat';
import { invoke } from '@tauri-apps/api/core';
import type { Theme, ThemeInfo } from '$lib/types/theme';
import { showToast } from './notification';
import { appearance } from './settings';
import { presetThemes, currentPresetTheme } from './presetThemes';
import { useThemeStore } from './zustand/theme';

function syncWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  const zustandVal = (useThemeStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;
  const store = writable<T>(initial);
  void useThemeStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) store.set(next);
  });
  return {
    subscribe: store.subscribe,
    set(value: T) { (useThemeStore.getState() as any).__set(key, value); },
    update(fn: (val: T) => T) {
      const current = (useThemeStore.getState() as any)[key] as T;
      (useThemeStore.getState() as any).__set(key, fn(current));
    },
  };
}

export const activeTheme = syncWritable<Theme | null>('activeTheme', null);
export const availableThemes = syncWritable<ThemeInfo[]>('availableThemes', []);

/**
 * Monotonically increasing counter that is bumped every time the user
 * explicitly picks a theme (via switchPresetTheme or switchTheme). loadThemes
 * checks this before and after its async Tauri invoke so that a backend
 * response arriving after a user selection doesn't silently overwrite it.
 */
let userThemeVersion = 0;

let mediaQueryList: MediaQueryList | null = null;
const handleSystemThemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
  const desiredTheme = e.matches ? 'forge-dark' : 'forge-light';
  const currentActive = get(activeTheme);
  if (!currentActive || currentActive.id !== desiredTheme) {
    switchTheme(desiredTheme, false);
  }
};

if (typeof window !== 'undefined') {
  let isAppearanceInitialLoad = true;
  let lastAppearance: string | null = null;

  appearance.subscribe((value) => {
    if (value === lastAppearance && !isAppearanceInitialLoad) {
      return;
    }
    lastAppearance = value;

    if (mediaQueryList) {
      try {
        mediaQueryList.removeEventListener('change', handleSystemThemeChange);
      } catch (err) {
        try {
          mediaQueryList.removeListener(handleSystemThemeChange);
        } catch (_) {}
      }
      mediaQueryList = null;
    }

    if (value === 'system') {
      mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
      try {
        mediaQueryList.addEventListener('change', handleSystemThemeChange);
      } catch (err) {
        try {
          mediaQueryList.addListener(handleSystemThemeChange);
        } catch (_) {}
      }
      if (!isAppearanceInitialLoad) {
        handleSystemThemeChange(mediaQueryList);
      }
    } else if (!isAppearanceInitialLoad) {
      if (value === 'light') {
        switchTheme('forge-light', false);
      } else if (value === 'dark') {
        switchTheme('forge-dark', false);
      }
    }

    isAppearanceInitialLoad = false;
  });
}

export async function loadThemes() {
  // Snapshot the version before any async work. If the user picks a theme
  // while we are awaiting Tauri calls, our result is stale and we must not
  // overwrite their explicit choice.
  const versionAtStart = userThemeVersion;

  const isStale = () => userThemeVersion !== versionAtStart;

  try {
    const themes = await invoke<ThemeInfo[]>('theme_list');
    if (isStale()) return;
    availableThemes.set(themes);

    const savedThemeId = typeof window !== 'undefined' ? localStorage.getItem('forge_active_theme') : null;

    if (savedThemeId) {
      const preset = presetThemes.find(t => t.id === savedThemeId);
      if (preset) {
        if (isStale()) return;
        activeTheme.set(preset);
        currentPresetTheme.set(savedThemeId);
        applyThemeToCSS(preset);
        return;
      }

      try {
        const theme = await invoke<Theme>('theme_activate', { themeId: savedThemeId });
        if (isStale()) return;
        activeTheme.set(theme);
        currentPresetTheme.set(null);
        applyThemeToCSS(theme);
        return;
      } catch (e) {
        console.warn(`Failed to activate saved theme ${savedThemeId} on backend, falling back to backend's active theme:`, e);
      }
    }

    const theme = await invoke<Theme>('theme_get_active');
    if (isStale()) return;
    activeTheme.set(theme);
    currentPresetTheme.set(null);
    applyThemeToCSS(theme);
  } catch (err) {
    console.error('Failed to load themes:', err);
  }
}

export async function switchTheme(themeId: string, showNotification = true) {
  userThemeVersion++;
  try {
    const theme = await invoke<Theme>('theme_activate', { themeId });
    activeTheme.set(theme);
    currentPresetTheme.set(null);
    if (typeof window !== 'undefined') {
      localStorage.setItem('forge_active_theme', themeId);
    }
    applyThemeToCSS(theme);
    if (showNotification) {
      showToast(`Switched to theme: ${theme.name}`, 'success');
    }
  } catch (err: any) {
    console.error('Failed to switch theme:', err);
    if (showNotification) {
      showToast(`Failed to switch theme: ${err?.message || err}`, 'error');
    }
  }
}

export function switchPresetTheme(themeId: string, showNotification = true) {
  const theme = presetThemes.find(t => t.id === themeId);
  if (!theme) {
    showToast(`Theme "${themeId}" not found`, 'error');
    return;
  }
  // Bump the version so any in-flight loadThemes() call knows its result is now stale.
  userThemeVersion++;
  activeTheme.set(theme);
  currentPresetTheme.set(themeId);
  if (typeof window !== 'undefined') {
    localStorage.setItem('forge_active_theme', themeId);
  }
  applyThemeToCSS(theme);
  if (showNotification) {
    showToast(`Switched to theme: ${theme.name}`, 'success');
  }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleanHex = hex.trim().replace(/^#/, '');
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return { r, g, b };
  } else if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

let themeTransitionTimeout: any = null;

export function applyThemeToCSS(theme: Theme | null) {
  if (!theme || typeof document === 'undefined') return;
  const root = document.documentElement;

  if (theme.type === 'light') {
    root.classList.add('light-theme');
    root.classList.remove('dark-theme');
  } else {
    root.classList.add('dark-theme');
    root.classList.remove('light-theme');
  }

  const isInitialLoad = !root.classList.contains('theme-initialized');
  if (!isInitialLoad) {
    root.classList.add('theme-transitioning');
    void root.offsetHeight;
    if (themeTransitionTimeout) {
      clearTimeout(themeTransitionTimeout);
    }
  } else {
    root.classList.remove('theme-transitioning');
  }

  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${key}`, value);
    if (typeof value === 'string') {
      const rgb = hexToRgb(value);
      if (rgb) {
        root.style.setProperty(`--${key}-rgb`, `${rgb.r}, ${rgb.g}, ${rgb.b}`);
      }
    }
  }
  for (const [key, value] of Object.entries(theme.syntax)) {
    root.style.setProperty(`--syntax-${key}`, value);
  }

  const accent = theme.colors['accent'];
  if (accent) {
    const rgb = hexToRgb(accent);
    if (rgb) {
      root.style.setProperty('--accent-light', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
      root.style.setProperty('--accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`);
    }
  }

  if (isInitialLoad) {
    root.classList.add('theme-initialized');
  } else {
    themeTransitionTimeout = setTimeout(() => {
      root.classList.remove('theme-transitioning');
      themeTransitionTimeout = null;
    }, 260);
  }
}

export async function saveTheme(theme: Theme) {
  try {
    await invoke('theme_save', { theme });
    const themes = await invoke<ThemeInfo[]>('theme_list');
    availableThemes.set(themes);
    activeTheme.set(theme);
    currentPresetTheme.set(null);
    if (typeof window !== 'undefined') {
      localStorage.setItem('forge_active_theme', theme.id);
    }
    applyThemeToCSS(theme);
    showToast(`Theme "${theme.name}" saved successfully`, 'success');
  } catch (err: any) {
    console.error('Failed to save custom theme:', err);
    showToast(`Failed to save theme: ${err?.message || err}`, 'error');
  }
}

export function importTheme(file: File): Promise<Theme> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!data.id || !data.name || !data.colors || !data.syntax) {
          reject(new Error('Invalid theme file: missing required fields (id, name, colors, syntax)'));
          return;
        }
        const theme: Theme = {
          id: data.id,
          name: data.name,
          type: data.type || 'dark',
          colors: data.colors,
          syntax: data.syntax,
        };
        resolve(theme);
      } catch (err) {
        reject(new Error('Invalid theme file: not valid JSON'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export interface ThemeColorField {
  key: string;
  label: string;
  category: 'colors' | 'syntax';
}

export const themeColorFields: ThemeColorField[] = [
  { key: 'bg-primary', label: 'Background Primary', category: 'colors' },
  { key: 'bg-secondary', label: 'Background Secondary', category: 'colors' },
  { key: 'bg-tertiary', label: 'Background Tertiary', category: 'colors' },
  { key: 'bg-hover', label: 'Hover', category: 'colors' },
  { key: 'bg-active', label: 'Active', category: 'colors' },
  { key: 'text-primary', label: 'Text Primary', category: 'colors' },
  { key: 'text-secondary', label: 'Text Secondary', category: 'colors' },
  { key: 'text-muted', label: 'Text Muted', category: 'colors' },
  { key: 'accent', label: 'Accent', category: 'colors' },
  { key: 'accent-hover', label: 'Accent Hover', category: 'colors' },
  { key: 'border', label: 'Border', category: 'colors' },
  { key: 'error', label: 'Error', category: 'colors' },
  { key: 'warning', label: 'Warning', category: 'colors' },
  { key: 'success', label: 'Success', category: 'colors' },
  { key: 'button-bg', label: 'Button Background', category: 'colors' },
  { key: 'button-text', label: 'Button Text', category: 'colors' },
  { key: 'terminal-bg', label: 'Terminal Background', category: 'colors' },
  { key: 'titlebar-bg', label: 'Title Bar', category: 'colors' },
  { key: 'statusbar-bg', label: 'Status Bar', category: 'colors' },
  { key: 'statusbar-text', label: 'Status Bar Text', category: 'colors' },
  { key: 'keyword', label: 'Keyword', category: 'syntax' },
  { key: 'string', label: 'String', category: 'syntax' },
  { key: 'number', label: 'Number', category: 'syntax' },
  { key: 'comment', label: 'Comment', category: 'syntax' },
  { key: 'function', label: 'Function', category: 'syntax' },
  { key: 'variable', label: 'Variable', category: 'syntax' },
  { key: 'type', label: 'Type', category: 'syntax' },
  { key: 'operator', label: 'Operator', category: 'syntax' },
  { key: 'constant', label: 'Constant', category: 'syntax' },
  { key: 'tag', label: 'Tag', category: 'syntax' },
  { key: 'attribute', label: 'Attribute', category: 'syntax' },
];
