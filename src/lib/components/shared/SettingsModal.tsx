import { useEffect, useMemo, useRef, useState } from 'react';
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
  getProviderTtsBadge,
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

function SelectField<T extends string>({
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
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as T)} aria-label={ariaLabel}>
      {options.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  );
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
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
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
  const [liveModels, setLiveModels] = useState<AiModelOption[] | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [showingCustomThemeEditor, setShowingCustomThemeEditor] = useState(false);
  const [customThemeName, setCustomThemeName] = useState('');
  const [customThemeId, setCustomThemeId] = useState('');
  const [customThemeColors, setCustomThemeColors] = useState<Record<string, string>>({});
  const [customThemeSyntax, setCustomThemeSyntax] = useState<Record<string, string>>({});

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
  const models = liveModels ?? providerDef.models;
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

  useEffect(() => {
    setApiKeyInput('');
    setLiveModels(null);
    if (!isTauriRuntime()) {
      setKeyExists(false);
      return;
    }
    providerApiKeyExists(provider).then(setKeyExists).catch(() => setKeyExists(false));
  }, [provider]);

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
  }

  async function clearKey() {
    if (!isTauriRuntime()) {
      showToast('Keychain is available in the desktop app.', 'info');
      return;
    }
    await clearProviderApiKey(provider);
    setKeyExists(false);
    showToast(`${providerDef.label} key removed`, 'success');
  }

  async function refreshModels() {
    if (!isTauriRuntime()) {
      showToast('Live model refresh is available in the desktop app.', 'info');
      return;
    }
    setModelLoading(true);
    try {
      const next = await listProviderModels(provider);
      setLiveModels(next);
      showToast('Model list refreshed', 'success');
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setModelLoading(false);
    }
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
                    <input type="number" min="10" max="32" value={currentFontSize} onChange={(event) => fontSize.set(Number(event.target.value))} />
                  </SettingRow>
                  <SettingRow title="Font family">
                    <input value={currentFontFamily} onChange={(event) => fontFamily.set(event.target.value)} />
                  </SettingRow>
                  <SettingRow title="Tab size" detail={`${currentTabSize} spaces`}>
                    <input type="number" min="1" max="8" value={currentTabSize} onChange={(event) => tabSize.set(Number(event.target.value))} />
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
                  <SettingRow title="Show hidden files">
                    <Toggle label="Toggle hidden files" checked={currentShowHidden} onChange={showHidden.set} />
                  </SettingRow>
                  <SettingRow title="Notifications">
                    <Toggle
                      label="Toggle notifications"
                      checked={currentNotifications}
                      onChange={(checked) => {
                        notificationsEnabled.set(checked);
                        if (checked) void requestNotificationPermission();
                      }}
                    />
                  </SettingRow>
                  <SettingRow title="Close behavior">
                    <SelectField
                      value={currentCloseBehavior}
                      options={[
                        { id: 'quit', label: 'Quit app' },
                        { id: 'minimize', label: 'Minimize' },
                      ]}
                      onChange={closeBehavior.set}
                      ariaLabel="Close behavior"
                    />
                  </SettingRow>
                </Section>
              </>
            )}

            {activeTab === 'appearance' && (
              <>
                <Section title="Theme">
                  <SettingRow title="Mode">
                    <SelectField
                      value={currentAppearance}
                      options={[
                        { id: 'system', label: 'System' },
                        { id: 'light', label: 'Light' },
                        { id: 'dark', label: 'Dark' },
                      ]}
                      onChange={appearance.set}
                      ariaLabel="Appearance mode"
                    />
                  </SettingRow>
                  <SettingRow title="UI zoom" detail={`${currentZoom}%`}>
                    <input type="range" min="50" max="200" step="5" value={currentZoom} onChange={(event) => uiZoom.set(Number(event.target.value))} />
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
                  <SettingRow title="Provider" detail={getProviderTtsBadge(provider) ?? undefined}>
                    <SelectField value={provider} options={aiProviders.map((item) => ({ id: item.id, label: item.label }))} onChange={aiProvider.set} ariaLabel="AI provider" />
                  </SettingRow>

                  {localProvider ? (
                    <SettingRow title={providerDef.keyLabel}>
                      <input value={getProviderBaseUrl(provider, baseUrls)} onChange={(event) => setProviderBaseUrl(provider, event.target.value)} placeholder={providerDef.keyPlaceholder} />
                    </SettingRow>
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
                      <select value={ttsVoice} onChange={(event) => setVoiceConversationTtsVoice(conversationProvider, event.target.value)} aria-label="TTS voice">
                        {ttsVoices.map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.label}
                          </option>
                        ))}
                      </select>
                    </SettingRow>
                  )}
                </Section>
              </>
            )}

            {activeTab === 'terminal' && (
              <Section title="Terminal">
                <SettingRow title="Shell" detail={shell ? undefined : 'Auto-detect'}>
                  <input value={shell} onChange={(event) => terminalShell.set(event.target.value)} placeholder="Auto-detect" />
                </SettingRow>
                <SettingRow title="Font size" detail={`${termFontSize}px`}>
                  <input type="number" min="9" max="28" value={termFontSize} onChange={(event) => terminalFontSize.set(Number(event.target.value))} />
                </SettingRow>
                <SettingRow title="Scrollback" detail={`${scrollback.toLocaleString()} lines`}>
                  <input type="number" min="100" max="100000" step="100" value={scrollback} onChange={(event) => terminalScrollback.set(Number(event.target.value))} />
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
                <SettingRow title="Renderer">
                  <SelectField
                    value={renderer}
                    options={[
                      { id: 'dom', label: 'DOM' },
                      { id: 'canvas', label: 'Canvas' },
                    ]}
                    onChange={terminalRenderer.set}
                    ariaLabel="Terminal renderer"
                  />
                </SettingRow>
              </Section>
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
