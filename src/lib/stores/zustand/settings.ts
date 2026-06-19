import { create } from 'zustand';
import { getAppFlag, setAppFlag } from '$lib/services/app-flags';

export type CloseBehavior = 'quit' | 'minimize';
export type AiProviderId =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'ollama'
  | 'lmstudio';
export type VoiceInputProviderId = 'webspeech' | 'google' | 'openrouter' | 'ollama' | 'lmstudio';
export interface KeyboardShortcut {
  id: string;
  label: string;
  keys: string;
  command?: string; // Custom shell command to run in active terminal
}

const FONT_FALLBACK = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Ubuntu Mono', 'Noto Mono', Consolas, monospace";

function persistentValue<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(`forge_setting_${key}`);
    return stored !== null ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function persistValue(key: string, value: unknown) {
  try {
    localStorage.setItem(`forge_setting_${key}`, JSON.stringify(value));
  } catch {}
}

function mergeDefaultShortcuts(initial: KeyboardShortcut[]): KeyboardShortcut[] {
  // Inlined defaultShortcuts to avoid circular import
  const defaultShortcuts: KeyboardShortcut[] = [
    { id: 'commandPalette', label: 'Command Palette', keys: 'Ctrl+Shift+P' },
    { id: 'openSettings', label: 'Open Settings', keys: 'Ctrl+,' },
    { id: 'newWorkspace', label: 'New Workspace', keys: 'Ctrl+N' },
    { id: 'goToTerminal', label: 'Go to Terminal', keys: 'Ctrl+`' },
    { id: 'goToEditor', label: 'Go to Editor', keys: 'Ctrl+E' },
    { id: 'goToPreview', label: 'Go to Preview', keys: 'Ctrl+Shift+V' },
    { id: 'toggleSidebar', label: 'Toggle Sidebar', keys: 'Ctrl+B' },
    { id: 'openSearch', label: 'Search in Files', keys: 'Ctrl+Shift+F' },
    { id: 'openEnvManager', label: 'Environment Manager', keys: 'Ctrl+Shift+E' },
    { id: 'saveFile', label: 'Save File', keys: 'Ctrl+S' },
    { id: 'openFolder', label: 'Open Folder', keys: 'Ctrl+O' },
    { id: 'newTerminal', label: 'New Terminal Tab', keys: 'Ctrl+Shift+`' },
    { id: 'splitPreview', label: 'Toggle Editor + Preview Split', keys: 'Ctrl+\\' },
    { id: 'formatDocument', label: 'Format Document', keys: 'Alt+Shift+F' },
    { id: 'startProxy', label: 'Start Preview Proxy', keys: 'Ctrl+Alt+P' },
    { id: 'stopProxy', label: 'Stop Preview Proxy', keys: 'Ctrl+Alt+O' },
    { id: 'zoomIn', label: 'Zoom In', keys: 'Ctrl+=' },
    { id: 'zoomOut', label: 'Zoom Out', keys: 'Ctrl+-' },
    { id: 'resetZoom', label: 'Reset Zoom', keys: 'Ctrl+0' },
    { id: 'quickCapture', label: 'Quick Capture', keys: 'Ctrl+Shift+Space' },
    { id: 'openDailyNote', label: 'Open Daily Note', keys: 'Ctrl+Shift+D' },
    { id: 'toggleSketch', label: 'Toggle Sketch Canvas', keys: 'Ctrl+Shift+N' },
    { id: 'openPromptBar', label: 'Open Floating Bar', keys: 'Ctrl+Shift+L' },
    { id: 'launchVoiceMode', label: 'Launch Voice Mode', keys: 'Ctrl+Shift+M' },
    { id: 'canvasZoomIn', label: 'Canvas Zoom In', keys: 'Alt+=' },
    { id: 'canvasZoomOut', label: 'Canvas Zoom Out', keys: 'Alt+-' },
    { id: 'canvasResetZoom', label: 'Canvas Reset Zoom', keys: 'Alt+0' },
  ];
  if (!Array.isArray(initial)) return defaultShortcuts;
  const merged = [...initial];
  for (const def of defaultShortcuts) {
    if (!merged.some((item) => item && item.id === def.id)) {
      merged.push(def);
    }
  }
  return merged;
}

