import { writable, derived, get } from 'svelte/store';

function persistentWritable<T>(key: string, defaultValue: T): import('svelte/store').Writable<T> {
  if (typeof window === 'undefined') {
    return writable(defaultValue);
  }
  // One-time migration to move users off unstable terminal renderers.
  let stored = localStorage.getItem(`forge_setting_${key}`);
  if (key === 'terminalRenderer' && stored !== null) {
    try {
      const parsed = JSON.parse(stored);
      const rendererMigrationKey = 'forge_setting_terminalRenderer_migrated_v2';
      if (!localStorage.getItem(rendererMigrationKey) && (parsed === 'webgl' || parsed === 'canvas')) {
        localStorage.setItem('forge_setting_terminalRenderer', JSON.stringify('dom'));
        localStorage.setItem(rendererMigrationKey, '1');
        stored = JSON.stringify('dom');
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }
  let initialValue: T;
  try {
    initialValue = stored !== null ? JSON.parse(stored) : defaultValue;
  } catch {
    initialValue = defaultValue;
  }

  if (key === 'userShortcuts') {
    if (!Array.isArray(initialValue)) {
      initialValue = defaultValue;
    } else {
      // Merge missing default shortcuts
      const defaultList = defaultValue as unknown as KeyboardShortcut[];
      const currentList = initialValue as KeyboardShortcut[];
      const updatedList = [...currentList];
      for (const def of defaultList) {
        if (!updatedList.some(item => item && item.id === def.id)) {
          updatedList.push(def);
        }
      }
      initialValue = updatedList as unknown as T;
    }
  }

  const store = writable<T>(initialValue);
  store.subscribe((val) => {
    localStorage.setItem(`forge_setting_${key}`, JSON.stringify(val));
  });
  return store;
}

const FONT_CANDIDATES = [
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Cascadia Mono',
  'Victor Mono',
  'IBM Plex Mono',
  'Source Code Pro',
  'Consolas',
  'Monaco',
  'Menlo',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Courier New',
];

let detectedFontCache: string | null = null;

export function detectBestFont(): string {
  if (detectedFontCache) return detectedFontCache;

  if (typeof document === 'undefined') {
    detectedFontCache = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";
    return detectedFontCache;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    detectedFontCache = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";
    return detectedFontCache;
  }

  ctx.font = '12px monospace';
  const testStr = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const baseWidth = ctx.measureText(testStr).width;

  for (const font of FONT_CANDIDATES) {
    ctx.font = `12px "${font}", monospace`;
    const width = ctx.measureText(testStr).width;
    if (width !== baseWidth) {
      detectedFontCache = `'${font}', '${FONT_CANDIDATES.filter(f => f !== font).join("', '")}', monospace`;
      return detectedFontCache;
    }
  }

  detectedFontCache = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";
  return detectedFontCache;
}

// Editor
export const fontSize = persistentWritable('fontSize', 14);
const FONT_FALLBACK = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Ubuntu Mono', 'Noto Mono', Consolas, monospace";
export const fontFamily = persistentWritable('fontFamily', FONT_FALLBACK);
export const resolvedFontFamily = derived(fontFamily, ($ff) => {
  if (!$ff || $ff.trim() === '') return FONT_FALLBACK;
  return $ff;
});
export const tabSize = persistentWritable('tabSize', 2);
export const wordWrap = persistentWritable('wordWrap', false);
export const minimap = persistentWritable('minimap', false);
export const vimMode = persistentWritable('vimMode', false);

// Explorer
export const showHidden = persistentWritable('showHidden', false);

// Notifications
export const notificationsEnabled = persistentWritable('notificationsEnabled', true);

// ── AI providers & models ──
// Voice refinement and AI commit messages route through one of several
// providers. Each provider has its own API key (or, for local providers, a
// server URL) and its own model list; the model picker in Settings swaps to the
// selected provider's models. The Rust backend (`commands/secrets.rs`) calls
// each provider's native API directly.
//
// Local providers (Ollama, LM Studio) run on the user's own machine. They need
// a base URL instead of an API key and expose OpenAI-compatible endpoints, so
// the backend reuses its OpenAI-compatible request path with no auth header.
export type AiProviderId =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'ollama'
  | 'lmstudio';

export interface AiModelOption {
  id: string;
  label: string;
  description: string;
  free?: boolean;
}

export interface AiProviderDef {
  id: AiProviderId;
  label: string;
  /** Label shown above the key field, e.g. "OpenRouter API key". */
  keyLabel: string;
  /** Placeholder hinting at the key shape, e.g. "sk-or-...". */
  keyPlaceholder: string;
  /** Where the user can create a key (or, for local providers, install docs). */
  keyUrl: string;
  defaultModel: string;
  models: AiModelOption[];
  /**
   * Local providers run on the user's own machine and are configured with a
   * server URL instead of an API key. The model picker, readiness checks and
   * backend auth all branch on this flag.
   */
  local?: boolean;
  /**
   * OpenAI-compatible base URL for local providers (root that owns
   * `/chat/completions` and `/models`), e.g. `http://localhost:11434/v1`.
   */
  defaultBaseUrl?: string;
}

export const aiProviders: AiProviderDef[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyLabel: 'OpenRouter API key',
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'google/gemini-2.5-flash',
    models: [
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Best balance of quality and speed.' },
      { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Cheaper, faster fallback.' },
      { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', description: 'Best overall quality.' },
      { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', description: 'Cheap, fast Claude.' },
      { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku', description: 'Fast, polished rewrites.' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', description: 'Cheap OpenAI option.' },
      { id: 'qwen/qwen3-30b-a3b-instruct-2507', label: 'Qwen3 30B Instruct', description: 'Very cheap fallback.' },
      { id: 'qwen/qwen-2.5-7b-instruct', label: 'Qwen 2.5 7B Instruct', description: 'Ultra-cheap fallback.' },
      { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', description: 'Free Google option.', free: true },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyLabel: 'Anthropic API key',
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-3-5-haiku-latest',
    models: [
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', description: 'Fast and cheap — great for refinement.' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Newest fast Claude.' },
      { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', description: 'Higher quality, pricier.' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', description: 'Cheap, fast, capable.' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', description: 'Improved mini model.' },
      { id: 'gpt-4o', label: 'GPT-4o', description: 'Flagship quality.' },
      { id: 'gpt-4.1', label: 'GPT-4.1', description: 'Highest quality OpenAI option.' },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    keyLabel: 'Google AI API key',
    keyPlaceholder: 'AIza...',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Best balance of quality and speed.' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Cheaper, faster fallback.' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Older, very cheap.' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    keyLabel: 'Groq API key',
    keyPlaceholder: 'gsk_...',
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.1-8b-instant',
    models: [
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', description: 'Extremely fast and cheap.' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', description: 'Higher quality, still fast.' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    local: true,
    defaultBaseUrl: 'http://localhost:11434/v1',
    keyLabel: 'Ollama server URL',
    keyPlaceholder: 'http://localhost:11434/v1',
    keyUrl: 'https://ollama.com/download',
    // Runs entirely on your machine. The model list is read live from your
    // server; these are common pulls shown until then.
    defaultModel: 'llama3.1',
    models: [
      { id: 'llama3.1', label: 'Llama 3.1', description: 'Meta Llama 3.1, a solid general default.' },
      { id: 'qwen2.5', label: 'Qwen 2.5', description: 'Strong general-purpose model.' },
      { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder', description: 'Tuned for code tasks.' },
      { id: 'gemma2', label: 'Gemma 2', description: 'Google Gemma 2, lightweight.' },
      { id: 'phi3', label: 'Phi-3', description: 'Small and fast Microsoft model.' },
    ],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    local: true,
    defaultBaseUrl: 'http://localhost:1234/v1',
    keyLabel: 'LM Studio server URL',
    keyPlaceholder: 'http://localhost:1234/v1',
    keyUrl: 'https://lmstudio.ai/docs/app/api/endpoints/openai',
    // The model id is whatever you've loaded in LM Studio's server tab; the
    // live list reflects your loaded models. `local-model` works as a generic
    // alias for the currently-loaded model.
    defaultModel: 'local-model',
    models: [
      { id: 'local-model', label: 'Loaded model', description: 'Uses whichever model LM Studio currently has loaded.' },
    ],
  },
];

export function getProviderDef(id: AiProviderId): AiProviderDef {
  return aiProviders.find((p) => p.id === id) ?? aiProviders[0];
}

export const voiceRefinementEnabled = persistentWritable('voiceRefinementEnabled', true);

// Selected provider + per-provider remembered model choice.
export const aiProvider = persistentWritable<AiProviderId>('aiProvider', 'openrouter');
export const aiModelByProvider = persistentWritable<Record<string, string>>('aiModelByProvider', {});

// Per-provider server URL, used only by local providers (Ollama, LM Studio).
// Empty means "fall back to the provider's defaultBaseUrl".
export const aiBaseUrlByProvider = persistentWritable<Record<string, string>>('aiBaseUrlByProvider', {});

/** Whether a provider runs locally and is configured by URL rather than key. */
export function isLocalProvider(id: AiProviderId): boolean {
  return getProviderDef(id).local === true;
}

/**
 * The effective server URL for a local provider: the user's override if set,
 * otherwise the provider's default. Returns '' for non-local providers.
 */
export function getProviderBaseUrl(id: AiProviderId, overrides?: Record<string, string>): string {
  const def = getProviderDef(id);
  if (!def.local) return '';
  const map = overrides ?? get(aiBaseUrlByProvider);
  const override = map[id];
  return (override && override.trim()) || def.defaultBaseUrl || '';
}

export function setProviderBaseUrl(id: AiProviderId, url: string) {
  aiBaseUrlByProvider.update((map) => ({ ...map, [id]: url.trim() }));
}

// One-time migration: fold the legacy single OpenRouter model setting into the
// new per-provider map so existing users keep their chosen model.
if (typeof localStorage !== 'undefined') {
  const legacy = localStorage.getItem('forge_setting_voiceRefinementModel');
  if (legacy) {
    try {
      const model = JSON.parse(legacy);
      if (typeof model === 'string' && model) {
        aiModelByProvider.update((map) => (map.openrouter ? map : { ...map, openrouter: model }));
      }
    } catch {
      // Ignore malformed legacy value.
    }
    localStorage.removeItem('forge_setting_voiceRefinementModel');
  }
}

// The active model id, derived from the selected provider and its remembered
// choice (falling back to the provider's default). The remembered id is trusted
// as-is: models are now loaded live from each provider, so a valid choice may
// not appear in the static curated `models` list.
export const currentAiModel = derived(
  [aiProvider, aiModelByProvider],
  ([$provider, $map]) => {
    const def = getProviderDef($provider);
    const remembered = $map[$provider];
    return remembered && remembered.trim() ? remembered : def.defaultModel;
  }
);

export function setAiModel(provider: AiProviderId, modelId: string) {
  aiModelByProvider.update((map) => ({ ...map, [provider]: modelId }));
}

// UI Scaling
export const uiZoom = persistentWritable('uiZoom', 100);

// Code Formatting
export const formatOnSave = persistentWritable('formatOnSave', true);

// Keyboard Shortcuts
export interface KeyboardShortcut {
  id: string;
  label: string;
  keys: string;
}

export interface ShortcutAction {
  id: string;
  label: string;
  category: string;
}

export const shortcutActions: ShortcutAction[] = [
  { id: 'commandPalette', label: 'Command Palette', category: 'View' },
  { id: 'openSettings',    label: 'Open Settings',   category: 'View' },
  { id: 'newWorkspace',   label: 'New Workspace',   category: 'Workspace' },
  { id: 'goToTerminal',   label: 'Go to Terminal',  category: 'View' },
  { id: 'goToEditor',     label: 'Go to Editor',    category: 'View' },
  { id: 'goToPreview',    label: 'Go to Preview',   category: 'View' },
  { id: 'toggleSidebar',  label: 'Toggle Sidebar',  category: 'View' },
  { id: 'saveFile',       label: 'Save File',       category: 'File' },
  { id: 'openFolder',     label: 'Open Folder',     category: 'Workspace' },
  { id: 'newTerminal',    label: 'New Terminal Tab',category: 'Terminal' },
  { id: 'splitPreview',   label: 'Toggle Editor + Preview Split', category: 'Editor' },
  { id: 'formatDocument', label: 'Format Document',       category: 'Editor' },
  { id: 'startProxy',     label: 'Start Preview Proxy', category: 'Preview' },
  { id: 'stopProxy',      label: 'Stop Preview Proxy', category: 'Preview' },
  { id: 'zoomIn',         label: 'Zoom In',         category: 'Window' },
  { id: 'zoomOut',        label: 'Zoom Out',        category: 'Window' },
  { id: 'resetZoom',      label: 'Reset Zoom',      category: 'Window' },
  { id: 'toggleNotepad',  label: 'Toggle Scratchpad', category: 'View' },
  { id: 'quickCapture',  label: 'Quick Capture',     category: 'Workspace' },
  { id: 'openDailyNote', label: 'Open Daily Note',   category: 'Workspace' },
];

export const defaultShortcuts: KeyboardShortcut[] = [
  { id: 'commandPalette', label: 'Command Palette', keys: 'Ctrl+Shift+P' },
  { id: 'openSettings',    label: 'Open Settings',   keys: 'Ctrl+,' },
  { id: 'newWorkspace',   label: 'New Workspace',   keys: 'Ctrl+N' },
  { id: 'goToTerminal',   label: 'Go to Terminal',  keys: 'Ctrl+`' },
  { id: 'goToEditor',     label: 'Go to Editor',    keys: 'Ctrl+E' },
  { id: 'goToPreview',    label: 'Go to Preview',   keys: 'Ctrl+Shift+V' },
  { id: 'toggleSidebar',  label: 'Toggle Sidebar',  keys: 'Ctrl+B' },
  { id: 'saveFile',       label: 'Save File',       keys: 'Ctrl+S' },
  { id: 'openFolder',     label: 'Open Folder',     keys: 'Ctrl+O' },
  { id: 'newTerminal',    label: 'New Terminal Tab',keys: 'Ctrl+Shift+`' },
  { id: 'splitPreview',   label: 'Toggle Editor + Preview Split', keys: 'Ctrl+\\' },
  { id: 'formatDocument', label: 'Format Document',       keys: 'Alt+Shift+F' },
  { id: 'startProxy',     label: 'Start Preview Proxy', keys: 'Ctrl+Alt+P' },
  { id: 'stopProxy',      label: 'Stop Preview Proxy', keys: 'Ctrl+Alt+O' },
  { id: 'zoomIn',         label: 'Zoom In',         keys: 'Ctrl+=' },
  { id: 'zoomOut',        label: 'Zoom Out',        keys: 'Ctrl+-' },
  { id: 'resetZoom',      label: 'Reset Zoom',      keys: 'Ctrl+0' },
  { id: 'toggleNotepad',  label: 'Toggle Scratchpad', keys: 'Ctrl+Shift+N' },
  { id: 'quickCapture',  label: 'Quick Capture',     keys: 'Ctrl+Shift+Space' },
  { id: 'openDailyNote', label: 'Open Daily Note',   keys: 'Ctrl+Shift+D' },
];

export const userShortcuts = persistentWritable<KeyboardShortcut[]>('userShortcuts', defaultShortcuts);

export function parseShortcutString(str: string): string[] {
  const trimmed = str.trim();
  if (trimmed.endsWith('+') && trimmed.length > 1) {
    const lastPlus = trimmed.slice(0, -1).lastIndexOf('+');
    if (lastPlus !== -1) {
      const modifiersStr = trimmed.slice(0, lastPlus);
      const parts = modifiersStr.split('+').map(p => p.trim());
      parts.push('+');
      return parts;
    }
  }
  return trimmed.split('+').map(p => p.trim());
}

export function matchShortcut(e: KeyboardEvent, shortcutKeys: string): boolean {
  if (!shortcutKeys) return false;
  const parts = parseShortcutString(shortcutKeys).map(p => p.toLowerCase());
  
  const hasCtrl = parts.includes('ctrl');
  const hasShift = parts.includes('shift');
  const hasAlt = parts.includes('alt');
  const hasMeta = parts.includes('meta');
  
  const modifiers = ['ctrl', 'shift', 'alt', 'meta'];
  const primaryKeyPart = parts.find(p => !modifiers.includes(p));
  if (!primaryKeyPart) return false;
  
  const isCtrlPressed = e.ctrlKey || e.metaKey;
  const ctrlMatch = isCtrlPressed === hasCtrl;
  const shiftMatch = e.shiftKey === hasShift;
  const altMatch = e.altKey === hasAlt;
  const metaMatch = e.metaKey === hasMeta;
  
  let keyMatch = false;
  const eventKeyLower = e.key.toLowerCase();
  const targetKeyLower = primaryKeyPart.toLowerCase();
  
  if (targetKeyLower === 'space') {
    keyMatch = eventKeyLower === ' ' || eventKeyLower === 'space';
  } else if (targetKeyLower === 'esc' || targetKeyLower === 'escape') {
    keyMatch = eventKeyLower === 'escape' || eventKeyLower === 'esc';
  } else if (targetKeyLower === '+') {
    keyMatch = eventKeyLower === '+' || eventKeyLower === '=';
  } else if (targetKeyLower === '=') {
    keyMatch = eventKeyLower === '=' || eventKeyLower === '+';
  } else {
    keyMatch = eventKeyLower === targetKeyLower;
  }
  
  return ctrlMatch && shiftMatch && altMatch && keyMatch;
}

// Appearance / Theme
export const appearance = persistentWritable<'system' | 'light' | 'dark'>('appearance', 'system');

// Global interface transparency (0 = solid, 100 = most see-through). Controls the
// frost/glass opacity of every surface — works with or without a background image,
// letting the desktop/acrylic (or the image) show through. Default 50 ≈ the
// app's built-in frosted look.
export const interfaceTransparency = persistentWritable<number>('interfaceTransparency', 50);

// Background image — an optional personalization layer painted behind the frosted UI.
// The image file lives in the app data dir (managed by the Rust backend); this only
// tracks whether it's currently shown.
export const backgroundImageEnabled = persistentWritable<boolean>('backgroundImageEnabled', false);

// Background image appearance (Terax-style), independent of the global interface
// transparency. Opacity 0–100 dims the image against the desktop; blur 0–60px
// softens it for legibility. Pure CSS on the html::before layer — no backend.
export const backgroundImageOpacity = persistentWritable<number>('backgroundImageOpacity', 100);
export const backgroundImageBlur = persistentWritable<number>('backgroundImageBlur', 0);

// Onboarding
export const onboardingCompleted = persistentWritable<boolean>('onboardingCompleted', false);

// Terminal
export const terminalShell = persistentWritable<string>('terminalShell', ''); // empty = auto-detect
export const terminalCursorStyle = persistentWritable<'bar' | 'block' | 'underline'>('terminalCursorStyle', 'bar');
export const terminalScrollback = persistentWritable('terminalScrollback', 5000);
export const terminalFontSize = persistentWritable('terminalFontSize', 13);
export const terminalRenderer = persistentWritable<'canvas' | 'dom'>('terminalRenderer', 'dom');

export function updateSetting(key: string, value: unknown) {
  switch (key) {
    case 'fontSize':         fontSize.set(value as number); break;
    case 'fontFamily':       fontFamily.set(value as string); break;
    case 'tabSize':          tabSize.set(value as number); break;
    case 'wordWrap':         wordWrap.set(value as boolean); break;
    case 'minimap':          minimap.set(value as boolean); break;
    case 'vimMode':          vimMode.set(value as boolean); break;
    case 'showHidden':       showHidden.set(value as boolean); break;
    case 'voiceRefinementEnabled': voiceRefinementEnabled.set(value as boolean); break;
    case 'aiProvider': aiProvider.set(value as AiProviderId); break;
    case 'aiModelByProvider': aiModelByProvider.set(value as Record<string, string>); break;
    case 'aiBaseUrlByProvider': aiBaseUrlByProvider.set(value as Record<string, string>); break;
    case 'uiZoom':           uiZoom.set(value as number); break;
    case 'formatOnSave':     formatOnSave.set(value as boolean); break;
    case 'appearance':       appearance.set(value as 'system' | 'light' | 'dark'); break;
    case 'onboardingCompleted': onboardingCompleted.set(value as boolean); break;
    case 'terminalShell':    terminalShell.set(value as string); break;
    case 'terminalFontSize': terminalFontSize.set(value as number); break;
    case 'terminalRenderer': terminalRenderer.set(value as 'canvas' | 'dom'); break;
  }
}

export function resetSettingsToDefault() {
  fontSize.set(14);
  fontFamily.set(FONT_FALLBACK);
  tabSize.set(2);
  wordWrap.set(false);
  minimap.set(false);
  vimMode.set(false);
  showHidden.set(false);
  voiceRefinementEnabled.set(true);
  aiProvider.set('openrouter');
  aiModelByProvider.set({});
  aiBaseUrlByProvider.set({});
  uiZoom.set(100);
  formatOnSave.set(true);
  userShortcuts.set(defaultShortcuts);
  appearance.set('system');
  interfaceTransparency.set(50);
  backgroundImageEnabled.set(false);
  backgroundImageOpacity.set(100);
  backgroundImageBlur.set(0);
  onboardingCompleted.set(false);
  terminalShell.set('');
  terminalCursorStyle.set('bar');
  terminalScrollback.set(5000);
  terminalFontSize.set(13);
  terminalRenderer.set('dom');
}

