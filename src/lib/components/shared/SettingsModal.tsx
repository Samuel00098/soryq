import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import packageJson from '../../../../package.json';
import {
  aiBaseUrlByProvider,
  aiCompletionModelByProvider,
  aiCompletionProvider,
  aiGhostTextEnabled,
  aiProvider,
  aiProviders,
  appearance,
  backgroundImageBlur,
  backgroundImageEnabled,
  backgroundImageOpacity,
  closeBehavior,
  currentAiModel,
  currentVoiceAiModel,
  currentVoiceConversationAiModel,
  currentVoiceConversationTtsModel,
  currentVoiceConversationTtsVoice,
  currentVoiceInputModel,
  defaultShortcuts,
  enableLsp,
  fontFamily,
  fontSize,
  formatOnSave,
  getProviderBaseUrl,
  getProviderDef,
  getTtsModelOptions,
  getTtsVoiceOptionsForModel,
  getVoiceInputModelOptions,
  interfaceTransparency,
  isLocalProvider,
  minimap,
  notificationsEnabled,
  resetSettingsToDefault,
  setAiModel,
  setProviderBaseUrl,
  setVoiceAiModel,
  setVoiceConversationAiModel,
  setVoiceConversationTtsModel,
  setVoiceConversationTtsVoice,
  setVoiceInputModel,
  showHidden,
  tabSize,
  terminalCursorStyle,
  terminalFontSize,
  terminalRenderer,
  terminalScrollback,
  terminalShell,
  uiZoom,
  userShortcuts,
  vimMode,
  voiceAiProvider,
  voiceConversationAiProvider,
  voiceInputProvider,
  voiceInputUsesModelTranscription,
  voiceRefinementEnabled,
  wordWrap,
  type AiModelOption,
  type AiProviderId,
  type KeyboardShortcut,
  type VoiceInputProviderId,
} from '$lib/stores/settings';
import { clearProviderApiKey, listProviderModels, providerApiKeyExists, saveProviderApiKey } from '$lib/services/ai-keychain';
import { requestNotificationPermission, showToast } from '$lib/stores/notification';
import { checkForUpdate, installUpdate, pendingUpdate, updateChecking, updateDownloading, updateProgress } from '$lib/stores/updater';
import { get } from '$lib/stores/storeCompat';
import { useStore } from '$lib/react/useStore';
import { isTauriRuntime } from '$lib/utils/tauri';
import { activeTheme, switchPresetTheme, saveTheme, importTheme, themeColorFields } from '$lib/stores/theme';
import { presetThemes } from '$lib/stores/presetThemes';
import { chooseBackgroundImage, removeBackgroundImage, backgroundImagePresent } from '$lib/stores/background';
import { getAvailableShells, type ShellInfo } from '$lib/services/pty-bridge';
import './SettingsModal.css';

type Tab = 'general' | 'appearance' | 'models' | 'voice' | 'terminal' | 'shortcuts' | 'about';

type SettingsModalProps = {
  onclose: () => void;
};

const tabs: { id: Tab; label: string; kicker: string }[] = [
  { id: 'general', label: 'General', kicker: 'Editor and app' },
  { id: 'appearance', label: 'Appearance', kicker: 'Window and media' },
  { id: 'models', label: 'AI Models', kicker: 'Providers and keys' },
  { id: 'voice', label: 'Voice', kicker: 'Input, reply, TTS' },
  { id: 'terminal', label: 'Terminal', kicker: 'Shell and rendering' },
  { id: 'shortcuts', label: 'Shortcuts', kicker: 'Keyboard map' },
  { id: 'about', label: 'About', kicker: 'Version and reset' },
];

const voiceInputProviders: { id: VoiceInputProviderId; label: string }[] = [
  { id: 'webspeech', label: 'System speech' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'lmstudio', label: 'LM Studio' },
];

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={classNames('settings-toggle', checked && 'active')}
      onClick={() => onChange(!checked)}
      aria-label={label}
      aria-pressed={checked}
    >
      <span />
    </button>
  );
}

function StyledSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const selectedLabel = options.find((o) => o.id === value)?.label ?? value;

  const close = useCallback(() => setOpen(false), []);

  // Compute panel position from trigger's rect relative to the settings modal
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    
    const modal = document.querySelector('.settings-modal');
    if (!modal) return;
    
    const modalRect = modal.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    
    const relativeTop = rect.bottom - modalRect.top;
    const relativeLeft = rect.left - modalRect.left;
    
    const spaceBelow = modalRect.bottom - rect.bottom;
    const spaceAbove = rect.top - modalRect.top;
    const openDown = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    
    if (openDown) {
      setPanelStyle({
        position: 'absolute',
        top: relativeTop + 6,
        left: relativeLeft,
        width: rect.width,
        maxHeight: Math.min(240, spaceBelow - 12),
      });
    } else {
      setPanelStyle({
        position: 'absolute',
        bottom: modalRect.height - (rect.top - modalRect.top) + 6,
        left: relativeLeft,
        width: rect.width,
        maxHeight: Math.min(240, spaceAbove - 12),
      });
    }
  }, []);

  // Open: measure position then show
  const toggle = useCallback(() => {
    if (!open) updatePosition();
    setOpen((v) => !v);
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    function onScroll() { updatePosition(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close, updatePosition]);

  const panel = open
    ? createPortal(
        <ul
          ref={panelRef}
          className="sselect-panel"
          role="listbox"
          style={panelStyle}
        >
          {options.map((opt) => (
            <li
              key={opt.id}
              role="option"
              aria-selected={opt.id === value}
              className={`sselect-option${opt.id === value ? ' selected' : ''}`}
              onMouseDown={() => { onChange(opt.id); setOpen(false); }}
            >
              {opt.id === value && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {opt.label}
            </li>
          ))}
        </ul>,
        document.querySelector('.settings-modal') || document.body,
      )
    : null;

  return (
    <div className={`sselect${open ? ' open' : ''}`} aria-label={ariaLabel}>
      <button
        ref={triggerRef}
        type="button"
        className="sselect-trigger"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="sselect-value">{selectedLabel}</span>
        <svg className="sselect-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {panel}
    </div>
  );
}

// Alias — SelectField and ModelSelect both now use StyledSelect under the hood
function SelectField<T extends string>(props: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return <StyledSelect {...props} />;
}

function SettingRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-control-row">
      <div className="settings-control-copy">
        <span>{title}</span>
        {detail && <small>{detail}</small>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-card">
      <h3>{title}</h3>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}

function ModelSelect({
  value,
  models,
  onChange,
  label,
}: {
  value: string;
  models: AiModelOption[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <StyledSelect
      value={value}
      options={models.map((m) => ({ id: m.id, label: m.label }))}
      onChange={onChange}
      ariaLabel={label}
    />
  );
}

function ShortcutEditor({
  shortcuts,
  onUpdate,
}: {
  shortcuts: KeyboardShortcut[];
  onUpdate: (id: string, keys: string) => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, KeyboardShortcut[]>();
    for (const shortcut of shortcuts) {
      const category = shortcut.id.startsWith('canvas')
        ? 'Canvas'
        : shortcut.id.includes('Terminal') || shortcut.id === 'newTerminal'
          ? 'Terminal'
          : shortcut.id.includes('zoom') || shortcut.id.includes('Zoom')
            ? 'Window'
            : shortcut.id.includes('Preview') || shortcut.id.includes('proxy')
              ? 'Preview'
              : shortcut.id.includes('File') || shortcut.id.includes('Folder')
                ? 'File'
                : shortcut.id.includes('Voice')
                  ? 'Voice'
                  : 'Workspace';
      groups.set(category, [...(groups.get(category) ?? []), shortcut]);
    }
    return [...groups.entries()];
  }, [shortcuts]);

  return (
    <div className="shortcut-groups">
      {grouped.map(([group, items]) => (
        <div className="shortcut-group" key={group}>
          <h4>{group}</h4>
          {items.map((shortcut) => (
            <label className="shortcut-row" key={shortcut.id}>
              <span>{shortcut.label}</span>
              <input value={shortcut.keys} onChange={(event) => onUpdate(shortcut.id, event.target.value)} />
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function SettingsModal({ onclose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keyExists, setKeyExists] = useState(false);
  const [providerLiveModels, setProviderLiveModels] = useState<Record<string, AiModelOption[]>>({});
  const [modelLoading, setModelLoading] = useState(false);
  const [localUrlInput, setLocalUrlInput] = useState('');
  const providerLiveModelsRef = useRef<Record<string, AiModelOption[]>>({});

  useEffect(() => {
    providerLiveModelsRef.current = providerLiveModels;
  }, [providerLiveModels]);
  const [updateMessage, setUpdateMessage] = useState('');
  const [showingCustomThemeEditor, setShowingCustomThemeEditor] = useState(false);
  const [customThemeName, setCustomThemeName] = useState('');
  const [customThemeId, setCustomThemeId] = useState('');
  const [customThemeColors, setCustomThemeColors] = useState<Record<string, string>>({});
  const [customThemeSyntax, setCustomThemeSyntax] = useState<Record<string, string>>({});
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);

  const currentActiveTheme = useStore(activeTheme);
  const bgPresent = useStore(backgroundImagePresent);
  const panelRef = useRef<HTMLElement | null>(null);

  const currentFontSize = useStore(fontSize);
  const currentFontFamily = useStore(fontFamily);
  const currentTabSize = useStore(tabSize);
  const currentWordWrap = useStore(wordWrap);
  const currentMinimap = useStore(minimap);
  const currentVimMode = useStore(vimMode);
  const currentEnableLsp = useStore(enableLsp);
  const currentShowHidden = useStore(showHidden);
  const currentNotifications = useStore(notificationsEnabled);
  const currentCloseBehavior = useStore(closeBehavior);
  const currentZoom = useStore(uiZoom);
  const currentFormatOnSave = useStore(formatOnSave);
  const currentAppearance = useStore(appearance);
  const currentTransparency = useStore(interfaceTransparency);
  const bgEnabled = useStore(backgroundImageEnabled);
  const bgOpacity = useStore(backgroundImageOpacity);
  const bgBlur = useStore(backgroundImageBlur);
  const provider = useStore(aiProvider);
  const model = useStore(currentAiModel);
  const shortcuts = useStore(userShortcuts);
  const shell = useStore(terminalShell);
  const termFontSize = useStore(terminalFontSize);
  const scrollback = useStore(terminalScrollback);
  const cursorStyle = useStore(terminalCursorStyle);
  const renderer = useStore(terminalRenderer);
  const update = useStore(pendingUpdate);
  const checking = useStore(updateChecking);
  const downloading = useStore(updateDownloading);
  const progress = useStore(updateProgress);
  const completionEnabled = useStore(aiGhostTextEnabled);
  const completionProvider = useStore(aiCompletionProvider);
  const completionModelMap = useStore(aiCompletionModelByProvider);
  const voiceInput = useStore(voiceInputProvider);
  const voiceInputModel = useStore(currentVoiceInputModel);
  const voiceRefinement = useStore(voiceRefinementEnabled);
  const refinementProvider = useStore(voiceAiProvider);
  const refinementModel = useStore(currentVoiceAiModel);
  const conversationProvider = useStore(voiceConversationAiProvider);
  const conversationModel = useStore(currentVoiceConversationAiModel);
  const ttsModel = useStore(currentVoiceConversationTtsModel);
  const ttsVoice = useStore(currentVoiceConversationTtsVoice);
  const baseUrls = useStore(aiBaseUrlByProvider);

  const providerDef = getProviderDef(provider);
  const models = providerLiveModels[provider] ?? providerDef.models;
  const localProvider = isLocalProvider(provider);
  const selectedModel = models.find((item) => item.id === model) ?? providerDef.models.find((item) => item.id === model);
  const completionDef = getProviderDef(completionProvider);
  const completionModels = completionDef.models;
  const completionModel = completionModelMap[completionProvider] || completionDef.defaultModel;
  const voiceInputModels = getVoiceInputModelOptions(voiceInput);
  const refinementModels = getProviderDef(refinementProvider).models;
  const conversationModels = getProviderDef(conversationProvider).models;
  const ttsModels = getTtsModelOptions(conversationProvider);
  const ttsVoices = getTtsVoiceOptionsForModel(conversationProvider, ttsModel);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onclose();
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [onclose]);

  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  // Load available shells once on mount
  useEffect(() => {
    getAvailableShells().then(setAvailableShells).catch(() => setAvailableShells([]));
  }, []);

  const loadLiveModels = useCallback(async (prov: AiProviderId, force = false) => {
    if (!isTauriRuntime()) return;
    
    const isLocal = isLocalProvider(prov);
    const hasKey = isLocal ? true : await providerApiKeyExists(prov).catch(() => false);
    
    if (!hasKey) {
      setProviderLiveModels((prev) => {
        if (!prev[prov]) return prev;
        const next = { ...prev };
        delete next[prov];
        return next;
      });
      return;
    }

    if (!force && providerLiveModelsRef.current[prov]) {
      return;
    }
    
    setModelLoading(true);
    try {
      const remote = await listProviderModels(prov);
      const curated = new Map(getProviderDef(prov).models.map((m) => [m.id, m]));
      const merged: AiModelOption[] = remote.map((r) => {
        const c = curated.get(r.id);
        return {
          id: r.id,
          label: c?.label ?? r.label ?? r.id,
          description: c?.description ?? r.description ?? '',
          free: c?.free ?? r.id.endsWith(':free'),
        };
      });
      const finalModels = merged.length ? merged : getProviderDef(prov).models;
      setProviderLiveModels((prev) => ({
        ...prev,
        [prov]: finalModels,
      }));
    } catch (err) {
      console.error('Failed to load models for provider:', prov, err);
    } finally {
      setModelLoading(false);
    }
  }, []);

  useEffect(() => {
    setApiKeyInput('');
    if (!isTauriRuntime()) {
      setKeyExists(false);
      return;
    }
    let active = true;
    providerApiKeyExists(provider)
      .then((exists) => {
        if (!active) return;
        setKeyExists(exists);
        const isLocal = isLocalProvider(provider);
        if (exists || isLocal) {
          void loadLiveModels(provider);
        }
      })
      .catch(() => {
        if (!active) return;
        setKeyExists(false);
      });
    return () => {
      active = false;
    };
  }, [provider, loadLiveModels]);

  useEffect(() => {
    setLocalUrlInput(getProviderBaseUrl(provider, baseUrls) || '');
  }, [provider, baseUrls]);

  const handleSaveLocalUrl = useCallback((val: string) => {
    const trimmed = val.trim();
    setProviderBaseUrl(provider, trimmed);
    showToast(`${providerDef.label} server URL saved`, 'success');
    void loadLiveModels(provider, true);
  }, [provider, providerDef.label, loadLiveModels]);

  const handleResetLocalUrl = useCallback(() => {
    const defaultUrl = providerDef.defaultBaseUrl ?? '';
    setLocalUrlInput(defaultUrl);
    setProviderBaseUrl(provider, defaultUrl);
    showToast(`${providerDef.label} server URL reset to default`, 'info');
    void loadLiveModels(provider, true);
  }, [provider, providerDef, loadLiveModels]);

  async function saveKey() {
    if (!apiKeyInput.trim()) return;
    if (!isTauriRuntime()) {
      showToast('Keychain is available in the desktop app.', 'info');
      return;
    }
    await saveProviderApiKey(provider, apiKeyInput);
    setApiKeyInput('');
    setKeyExists(true);
    showToast(`${providerDef.label} key saved`, 'success');
    void loadLiveModels(provider, true);
  }

  async function clearKey() {
    if (!isTauriRuntime()) {
      showToast('Keychain is available in the desktop app.', 'info');
      return;
    }
    await clearProviderApiKey(provider);
    setKeyExists(false);
    setProviderLiveModels((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
    showToast(`${providerDef.label} key removed`, 'success');
  }

  async function refreshModels() {
    if (!isTauriRuntime()) {
      showToast('Live model refresh is available in the desktop app.', 'info');
      return;
    }
    await loadLiveModels(provider, true);
    showToast('Model list refreshed', 'success');
  }

  async function checkUpdates() {
    setUpdateMessage('');
    if (!isTauriRuntime()) {
      setUpdateMessage('Update checks are available in the desktop app.');
      return;
    }
    try {
      await checkForUpdate();
      const latest = get(pendingUpdate);
      setUpdateMessage(latest ? `Update available: v${latest.version}` : 'Soryq is up to date.');
    } catch {
      setUpdateMessage('Could not check for updates.');
    }
  }

  function updateShortcut(id: string, keys: string) {
    userShortcuts.set(shortcuts.map((shortcut) => (shortcut.id === id ? { ...shortcut, keys } : shortcut)));
  }

  async function handleImportTheme() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const theme = await importTheme(file);
        await saveTheme(theme);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(message || 'Failed to import theme', 'error');
      }
    };
    input.click();
  }

  function openCustomThemeEditor() {
    setCustomThemeName('');
    setCustomThemeId('');
    setCustomThemeColors({
      'bg-primary': '#1e1e1e',
      'bg-secondary': '#252526',
      'bg-tertiary': '#2d2d2d',
      'bg-hover': '#333333',
      'bg-active': '#3c3c3c',
      'text-primary': '#d4d4d4',
      'text-secondary': '#ababab',
      'text-muted': '#6e6e6e',
      'accent': '#007acc',
      'accent-hover': '#1a8ad4',
      'border': '#3c3c3c',
      'error': '#f48771',
      'warning': '#cca700',
      'success': '#4ec9b0',
      'info': '#3794ff',
      'button-bg': '#007acc',
      'button-text': '#ffffff',
      'terminal-bg': '#1e1e1e',
      'titlebar-bg': '#181818',
      'statusbar-bg': '#007acc',
      'statusbar-text': '#ffffff',
    });
    setCustomThemeSyntax({
      'keyword': '#569cd6',
      'string': '#ce9178',
      'number': '#b5cea8',
      'comment': '#6a9955',
      'function': '#dcdcaa',
      'variable': '#d4d4d4',
      'type': '#4ec9b0',
      'operator': '#d4d4d4',
      'constant': '#4fc1ff',
      'tag': '#569cd6',
      'attribute': '#9cdcfe',
    });
    setShowingCustomThemeEditor(true);
  }

  function handleSaveCustomTheme() {
    if (!customThemeName.trim()) {
      showToast('Please enter a theme name', 'error');
      return;
    }
    const rawId = customThemeId.trim() || customThemeName.toLowerCase().replace(/\s+/g, '-');
    const id = rawId.replace(/[^a-z0-9_-]/g, '').slice(0, 64);
    if (!id) {
      showToast('Theme ID contains no valid characters (use a-z, 0-9, - or _)', 'error');
      return;
    }
    const theme = {
      id,
      name: customThemeName.trim(),
      type: 'dark' as const,
      colors: customThemeColors,
      syntax: customThemeSyntax,
    };
    saveTheme(theme).catch(e => {
      showToast(`Failed to save theme: ${e?.message || e}`, 'error');
    });
    setShowingCustomThemeEditor(false);
  }

  function resetAllSettings() {
    if (!window.confirm('Reset all settings to defaults?')) return;
    resetSettingsToDefault();
    showToast('Settings reset to defaults', 'success');
  }

  return (
    <div className="settings-overlay" onClick={onclose}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
        <header className="settings-header">
          <div>
            <span className="settings-eyebrow">Preferences</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button className="settings-close" onClick={onclose} aria-label="Close settings">x</button>
        </header>

        <div className="settings-body">
          <nav className="settings-tabs" aria-label="Settings sections">
            {tabs.map((tab) => (
              <button key={tab.id} className={activeTab === tab.id ? 'active' : undefined} onClick={() => setActiveTab(tab.id)}>
                <span>{tab.label}</span>
                <small>{tab.kicker}</small>
              </button>
            ))}
          </nav>

          <main className="settings-panel" ref={panelRef}>
            {activeTab === 'general' && (
              <>
                <Section title="Editor">
                  <SettingRow title="Font size" detail={`${currentFontSize}px`}>
                    <div className="num-control">
                      <button className="num-btn" onClick={() => fontSize.set(Math.max(10, currentFontSize - 1))}>−</button>
                      <span className="num-val">{currentFontSize}</span>
                      <button className="num-btn" onClick={() => fontSize.set(Math.min(32, currentFontSize + 1))}>+</button>
                    </div>
                  </SettingRow>
                  <SettingRow title="Font family" detail="Editor and terminal">
                    <input value={currentFontFamily} onChange={(event) => fontFamily.set(event.target.value)} placeholder="'JetBrains Mono', monospace" spellCheck={false} />
                  </SettingRow>
                  <SettingRow title="Tab size" detail={`${currentTabSize} spaces`}>
                    <div className="num-control">
                      <button className="num-btn" onClick={() => tabSize.set(Math.max(1, currentTabSize - 1))}>−</button>
                      <span className="num-val">{currentTabSize}</span>
                      <button className="num-btn" onClick={() => tabSize.set(Math.min(8, currentTabSize + 1))}>+</button>
                    </div>
                  </SettingRow>
                  <SettingRow title="Word wrap">
                    <Toggle label="Toggle word wrap" checked={currentWordWrap} onChange={wordWrap.set} />
                  </SettingRow>
                  <SettingRow title="Format on save">
                    <Toggle label="Toggle format on save" checked={currentFormatOnSave} onChange={formatOnSave.set} />
                  </SettingRow>
                  <SettingRow title="Language server">
                    <Toggle label="Toggle language server" checked={currentEnableLsp} onChange={enableLsp.set} />
                  </SettingRow>
                  <SettingRow title="Minimap">
                    <Toggle label="Toggle minimap" checked={currentMinimap} onChange={minimap.set} />
                  </SettingRow>
                  <SettingRow title="Vim mode">
                    <Toggle label="Toggle Vim mode" checked={currentVimMode} onChange={vimMode.set} />
                  </SettingRow>
                </Section>

                <Section title="Workspace">
                  <SettingRow title="Show hidden files" detail="Include dot-prefixed files in the explorer">
                    <Toggle label="Toggle hidden files" checked={currentShowHidden} onChange={showHidden.set} />
                  </SettingRow>
                  <SettingRow title="Notifications" detail="System alerts for agent activity and process exits">
                    <Toggle
                      label="Toggle notifications"
                      checked={currentNotifications}
                      onChange={(checked) => {
                        notificationsEnabled.set(checked);
                        if (checked) void requestNotificationPermission();
                      }}
                    />
                  </SettingRow>
                </Section>

                <Section title="Window">
                  <div className="option-cards" style={{ padding: '14px', gap: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    {([
                      { id: 'quit' as const,     label: 'Quit Soryq',    desc: 'Close the app and stop live terminals.' },
                      { id: 'minimize' as const, label: 'Keep running',  desc: 'Minimize and keep terminals and agents alive.' },
                    ]).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`option-card${currentCloseBehavior === opt.id ? ' selected' : ''}`}
                        onClick={() => closeBehavior.set(opt.id)}
                      >
                        <span className="option-title">{opt.label}</span>
                        <span className="option-desc">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </Section>
              </>
            )}

            {activeTab === 'appearance' && (
              <>
                <Section title="Theme">
                  {/* Appearance mode — visual cards */}
                  <div className="appearance-cards" style={{ padding: '16px 18px 10px' }}>
                    {([
                      { id: 'system' as const, label: 'System',
                        icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> },
                      { id: 'light'  as const, label: 'Light',
                        icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg> },
                      { id: 'dark'   as const, label: 'Dark',
                        icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg> },
                    ]).map(({ id, label, icon }) => (
                      <button
                        key={id}
                        type="button"
                        className={`appearance-card${currentAppearance === id ? ' selected' : ''}`}
                        onClick={() => appearance.set(id)}
                      >
                        <span className="appearance-icon">{icon}</span>
                        <span className="appearance-label">{label}</span>
                      </button>
                    ))}
                  </div>
                  <SettingRow title="UI zoom" detail={`${currentZoom}%`}>
                    <div className="num-control">
                      <button className="num-btn" onClick={() => uiZoom.set(Math.max(50, currentZoom - 10))}>−</button>
                      <span className="num-val">{currentZoom}%</span>
                      <button className="num-btn" onClick={() => uiZoom.set(Math.min(200, currentZoom + 10))}>+</button>
                      <button className="num-btn-reset" onClick={() => uiZoom.set(100)}>Reset</button>
                    </div>
                  </SettingRow>
                  <SettingRow title="Transparency" detail={`${currentTransparency}%`}>
                    <input type="range" min="0" max="100" step="5" value={currentTransparency} onChange={(event) => interfaceTransparency.set(Number(event.target.value))} />
                  </SettingRow>
                </Section>

                {showingCustomThemeEditor ? (
                  <Section title="Custom Theme Editor">
                    <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="ct-field">
                        <span className="ct-label">Theme Name</span>
                        <input className="settings-control input" style={{ height: '34px', width: '100%', padding: '0 10px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} type="text" value={customThemeName} onChange={(e) => setCustomThemeName(e.target.value)} placeholder="My Custom Theme" />
                      </div>
                      <div className="ct-field">
                        <span className="ct-label">Theme ID</span>
                        <input className="settings-control input" style={{ height: '34px', width: '100%', padding: '0 10px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} type="text" value={customThemeId} onChange={(e) => setCustomThemeId(e.target.value)} placeholder="my-custom-theme (auto)" />
                      </div>
                      <div className="ct-section-label">Interface Colors</div>
                      <div className="ct-grid">
                        {themeColorFields.filter(f => f.category === 'colors').map(field => (
                          <div className="ct-color-field" key={field.key}>
                            <span className="ct-color-label">{field.label}</span>
                            <input className="color-input" type="color" value={customThemeColors[field.key] || '#000000'} onChange={(e) => setCustomThemeColors({ ...customThemeColors, [field.key]: e.target.value })} />
                          </div>
                        ))}
                      </div>
                      <div className="ct-section-label">Syntax Colors</div>
                      <div className="ct-grid">
                        {themeColorFields.filter(f => f.category === 'syntax').map(field => (
                          <div className="ct-color-field" key={field.key}>
                            <span className="ct-color-label">{field.label}</span>
                            <input className="color-input" type="color" value={customThemeSyntax[field.key] || '#000000'} onChange={(e) => setCustomThemeSyntax({ ...customThemeSyntax, [field.key]: e.target.value })} />
                          </div>
                        ))}
                      </div>
                      <div className="ct-actions">
                        <button className="ct-btn" onClick={() => setShowingCustomThemeEditor(false)}>Cancel</button>
                        <button className="ct-btn primary" onClick={handleSaveCustomTheme}>Save Theme</button>
                      </div>
                    </div>
                  </Section>
                ) : (
                  <Section title="Color Themes">
                    <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="theme-grid">
                        {presetThemes.map(theme => (
                          <button
                            key={theme.id}
                            className={`theme-card ${currentActiveTheme?.id === theme.id ? 'active' : ''}`}
                            onClick={() => switchPresetTheme(theme.id)}
                          >
                            <div className="theme-preview">
                              {['keyword', 'string', 'function', 'type', 'constant'].map((syntaxKey, i) => {
                                const defaultColors = ['#ff7b72', '#a5d6ff', '#d2a8ff', '#7ee787', '#79c0ff'];
                                return (
                                  <span
                                    key={syntaxKey}
                                    className="preview-bar"
                                    style={{ background: theme.syntax[syntaxKey] || defaultColors[i] }}
                                  />
                                );
                              })}
                            </div>
                            <div className="theme-meta">
                              <span className="theme-name">{theme.name}</span>
                              {currentActiveTheme?.id === theme.id && (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="theme-actions">
                        <button className="theme-action-btn" onClick={handleImportTheme}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Import Theme
                        </button>
                        <button className="theme-action-btn" onClick={openCustomThemeEditor}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                          </svg>
                          Create Custom Theme
                        </button>
                      </div>
                    </div>
                  </Section>
                )}

                <Section title="Background">
                  <SettingRow title="Custom background" detail="Show an image or live wallpaper behind the interface.">
                    <div className="bg-actions">
                      <button className="bg-btn" onClick={chooseBackgroundImage}>
                        {bgPresent ? 'Change…' : 'Choose…'}
                      </button>
                      {bgPresent && (
                        <button className="bg-btn bg-btn-danger" onClick={removeBackgroundImage}>Remove</button>
                      )}
                    </div>
                  </SettingRow>
                  <SettingRow title="Media background">
                    <Toggle label="Toggle background media" checked={bgEnabled} onChange={backgroundImageEnabled.set} />
                  </SettingRow>
                  <SettingRow title="Opacity" detail={`${bgOpacity}%`}>
                    <input type="range" min="0" max="100" step="5" value={bgOpacity} onChange={(event) => backgroundImageOpacity.set(Number(event.target.value))} disabled={!bgEnabled} />
                  </SettingRow>
                  <SettingRow title="Blur" detail={`${bgBlur}px`}>
                    <input type="range" min="0" max="24" step="1" value={bgBlur} onChange={(event) => backgroundImageBlur.set(Number(event.target.value))} disabled={!bgEnabled} />
                  </SettingRow>
                </Section>
              </>
            )}

            {activeTab === 'models' && (
              <>
                <Section title="Primary provider">
                  <SettingRow title="Provider" detail="Main AI provider for orchestration & AI commits">
                    <SelectField value={provider} options={aiProviders.map((item) => ({ id: item.id, label: item.label }))} onChange={aiProvider.set} ariaLabel="AI provider" />
                  </SettingRow>

                  {localProvider ? (
                    <>
                      <SettingRow title={providerDef.keyLabel}>
                        <input
                          value={localUrlInput}
                          onChange={(event) => setLocalUrlInput(event.target.value)}
                          placeholder={providerDef.keyPlaceholder}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              handleSaveLocalUrl(localUrlInput);
                            }
                          }}
                        />
                      </SettingRow>
                      <div className="settings-action-row">
                        <button className="settings-primary" onClick={() => handleSaveLocalUrl(localUrlInput)}>Save URL</button>
                        <button className="settings-secondary" onClick={handleResetLocalUrl}>Reset</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <SettingRow title={providerDef.keyLabel} detail={keyExists ? 'Saved' : 'Not saved'}>
                        <input type="password" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} placeholder={keyExists ? 'Key saved in OS keychain' : providerDef.keyPlaceholder} />
                      </SettingRow>
                      <div className="settings-action-row">
                        <button className="settings-primary" onClick={() => void saveKey()} disabled={!apiKeyInput.trim()}>Save key</button>
                        <button className="settings-secondary" onClick={() => void clearKey()} disabled={!keyExists}>Clear key</button>
                        <a className="settings-link-button" href={providerDef.keyUrl} target="_blank" rel="noreferrer">Open provider</a>
                      </div>
                    </>
                  )}

                  <SettingRow title="Model" detail={selectedModel?.description}>
                    <ModelSelect value={model} models={models} onChange={(value) => setAiModel(provider, value)} label="Primary AI model" />
                  </SettingRow>
                  <div className="settings-action-row">
                    <button className="settings-secondary" onClick={() => void refreshModels()} disabled={modelLoading}>
                      {modelLoading ? 'Refreshing...' : 'Refresh models'}
                    </button>
                  </div>
                </Section>

                <Section title="Inline completion">
                  <SettingRow title="Ghost text">
                    <Toggle label="Toggle ghost text" checked={completionEnabled} onChange={aiGhostTextEnabled.set} />
                  </SettingRow>
                  <SettingRow title="Provider">
                    <SelectField value={completionProvider} options={aiProviders.map((item) => ({ id: item.id, label: item.label }))} onChange={aiCompletionProvider.set} ariaLabel="Completion provider" />
                  </SettingRow>
                  <SettingRow title="Model">
                    <ModelSelect
                      value={completionModel}
                      models={completionModels}
                      onChange={(value) => aiCompletionModelByProvider.update((map) => ({ ...map, [completionProvider]: value }))}
                      label="Completion model"
                    />
                  </SettingRow>
                </Section>
              </>
            )}

            {activeTab === 'voice' && (
              <>
                <Section title="Voice input">
                  <SettingRow title="Provider">
                    <SelectField value={voiceInput} options={voiceInputProviders} onChange={voiceInputProvider.set} ariaLabel="Voice input provider" />
                  </SettingRow>
                  {voiceInputUsesModelTranscription(voiceInput) && (
                    <SettingRow title="Transcription model">
                      <ModelSelect
                        value={voiceInputModel}
                        models={voiceInputModels}
                        onChange={(value) => setVoiceInputModel(voiceInput as Exclude<VoiceInputProviderId, 'webspeech'>, value)}
                        label="Voice input model"
                      />
                    </SettingRow>
                  )}
                </Section>

                <Section title="Voice refinement">
                  <SettingRow title="Refinement">
                    <Toggle label="Toggle voice refinement" checked={voiceRefinement} onChange={voiceRefinementEnabled.set} />
                  </SettingRow>
                  <SettingRow title="Provider">
                    <SelectField value={refinementProvider} options={aiProviders.map((item) => ({ id: item.id, label: item.label }))} onChange={voiceAiProvider.set} ariaLabel="Voice refinement provider" />
                  </SettingRow>
                  <SettingRow title="Model">
                    <ModelSelect value={refinementModel} models={refinementModels} onChange={(value) => setVoiceAiModel(refinementProvider, value)} label="Voice refinement model" />
                  </SettingRow>
                </Section>

                <Section title="Conversation replies">
                  <SettingRow title="Provider">
                    <SelectField value={conversationProvider} options={aiProviders.map((item) => ({ id: item.id, label: item.label }))} onChange={voiceConversationAiProvider.set} ariaLabel="Conversation provider" />
                  </SettingRow>
                  <SettingRow title="Reply model">
                    <ModelSelect value={conversationModel} models={conversationModels} onChange={(value) => setVoiceConversationAiModel(conversationProvider, value)} label="Conversation model" />
                  </SettingRow>
                  {ttsModels.length > 0 && (
                    <SettingRow title="Speech model">
                      <ModelSelect value={ttsModel} models={ttsModels} onChange={(value) => setVoiceConversationTtsModel(conversationProvider, value)} label="TTS model" />
                    </SettingRow>
                  )}
                  {ttsVoices.length > 0 && (
                    <SettingRow title="Voice">
                      <StyledSelect
                        value={ttsVoice}
                        options={ttsVoices.map((v) => ({ id: v.id, label: v.label }))}
                        onChange={(value) => setVoiceConversationTtsVoice(conversationProvider, value)}
                        ariaLabel="TTS voice"
                      />
                    </SettingRow>
                  )}
                </Section>
              </>
            )}

            {activeTab === 'terminal' && (
              <>
                <Section title="Default shell">
                  <div className="shell-cards">
                    {availableShells.length === 0 ? (
                      <div className="shell-loading">Detecting shells…</div>
                    ) : (
                      availableShells.map((sh) => {
                        const basename = sh.program.split(/[\/\\]/).pop() ?? sh.program;
                        const lc = basename.toLowerCase();
                        const isSelected = shell === sh.program || (shell === '' && sh === availableShells[0]);
                        const icon = lc.includes('pwsh') || lc.includes('powershell')
                          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="18" rx="3"/><polyline points="8,9 4,12 8,15"/><line x1="12" y1="15" x2="20" y2="15"/></svg>
                          : lc.includes('cmd')
                          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="18" rx="3"/><path d="M6 9l4 3-4 3"/><line x1="14" y1="15" x2="18" y2="15"/></svg>
                          : lc.includes('bash') || lc.includes('zsh') || lc.includes('sh')
                          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="18" rx="3"/><path d="M8 8l4 4-4 4"/><line x1="14" y1="16" x2="18" y2="16"/></svg>
                          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="18" rx="3"/><circle cx="12" cy="12" r="3"/></svg>;
                        return (
                          <button
                            key={sh.program}
                            type="button"
                            className={`shell-card${isSelected ? ' selected' : ''}`}
                            onClick={() => terminalShell.set(sh.program)}
                          >
                            <span className="shell-icon">{icon}</span>
                            <div className="shell-info">
                              <span className="shell-name">{basename}</span>
                              <span className="shell-path">{sh.program}</span>
                            </div>
                            {isSelected && (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M2 7l3.5 3.5 6.5-7" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <p className="shell-hint">Changes apply to new sessions. Active terminal sessions will automatically restart using the new shell.</p>
                </Section>

                <Section title="Appearance">
                  <SettingRow title="Font size" detail={`${termFontSize}px`}>
                    <div className="num-control">
                      <button className="num-btn" onClick={() => terminalFontSize.set(Math.max(9, termFontSize - 1))}>−</button>
                      <span className="num-val">{termFontSize}</span>
                      <button className="num-btn" onClick={() => terminalFontSize.set(Math.min(28, termFontSize + 1))}>+</button>
                    </div>
                  </SettingRow>
                  <SettingRow title="Cursor">
                    <SelectField
                      value={cursorStyle}
                      options={[
                        { id: 'bar', label: 'Bar' },
                        { id: 'block', label: 'Block' },
                        { id: 'underline', label: 'Underline' },
                      ]}
                      onChange={terminalCursorStyle.set}
                      ariaLabel="Terminal cursor"
                    />
                  </SettingRow>
                  <SettingRow title="Canvas renderer" detail="Faster GPU rendering; disable if terminal glitches">
                    <Toggle
                      label="Toggle canvas renderer"
                      checked={renderer === 'canvas'}
                      onChange={(on) => terminalRenderer.set(on ? 'canvas' : 'dom')}
                    />
                  </SettingRow>
                  <SettingRow title="Scrollback" detail={`${scrollback.toLocaleString()} lines`}>
                    <div className="num-control">
                      <button className="num-btn" onClick={() => terminalScrollback.set(Math.max(100, scrollback - 1000))}>−</button>
                      <span className="num-val" style={{ minWidth: 54 }}>{scrollback.toLocaleString()}</span>
                      <button className="num-btn" onClick={() => terminalScrollback.set(Math.min(100000, scrollback + 1000))}>+</button>
                    </div>
                  </SettingRow>
                </Section>
              </>
            )}

            {activeTab === 'shortcuts' && (
              <>
                <Section title="Keyboard shortcuts">
                  <ShortcutEditor shortcuts={shortcuts} onUpdate={updateShortcut} />
                </Section>
                <div className="settings-footer-actions">
                  <button className="settings-secondary" onClick={() => userShortcuts.set(defaultShortcuts)}>Reset shortcuts</button>
                </div>
              </>
            )}

            {activeTab === 'about' && (
              <>
                <Section title="Soryq">
                  <div className="settings-about-grid">
                    <span>Version</span>
                    <strong>{packageJson.version}</strong>
                    <span>Framework</span>
                    <strong>React</strong>
                    <span>Build</span>
                    <strong>Vite + Tauri</strong>
                  </div>
                  <div className="settings-action-row">
                    <button className="settings-primary" onClick={() => void checkUpdates()} disabled={checking}>
                      {checking ? 'Checking...' : 'Check for updates'}
                    </button>
                    {update && (
                      <button className="settings-secondary" onClick={() => void installUpdate()} disabled={downloading}>
                        {downloading ? `Installing ${progress}%` : `Install v${update.version}`}
                      </button>
                    )}
                  </div>
                  {updateMessage && <p className="settings-message">{updateMessage}</p>}
                </Section>

                <Section title="Maintenance">
                  <div className="settings-danger-row">
                    <div>
                      <span>Reset preferences</span>
                      <small>Restore defaults for editor, models, voice, terminal, shortcuts, and appearance.</small>
                    </div>
                    <button className="settings-danger" onClick={resetAllSettings}>Reset</button>
                  </div>
                </Section>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
