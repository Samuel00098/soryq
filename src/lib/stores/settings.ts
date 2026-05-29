import { writable, derived } from 'svelte/store';

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

// Voice Refinement
export const voiceRefinementModelOptions = [
  { id: 'anthropic/claude-sonnet-4.5' as const, label: 'Claude Sonnet 4.5', description: 'Best overall quality for prompt rewriting.' },
  { id: 'anthropic/claude-haiku-4.5' as const, label: 'Claude Haiku 4.5', description: 'Best cheap Claude option.' },
  { id: 'google/gemini-2.5-flash' as const, label: 'Google Gemini 2.5 Flash', description: 'Best balance of quality and speed.' },
  { id: 'google/gemini-2.5-flash-lite' as const, label: 'Google Gemini 2.5 Flash Lite', description: 'Cheaper and faster Google fallback.' },
  { id: 'anthropic/claude-3.5-haiku' as const, label: 'Claude 3.5 Haiku', description: 'Fast, polished rewrites.' },
  { id: 'qwen/qwen3-30b-a3b-instruct-2507' as const, label: 'Qwen3 30B Instruct', description: 'Very cheap, solid fallback.' },
  { id: 'qwen/qwen-2.5-7b-instruct' as const, label: 'Qwen 2.5 7B Instruct', description: 'Ultra-cheap fallback.' },
  { id: 'google/gemma-4-31b-it:free' as const, label: 'Google Gemma 4 31B (free)', description: 'Free Google option.' },
  { id: 'google/gemma-4-26b-a4b-it:free' as const, label: 'Google Gemma 4 26B A4B (free)', description: 'Free Google fallback.' },
] as const;

export type VoiceRefinementModelId = (typeof voiceRefinementModelOptions)[number]['id'];
export const voiceRefinementEnabled = persistentWritable('voiceRefinementEnabled', true);
export const voiceRefinementModel = persistentWritable<VoiceRefinementModelId>('voiceRefinementModel', 'google/gemini-2.5-flash');
 
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
    case 'voiceRefinementModel': voiceRefinementModel.set(value as VoiceRefinementModelId); break;
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
  voiceRefinementModel.set('google/gemini-2.5-flash');
  uiZoom.set(100);
  formatOnSave.set(true);
  userShortcuts.set(defaultShortcuts);
  appearance.set('system');
  onboardingCompleted.set(false);
  terminalShell.set('');
  terminalCursorStyle.set('bar');
  terminalScrollback.set(5000);
  terminalFontSize.set(13);
  terminalRenderer.set('dom');
}