function migrateLegacySettings() {
  if (typeof localStorage === 'undefined') return;
  const legacy = localStorage.getItem('forge_setting_voiceRefinementModel');
  if (legacy) {
    try {
      const model = JSON.parse(legacy);
      if (typeof model === 'string' && model) {
        persistValue('voiceAiModelByProvider', { openrouter: model });
      }
    } catch {}
    localStorage.removeItem('forge_setting_voiceRefinementModel');
  }

  if (persistentValue('voiceConversationAiProvider', '') === '') {
    const legacyProvider = localStorage.getItem('forge_setting_aiProvider');
    if (legacyProvider) {
      try {
        const p = JSON.parse(legacyProvider);
        if (typeof p === 'string' && p) persistValue('voiceConversationAiProvider', p);
      } catch {}
    }
  }

  if (persistentValue('voiceConversationAiModelByProvider', null) === null) {
    const legacyMap = localStorage.getItem('forge_setting_aiModelByProvider');
    if (legacyMap) {
      try {
        const m = JSON.parse(legacyMap);
        if (m && typeof m === 'object' && !Array.isArray(m)) persistValue('voiceConversationAiModelByProvider', m);
      } catch {}
    }
  }

  const legacyTts = localStorage.getItem('forge_setting_ttsVoice');
  if (legacyTts) {
    try {
      const voice = JSON.parse(legacyTts);
      if (!localStorage.getItem('forge_setting_voiceConversationTtsVoiceByProvider')) {
        const next = voice === 'Arista-PlayAI' ? 'austin' : voice;
        if (typeof next === 'string' && next) persistValue('voiceConversationTtsVoiceByProvider', { groq: next });
      }
      if (voice === 'Arista-PlayAI') persistValue('ttsVoice', 'austin');
    } catch {}
  }

  const ttsModelMap = persistentValue('voiceConversationTtsModelByProvider', {}) as Record<string, string>;
  if (ttsModelMap.google === 'gemini-3.1-flash-tts-preview') {
    persistValue('voiceConversationTtsModelByProvider', { ...ttsModelMap, google: 'gemini-2.5-flash-preview-tts' });
  }
}

migrateLegacySettings();

const initialUserShortcuts = mergeDefaultShortcuts(persistentValue('userShortcuts', []));

function createSettingsState() {
  return {
    fontSize: persistentValue('fontSize', 14),
    fontFamily: persistentValue('fontFamily', FONT_FALLBACK),
    tabSize: persistentValue('tabSize', 2),
    wordWrap: persistentValue('wordWrap', false),
    minimap: persistentValue('minimap', false),
    vimMode: persistentValue('vimMode', false),
    enableLsp: persistentValue('enableLsp', true),
    showHidden: persistentValue('showHidden', false),
    notificationsEnabled: persistentValue('notificationsEnabled', true),
    closeBehavior: persistentValue<CloseBehavior>('closeBehavior', 'quit'),
    aiProvider: persistentValue<AiProviderId>('aiProvider', 'openrouter'),
    aiModelByProvider: persistentValue<Record<string, string>>('aiModelByProvider', {}),
    aiBaseUrlByProvider: persistentValue<Record<string, string>>('aiBaseUrlByProvider', {}),
    aiGhostTextEnabled: persistentValue('aiGhostTextEnabled', false),
    aiCompletionProvider: persistentValue<AiProviderId>('aiCompletionProvider', 'groq'),
    aiCompletionModelByProvider: persistentValue<Record<string, string>>('aiCompletionModelByProvider', {}),
    voiceRefinementEnabled: persistentValue('voiceRefinementEnabled', false),
    voiceInputProvider: persistentValue<VoiceInputProviderId>('voiceInputProvider', 'webspeech'),
    voiceInputModelByProvider: persistentValue<Record<string, string>>('voiceInputModelByProvider', {}),
    voiceAiProvider: persistentValue<AiProviderId>('voiceAiProvider', 'groq'),
    voiceAiModelByProvider: persistentValue<Record<string, string>>('voiceAiModelByProvider', {}),
    voiceConversationAiProvider: persistentValue<AiProviderId>('voiceConversationAiProvider', 'openrouter'),
    voiceConversationAiModelByProvider: persistentValue<Record<string, string>>('voiceConversationAiModelByProvider', {}),
    voiceConversationTtsModelByProvider: persistentValue<Record<string, string>>('voiceConversationTtsModelByProvider', {}),
    voiceConversationTtsVoiceByProvider: persistentValue<Record<string, string>>('voiceConversationTtsVoiceByProvider', {}),
    ttsVoice: persistentValue('ttsVoice', 'austin'),
    uiZoom: persistentValue('uiZoom', 100),
    formatOnSave: persistentValue('formatOnSave', true),
    userShortcuts: initialUserShortcuts,
    appearance: persistentValue<'system' | 'light' | 'dark'>('appearance', 'system'),
    interfaceTransparency: persistentValue('interfaceTransparency', 0),
    backgroundImageEnabled: persistentValue('backgroundImageEnabled', false),
    backgroundImageOpacity: persistentValue('backgroundImageOpacity', 100),
    backgroundImageBlur: persistentValue('backgroundImageBlur', 0),
    onboardingCompleted: persistentValue('onboardingCompleted', false),
    terminalShell: persistentValue('terminalShell', ''),
    terminalCursorStyle: persistentValue<'bar' | 'block' | 'underline'>('terminalCursorStyle', 'bar'),
    terminalScrollback: persistentValue('terminalScrollback', 5000),
    terminalFontSize: persistentValue('terminalFontSize', 13),
    terminalRenderer: persistentValue<'canvas' | 'dom'>('terminalRenderer', 'dom'),
    showSnapshotsTab: persistentValue('showSnapshotsTab', false),
    voicePersonality: persistentValue('voicePersonality', 'helpful'),
  };
}

