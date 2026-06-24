import { get } from '$lib/stores/storeCompat';
import type { Writable } from '$lib/stores/storeCompat';
import {
  fontSize,
  tabSize,
  wordWrap,
  minimap,
  vimMode,
  enableLsp,
  showHidden,
  notificationsEnabled,
  aiGhostTextEnabled,
  uiZoom,
  interfaceTransparency,
  terminalFontSize,
  formatOnSave,
  appearance,
} from '$lib/stores/settings';
import { useThemeStore } from '$lib/stores/zustand/theme';
import { presetThemes } from '$lib/stores/presetThemes';
import type { Theme, ThemeInfo } from '$lib/types/theme';

// Theme state is read straight from the zustand theme store (no side effects on
// import). The theme-switch helpers live in `$lib/stores/theme`, which runs a
// `window.matchMedia` appearance subscription at import time — so it's loaded
// lazily, only when a theme is actually applied, to keep this module importable
// in non-browser contexts (tests, the app-context snapshot).
function getActiveTheme(): Theme | null {
  return (useThemeStore.getState().activeTheme as Theme | null) ?? null;
}

function getAvailableThemes(): ThemeInfo[] {
  return (useThemeStore.getState().availableThemes as ThemeInfo[]) ?? [];
}

/**
 * The settings the in-app assistant is allowed to read and change on the user's
 * behalf — the same toggles the user can flip manually in Settings, plus the
 * active theme. Kept as an explicit allow-list so the orchestrator can never
 * write an arbitrary or unsafe setting, and so the brain can be told exactly
 * what it may touch.
 */

type BooleanDescriptor = {
  type: 'boolean';
  store: Writable<boolean>;
};

type NumberDescriptor = {
  type: 'number';
  store: Writable<number>;
  min: number;
  max: number;
};

type EnumDescriptor = {
  type: 'enum';
  store: Writable<string>;
  values: string[];
};

type SettingDescriptor = BooleanDescriptor | NumberDescriptor | EnumDescriptor;

const SETTINGS: Record<string, SettingDescriptor> = {
  appearance: { type: 'enum', store: appearance as unknown as Writable<string>, values: ['system', 'light', 'dark'] },
  fontSize: { type: 'number', store: fontSize, min: 8, max: 32 },
  tabSize: { type: 'number', store: tabSize, min: 1, max: 8 },
  wordWrap: { type: 'boolean', store: wordWrap },
  minimap: { type: 'boolean', store: minimap },
  vimMode: { type: 'boolean', store: vimMode },
  formatOnSave: { type: 'boolean', store: formatOnSave },
  enableLsp: { type: 'boolean', store: enableLsp },
  showHidden: { type: 'boolean', store: showHidden },
  notificationsEnabled: { type: 'boolean', store: notificationsEnabled },
  aiGhostTextEnabled: { type: 'boolean', store: aiGhostTextEnabled },
  uiZoom: { type: 'number', store: uiZoom, min: 50, max: 200 },
  interfaceTransparency: { type: 'number', store: interfaceTransparency, min: 0, max: 100 },
  terminalFontSize: { type: 'number', store: terminalFontSize, min: 8, max: 32 },
};

const TRUE_WORDS = new Set(['true', 'on', 'yes', 'enable', 'enabled', '1']);
const FALSE_WORDS = new Set(['false', 'off', 'no', 'disable', 'disabled', '0']);

function coerceBoolean(value: string | number | boolean): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const v = value.trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}

function coerceNumber(value: string | number | boolean, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Resolve a free-text theme reference to a concrete theme by id or name. */
function resolveTheme(
  input: string,
): { kind: 'preset' | 'backend'; id: string; name: string } | null {
  const want = input.trim().toLowerCase();
  if (!want) return null;
  const preset =
    presetThemes.find((t) => t.id.toLowerCase() === want) ??
    presetThemes.find((t) => t.name.toLowerCase() === want) ??
    presetThemes.find((t) => t.name.toLowerCase().includes(want) || t.id.toLowerCase().includes(want));
  if (preset) return { kind: 'preset', id: preset.id, name: preset.name };

  const backend = getAvailableThemes();
  const match =
    backend.find((t) => t.id.toLowerCase() === want) ??
    backend.find((t) => t.name.toLowerCase() === want) ??
    backend.find((t) => t.name.toLowerCase().includes(want) || t.id.toLowerCase().includes(want));
  if (match) return { kind: 'backend', id: match.id, name: match.name };
  return null;
}

/** Every theme name the assistant may switch to, presets first then backend. */
export function listThemeNames(): string[] {
  const names = presetThemes.map((t) => t.name);
  for (const t of getAvailableThemes()) {
    if (!names.some((n) => n.toLowerCase() === t.name.toLowerCase())) names.push(t.name);
  }
  return names;
}

/** A read of the current settings the assistant can report on and change. */
export function getAgentSettingsSnapshot(): {
  theme: string | null;
  availableThemes: string[];
  values: Record<string, string | number | boolean>;
} {
  const values: Record<string, string | number | boolean> = {};
  for (const [name, desc] of Object.entries(SETTINGS)) {
    values[name] = get(desc.store as Writable<string | number | boolean>);
  }
  return {
    theme: getActiveTheme()?.name ?? null,
    availableThemes: listThemeNames(),
    values,
  };
}

export interface ApplySettingResult {
  ok: boolean;
  message: string;
}

/**
 * Apply one setting change requested by the assistant. Validates the value
 * against the allow-list; theme is handled specially. Returns a short message
 * suitable for a toast / confirmation.
 */
export async function applyAgentSetting(
  setting: string,
  value: string | number | boolean,
): Promise<ApplySettingResult> {
  const name = setting.trim().toLowerCase();

  if (name === 'theme') {
    const resolved = resolveTheme(String(value));
    if (!resolved) {
      return { ok: false, message: `I don't know a theme called "${value}".` };
    }
    const themeStore = await import('$lib/stores/theme');
    if (resolved.kind === 'preset') {
      themeStore.switchPresetTheme(resolved.id, false);
    } else {
      await themeStore.switchTheme(resolved.id, false);
    }
    return { ok: true, message: `Switched theme to ${resolved.name}.` };
  }

  // Case-insensitive lookup so "fontsize" / "wordwrap" still resolve.
  const key = Object.keys(SETTINGS).find((k) => k.toLowerCase() === name);
  const desc = key ? SETTINGS[key] : undefined;
  if (!key || !desc) {
    return { ok: false, message: `I can't change "${setting}".` };
  }

  if (desc.type === 'boolean') {
    const next = coerceBoolean(value);
    if (next === null) return { ok: false, message: `"${value}" isn't a valid on/off value for ${key}.` };
    desc.store.set(next);
    return { ok: true, message: `Set ${key} to ${next ? 'on' : 'off'}.` };
  }

  if (desc.type === 'number') {
    const next = coerceNumber(value, desc.min, desc.max);
    if (next === null) return { ok: false, message: `"${value}" isn't a valid number for ${key}.` };
    desc.store.set(next);
    return { ok: true, message: `Set ${key} to ${next}.` };
  }

  // enum
  const v = String(value).trim().toLowerCase();
  const matched = desc.values.find((opt) => opt.toLowerCase() === v);
  if (!matched) {
    return { ok: false, message: `${key} must be one of: ${desc.values.join(', ')}.` };
  }
  desc.store.set(matched);
  return { ok: true, message: `Set ${key} to ${matched}.` };
}