type SettingsValues = ReturnType<typeof createSettingsState>;

interface SettingsActions {
  __set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;
  resetSettingsToDefault: () => void;
  updateSetting: (key: string, value: unknown) => void;
  markOnboardingCompleted: () => void;
  markOnboardingIncomplete: () => void;
}

export type SettingsState = SettingsValues & SettingsActions;

const ONBOARDING_FLAG = 'onboardingCompleted';

const defaults: SettingsValues = {
  fontSize: 14,
  fontFamily: FONT_FALLBACK,
  tabSize: 2,
  wordWrap: false,
  minimap: false,
  vimMode: false,
  enableLsp: true,
  showHidden: false,
  notificationsEnabled: true,
  closeBehavior: 'quit',
  aiProvider: 'openrouter',
  aiModelByProvider: {},
  aiBaseUrlByProvider: {},
  aiGhostTextEnabled: false,
  aiCompletionProvider: 'groq',
  aiCompletionModelByProvider: {},
  voiceRefinementEnabled: false,
  voiceInputProvider: 'webspeech',
  voiceInputModelByProvider: {},
  voiceAiProvider: 'groq',
  voiceAiModelByProvider: {},
  voiceConversationAiProvider: 'openrouter',
  voiceConversationAiModelByProvider: {},
  voiceConversationTtsModelByProvider: {},
  voiceConversationTtsVoiceByProvider: {},
  ttsVoice: 'austin',
  uiZoom: 100,
  formatOnSave: true,
  userShortcuts: [
    { id: 'commandPalette', label: 'Command Palette', keys: 'Ctrl+Shift+P' },
    { id: 'openSettings', label: 'Open Settings', keys: 'Ctrl+,' },
    { id: 'newWorkspace', label: 'New Workspace', keys: 'Ctrl+N' },
    { id: 'goToTerminal', label: 'Go to Terminal', keys: 'Ctrl+`' },
    { id: 'goToEditor', label: 'Go to Editor', keys: 'Ctrl+E' },
    { id: 'goToPreview', label: 'Go to Preview', keys: 'Ctrl+Shift+V' },
    { id: 'toggleSidebar', label: 'Toggle Sidebar', keys: 'Ctrl+B' },
    { id: 'openSearch', label: 'Search in Files', keys: 'Ctrl+Shift+F' },
    { id: 'openEnvManager', label: 'Environment Manager', keys: 'Ctrl+Shift+E' },
    { id: 'saveFile', label: 'Save File', keys: 'Ctrl+S' },
    { id: 'openFolder', label: 'Open Folder', keys: 'Ctrl+O' },
    { id: 'newTerminal', label: 'New Terminal Tab', keys: 'Ctrl+Shift+`' },
    { id: 'splitPreview', label: 'Toggle Editor + Preview Split', keys: 'Ctrl+\\' },
    { id: 'formatDocument', label: 'Format Document', keys: 'Alt+Shift+F' },
    { id: 'startProxy', label: 'Start Preview Proxy', keys: 'Ctrl+Alt+P' },
    { id: 'stopProxy', label: 'Stop Preview Proxy', keys: 'Ctrl+Alt+O' },
    { id: 'zoomIn', label: 'Zoom In', keys: 'Ctrl+=' },
    { id: 'zoomOut', label: 'Zoom Out', keys: 'Ctrl+-' },
    { id: 'resetZoom', label: 'Reset Zoom', keys: 'Ctrl+0' },
    { id: 'quickCapture', label: 'Quick Capture', keys: 'Ctrl+Shift+Space' },
    { id: 'openDailyNote', label: 'Open Daily Note', keys: 'Ctrl+Shift+D' },
    { id: 'toggleSketch', label: 'Toggle Sketch Canvas', keys: 'Ctrl+Shift+N' },
    { id: 'openPromptBar', label: 'Open Floating Bar', keys: 'Ctrl+Shift+L' },
    { id: 'launchVoiceMode', label: 'Launch Voice Mode', keys: 'Ctrl+Shift+M' },
    { id: 'canvasZoomIn', label: 'Canvas Zoom In', keys: 'Alt+=' },
    { id: 'canvasZoomOut', label: 'Canvas Zoom Out', keys: 'Alt+-' },
    { id: 'canvasResetZoom', label: 'Canvas Reset Zoom', keys: 'Alt+0' },
  ],
  appearance: 'system',
  interfaceTransparency: 0,
  backgroundImageEnabled: false,
  backgroundImageOpacity: 100,
  backgroundImageBlur: 0,
  onboardingCompleted: false,
  terminalShell: '',
  terminalCursorStyle: 'bar',
  terminalScrollback: 5000,
  terminalFontSize: 13,
  terminalRenderer: 'dom',
  showSnapshotsTab: false,
  voicePersonality: 'helpful',
};

export const useSettingsStore = create<SettingsState>((set, getState) => ({
  ...createSettingsState(),

  __set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    set({ [key]: value });
    persistValue(key as string, value);
  },

  resetSettingsToDefault: () => {
    set(defaults);
    for (const [key, value] of Object.entries(defaults)) {
      persistValue(key, value);
    }
    setAppFlag(ONBOARDING_FLAG, 'false');
  },

  updateSetting: (key: string, value: unknown) => {
    const setters: Record<string, keyof SettingsValues> = {
      fontSize: 'fontSize',
      fontFamily: 'fontFamily',
      tabSize: 'tabSize',
      wordWrap: 'wordWrap',
      minimap: 'minimap',
      vimMode: 'vimMode',
      enableLsp: 'enableLsp',
      aiGhostTextEnabled: 'aiGhostTextEnabled',
      aiCompletionProvider: 'aiCompletionProvider',
      aiCompletionModelByProvider: 'aiCompletionModelByProvider',
      showHidden: 'showHidden',
      voiceRefinementEnabled: 'voiceRefinementEnabled',
      voiceInputProvider: 'voiceInputProvider',
      voiceInputModelByProvider: 'voiceInputModelByProvider',
      voiceAiProvider: 'voiceAiProvider',
      voiceAiModelByProvider: 'voiceAiModelByProvider',
      voiceConversationAiProvider: 'voiceConversationAiProvider',
      voiceConversationAiModelByProvider: 'voiceConversationAiModelByProvider',
      voiceConversationTtsModelByProvider: 'voiceConversationTtsModelByProvider',
      voiceConversationTtsVoiceByProvider: 'voiceConversationTtsVoiceByProvider',
      aiProvider: 'aiProvider',
      aiModelByProvider: 'aiModelByProvider',
      aiBaseUrlByProvider: 'aiBaseUrlByProvider',
      uiZoom: 'uiZoom',
      formatOnSave: 'formatOnSave',
      closeBehavior: 'closeBehavior',
      appearance: 'appearance',
      onboardingCompleted: 'onboardingCompleted',
      terminalShell: 'terminalShell',
      terminalFontSize: 'terminalFontSize',
      terminalRenderer: 'terminalRenderer',
      showSnapshotsTab: 'showSnapshotsTab',
      voicePersonality: 'voicePersonality',
    };
    const stateKey = setters[key];
    if (stateKey) {
      const s = getState();
      (s as any).__set(stateKey, value);
    }
  },

  markOnboardingCompleted: () => {
    set({ onboardingCompleted: true });
    persistValue('onboardingCompleted', true);
    setAppFlag(ONBOARDING_FLAG, 'true');
  },

  markOnboardingIncomplete: () => {
    set({ onboardingCompleted: false });
    persistValue('onboardingCompleted', false);
    setAppFlag(ONBOARDING_FLAG, 'false');
  },
}));
