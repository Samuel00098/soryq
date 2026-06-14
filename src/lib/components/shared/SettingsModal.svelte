<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { activeTheme, switchTheme, switchPresetTheme, saveTheme, importTheme, themeColorFields } from '$lib/stores/theme';
  import { presetThemes, currentPresetTheme } from '$lib/stores/presetThemes';
  import {
    fontSize,
    fontFamily,
    tabSize,
    wordWrap,
    minimap,
    vimMode,
    enableLsp,
    showHidden,
    uiZoom,
    userShortcuts,
    defaultShortcuts,
    shortcutActions,
    appearance,
    terminalShell,
    terminalFontSize,
    terminalRenderer,
    formatOnSave,
    notificationsEnabled,
    closeBehavior,
    voiceRefinementEnabled,
    voiceInputProvider,
    currentVoiceInputModel,
    getVoiceInputModelOptions,
    setVoiceInputModel,
    voiceAiProvider,
    currentVoiceAiModel,
    setVoiceAiModel,
    voiceConversationAiProvider,
    currentVoiceConversationAiModel,
    currentVoiceConversationTtsModel,
    currentVoiceConversationTtsVoice,
    setVoiceConversationAiModel,
    setVoiceConversationTtsModel,
    setVoiceConversationTtsVoice,
    aiProvider,
    currentAiModel,
    setAiModel,
    aiGhostTextEnabled,
    aiCompletionProvider,
    aiCompletionModelByProvider,
    type AiModelOption,
    type AiProviderId,
    type VoiceInputProviderId,
    aiProviders,
    getProviderDef,
    getProviderTtsBadge,
    getTtsModelOptions,
    getTtsVoiceOptionsForModel,
    isLocalProvider,
    providerSupportsReplyTts,
    getProviderBaseUrl,
    setProviderBaseUrl,
    backgroundImageEnabled,
    interfaceTransparency,
    backgroundImageOpacity,
    backgroundImageBlur,
    onboardingCompleted,
  } from '$lib/stores/settings';
  import { chooseBackgroundImage, removeBackgroundImage, backgroundImagePresent } from '$lib/stores/background';
  import { requestNotificationPermission } from '$lib/stores/notification';
  import { getAvailableShells, type ShellInfo } from '$lib/services/pty-bridge';
  import { showToast } from '$lib/stores/notification';
  import { clearAllApplicationState } from '$lib/stores/workspace';
  import { checkForUpdate, pendingUpdate } from '$lib/stores/updater';
  import {
    customAgents,
    addCustomAgent,
    deleteCustomAgent,
    updateCustomAgent,
  } from '$lib/stores/customAgents';
  import { getVersion } from '@tauri-apps/api/app';
  import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.svelte';
  import { clearProviderApiKey, providerApiKeyExists, saveProviderApiKey, listProviderModels } from '$lib/services/ai-keychain';
  import { describeTtsError, getVoiceReplyConfigError, speak, stopSpeaking } from '$lib/services/tts';
  import { isTauriRuntime } from '$lib/utils/tauri';
  import packageJson from '../../../../package.json';

  type Tab = 'general' | 'models' | 'terminal' | 'shortcuts' | 'themes' | 'about';
  let activeTab = $state<Tab>('general');
  const PACKAGE_VERSION = packageJson.version;

  let updateStatus = $state<'idle' | 'checking' | 'latest' | 'available' | 'error'>('idle');
  let updateMessage = $state('');
  let appVersion = $state(PACKAGE_VERSION);

  // Public site changelog page. Mirrors the site's production-URL fallback
  // (see site/src/config.ts) — the live deploy auto-binds any custom domain.
  const CHANGELOG_URL = 'https://site-flame-phi.vercel.app/changelog';

  async function openChangelog() {
    if (!isTauriRuntime()) {
      window.open(CHANGELOG_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await invoke('preview_open_in_browser', { url: CHANGELOG_URL });
    } catch (err) {
      console.error('Failed to open changelog:', err);
      showToast('Could not open the changelog', 'error');
    }
  }

  async function handleCheckForUpdates() {
    if (updateStatus === 'checking') return;
    updateStatus = 'checking';
    updateMessage = 'Checking for updates...';

    try {
      await checkForUpdate();
      if ($pendingUpdate) {
        updateStatus = 'available';
        updateMessage = `Update available: v${$pendingUpdate.version}`;
        showToast(`Update available: v${$pendingUpdate.version}`, 'success');
      } else {
        updateStatus = 'latest';
        updateMessage = 'Soryq is up to date!';
        showToast('Soryq is up to date!', 'success');
      }
    } catch (err) {
      updateStatus = 'error';
      updateMessage = 'Failed to check for updates.';
      showToast('Failed to check for updates.', 'error');
    }
  }

  const modalTabs = [
    { id: 'general'   as Tab, label: 'General' },
    { id: 'models'    as Tab, label: 'Models' },
    { id: 'themes'    as Tab, label: 'Themes' },
    { id: 'terminal'  as Tab, label: 'Terminal' },
    { id: 'shortcuts' as Tab, label: 'Shortcuts' },
    { id: 'about'     as Tab, label: 'About' },
  ];

  const appearanceModes = [
    { id: 'system' as 'system'|'light'|'dark', label: 'System' },
    { id: 'light'  as 'system'|'light'|'dark', label: 'Light'  },
    { id: 'dark'   as 'system'|'light'|'dark', label: 'Dark'   },
  ];

  const closeBehaviorModes = [
    { id: 'quit' as const, label: 'Quit Soryq', desc: 'Close the app and stop live terminals.' },
    { id: 'minimize' as const, label: 'Keep running', desc: 'Minimize and keep terminals and agents alive.' },
  ];

  // Terminal settings
  let availableShells = $state<ShellInfo[]>([]);
  // openRouterKeyValue is for entering a new key only — we never read the stored key back to the frontend.

  // ── Custom CLI agents (Terminal tab) ──
  let newAgentName = $state('');
  let newAgentCommand = $state('');
  let newAgentReadsRules = $state(true);
  let agentFormError = $state('');

  function handleAddCustomAgent() {
    const name = newAgentName.trim();
    const command = newAgentCommand.trim();
    if (!name || !command) {
      agentFormError = 'Give the agent a name and a launch command.';
      return;
    }
    const created = addCustomAgent({ name, command, readsRulesFile: newAgentReadsRules });
    if (!created) {
      agentFormError = 'An agent with that launch command already exists.';
      return;
    }
    newAgentName = '';
    newAgentCommand = '';
    newAgentReadsRules = true;
    agentFormError = '';
    showToast(`Added "${created.name}" — it's now in the spawn picker.`, 'success');
  }

  function handleRemoveCustomAgent(id: string, name: string) {
    deleteCustomAgent(id);
    showToast(`Removed "${name}".`, 'info');
  }

  // ── Models tab ──
  // Key entry box value per provider (entry only — we never read stored keys
  // back to the frontend). Status tracks whether each provider has a saved key.
  let providerKeyValue = $state<Record<string, string>>({});
  let providerKeyStatus = $state<Record<string, 'loading' | 'saved' | 'idle' | 'error'>>({});

  // Live model catalogues fetched per provider through its own key. Falls back
  // to the curated static list (getProviderDef().models) until loaded.
  let providerModels = $state<Record<string, AiModelOption[]>>({});
  let providerModelsStatus = $state<Record<string, 'idle' | 'loading' | 'loaded' | 'error'>>({});
  let providerModelsError = $state<Record<string, string>>({});

  // Voice refinement keeps its own live catalog cache so the dedicated voice
  // provider can diverge from the main app provider without sharing state.
  let voiceProviderModels = $state<Record<string, AiModelOption[]>>({});
  let voiceProviderModelsStatus = $state<Record<string, 'idle' | 'loading' | 'loaded' | 'error'>>({});
  let voiceProviderModelsError = $state<Record<string, string>>({});

  // Voice conversations also keep an independent provider/model choice so the
  // spoken orchestrator can use a different "brain" from typing or refinement.
  let voiceConversationProviderModels = $state<Record<string, AiModelOption[]>>({});
  let voiceConversationProviderModelsStatus = $state<Record<string, 'idle' | 'loading' | 'loaded' | 'error'>>({});
  let voiceConversationProviderModelsError = $state<Record<string, string>>({});

  // AI ghost text keeps its own live catalog cache so the dedicated completion
  // provider can use a fast model independent of the other features.
  let completionProviderModels = $state<Record<string, AiModelOption[]>>({});
  let completionProviderModelsStatus = $state<Record<string, 'idle' | 'loading' | 'loaded' | 'error'>>({});
  let completionProviderModelsError = $state<Record<string, string>>({});

  let modelSearch = $state('');

  // Local providers (Ollama, LM Studio) are configured by a server URL instead
  // of an API key. We mirror the effective URL here for the input field, and
  // reuse `providerKeyStatus` as the single readiness signal (saved = a URL is
  // set) so the model picker and live-load logic work unchanged.
  let providerBaseUrlValue = $state<Record<string, string>>({});

  async function refreshProviderKeyStatuses() {
    for (const provider of aiProviders) {
      if (provider.local) {
        const url = getProviderBaseUrl(provider.id);
        providerBaseUrlValue[provider.id] = url;
        if (!url) {
          providerKeyStatus[provider.id] = 'idle';
          continue;
        }
        providerKeyStatus[provider.id] = 'loading';
        try {
          const online = await invoke<boolean>('check_local_provider_online', {
            provider: provider.id,
            baseUrl: url,
          });
          providerKeyStatus[provider.id] = online ? 'saved' : 'error';
        } catch {
          providerKeyStatus[provider.id] = 'error';
        }
        continue;
      }
      providerKeyStatus[provider.id] = 'loading';
      const exists = await providerApiKeyExists(provider.id);
      providerKeyStatus[provider.id] = exists ? 'saved' : 'idle';
    }
  }

  // Fetch the provider's live model list and merge curated labels/descriptions
  // onto known ids so familiar models keep their friendly copy.
  async function loadModels(provider: AiProviderId, force = false) {
    if (providerKeyStatus[provider] !== 'saved') return;
    const status = providerModelsStatus[provider];
    if (!force && (status === 'loading' || status === 'loaded')) return;

    providerModelsStatus[provider] = 'loading';
    providerModelsError[provider] = '';
    try {
      const remote = await listProviderModels(provider);
      const curated = new Map(getProviderDef(provider).models.map((m) => [m.id, m]));
      const merged: AiModelOption[] = remote.map((r) => {
        const c = curated.get(r.id);
        return {
          id: r.id,
          label: c?.label ?? r.label ?? r.id,
          description: c?.description ?? r.description ?? '',
          free: c?.free ?? r.id.endsWith(':free'),
        };
      });
      providerModels[provider] = merged.length ? merged : getProviderDef(provider).models;
      providerModelsStatus[provider] = 'loaded';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      providerModelsError[provider] = message || 'Failed to load models';
      providerModelsStatus[provider] = 'error';
    }
  }

  async function loadVoiceModels(provider: AiProviderId, force = false) {
    if (providerKeyStatus[provider] !== 'saved') return;
    const status = voiceProviderModelsStatus[provider];
    if (!force && (status === 'loading' || status === 'loaded')) return;

    voiceProviderModelsStatus[provider] = 'loading';
    voiceProviderModelsError[provider] = '';
    try {
      const remote = await listProviderModels(provider);
      const curated = new Map(getProviderDef(provider).models.map((m) => [m.id, m]));
      const merged: AiModelOption[] = remote.map((r) => {
        const c = curated.get(r.id);
        return {
          id: r.id,
          label: c?.label ?? r.label ?? r.id,
          description: c?.description ?? r.description ?? '',
          free: c?.free ?? r.id.endsWith(':free'),
        };
      });
      voiceProviderModels[provider] = merged.length ? merged : getProviderDef(provider).models;
      voiceProviderModelsStatus[provider] = 'loaded';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      voiceProviderModelsError[provider] = message || 'Failed to load models';
      voiceProviderModelsStatus[provider] = 'error';
    }
  }

  async function loadVoiceConversationModels(provider: AiProviderId, force = false) {
    if (providerKeyStatus[provider] !== 'saved') return;
    const status = voiceConversationProviderModelsStatus[provider];
    if (!force && (status === 'loading' || status === 'loaded')) return;

    voiceConversationProviderModelsStatus[provider] = 'loading';
    voiceConversationProviderModelsError[provider] = '';
    try {
      const remote = await listProviderModels(provider);
      const curated = new Map(getProviderDef(provider).models.map((m) => [m.id, m]));
      const merged: AiModelOption[] = remote.map((r) => {
        const c = curated.get(r.id);
        return {
          id: r.id,
          label: c?.label ?? r.label ?? r.id,
          description: c?.description ?? r.description ?? '',
          free: c?.free ?? r.id.endsWith(':free'),
        };
      });
      voiceConversationProviderModels[provider] = merged.length ? merged : getProviderDef(provider).models;
      voiceConversationProviderModelsStatus[provider] = 'loaded';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      voiceConversationProviderModelsError[provider] = message || 'Failed to load models';
      voiceConversationProviderModelsStatus[provider] = 'error';
    }
  }

  async function loadCompletionModels(provider: AiProviderId, force = false) {
    if (providerKeyStatus[provider] !== 'saved') return;
    const status = completionProviderModelsStatus[provider];
    if (!force && (status === 'loading' || status === 'loaded')) return;

    completionProviderModelsStatus[provider] = 'loading';
    completionProviderModelsError[provider] = '';
    try {
      const remote = await listProviderModels(provider);
      const curated = new Map(getProviderDef(provider).models.map((m) => [m.id, m]));
      const merged: AiModelOption[] = remote.map((r) => {
        const c = curated.get(r.id);
        return {
          id: r.id,
          label: c?.label ?? r.label ?? r.id,
          description: c?.description ?? r.description ?? '',
          free: c?.free ?? r.id.endsWith(':free'),
        };
      });
      completionProviderModels[provider] = merged.length ? merged : getProviderDef(provider).models;
      completionProviderModelsStatus[provider] = 'loaded';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      completionProviderModelsError[provider] = message || 'Failed to load models';
      completionProviderModelsStatus[provider] = 'error';
    }
  }

  function clearLiveModelCaches(provider: AiProviderId) {
    providerModels[provider] = [];
    providerModelsStatus[provider] = 'idle';
    providerModelsError[provider] = '';
    voiceProviderModels[provider] = [];
    voiceProviderModelsStatus[provider] = 'idle';
    voiceProviderModelsError[provider] = '';
    voiceConversationProviderModels[provider] = [];
    voiceConversationProviderModelsStatus[provider] = 'idle';
    voiceConversationProviderModelsError[provider] = '';
    completionProviderModels[provider] = [];
    completionProviderModelsStatus[provider] = 'idle';
    completionProviderModelsError[provider] = '';
  }

  // Models shown for the active provider: live list once loaded, else curated.
  let activeModels = $derived(
    (providerModels[$aiProvider]?.length ? providerModels[$aiProvider] : getProviderDef($aiProvider).models)
  );

  let filteredModels = $derived.by(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return activeModels;
    return activeModels.filter((m) =>
      `${m.label} ${m.id} ${m.description}`.toLowerCase().includes(q)
    );
  });

  let selectedModel = $derived(activeModels.find((m) => m.id === $currentAiModel));


  let activeVoiceProvider = $derived(getProviderDef($voiceAiProvider));
  let voiceActiveModels = $derived(
    (voiceProviderModels[$voiceAiProvider]?.length ? voiceProviderModels[$voiceAiProvider] : activeVoiceProvider.models)
  );

  let filteredVoiceModels = $derived.by(() => {
    const q = voiceModelSearch.trim().toLowerCase();
    if (!q) return voiceActiveModels;
    return voiceActiveModels.filter((m) =>
      `${m.label} ${m.id} ${m.description}`.toLowerCase().includes(q)
    );
  });

  let selectedVoiceModel = $derived(voiceActiveModels.find((m) => m.id === $currentVoiceAiModel));

  let activeCompletionProvider = $derived(getProviderDef($aiCompletionProvider));
  let currentCompletionModel = $derived(
    $aiCompletionModelByProvider[$aiCompletionProvider]?.trim() || activeCompletionProvider.defaultModel
  );
  let completionActiveModels = $derived(
    (completionProviderModels[$aiCompletionProvider]?.length
      ? completionProviderModels[$aiCompletionProvider]
      : activeCompletionProvider.models)
  );
  let filteredCompletionModels = $derived.by(() => {
    const q = completionModelSearch.trim().toLowerCase();
    if (!q) return completionActiveModels;
    return completionActiveModels.filter((m) =>
      `${m.label} ${m.id} ${m.description}`.toLowerCase().includes(q)
    );
  });
  let selectedCompletionModel = $derived(
    completionActiveModels.find((m) => m.id === currentCompletionModel)
  );

  function setCompletionModel(provider: AiProviderId, id: string) {
    aiCompletionModelByProvider.update((m) => ({ ...m, [provider]: id }));
  }

  let activeVoiceConversationProvider = $derived(getProviderDef($voiceConversationAiProvider));
  let voiceConversationActiveModels = $derived(
    (voiceConversationProviderModels[$voiceConversationAiProvider]?.length
      ? voiceConversationProviderModels[$voiceConversationAiProvider]
      : activeVoiceConversationProvider.models)
  );

  let filteredVoiceConversationModels = $derived.by(() => {
    const q = voiceConversationModelSearch.trim().toLowerCase();
    if (!q) return voiceConversationActiveModels;
    return voiceConversationActiveModels.filter((m) =>
      `${m.label} ${m.id} ${m.description}`.toLowerCase().includes(q)
    );
  });

  let selectedVoiceConversationModel = $derived(
    voiceConversationActiveModels.find((m) => m.id === $currentVoiceConversationAiModel)
  );
  let voiceConversationReplyAudioSupported = $derived(
    providerSupportsReplyTts($voiceConversationAiProvider)
  );
  let voiceConversationTtsVoiceOptions = $derived(
    getTtsVoiceOptionsForModel($voiceConversationAiProvider, $currentVoiceConversationTtsModel)
  );
  let voiceConversationTtsModelOptions = $derived<DropdownOption[]>(
    getTtsModelOptions($voiceConversationAiProvider).map((model) => ({
      value: model.id,
      label: model.label,
      sublabel: model.description || model.id,
    }))
  );
  let selectedVoiceConversationTtsVoice = $derived(
    voiceConversationTtsVoiceOptions.find((voice) => voice.id === $currentVoiceConversationTtsVoice)
  );
  let activeVoiceInputModelProvider = $derived(
    ($voiceInputProvider === 'webspeech' ? 'google' : $voiceInputProvider) as Exclude<VoiceInputProviderId, 'webspeech'>
  );
  let voiceInputModelIsLocal = $derived(
    activeVoiceInputModelProvider === 'ollama' || activeVoiceInputModelProvider === 'lmstudio'
  );
  let voiceInputModelOptions = $derived<DropdownOption[]>(
    getVoiceInputModelOptions($voiceInputProvider)
      .map((model) => ({
        value: model.id,
        label: model.label,
        sublabel: model.description || model.id,
      }))
  );
  let voiceInputProviderOptions: Array<{
    id: VoiceInputProviderId;
    label: string;
    subtitle: string;
    status: string;
  }> = $derived([
    {
      id: 'webspeech',
      label: 'Web Speech',
      subtitle: 'Fast browser dictation',
      status: 'Local',
    },
    {
      id: 'google',
      label: 'Google',
      subtitle: 'Model-based transcription',
      status:
        providerKeyStatus.google === 'saved'
          ? 'Ready'
          : providerKeyStatus.google === 'error'
            ? 'Error'
            : providerKeyStatus.google === 'loading'
              ? 'Checking'
              : 'No key',
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      subtitle: 'Paid STT models',
      status:
        providerKeyStatus.openrouter === 'saved'
          ? 'Ready'
          : providerKeyStatus.openrouter === 'error'
            ? 'Error'
            : providerKeyStatus.openrouter === 'loading'
              ? 'Checking'
              : 'No key',
    },
    {
      id: 'ollama',
      label: 'Ollama',
      subtitle: 'Local /audio/transcriptions',
      status:
        providerKeyStatus.ollama === 'saved'
          ? 'Ready'
          : providerKeyStatus.ollama === 'error'
            ? 'Error'
            : providerKeyStatus.ollama === 'loading'
              ? 'Checking'
              : 'No URL',
    },
    {
      id: 'lmstudio',
      label: 'LM Studio',
      subtitle: 'Local /audio/transcriptions',
      status:
        providerKeyStatus.lmstudio === 'saved'
          ? 'Ready'
          : providerKeyStatus.lmstudio === 'error'
            ? 'Error'
            : providerKeyStatus.lmstudio === 'loading'
              ? 'Checking'
              : 'No URL',
    },
  ]);

  // Lazily load the live catalogue for whichever provider is in view once its
  // key is known to exist.
  $effect(() => {
    const p = $aiProvider;
    if (providerKeyStatus[p] === 'saved' &&
        providerModelsStatus[p] !== 'loaded' &&
        providerModelsStatus[p] !== 'loading') {
      loadModels(p);
    }
  });

  $effect(() => {
    const p = $voiceAiProvider;
    if (providerKeyStatus[p] === 'saved' &&
        voiceProviderModelsStatus[p] !== 'loaded' &&
        voiceProviderModelsStatus[p] !== 'loading') {
      loadVoiceModels(p);
    }
  });

  $effect(() => {
    const p = $voiceConversationAiProvider;
    if (providerKeyStatus[p] === 'saved' &&
        voiceConversationProviderModelsStatus[p] !== 'loaded' &&
        voiceConversationProviderModelsStatus[p] !== 'loading') {
      loadVoiceConversationModels(p);
    }
  });

  $effect(() => {
    const p = $aiCompletionProvider;
    if (providerKeyStatus[p] === 'saved' &&
        completionProviderModelsStatus[p] !== 'loaded' &&
        completionProviderModelsStatus[p] !== 'loading') {
      loadCompletionModels(p);
    }
  });

  // Reset the in-dropdown search when switching providers.
  $effect(() => {
    void $aiProvider;
    modelSearch = '';
  });

  $effect(() => {
    void $aiCompletionProvider;
    completionModelSearch = '';
  });

  async function saveProviderKey(provider: AiProviderId) {
    const value = providerKeyValue[provider] ?? '';
    const label = getProviderDef(provider).label;
    try {
      await saveProviderApiKey(provider, value);
      clearLiveModelCaches(provider);
      providerKeyValue[provider] = '';
      providerKeyStatus[provider] = 'saved';
      showToast(`${label} key saved`, 'success');
      // A new key may unlock a different model set — refetch.
      loadModels(provider, true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      providerKeyStatus[provider] = 'error';
      showToast(message || `Failed to save ${label} key`, 'error');
    }
  }

  async function saveProviderBaseUrl(provider: AiProviderId) {
    const def = getProviderDef(provider);
    const value = (providerBaseUrlValue[provider] ?? '').trim() || def.defaultBaseUrl || '';
    setProviderBaseUrl(provider, value);
    providerBaseUrlValue[provider] = value;
    providerKeyStatus[provider] = value ? 'saved' : 'idle';
    // Point at the new server — drop any cached catalogue and re-fetch.
    clearLiveModelCaches(provider);
    showToast(`${def.label} server URL saved`, 'success');
    loadModels(provider, true);
  }

  function resetProviderBaseUrl(provider: AiProviderId) {
    const def = getProviderDef(provider);
    providerBaseUrlValue[provider] = def.defaultBaseUrl ?? '';
    saveProviderBaseUrl(provider);
  }

  async function clearProviderKey(provider: AiProviderId) {
    const label = getProviderDef(provider).label;
    try {
      await clearProviderApiKey(provider);
      providerKeyValue[provider] = '';
      providerKeyStatus[provider] = 'idle';
      // Without a key we can't list live models — drop back to the curated set.
      clearLiveModelCaches(provider);
      showToast(`${label} key cleared`, 'info');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      providerKeyStatus[provider] = 'error';
      showToast(message || `Failed to clear ${label} key`, 'error');
    }
  }

  onMount(async () => {
    availableShells = await getAvailableShells();
    if (isTauriRuntime()) {
      appVersion = await getVersion().catch(() => PACKAGE_VERSION);
    }
    await refreshProviderKeyStatuses();

    // Auto-detect if Ollama is online and configure it if no other keys exist
    try {
      const remoteProviders = aiProviders.filter(p => !p.local);
      const remoteKeysExist = await Promise.all(
        remoteProviders.map(p => providerApiKeyExists(p.id))
      );
      const hasNoKeys = !remoteKeysExist.some(Boolean);
      
      if (hasNoKeys && providerKeyStatus['ollama'] === 'saved') {
        if ($aiProvider !== 'ollama') {
          $aiProvider = 'ollama';
          await loadModels('ollama', true);
          const models = providerModels['ollama'] || [];
          if (models.length > 0) {
            setAiModel('ollama', models[0].id);
            showToast('Local Ollama detected! Configured Soryq to run offline.', 'success', 5000);
          } else {
            showToast('Local Ollama detected, but no models are loaded. Run "ollama run llama3.1" to pull a model.', 'warning', 7000);
          }
        }
      }
    } catch (err) {
      console.warn('Auto-detecting Ollama failed:', err);
    }
  });

  let recordingId = $state<string | null>(null);
  let recordedKeys = $state('');
  let addingShortcut = $state(false);
  let newShortcutActionId = $state('');
  let newShortcutKeys = $state('');
  let newShortcutRecording = $state(false);

  function getShortcutKeys(id: string, fallback: string): string {
    return ($userShortcuts || []).find((item) => item && item.id === id)?.keys
      ?? getDefaultShortcut(id)?.keys
      ?? fallback;
  }

  const contextualShortcuts = $derived([
    {
      keys: 'Left Alt',
      label: 'Hold to dictate',
      context: 'Prompt bar, Tasks, and Notes when the relevant surface is focused',
    },
    {
      keys: 'Enter',
      label: 'Send prompt',
      context: 'Floating bar input',
    },
    {
      keys: 'Shift+Enter',
      label: 'Insert a new line',
      context: 'Floating bar input',
    },
    {
      keys: 'Arrow Up / Arrow Down',
      label: 'Browse prompt history',
      context: 'Floating bar input on the first or last line',
    },
    {
      keys: 'Escape',
      label: 'Close prompt history',
      context: 'Floating bar input',
    },
    {
      keys: 'Space',
      label: 'Temporarily pan the canvas',
      context: 'Canvas while not typing into a text field',
    },
    {
      keys: getShortcutKeys('canvasZoomIn', 'Alt+='),
      label: 'Zoom canvas in',
      context: 'Canvas tab',
    },
    {
      keys: getShortcutKeys('canvasZoomOut', 'Alt+-'),
      label: 'Zoom canvas out',
      context: 'Canvas tab',
    },
    {
      keys: getShortcutKeys('canvasResetZoom', 'Alt+0'),
      label: 'Reset canvas zoom',
      context: 'Canvas tab',
    },
    {
      keys: 'Ctrl+Enter',
      label: 'Commit canvas text',
      context: 'Canvas text editor',
    },
    {
      keys: 'Delete / Backspace',
      label: 'Delete selected shape',
      context: 'Canvas while not typing',
    },
    {
      keys: 'Escape',
      label: 'Exit canvas or cancel text editing',
      context: 'Canvas overlay',
    },
    {
      keys: 'Ctrl+Enter',
      label: 'Commit changes',
      context: 'Source Control commit message box',
    },
    {
      keys: 'Enter',
      label: 'Confirm create or rename',
      context: 'Explorer create and rename inputs',
    },
    {
      keys: 'Escape',
      label: 'Cancel create, rename, or recording',
      context: 'Explorer inputs and shortcut recorder',
    },
  ]);

  function startRecording(id: string) {
    recordingId = id;
    recordedKeys = 'Press key combination...';
  }

  function stopRecording() {
    recordingId = null;
    recordedKeys = '';
  }

  function startNewRecording() {
    newShortcutRecording = true;
    newShortcutKeys = 'Press key combination...';
  }

  function stopNewRecording() {
    newShortcutRecording = false;
  }

  function normalizeShortcutKeys(keys: string): string {
    return keys.trim().toLowerCase();
  }

  function findShortcutConflict(keys: string, ignoreId?: string): (typeof $userShortcuts)[number] | null {
    const normalized = normalizeShortcutKeys(keys);
    return ($userShortcuts || []).find((item) =>
      item &&
      item.id !== ignoreId &&
      normalizeShortcutKeys(item.keys) === normalized
    ) ?? null;
  }

  function getDefaultShortcut(id: string) {
    return defaultShortcuts.find((item) => item.id === id) ?? null;
  }

  function resetShortcut(id: string) {
    const defaultShortcut = getDefaultShortcut(id);
    if (!defaultShortcut) {
      userShortcuts.update((list) => (list || []).filter((item) => item && item.id !== id));
      showToast('Shortcut removed', 'info');
      return;
    }

    const conflict = findShortcutConflict(defaultShortcut.keys, id);
    if (conflict) {
      showToast(`Cannot reset: ${defaultShortcut.keys} is already used by ${conflict.label}`, 'error');
      return;
    }

    userShortcuts.update((list) => {
      const current = list || [];
      const exists = current.some((item) => item && item.id === id);
      if (exists) {
        return current.map((item) => item && item.id === id ? { ...item, keys: defaultShortcut.keys } : item);
      }
      return [...current, defaultShortcut];
    });
    showToast('Shortcut reset to default', 'success');
  }

  function handleShortcutKeyDown(e: KeyboardEvent) {
    if (!recordingId && !newShortcutRecording) return;

    e.preventDefault();
    e.stopPropagation();

    // Ignore solitary modifier presses
    if (['control', 'shift', 'alt', 'meta'].includes(e.key.toLowerCase())) {
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      if (e.metaKey) parts.push('Meta');
      parts.push('...');
      const keysStr = parts.join('+');
      if (recordingId) {
        recordedKeys = keysStr;
      } else {
        newShortcutKeys = keysStr;
      }
      return;
    }

    if (e.key === 'Escape') {
      if (recordingId) stopRecording();
      else stopNewRecording();
      return;
    }

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    let primaryKey = e.key;
    if (primaryKey === ' ') primaryKey = 'Space';
    else if (primaryKey.length === 1) primaryKey = primaryKey.toUpperCase();

    parts.push(primaryKey);
    const finalKeys = parts.join('+');

    if (recordingId) {
      const conflict = findShortcutConflict(finalKeys, recordingId);
      if (conflict) {
        showToast(`Shortcut conflict: ${finalKeys} is already used by ${conflict.label}`, 'error');
        stopRecording();
        return;
      }
      userShortcuts.update(list => {
        return (list || []).map(item => {
          if (item && item.id === recordingId) {
            return { ...item, keys: finalKeys };
          }
          return item;
        });
      });
      stopRecording();
      showToast('Shortcut updated', 'success');
    } else {
      newShortcutKeys = finalKeys;
      stopNewRecording();
    }
  }

  function deleteShortcut(id: string) {
    userShortcuts.update(list => (list || []).filter(item => item && item.id !== id));
    showToast('Shortcut deleted', 'info');
  }

  function handleAddShortcut() {
    if (!newShortcutActionId) {
      showToast('Please select an action', 'error');
      return;
    }
    if (!newShortcutKeys || newShortcutKeys === 'Press key combination...') {
      showToast('Please press key combination', 'error');
      return;
    }

    const conflict = findShortcutConflict(newShortcutKeys, newShortcutActionId);
    if (conflict) {
      showToast(`Shortcut conflict: ${newShortcutKeys} is already used by ${conflict.label}`, 'error');
      return;
    }

    const action = shortcutActions.find(a => a.id === newShortcutActionId);
    if (!action) return;

    userShortcuts.update(list => {
      const currentList = list || [];
      const existing = currentList.find(item => item && item.id === newShortcutActionId);
      if (existing) {
        return currentList.map(item => item && item.id === newShortcutActionId ? { ...item, keys: newShortcutKeys } : item);
      }
      return [...currentList, { id: newShortcutActionId, label: action.label, keys: newShortcutKeys }];
    });

    showToast('Shortcut added', 'success');
    newShortcutActionId = '';
    newShortcutKeys = '';
    addingShortcut = false;
  }

  let iconError = $state(false);

  let modelDropdownEl = $state<HTMLDivElement | null>(null);
  let modelDropdownOpen = $state(false);

  let providerDropdownEl = $state<HTMLDivElement | null>(null);
  let providerDropdownOpen = $state(false);

  let voiceInputModelDropdownEl = $state<HTMLDivElement | null>(null);
  let voiceInputModelDropdownOpen = $state(false);

  let voiceModelDropdownEl = $state<HTMLDivElement | null>(null);
  let voiceModelDropdownOpen = $state(false);
  let voiceModelSearch = $state('');

  let completionProviderDropdownEl = $state<HTMLDivElement | null>(null);
  let completionProviderDropdownOpen = $state(false);
  let completionModelDropdownEl = $state<HTMLDivElement | null>(null);
  let completionModelDropdownOpen = $state(false);
  let completionModelSearch = $state('');

  let voiceConversationProviderDropdownEl = $state<HTMLDivElement | null>(null);
  let voiceConversationProviderDropdownOpen = $state(false);

  let voiceConversationModelDropdownEl = $state<HTMLDivElement | null>(null);
  let voiceConversationModelDropdownOpen = $state(false);
  let voiceConversationModelSearch = $state('');

  let voiceConversationTtsModelDropdownEl = $state<HTMLDivElement | null>(null);
  let voiceConversationTtsModelDropdownOpen = $state(false);

  let voiceConversationTtsVoiceDropdownEl = $state<HTMLDivElement | null>(null);
  let voiceConversationTtsVoiceDropdownOpen = $state(false);
  let previewingVoiceId = $state<string | null>(null);
  let previewingVoiceProvider = $state<AiProviderId | null>(null);
  let previewingVoiceModel = $state('');

  const VOICE_PREVIEW_TEXT = 'Hello, this is a quick preview of my voice in Soryq.';

  async function previewVoiceOption(voiceId: string) {
    const provider = $voiceConversationAiProvider;
    const model = $currentVoiceConversationTtsModel;

    if (previewingVoiceId === voiceId && previewingVoiceProvider === provider) {
      stopSpeaking();
      previewingVoiceId = null;
      previewingVoiceProvider = null;
      previewingVoiceModel = '';
      return;
    }

    const configError = getVoiceReplyConfigError({ provider, model, voice: voiceId });
    if (configError) {
      showToast(configError, 'warning');
      return;
    }

    previewingVoiceId = voiceId;
    previewingVoiceProvider = provider;
    previewingVoiceModel = model;

    try {
      await speak(VOICE_PREVIEW_TEXT, { provider, model, voice: voiceId });
    } catch (error) {
      showToast(describeTtsError(error), 'error');
    } finally {
      if (previewingVoiceId === voiceId && previewingVoiceProvider === provider) {
        previewingVoiceId = null;
        previewingVoiceProvider = null;
        previewingVoiceModel = '';
      }
    }
  }

  function chooseVoiceConversationTtsModel(modelId: string) {
    setVoiceConversationTtsModel($voiceConversationAiProvider, modelId);
    const voices = getTtsVoiceOptionsForModel($voiceConversationAiProvider, modelId);
    if (voices.length && !voices.some((voice) => voice.id === $currentVoiceConversationTtsVoice)) {
      setVoiceConversationTtsVoice($voiceConversationAiProvider, voices[0].id);
    }
    voiceConversationTtsModelDropdownOpen = false;
  }

  let selectedVoiceConversationTtsModel = $derived(
    getTtsModelOptions($voiceConversationAiProvider).find((model) => model.id === $currentVoiceConversationTtsModel)
  );

  let selectedVoiceInputModel = $derived(
    getVoiceInputModelOptions($voiceInputProvider).find((model) => model.id === $currentVoiceInputModel)
  );

  function chooseVoiceInputModel(modelId: string) {
    setVoiceInputModel(activeVoiceInputModelProvider, modelId);
    voiceInputModelDropdownOpen = false;
  }


  // Badge shown next to a model. For OpenRouter we infer the underlying vendor
  // from the slug prefix; for native providers it's the provider itself.
  function modelBadge(providerId: AiProviderId, modelId: string): string {
    if (providerId === 'openrouter') {
      if (modelId.startsWith('anthropic/')) return 'Anthropic';
      if (modelId.startsWith('google/')) return 'Google';
      if (modelId.startsWith('openai/')) return 'OpenAI';
      if (modelId.startsWith('mistralai/')) return 'Mistral';
      if (modelId.startsWith('microsoft/')) return 'Microsoft';
      if (modelId.startsWith('nvidia/')) return 'NVIDIA';
      if (modelId.startsWith('qwen/')) return 'Qwen';
      if (modelId.startsWith('x-ai/')) return 'xAI';
      if (modelId.startsWith('zyphra/')) return 'Zyphra';
      if (modelId.startsWith('sesame/')) return 'Sesame';
      if (modelId.startsWith('canopylabs/')) return 'Canopy';
      if (modelId.startsWith('hexgrad/')) return 'Kokoro';
      return 'Other';
    }
    switch (providerId) {
      case 'anthropic': return 'Anthropic';
      case 'google': return 'Google';
      case 'openai': return 'OpenAI';
      case 'groq': return 'Groq';
      case 'ollama': return 'Local';
      case 'lmstudio': return 'Local';
      default: return 'Other';
    }
  }

  $effect(() => {
    if (!modelDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (modelDropdownEl && !modelDropdownEl.contains(e.target as Node)) {
        modelDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    if (!providerDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (providerDropdownEl && !providerDropdownEl.contains(e.target as Node)) {
        providerDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    if (!voiceInputModelDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (voiceInputModelDropdownEl && !voiceInputModelDropdownEl.contains(e.target as Node)) {
        voiceInputModelDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    if (!voiceModelDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (voiceModelDropdownEl && !voiceModelDropdownEl.contains(e.target as Node)) {
        voiceModelDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    if (!completionProviderDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (completionProviderDropdownEl && !completionProviderDropdownEl.contains(e.target as Node)) {
        completionProviderDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    if (!completionModelDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (completionModelDropdownEl && !completionModelDropdownEl.contains(e.target as Node)) {
        completionModelDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    if (!voiceConversationProviderDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (voiceConversationProviderDropdownEl && !voiceConversationProviderDropdownEl.contains(e.target as Node)) {
        voiceConversationProviderDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    if (!voiceConversationModelDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (voiceConversationModelDropdownEl && !voiceConversationModelDropdownEl.contains(e.target as Node)) {
        voiceConversationModelDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    if (!voiceConversationTtsModelDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (voiceConversationTtsModelDropdownEl && !voiceConversationTtsModelDropdownEl.contains(e.target as Node)) {
        voiceConversationTtsModelDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    if (!voiceConversationTtsVoiceDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (voiceConversationTtsVoiceDropdownEl && !voiceConversationTtsVoiceDropdownEl.contains(e.target as Node)) {
        voiceConversationTtsVoiceDropdownOpen = false;
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  $effect(() => {
    // Reset search when provider changes
    const _ = $voiceAiProvider;
    voiceModelSearch = '';
  });

  $effect(() => {
    const _ = $voiceConversationAiProvider;
    voiceConversationModelSearch = '';
  });

  $effect(() => {
    const provider = $voiceConversationAiProvider;
    const model = $currentVoiceConversationTtsModel;
    const voices = getTtsVoiceOptionsForModel(provider, model);
    if (!voices.length) return;
    if (voices.some((voice) => voice.id === $currentVoiceConversationTtsVoice)) return;
    setVoiceConversationTtsVoice(provider, voices[0].id);
  });

  $effect(() => {
    const provider = $voiceConversationAiProvider;
    const model = $currentVoiceConversationTtsModel;
    if (!previewingVoiceId) return;
    if (previewingVoiceProvider === provider && previewingVoiceModel === model) return;
    stopSpeaking();
    previewingVoiceId = null;
    previewingVoiceProvider = null;
    previewingVoiceModel = '';
  });

  // Themes tab
  let showingCustomThemeEditor = $state(false);
  let customThemeName = $state('');
  let customThemeId = $state('');
  let customThemeColors: Record<string, string> = $state({});
  let customThemeSyntax: Record<string, string> = $state({});

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
        import('$lib/stores/notification').then(({ showToast }) => {
          showToast(message || 'Failed to import theme', 'error');
        });
      }
    };
    input.click();
  }

  function openCustomThemeEditor() {
    customThemeName = '';
    customThemeId = '';
    customThemeColors = {
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
    };
    customThemeSyntax = {
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
    };
    showingCustomThemeEditor = true;
  }

  function handleSaveCustomTheme() {
    if (!customThemeName.trim()) {
      import('$lib/stores/notification').then(({ showToast }) => {
        showToast('Please enter a theme name', 'error');
      });
      return;
    }
    const rawId = customThemeId.trim() || customThemeName.toLowerCase().replace(/\s+/g, '-');
    const id = rawId.replace(/[^a-z0-9_-]/g, '').slice(0, 64);
    if (!id) {
      import('$lib/stores/notification').then(({ showToast }) => {
        showToast('Theme ID contains no valid characters (use a-z, 0-9, - or _)', 'error');
      });
      return;
    }
    const theme = {
      id,
      name: customThemeName.trim(),
      type: 'dark' as const,
      colors: customThemeColors,
      syntax: customThemeSyntax,
    };
    saveTheme(theme);
    showingCustomThemeEditor = false;
  }

  // export prop so parent can close
  let { onclose }: { onclose: () => void } = $props();

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  let resetConfirming = $state(false);
  function handleResetApp() {
    if (!resetConfirming) { resetConfirming = true; return; }
    resetConfirming = false;
    clearAllApplicationState();
    onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (recordingId || newShortcutRecording) {
      handleShortcutKeyDown(e);
      return;
    }
    if (e.key === 'Escape') onclose();
  }

  function getActionCategory(id: string): string {
    const action = shortcutActions.find(a => a.id === id);
    return action ? action.category : 'General';
  }

  function getConflictLabel(id: string, keys: string): string | null {
    const conflict = findShortcutConflict(keys, id);
    return conflict ? conflict.label : null;
  }

  // Compute actions that are not yet bound to a user shortcut (runes-compatible)
  let availableActions = $derived(
    shortcutActions.filter(action => !($userShortcuts || []).some(s => s && s.id === action.id))
  );

  let actionOptions = $derived<DropdownOption[]>(
    availableActions.map(action => ({
      value: action.id,
      label: `[${action.category}] ${action.label}`
    }))
  );

  function handleResetAll() {
    userShortcuts.set(defaultShortcuts);
    showToast('All shortcuts reset to defaults', 'success');
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdrop}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Settings">

    <!-- ── Header ──────────────────────────── -->
    <div class="modal-header">
      <div class="modal-tabs">
        {#each modalTabs as { id, label }}
          <button
            class="modal-tab"
            class:active={activeTab === id}
            onclick={() => activeTab = id}
          >
            <span class="tab-icon">
              {#if id === 'general'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.5 1z"/>
                </svg>
              {:else if id === 'models'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                  <rect x="9" y="9" width="6" height="6" rx="1"/>
                  <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"/>
                </svg>
              {:else if id === 'terminal'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="4 17 10 11 4 5"/>
                  <line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
              {:else if id === 'shortcuts'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/>
                  <line x1="6" y1="8" x2="6" y2="8"/>
                  <line x1="10" y1="8" x2="10" y2="8"/>
                  <line x1="14" y1="8" x2="14" y2="8"/>
                  <line x1="18" y1="8" x2="18" y2="8"/>
                  <line x1="6" y1="12" x2="6" y2="12"/>
                  <line x1="18" y1="12" x2="18" y2="12"/>
                  <line x1="7" y1="16" x2="17" y2="16"/>
                  <line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              {:else if id === 'themes'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.03442 19.1758 5.10913 19.4253 5.04825 19.667L4.76435 20.7963C4.64687 21.2638 5.01168 21.7228 5.48512 21.6702L6.77259 21.5271C7.00947 21.5008 7.24156 21.5971 7.39143 21.777C8.7291 23.383 10.3204 22 12 22Z" />
                  <circle cx="7.5" cy="10.5" r="1" fill="currentColor"/>
                  <circle cx="11.5" cy="7.5" r="1" fill="currentColor"/>
                  <circle cx="16.5" cy="9.5" r="1" fill="currentColor"/>
                  <circle cx="15.5" cy="14.5" r="1" fill="currentColor"/>
                </svg>
              {:else if id === 'about'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="16" x2="12" y2="12"/>
                  <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
              {/if}
            </span>
            {label}
          </button>
        {/each}
      </div>
      <button class="modal-close" onclick={onclose} aria-label="Close settings">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <!-- ── Body ───────────────────────────── -->
    <div class="modal-body">

      {#if activeTab === 'general'}
        <div class="section-heading">
          <h2>General</h2>
          <p>Appearance, editor, and explorer settings.</p>
        </div>

        <!-- Appearance cards -->
        <div class="setting-group">
          <div class="group-label">Appearance</div>
          <div class="appearance-cards">
            {#each appearanceModes as { id, label }}
              <button
                class="appearance-card"
                class:selected={$appearance === id}
                onclick={() => $appearance = id}
              >
                <span class="appearance-icon">
                  {#if id === 'system'}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                      <line x1="8" y1="21" x2="16" y2="21"/>
                      <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                  {:else if id === 'light'}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="4"/>
                      <path d="M12 2v2"/>
                      <path d="M12 20v2"/>
                      <path d="m4.93 4.93 1.41 1.41"/>
                      <path d="m17.66 17.66 1.41 1.41"/>
                      <path d="M2 12h2"/>
                      <path d="M20 12h2"/>
                      <path d="m6.34 17.66-1.41 1.41"/>
                      <path d="m19.07 4.93-1.41 1.41"/>
                    </svg>
                  {:else if id === 'dark'}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                    </svg>
                  {/if}
                </span>
                <span class="appearance-label">{label}</span>
              </button>
            {/each}
          </div>
        </div>

        <!-- UI Scaling -->
        <div class="setting-group">
          <div class="group-label">UI Scaling</div>
          <div class="slider-row">
            <div class="toggle-info">
              <span class="toggle-label">Zoom level</span>
              <span class="toggle-desc">Scale the entire interface (icons, fonts, sidebars) uniformly.</span>
            </div>
            <div class="number-control">
              <button class="num-btn" onclick={() => $uiZoom = Math.max(50, $uiZoom - 10)}>−</button>
              <span class="num-val">{$uiZoom}%</span>
              <button class="num-btn" onclick={() => $uiZoom = Math.min(200, $uiZoom + 10)}>+</button>
              <button class="num-btn-reset" onclick={() => $uiZoom = 100}>Reset</button>
            </div>
          </div>
        </div>

        <!-- Editor section -->
        <div class="setting-group">
          <div class="group-label">Editor</div>

          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">Format on save</span>
              <span class="toggle-desc">Format files using Prettier when saving.</span>
            </div>
            <button
              class="toggle"
              class:on={$formatOnSave}
              onclick={() => $formatOnSave = !$formatOnSave}
              aria-label="Toggle Format on save"
              role="switch"
              aria-checked={$formatOnSave}
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>

          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">Vim mode</span>
              <span class="toggle-desc">Enable Vim keybindings in the code editor.</span>
            </div>
            <button
              class="toggle"
              class:on={$vimMode}
              onclick={() => $vimMode = !$vimMode}
              aria-label="Toggle Vim mode"
              role="switch"
              aria-checked={$vimMode}
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>

          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">Word wrap</span>
              <span class="toggle-desc">Wrap long lines in the editor.</span>
            </div>
            <button
              class="toggle"
              class:on={$wordWrap}
              onclick={() => $wordWrap = !$wordWrap}
              aria-label="Toggle word wrap"
              role="switch"
              aria-checked={$wordWrap}
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>

          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">Smart autocomplete (LSP)</span>
              <span class="toggle-desc">Type-aware completion, diagnostics &amp; hover from language servers (rust-analyzer, typescript-language-server, pyright, gopls). Install the server for each language you use.</span>
            </div>
            <button
              class="toggle"
              class:on={$enableLsp}
              onclick={() => $enableLsp = !$enableLsp}
              aria-label="Toggle smart autocomplete"
              role="switch"
              aria-checked={$enableLsp}
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>

          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">AI ghost text (Cursor-style)</span>
              <span class="toggle-desc">Faded inline predictions of the next code as you type; press Tab to accept. Off by default — pick the completion provider &amp; model in the Models tab.</span>
            </div>
            <button
              class="toggle"
              class:on={$aiGhostTextEnabled}
              onclick={() => $aiGhostTextEnabled = !$aiGhostTextEnabled}
              aria-label="Toggle AI ghost text"
              role="switch"
              aria-checked={$aiGhostTextEnabled}
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>

          <!-- AI ghost-text provider & model selection lives in the Models tab. -->

          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">Minimap</span>
              <span class="toggle-desc">Show code minimap in the editor sidebar.</span>
            </div>
            <button
              class="toggle"
              class:on={$minimap}
              onclick={() => $minimap = !$minimap}
              aria-label="Toggle minimap"
              role="switch"
              aria-checked={$minimap}
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>

          <div class="slider-row">
            <div class="toggle-info">
              <span class="toggle-label">Font size</span>
              <span class="toggle-desc">Editor font size in pixels.</span>
            </div>
            <div class="number-control">
              <button class="num-btn" onclick={() => $fontSize = Math.max(10, $fontSize - 1)}>−</button>
              <span class="num-val">{$fontSize}</span>
              <button class="num-btn" onclick={() => $fontSize = Math.min(24, $fontSize + 1)}>+</button>
            </div>
          </div>

          <div class="slider-row">
            <div class="toggle-info">
              <span class="toggle-label">Font family</span>
              <span class="toggle-desc">Applies to editor and terminal.</span>
            </div>
            <input
              class="text-input font-input"
              type="text"
              bind:value={$fontFamily}
              placeholder="'JetBrains Mono', monospace"
              spellcheck="false"
            />
          </div>

          <div class="slider-row">
            <div class="toggle-info">
              <span class="toggle-label">Tab size</span>
              <span class="toggle-desc">Number of spaces per indentation level.</span>
            </div>
            <div class="number-control">
              <button class="num-btn" onclick={() => $tabSize = Math.max(1, $tabSize - 1)}>−</button>
              <span class="num-val">{$tabSize}</span>
              <button class="num-btn" onclick={() => $tabSize = Math.min(8, $tabSize + 1)}>+</button>
            </div>
          </div>
        </div>

        <!-- Explorer section -->
        <div class="setting-group">
          <div class="group-label">Explorer</div>

          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">Show hidden files</span>
              <span class="toggle-desc">Include dot-prefixed files (.env, .gitignore, .config) in the file explorer.</span>
            </div>
            <button
              class="toggle"
              class:on={$showHidden}
              onclick={() => $showHidden = !$showHidden}
              aria-label="Toggle show hidden files"
              role="switch"
              aria-checked={$showHidden}
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>
        </div>

        <!-- Window behavior section -->
        <div class="setting-group">
          <div class="group-label">Window</div>
          <div class="option-cards">
            {#each closeBehaviorModes as option}
              <button
                type="button"
                class="option-card"
                class:selected={$closeBehavior === option.id}
                onclick={() => $closeBehavior = option.id}
              >
                <span class="option-title">{option.label}</span>
                <span class="option-desc">{option.desc}</span>
              </button>
            {/each}
          </div>
        </div>

        <!-- Notifications section -->
        <div class="setting-group">
          <div class="group-label">Notifications</div>

          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">Desktop notifications</span>
              <span class="toggle-desc">Show system notifications for agent activity, process exits, and attention requests — even when Soryq is in the background.</span>
            </div>
            <button
              class="toggle"
              class:on={$notificationsEnabled}
              onclick={async () => {
                const next = !$notificationsEnabled;
                if (next) await requestNotificationPermission();
                $notificationsEnabled = next;
              }}
              aria-label="Toggle desktop notifications"
              role="switch"
              aria-checked={$notificationsEnabled}
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>
        </div>
      {:else if activeTab === 'models'}
        {@const activeProvider = getProviderDef($aiProvider)}
        <div class="section-heading">
          <h2>Models</h2>
          <p>The main provider powers typed orchestration and AI commit messages. Voice input, voice refinement, and voice conversations each have their own settings below.</p>
        </div>

        <div class="security-note">
          <span class="security-note-label">Key storage</span>
          <span>Provider keys are saved in the OS keychain. The UI only keeps configured/not configured status and never reads the saved key back.</span>
        </div>

        <!-- Provider picker -->
        <div class="setting-group">
          <div class="group-label">Main AI provider</div>
          <div class="provider-grid">
            {#each aiProviders as provider}
              <button
                type="button"
                class="provider-card"
                data-provider={provider.id}
                class:selected={$aiProvider === provider.id}
                onclick={() => ($aiProvider = provider.id)}
              >
                <div class="provider-card-top">
                  <span class="provider-card-icon">
                    {#if provider.id === 'openrouter'}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16.804 1.957l7.22 4.105v.087L16.73 10.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147 1.352L8.345 11.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314 1.17.796 2.701 1.866 1.11.775 2.083 1.177 3.147 1.352l.3.045c.694.091 1.375.094 2.825.033l.022-2.159 7.22 4.105v.087L16.589 22l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997 21.997 0 00-.755-.498l-.467-.28a55.927 55.927 0 00-.76-.43C2.908 14.73.563 14.116 0 14.116V9.888l.14.004c.564-.007 2.91-.622 3.809-1.124l1.016-.58.438-.274c.428-.28 1.072-.726 2.686-1.853 1.621-1.133 3.186-1.78 4.881-2.059 1.152-.19 1.974-.213 3.814-.138l.02-1.907z" fill="currentColor"/>
                      </svg>
                    {:else if provider.id === 'anthropic'}
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M9.218 2h2.402L16 12.987h-2.402zM4.379 2h2.512l4.38 10.987H8.82l-.895-2.308h-4.58l-.896 2.307H0L4.38 2.001zm2.755 6.64L5.635 4.777 4.137 8.64z"/>
                      </svg>
                    {:else if provider.id === 'openai'}
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 0 0z"/>
                      </svg>
                    {:else if provider.id === 'google'}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"/>
                      </svg>
                    {:else if provider.id === 'groq'}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12.036 2c-3.853-.035-7 3-7.036 6.781-.035 3.782 3.055 6.872 6.908 6.907h2.42v-2.566h-2.292c-2.407.028-4.38-1.866-4.408-4.23-.029-2.362 1.901-4.298 4.308-4.326h.1c2.407 0 4.358 1.915 4.365 4.278v6.305c0 2.342-1.944 4.25-4.323 4.279a4.375 4.375 0 01-3.033-1.252l-1.851 1.818A7 7 0 0012.029 22h.092c3.803-.056 6.858-3.083 6.879-6.816v-6.5C18.907 4.963 15.817 2 12.036 2z"/>
                      </svg>
                    {:else if provider.id === 'ollama'}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7.905 1.09c.216.085.411.225.588.41.295.306.544.744.734 1.263.191.522.315 1.1.362 1.68a5.054 5.054 0 012.049-.636l.051-.004c.87-.07 1.73.087 2.48.474.101.053.2.11.297.17.05-.569.172-1.134.36-1.644.19-.52.439-.957.733-1.264a1.67 1.67 0 01.589-.41c.257-.1.53-.118.796-.042.401.114.745.368 1.016.737.248.337.434.769.561 1.287.23.934.27 2.163.115 3.645l.053.04.026.019c.757.576 1.284 1.397 1.563 2.35.435 1.487.216 3.155-.534 4.088l-.018.021.002.003c.417.762.67 1.567.724 2.4l.002.03c.064 1.065-.2 2.137-.814 3.19l-.007.01.01.024c.472 1.157.62 2.322.438 3.486l-.006.039a.651.651 0 01-.747.536.648.648 0 01-.54-.742c.167-1.033.01-2.069-.48-3.123a.643.643 0 01.04-.617l.004-.006c.604-.924.854-1.83.8-2.72-.046-.779-.325-1.544-.8-2.273a.644.644 0 01.18-.886l.009-.006c.243-.159.467-.565.58-1.12a4.229 4.229 0 00-.095-1.974c-.205-.7-.58-1.284-1.105-1.683-.595-.454-1.383-.673-2.38-.61a.653.653 0 01-.632-.371c-.314-.665-.772-1.141-1.343-1.436a3.288 3.288 0 00-1.772-.332c-1.245.099-2.343.801-2.67 1.686a.652.652 0 01-.61.425c-1.067.002-1.893.252-2.497.703-.522.39-.878.935-1.066 1.588a4.07 4.07 0 00-.068 1.886c.112.558.331 1.02.582 1.269l.008.007c.212.207.257.53.109.785-.36.622-.629 1.549-.673 2.44-.05 1.018.186 1.902.719 2.536l.016.019a.643.643 0 01.095.69c-.576 1.236-.753 2.252-.562 3.052a.652.652 0 01-1.269.298c-.243-1.018-.078-2.184.473-3.498l.014-.035-.008-.012a4.339 4.339 0 01-.598-1.309l-.005-.019a5.764 5.764 0 01-.177-1.785c.044-.91.278-1.842.622-2.59l.012-.026-.002-.002c-.293-.418-.51-.953-.63-1.545l-.005-.024a5.352 5.352 0 01.093-2.49c.262-.915.777-1.701 1.536-2.269.06-.045.123-.09.186-.132-.159-1.493-.119-2.73.112-3.67.127-.518.314-.95.562-1.287.27-.368.614-.622 1.015-.737.266-.076.54-.059.797.042zm4.116 9.09c.936 0 1.8.313 2.446.855.63.527 1.005 1.235 1.005 1.94 0 .888-.406 1.58-1.133 2.022-.62.375-1.451.557-2.403.557-1.009 0-1.871-.259-2.493-.734-.617-.47-.963-1.13-.963-1.845 0-.707.398-1.417 1.056-1.946.668-.537 1.55-.849 2.485-.849zm0 .896a3.07 3.07 0 00-1.916.65c-.461.37-.722.835-.722 1.25 0 .428.21.829.61 1.134.455.347 1.124.548 1.943.548.799 0 1.473-.147 1.932-.426.463-.28.7-.686.7-1.257 0-.423-.246-.89-.683-1.256-.484-.405-1.14-.643-1.864-.643zm.662 1.21l.004.004c.12.151.095.37-.056.49l-.292.23v.446a.375.375 0 01-.376.373.375.375 0 01-.376-.373v-.46l-.271-.218a.347.347 0 01-.052-.49.353.353 0 01.494-.051l.215.172.22-.174a.353.353 0 01.49.051zm-5.04-1.919c.478 0 .867.39.867.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zm8.706 0c.48 0 .868.39.868.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zM7.44 2.3l-.003.002a.659.659 0 00-.285.238l-.005.006c-.138.189-.258.467-.348.832-.17.692-.216 1.631-.124 2.782.43-.128.899-.208 1.404-.237l.01-.001.019-.034c.046-.082.095-.161.148-.239.123-.771.022-1.692-.253-2.444-.134-.364-.297-.65-.453-.813a.628.628 0 00-.107-.09L7.44 2.3zm9.174.04l-.002.001a.628.628 0 00-.107.09c-.156.163-.32.45-.453.814-.29.794-.387 1.776-.23 2.572l.058.097.008.014h.03a5.184 5.184 0 011.466.212c.086-1.124.038-2.043-.128-2.722-.09-.365-.21-.643-.349-.832l-.004-.006a.659.659 0 00-.285-.239h-.004z"/>
                      </svg>
                    {:else if provider.id === 'lmstudio'}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2.84 2a1.273 1.273 0 100 2.547h14.107a1.273 1.273 0 100-2.547H2.84zM7.935 5.33a1.273 1.273 0 000 2.548H22.04a1.274 1.274 0 000-2.547H7.935zM3.624 9.935c0-.704.57-1.274 1.274-1.274h14.106a1.274 1.274 0 010 2.547H4.898c-.703 0-1.274-.57-1.274-1.273zM1.273 12.188a1.273 1.273 0 100 2.547H15.38a1.274 1.274 0 000-2.547H1.273zM3.624 16.792c0-.704.57-1.274 1.274-1.274h14.106a1.273 1.273 0 110 2.547H4.898c-.703 0-1.274-.57-1.274-1.273zM13.029 18.849a1.273 1.273 0 100 2.547h9.698a1.273 1.273 0 100-2.547h-9.698z" fill-opacity=".3"></path>
                        <path d="M2.84 2a1.273 1.273 0 100 2.547h10.287a1.274 1.274 0 000-2.547H2.84zM7.935 5.33a1.273 1.273 0 000 2.548H18.22a1.274 1.274 0 000-2.547H7.935zM3.624 9.935c0-.704.57-1.274 1.274-1.274h10.286a1.273 1.273 0 010 2.547H4.898c-.703 0-1.274-.57-1.274-1.273zM1.273 12.188a1.273 1.273 0 100 2.547H11.56a1.274 1.274 0 000-2.547H1.273zM3.624 16.792c0-.704.57-1.274 1.274-1.274h10.286a1.273 1.273 0 110 2.547H4.898c-.703 0-1.274-.57-1.274-1.273zM13.029 18.849a1.273 1.273 0 100 2.547h5.78a1.273 1.273 0 100-2.547h-5.78z"></path>
                      </svg>
                    {/if}
                  </span>
                  <span class="provider-card-name">{provider.label}</span>
                </div>
                <span class="provider-card-status" class:ready={providerKeyStatus[provider.id] === 'saved'} class:error={providerKeyStatus[provider.id] === 'error'}>
                  {#if providerKeyStatus[provider.id] === 'saved'}
                    <span class="provider-key-dot"></span> {provider.local ? 'Ready' : 'Active'}
                  {:else if providerKeyStatus[provider.id] === 'loading'}
                    <span class="provider-key-dot loading"></span> checking
                  {:else if providerKeyStatus[provider.id] === 'error'}
                    <span class="provider-key-dot error-dot"></span> {provider.local ? 'Offline' : 'Error'}
                  {:else}
                    {provider.local ? 'No URL' : 'No key'}
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        </div>

        <!-- Active provider: key + model -->
        <div class="setting-group active-provider-group">
          <div class="group-label">Configure {activeProvider.label}</div>

          <div class="provider-details-card">

            {#if activeProvider.local}
            <!-- Server URL Row (local providers: Ollama, LM Studio) -->
            <div class="detail-row key-section">
              <div class="detail-row-header">
                <div class="detail-info">
                  <span class="detail-label">{activeProvider.keyLabel}</span>
                  <span class="detail-desc">
                    Runs on your machine — no API key needed. Make sure {activeProvider.label} is running.
                    <a class="provider-key-link" href={activeProvider.keyUrl} target="_blank" rel="noreferrer">Setup ↗</a>
                  </span>
                </div>
              </div>

              <div class="api-key-input-wrapper">
                <div class="input-inner-container">
                  <span class="input-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                  </span>
                  <input
                    class="text-input key-input"
                    type="text"
                    bind:value={providerBaseUrlValue[$aiProvider]}
                    placeholder={activeProvider.defaultBaseUrl}
                    spellcheck="false"
                    autocomplete="off"
                    onkeydown={(e) => { if (e.key === 'Enter') saveProviderBaseUrl($aiProvider); }}
                  />
                </div>
                <div class="api-key-actions">
                  <button class="key-btn clear-btn" onclick={() => resetProviderBaseUrl($aiProvider)}>
                    Reset
                  </button>
                  <button class="key-btn save-btn" onclick={() => saveProviderBaseUrl($aiProvider)}>
                    Save
                  </button>
                </div>
              </div>

              <!-- Connection Status Indicator -->
              <div class="key-status-indicator">
                {#if providerModelsStatus[$aiProvider] === 'loaded'}
                  <span class="status-badge success">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" fill="#10B981" fill-opacity="0.12"/>
                      <path d="M3.5 6l1.5 1.5 3.5-3.5" stroke="#10B981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Connected — {providerModels[$aiProvider]?.length ?? 0} models found</span>
                  </span>
                {:else if providerModelsStatus[$aiProvider] === 'loading'}
                  <span class="status-badge loading">
                    <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke-linecap="round"/>
                    </svg>
                    <span>Connecting to server…</span>
                  </span>
                {:else if providerModelsStatus[$aiProvider] === 'error'}
                  <span class="status-badge error">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" fill="#EF4444" fill-opacity="0.12"/>
                      <path d="M4 4l4 4M8 4L4 8" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Couldn't reach server — is {activeProvider.label} running?</span>
                  </span>
                {:else}
                  <span class="status-badge idle">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" fill="var(--text-muted)" fill-opacity="0.12"/>
                      <circle cx="6" cy="6" r="1.5" fill="var(--text-muted)"/>
                    </svg>
                    <span>Save the URL to connect & load your local models</span>
                  </span>
                {/if}
              </div>
            </div>
            {:else}

            <!-- API Key Row -->
            <div class="detail-row key-section">
              <div class="detail-row-header">
                <div class="detail-info">
                  <span class="detail-label">{activeProvider.keyLabel}</span>
                  <span class="detail-desc">
                    Stored in your OS keychain. Soryq sends provider requests from the backend without exposing the saved key in the frontend.
                    <a class="provider-key-link" href={activeProvider.keyUrl} target="_blank" rel="noreferrer">Get a key ↗</a>
                  </span>
                </div>
              </div>

              <div class="api-key-input-wrapper">
                <div class="input-inner-container">
                  <span class="input-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    class="text-input key-input"
                    type="password"
                    bind:value={providerKeyValue[$aiProvider]}
                    placeholder={providerKeyStatus[$aiProvider] === 'saved' ? '••••••••••••••••••••••••••••••••' : activeProvider.keyPlaceholder}
                    spellcheck="false"
                    autocomplete="off"
                    onkeydown={(e) => { if (e.key === 'Enter' && (providerKeyValue[$aiProvider] ?? '').trim()) saveProviderKey($aiProvider); }}
                  />
                </div>
                <div class="api-key-actions">
                  {#if providerKeyStatus[$aiProvider] === 'saved'}
                    <button class="key-btn clear-btn" onclick={() => clearProviderKey($aiProvider)}>
                      Clear
                    </button>
                  {/if}
                  <button 
                    class="key-btn save-btn" 
                    onclick={() => saveProviderKey($aiProvider)} 
                    disabled={!((providerKeyValue[$aiProvider] ?? '').trim())}
                  >
                    Save
                  </button>
                </div>
              </div>

              <!-- Connection/Key Status Indicator -->
              <div class="key-status-indicator">
                {#if providerKeyStatus[$aiProvider] === 'saved'}
                  <span class="status-badge success">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" fill="#10B981" fill-opacity="0.12"/>
                      <path d="M3.5 6l1.5 1.5 3.5-3.5" stroke="#10B981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>{activeProvider.local ? 'Local server online & ready' : 'Key configured & active'}</span>
                  </span>
                {:else if providerKeyStatus[$aiProvider] === 'loading'}
                  <span class="status-badge loading">
                    <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke-linecap="round"/>
                    </svg>
                    <span>{activeProvider.local ? 'Checking local server…' : 'Checking key…'}</span>
                  </span>
                {:else if providerKeyStatus[$aiProvider] === 'error'}
                  <span class="status-badge error">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" fill="#EF4444" fill-opacity="0.12"/>
                      <path d="M4 4l4 4M8 4L4 8" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>{activeProvider.local ? 'Offline — make sure server is running' : 'Validation error — click retry or update key'}</span>
                  </span>
                {:else}
                  <span class="status-badge idle">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" fill="var(--text-muted)" fill-opacity="0.12"/>
                      <circle cx="6" cy="6" r="1.5" fill="var(--text-muted)"/>
                    </svg>
                    <span>No API key set — using static curated fallbacks</span>
                  </span>
                {/if}
              </div>
            </div>
            {/if}

            <!-- Model Selection Row -->
            <div class="detail-row model-section">
              <div class="model-selector-wrap" bind:this={modelDropdownEl}>
                <div class="model-label-row">
                  <div class="detail-info">
                    <span class="detail-label">Model Selection</span>
                    <span class="detail-desc">
                      {#if providerKeyStatus[$aiProvider] !== 'saved'}
                        {activeProvider.local ? 'Set a server URL to load your local models.' : 'Add a key to load full model list.'}
                      {:else if providerModelsStatus[$aiProvider] === 'loading'}
                        Loading live catalog…
                      {:else if providerModelsStatus[$aiProvider] === 'error'}
                        Couldn't load live models. <button type="button" class="model-inline-link" onclick={() => loadModels($aiProvider, true)}>Retry</button>
                      {:else if providerModelsStatus[$aiProvider] === 'loaded'}
                        Using live provider catalog.
                      {:else}
                        Select AI model for voice & commits.
                      {/if}
                    </span>
                  </div>

                  <div class="model-meta-actions">
                    <!-- Model catalog source indicator -->
                    {#if providerModelsStatus[$aiProvider] === 'loaded'}
                      <span class="model-status-pill live" title="Live catalog successfully fetched using your API key">
                        <span class="pulse-dot"></span> Live
                      </span>
                    {:else if providerKeyStatus[$aiProvider] === 'saved' && providerModelsStatus[$aiProvider] === 'loading'}
                      <span class="model-status-pill loading">
                        Checking…
                      </span>
                    {:else}
                      <span class="model-status-pill curated" title="Using local curated model defaults">
                        Curated
                      </span>
                    {/if}

                    {#if providerKeyStatus[$aiProvider] === 'saved'}
                      <button
                        type="button"
                        class="model-refresh-btn"
                        title="Reload models from {activeProvider.label}"
                        aria-label="Reload models"
                        onclick={() => loadModels($aiProvider, true)}
                      >
                        <svg class:spin={providerModelsStatus[$aiProvider] === 'loading'} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="23 4 23 10 17 10"/>
                          <polyline points="1 20 1 14 7 14"/>
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                      </button>
                    {/if}
                  </div>
                </div>

                <button
                  type="button"
                  class="model-trigger"
                  onclick={() => (modelDropdownOpen = !modelDropdownOpen)}
                  aria-haspopup="listbox"
                  aria-expanded={modelDropdownOpen}
                >
                  <div class="model-trigger-left">
                    <span class="model-trigger-badge" data-provider={modelBadge($aiProvider, $currentAiModel)}>
                      {modelBadge($aiProvider, $currentAiModel)}
                    </span>
                    <div class="model-trigger-meta">
                      <div class="model-trigger-name">
                        {selectedModel?.label ?? $currentAiModel}
                      </div>
                      <div class="model-trigger-desc">
                        {selectedModel?.description || $currentAiModel}
                      </div>
                    </div>
                  </div>
                  <div class="model-trigger-right">
                    {#if selectedModel?.free || $currentAiModel.includes(':free')}
                      <span class="model-free-badge">Free</span>
                    {/if}
                    <svg class="model-chevron" class:open={modelDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {#if modelDropdownOpen}
                  <div class="model-dropdown" role="listbox">
                    <div class="model-search-bar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        class="model-search-input"
                        type="text"
                        placeholder="Search {activeProvider.label} models…"
                        bind:value={modelSearch}
                        spellcheck="false"
                        autocomplete="off"
                        autofocus
                      />
                      {#if modelSearch}
                        <button type="button" class="model-search-clear" onclick={() => (modelSearch = '')} aria-label="Clear search">×</button>
                      {/if}
                    </div>
                    <div class="model-list">
                      {#if providerModelsStatus[$aiProvider] === 'loading' && activeModels.length === 0}
                        <div class="model-empty">Loading {activeProvider.label} models…</div>
                      {:else if filteredModels.length === 0}
                        <div class="model-empty">No models match “{modelSearch}”.</div>
                      {:else}
                        {#each filteredModels as model (model.id)}
                          <button
                            type="button"
                            class="model-option"
                            class:selected={$currentAiModel === model.id}
                            role="option"
                            aria-selected={$currentAiModel === model.id}
                            onclick={() => { setAiModel($aiProvider, model.id); modelDropdownOpen = false; }}
                          >
                            <div class="model-option-left">
                              <span class="model-option-badge" data-provider={modelBadge($aiProvider, model.id)}>
                                {modelBadge($aiProvider, model.id)}
                              </span>
                              <div class="model-option-body">
                                <div class="model-option-name">{model.label}</div>
                                <div class="model-option-desc">{model.description || model.id}</div>
                              </div>
                            </div>
                            <div class="model-option-right">
                              {#if model.free || model.id.endsWith(':free')}
                                <span class="model-free-badge">Free</span>
                              {/if}
                              {#if $currentAiModel === model.id}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              {/if}
                            </div>
                          </button>
                        {/each}
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            </div>

          </div>
        </div>

        <div class="setting-group active-provider-group">
          <div class="group-label">AI ghost text</div>
          <div class="provider-details-card">
            <div class="detail-row key-section">
              <div class="detail-row-header">
                <div class="detail-info">
                  <span class="detail-label">Completion provider</span>
                  <span class="detail-desc">
                    Powers Cursor-style inline code predictions. Pick a fast model — it fires on every typing pause. Turn the feature on under Editor settings.
                  </span>
                </div>
                {#if providerKeyStatus[$aiCompletionProvider] === 'saved'}
                  <span class="status-badge success">Ready</span>
                {:else if providerKeyStatus[$aiCompletionProvider] === 'loading'}
                  <span class="status-badge loading">checking</span>
                {:else if providerKeyStatus[$aiCompletionProvider] === 'error'}
                  <span class="status-badge error">{isLocalProvider($aiCompletionProvider) ? 'Offline' : 'Error'}</span>
                {:else}
                  <span class="status-badge idle">{isLocalProvider($aiCompletionProvider) ? 'No URL' : 'No key'}</span>
                {/if}
              </div>

              <div class="model-selector-wrap" bind:this={completionProviderDropdownEl}>
                <button
                  type="button"
                  class="model-trigger"
                  onclick={() => (completionProviderDropdownOpen = !completionProviderDropdownOpen)}
                  aria-haspopup="listbox"
                  aria-expanded={completionProviderDropdownOpen}
                >
                  <div class="model-trigger-left">
                    <span class="model-trigger-badge" data-provider={modelBadge($aiCompletionProvider, '')}>
                      {modelBadge($aiCompletionProvider, '')}
                    </span>
                    <div class="model-trigger-meta">
                      <div class="model-trigger-name">{activeCompletionProvider.label}</div>
                    </div>
                  </div>
                  <div class="model-trigger-right">
                    <svg class="model-chevron" class:open={completionProviderDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {#if completionProviderDropdownOpen}
                  <div class="model-dropdown" role="listbox">
                    <div class="model-list">
                      {#each aiProviders as provider}
                        <button
                          type="button"
                          class="model-option"
                          class:selected={$aiCompletionProvider === provider.id}
                          role="option"
                          aria-selected={$aiCompletionProvider === provider.id}
                          onclick={() => { $aiCompletionProvider = provider.id; completionProviderDropdownOpen = false; }}
                        >
                          <div class="model-option-left">
                            <span class="model-option-badge" data-provider={modelBadge(provider.id, '')}>
                              {modelBadge(provider.id, '')}
                            </span>
                            <div class="model-option-body">
                              <div class="model-option-name">{provider.label}</div>
                            </div>
                          </div>
                          <div class="model-option-right">
                            {#if $aiCompletionProvider === provider.id}
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            {/if}
                          </div>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <div class="detail-row model-section">
              <div class="model-label-row">
                <div class="detail-info">
                  <span class="detail-label">Completion model</span>
                  <span class="detail-desc">
                    {#if providerKeyStatus[$aiCompletionProvider] !== 'saved'}
                      {activeCompletionProvider.local ? 'Set a server URL for this provider above to load live models.' : 'Add a key for this provider above to load the live catalog.'}
                    {:else if completionProviderModelsStatus[$aiCompletionProvider] === 'loading'}
                      Loading live catalog…
                    {:else if completionProviderModelsStatus[$aiCompletionProvider] === 'error'}
                      Couldn't load live models. <button type="button" class="model-inline-link" onclick={() => loadCompletionModels($aiCompletionProvider, true)}>Retry</button>
                    {:else if completionProviderModelsStatus[$aiCompletionProvider] === 'loaded'}
                      Using live provider catalog.
                    {:else}
                      Using curated model fallbacks.
                    {/if}
                  </span>
                </div>

                <div class="model-meta-actions">
                  {#if completionProviderModelsStatus[$aiCompletionProvider] === 'loaded'}
                    <span class="model-status-pill live" title="Live catalog successfully fetched using your API key">
                      <span class="pulse-dot"></span> Live
                    </span>
                  {:else if providerKeyStatus[$aiCompletionProvider] === 'saved' && completionProviderModelsStatus[$aiCompletionProvider] === 'loading'}
                    <span class="model-status-pill loading">Checking…</span>
                  {:else if completionProviderModelsStatus[$aiCompletionProvider] === 'error'}
                    <span class="model-status-pill error" title={completionProviderModelsError[$aiCompletionProvider] || 'Failed to load live models'}>Error</span>
                  {:else}
                    <span class="model-status-pill curated" title="Using local curated model defaults">Curated</span>
                  {/if}

                  {#if providerKeyStatus[$aiCompletionProvider] === 'saved'}
                    <button
                      type="button"
                      class="model-refresh-btn"
                      title="Reload models from {activeCompletionProvider.label}"
                      aria-label="Reload completion models"
                      onclick={() => loadCompletionModels($aiCompletionProvider, true)}
                    >
                      <svg class:spin={completionProviderModelsStatus[$aiCompletionProvider] === 'loading'} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"/>
                        <polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                      </svg>
                    </button>
                  {/if}
                </div>
              </div>

              <div class="model-selector-wrap" bind:this={completionModelDropdownEl}>
                <button
                  type="button"
                  class="model-trigger"
                  onclick={() => (completionModelDropdownOpen = !completionModelDropdownOpen)}
                  aria-haspopup="listbox"
                  aria-expanded={completionModelDropdownOpen}
                >
                  <div class="model-trigger-left">
                    <span class="model-trigger-badge" data-provider={modelBadge($aiCompletionProvider, currentCompletionModel)}>
                      {modelBadge($aiCompletionProvider, currentCompletionModel)}
                    </span>
                    <div class="model-trigger-meta">
                      <div class="model-trigger-name">{selectedCompletionModel?.label ?? currentCompletionModel}</div>
                      <div class="model-trigger-desc">{selectedCompletionModel?.description || currentCompletionModel}</div>
                    </div>
                  </div>
                  <div class="model-trigger-right">
                    {#if selectedCompletionModel?.free || currentCompletionModel.includes(':free')}
                      <span class="model-free-badge">Free</span>
                    {/if}
                    <svg class="model-chevron" class:open={completionModelDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {#if completionModelDropdownOpen}
                  <div class="model-dropdown" role="listbox">
                    <div class="model-search-bar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        class="model-search-input"
                        type="text"
                        placeholder="Search {activeCompletionProvider.label} models…"
                        bind:value={completionModelSearch}
                        spellcheck="false"
                        autocomplete="off"
                      />
                      {#if completionModelSearch}
                        <button type="button" class="model-search-clear" onclick={() => (completionModelSearch = '')} aria-label="Clear search">×</button>
                      {/if}
                    </div>
                    <div class="model-list">
                      {#if completionProviderModelsStatus[$aiCompletionProvider] === 'loading' && completionActiveModels.length === 0}
                        <div class="model-empty">Loading {activeCompletionProvider.label} models…</div>
                      {:else if completionProviderModelsStatus[$aiCompletionProvider] === 'error' && completionActiveModels.length === 0}
                        <div class="model-empty">
                          Couldn't load live models. <button type="button" class="model-inline-link" onclick={() => loadCompletionModels($aiCompletionProvider, true)}>Retry</button>
                        </div>
                      {:else if filteredCompletionModels.length === 0}
                        <div class="model-empty">No models match “{completionModelSearch}”.</div>
                      {:else}
                        {#each filteredCompletionModels as model (model.id)}
                          <button
                            type="button"
                            class="model-option"
                            class:selected={currentCompletionModel === model.id}
                            role="option"
                            aria-selected={currentCompletionModel === model.id}
                            onclick={() => { setCompletionModel($aiCompletionProvider, model.id); completionModelDropdownOpen = false; }}
                          >
                            <div class="model-option-left">
                              <span class="model-option-badge" data-provider={modelBadge($aiCompletionProvider, model.id)}>
                                {modelBadge($aiCompletionProvider, model.id)}
                              </span>
                              <div class="model-option-body">
                                <div class="model-option-name">{model.label}</div>
                                <div class="model-option-desc">{model.description || model.id}</div>
                              </div>
                            </div>
                            <div class="model-option-right">
                              {#if model.free || model.id.endsWith(':free')}
                                <span class="model-free-badge">Free</span>
                              {/if}
                              {#if currentCompletionModel === model.id}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              {/if}
                            </div>
                          </button>
                        {/each}
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <div class="setting-group active-provider-group">
          <div class="group-label">Voice input</div>
          <div class="provider-details-card">
            <div class="detail-row key-section">
              <div class="detail-row-header">
                <div class="detail-info">
                  <span class="detail-label">Input engine</span>
                  <span class="detail-desc">
                    Choose whether dictation starts with browser Web Speech or a model transcription pass. OpenRouter audio currently requires account balance, even when a chat model slug includes :free.
                  </span>
                </div>
              </div>

              <div class="provider-grid voice-input-provider-grid">
                {#each voiceInputProviderOptions as inputProvider}
                  <button
                    type="button"
                    class="provider-card voice-input-provider-card"
                    data-provider={inputProvider.id}
                    class:selected={$voiceInputProvider === inputProvider.id}
                    onclick={() => ($voiceInputProvider = inputProvider.id)}
                  >
                    <div class="provider-card-top">
                      <span class="provider-card-icon">
                        {#if inputProvider.id === 'google'}
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"/>
                          </svg>
                        {:else if inputProvider.id === 'openrouter'}
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M16.804 1.957l7.22 4.105v.087L16.73 10.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147 1.352L8.345 11.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314 1.17.796 2.701 1.866 1.11.775 2.083 1.177 3.147 1.352l.3.045c.694.091 1.375.094 2.825.033l.022-2.159 7.22 4.105v.087L16.589 22l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997 21.997 0 00-.755-.498l-.467-.28a55.927 55.927 0 00-.76-.43C2.908 14.73.563 14.116 0 14.116V9.888l.14.004c.564-.007 2.91-.622 3.809-1.124l1.016-.58.438-.274c.428-.28 1.072-.726 2.686-1.853 1.621-1.133 3.186-1.78 4.881-2.059 1.152-.19 1.974-.213 3.814-.138l.02-1.907z" fill="currentColor"/>
                          </svg>
                        {:else}
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 18a6 6 0 0 0 6-6V6a6 6 0 0 0-12 0v6a6 6 0 0 0 6 6Z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                            <path d="M12 19v3"/>
                          </svg>
                        {/if}
                      </span>
                      <span class="provider-card-name">{inputProvider.label}</span>
                    </div>
                    <div class="provider-card-subtitle">{inputProvider.subtitle}</div>
                    <span class="provider-card-status voice-input-provider-status" class:ready={inputProvider.status === 'Ready' || inputProvider.status === 'Local'} class:error={inputProvider.status === 'Error'}>
                      {#if inputProvider.status === 'Local' || inputProvider.status === 'Ready'}
                        <span class="provider-key-dot"></span>
                      {:else if inputProvider.status === 'Checking'}
                        <span class="provider-key-dot loading"></span>
                      {:else if inputProvider.status === 'Error'}
                        <span class="provider-key-dot error-dot"></span>
                      {/if}
                      {inputProvider.status}
                    </span>
                  </button>
                {/each}
              </div>
            </div>

            {#if $voiceInputProvider !== 'webspeech'}
              <div class="detail-row model-section">
                <div class="detail-row-header">
                  <div class="detail-info">
                    <span class="detail-label">Transcription model</span>
                    <span class="detail-desc">
                      This model handles the audio transcription step directly. For no-balance input, use browser Web Speech or a local transcription server.
                    </span>
                  </div>
                </div>

                {#if voiceInputModelIsLocal}
                  <div class="api-key-input-wrapper" style="max-width: 420px;">
                    <div class="input-inner-container">
                      <span class="input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 18a6 6 0 0 0 6-6V6a6 6 0 0 0-12 0v6a6 6 0 0 0 6 6Z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <path d="M12 19v3" />
                        </svg>
                      </span>
                      <input
                        class="text-input key-input"
                        type="text"
                        value={$currentVoiceInputModel}
                        placeholder="local-stt-model"
                        spellcheck="false"
                        autocomplete="off"
                        disabled={providerKeyStatus[activeVoiceInputModelProvider] !== 'saved'}
                        oninput={(e) => setVoiceInputModel(activeVoiceInputModelProvider, (e.currentTarget as HTMLInputElement).value)}
                      />
                    </div>
                  </div>
                {:else}
                  <div class="model-selector-wrap stt-selector-wrap" bind:this={voiceInputModelDropdownEl}>
                    <button
                      type="button"
                      class="model-trigger stt-trigger"
                      onclick={() => (voiceInputModelDropdownOpen = !voiceInputModelDropdownOpen)}
                      aria-haspopup="listbox"
                      aria-expanded={voiceInputModelDropdownOpen}
                      disabled={providerKeyStatus[activeVoiceInputModelProvider] !== 'saved' || !voiceInputModelOptions.length}
                    >
                      <div class="model-trigger-left">
                        <span class="stt-model-icon" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 18a6 6 0 0 0 6-6V6a6 6 0 0 0-12 0v6a6 6 0 0 0 6 6Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <path d="M12 19v3" />
                          </svg>
                        </span>
                        <span class="model-trigger-badge" data-provider={modelBadge(activeVoiceInputModelProvider, $currentVoiceInputModel)}>
                          {modelBadge(activeVoiceInputModelProvider, $currentVoiceInputModel)}
                        </span>
                        <div class="model-trigger-meta">
                          <div class="model-trigger-name">
                            {selectedVoiceInputModel?.label ?? $currentVoiceInputModel}
                          </div>
                          <div class="model-trigger-desc">
                            {selectedVoiceInputModel?.description || 'Speech-to-text model'}
                          </div>
                        </div>
                      </div>
                      <div class="model-trigger-right">
                        <span class="stt-mode-pill">STT</span>
                        <svg class="model-chevron" class:open={voiceInputModelDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </div>
                    </button>

                    {#if voiceInputModelDropdownOpen}
                      <div class="model-dropdown stt-dropdown" role="listbox" aria-label="Voice input model">
                        <div class="model-list">
                          {#each getVoiceInputModelOptions($voiceInputProvider) as model (model.id)}
                            <button
                              type="button"
                              class="model-option stt-model-option"
                              class:selected={$currentVoiceInputModel === model.id}
                              role="option"
                              aria-selected={$currentVoiceInputModel === model.id}
                              onclick={() => chooseVoiceInputModel(model.id)}
                            >
                              <div class="model-option-left">
                                <span class="model-option-badge" data-provider={modelBadge(activeVoiceInputModelProvider, model.id)}>
                                  {modelBadge(activeVoiceInputModelProvider, model.id)}
                                </span>
                                <div class="model-option-body">
                                  <div class="model-option-name">{model.label}</div>
                                  <div class="model-option-desc">{model.description}</div>
                                </div>
                              </div>
                              <div class="model-option-right">
                                {#if model.free || model.id.endsWith(':free')}
                                  <span class="model-free-badge">Free</span>
                                {/if}
                                {#if $currentVoiceInputModel === model.id}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                {/if}
                              </div>
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}

                {#if providerKeyStatus[activeVoiceInputModelProvider] !== 'saved'}
                  <div class="key-status-indicator voice-input-key-hint" style="margin-top: 10px;">
                    <span class="status-badge idle voice-input-key-hint-badge">
                      {#if voiceInputModelIsLocal}
                        Set a {getProviderDef(activeVoiceInputModelProvider).label} server URL in the main provider section above to enable local transcription.
                      {:else}
                        Add an {$voiceInputProvider === 'openrouter' ? 'OpenRouter' : 'Google'} key in the main provider section above to enable model-based transcription.
                      {/if}
                    </span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        <div class="setting-group active-provider-group">
          <div class="group-label">Voice refinement</div>
          <div class="provider-details-card">
            <div class="detail-row refinement-section">
              <div class="refinement-row">
                <div class="refinement-copy">
                  <div class="ai-feature-icon-wrapper">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9.813 15.904L9 21L8.188 15.904L3 15L8.188 14.096L9 9L9.813 14.096L15 15L9.813 15.904Z" fill="currentColor" fill-opacity="0.15" />
                      <path d="M19.071 4.929a10 10 0 0 0-1.414-1.414M14 2L15 4M20 9L22 10" />
                    </svg>
                  </div>
                  <div class="toggle-info">
                    <span class="toggle-label">AI voice refinement</span>
                    <span class="toggle-desc">Rewrite dictated text before it reaches the floating bar. It uses the dedicated voice provider below and falls back through configured providers when needed.</span>
                  </div>
                </div>
                <button
                  class="toggle"
                  class:on={$voiceRefinementEnabled}
                  onclick={() => $voiceRefinementEnabled = !$voiceRefinementEnabled}
                  aria-label="Toggle AI voice refinement"
                  role="switch"
                  aria-checked={$voiceRefinementEnabled}
                >
                  <span class="toggle-thumb"></span>
                </button>
              </div>
            </div>

            <div class="detail-row key-section">
              <div class="detail-row-header">
                <div class="detail-info">
                  <span class="detail-label">Provider</span>
                  <span class="detail-desc">
                    Dedicated to dictated text. Defaults to Groq, then falls back to local models and OpenRouter.
                  </span>
                </div>
                {#if providerKeyStatus[$voiceAiProvider] === 'saved'}
                  <span class="status-badge success">Ready</span>
                {:else if providerKeyStatus[$voiceAiProvider] === 'loading'}
                  <span class="status-badge loading">checking</span>
                {:else if providerKeyStatus[$voiceAiProvider] === 'error'}
                  <span class="status-badge error">{isLocalProvider($voiceAiProvider) ? 'Offline' : 'Error'}</span>
                {:else}
                  <span class="status-badge idle">{isLocalProvider($voiceAiProvider) ? 'No URL' : 'No key'}</span>
                {/if}
              </div>

              <div class="model-selector-wrap" bind:this={providerDropdownEl}>
                <button
                  type="button"
                  class="model-trigger"
                  onclick={() => (providerDropdownOpen = !providerDropdownOpen)}
                  aria-haspopup="listbox"
                  aria-expanded={providerDropdownOpen}
                >
                  <div class="model-trigger-left">
                    <span class="model-trigger-badge" data-provider={modelBadge($voiceAiProvider, '')}>
                      {modelBadge($voiceAiProvider, '')}
                    </span>
                    <div class="model-trigger-meta">
                      <div class="model-trigger-name">
                        {getProviderDef($voiceAiProvider).label}
                      </div>
                    </div>
                  </div>
                  <div class="model-trigger-right">
                    <svg class="model-chevron" class:open={providerDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {#if providerDropdownOpen}
                  <div class="model-dropdown" role="listbox">
                    <div class="model-list">
                      {#each aiProviders as provider}
                        <button
                          type="button"
                          class="model-option"
                          class:selected={$voiceAiProvider === provider.id}
                          role="option"
                          aria-selected={$voiceAiProvider === provider.id}
                          onclick={() => { $voiceAiProvider = provider.id; providerDropdownOpen = false; }}
                        >
                          <div class="model-option-left">
                            <span class="model-option-badge" data-provider={modelBadge(provider.id, '')}>
                              {modelBadge(provider.id, '')}
                            </span>
                            <div class="model-option-body">
                              <div class="model-option-name">{provider.label}</div>
                            </div>
                          </div>
                          <div class="model-option-right">
                            {#if $voiceAiProvider === provider.id}
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            {/if}
                          </div>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <div class="detail-row model-section">
              <div class="detail-row-header">
                <div class="detail-info">
                  <span class="detail-label">Model</span>
                  <span class="detail-desc">
                    Uses {activeVoiceProvider.label}’s live catalog when a key or local server URL is configured in the main Models section.
                  </span>
                </div>
              </div>

              <div class="model-label-row">
                <div class="detail-info">
                  <span class="detail-label">Model Selection</span>
                  <span class="detail-desc">
                    {#if providerKeyStatus[$voiceAiProvider] !== 'saved'}
                      {activeVoiceProvider.local ? 'Set a server URL in the main Models section to load live voice models.' : 'Add a key in the main Models section to load full voice models.'}
                    {:else if voiceProviderModelsStatus[$voiceAiProvider] === 'loading'}
                      Loading live catalog…
                    {:else if voiceProviderModelsStatus[$voiceAiProvider] === 'error'}
                      Couldn't load live models. <button type="button" class="model-inline-link" title={voiceProviderModelsError[$voiceAiProvider] || 'Retry loading live voice models'} onclick={() => loadVoiceModels($voiceAiProvider, true)}>Retry</button>
                    {:else if voiceProviderModelsStatus[$voiceAiProvider] === 'loaded'}
                      Using live provider catalog.
                    {:else}
                      Using curated voice model fallbacks.
                    {/if}
                  </span>
                </div>

                <div class="model-meta-actions">
                  {#if voiceProviderModelsStatus[$voiceAiProvider] === 'loaded'}
                    <span class="model-status-pill live" title="Live catalog successfully fetched using the selected voice provider">
                      <span class="pulse-dot"></span> Live
                    </span>
                  {:else if providerKeyStatus[$voiceAiProvider] === 'saved' && voiceProviderModelsStatus[$voiceAiProvider] === 'loading'}
                    <span class="model-status-pill loading">Checking…</span>
                  {:else if voiceProviderModelsStatus[$voiceAiProvider] === 'error'}
                    <span class="model-status-pill error" title={voiceProviderModelsError[$voiceAiProvider] || 'Failed to load live voice models'}>
                      Error
                    </span>
                  {:else}
                    <span class="model-status-pill curated" title="Using local curated voice model defaults">Curated</span>
                  {/if}

                  {#if providerKeyStatus[$voiceAiProvider] === 'saved'}
                    <button
                      type="button"
                      class="model-refresh-btn"
                      title="Reload models from {activeVoiceProvider.label}"
                      aria-label="Reload voice models"
                      onclick={() => loadVoiceModels($voiceAiProvider, true)}
                    >
                      <svg class:spin={voiceProviderModelsStatus[$voiceAiProvider] === 'loading'} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"/>
                        <polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                      </svg>
                    </button>
                  {/if}
                </div>
              </div>
              <div class="model-selector-wrap" bind:this={voiceModelDropdownEl}>
                <button
                  type="button"
                  class="model-trigger"
                  onclick={() => (voiceModelDropdownOpen = !voiceModelDropdownOpen)}
                  aria-haspopup="listbox"
                  aria-expanded={voiceModelDropdownOpen}
                >
                  <div class="model-trigger-left">
                    <span class="model-trigger-badge" data-provider={modelBadge($voiceAiProvider, $currentVoiceAiModel)}>
                      {modelBadge($voiceAiProvider, $currentVoiceAiModel)}
                    </span>
                    <div class="model-trigger-meta">
                      <div class="model-trigger-name">
                        {selectedVoiceModel?.label ?? $currentVoiceAiModel}
                      </div>
                      <div class="model-trigger-desc">
                        {selectedVoiceModel?.description || $currentVoiceAiModel}
                      </div>
                    </div>
                  </div>
                  <div class="model-trigger-right">
                    {#if selectedVoiceModel?.free || $currentVoiceAiModel.includes(':free')}
                      <span class="model-free-badge">Free</span>
                    {/if}
                    <svg class="model-chevron" class:open={voiceModelDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {#if voiceModelDropdownOpen}
                  <div class="model-dropdown" role="listbox">
                    <div class="model-search-bar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        class="model-search-input"
                        type="text"
                        placeholder="Search {activeVoiceProvider.label} models…"
                        bind:value={voiceModelSearch}
                        spellcheck="false"
                        autocomplete="off"
                        autofocus
                      />
                      {#if voiceModelSearch}
                        <button type="button" class="model-search-clear" onclick={() => (voiceModelSearch = '')} aria-label="Clear search">×</button>
                      {/if}
                    </div>
                    <div class="model-list">
                      {#if voiceProviderModelsStatus[$voiceAiProvider] === 'loading' && voiceActiveModels.length === 0}
                        <div class="model-empty">Loading {activeVoiceProvider.label} models…</div>
                      {:else if voiceProviderModelsStatus[$voiceAiProvider] === 'error' && voiceActiveModels.length === 0}
                        <div class="model-empty">
                          Couldn't load live models. <button type="button" class="model-inline-link" onclick={() => loadVoiceModels($voiceAiProvider, true)}>Retry</button>
                        </div>
                      {:else if filteredVoiceModels.length === 0}
                        <div class="model-empty">No models match “{voiceModelSearch}”.</div>
                      {:else}
                        {#each filteredVoiceModels as model (model.id)}
                          <button
                            type="button"
                            class="model-option"
                            class:selected={$currentVoiceAiModel === model.id}
                            role="option"
                            aria-selected={$currentVoiceAiModel === model.id}
                            onclick={() => { setVoiceAiModel($voiceAiProvider, model.id); voiceModelDropdownOpen = false; }}
                          >
                            <div class="model-option-left">
                              <span class="model-option-badge" data-provider={modelBadge($voiceAiProvider, model.id)}>
                                {modelBadge($voiceAiProvider, model.id)}
                              </span>
                              <div class="model-option-body">
                                <div class="model-option-name">{model.label}</div>
                                <div class="model-option-desc">{model.description || model.id}</div>
                              </div>
                            </div>
                            <div class="model-option-right">
                              {#if model.free || model.id.endsWith(':free')}
                                <span class="model-free-badge">Free</span>
                              {/if}
                              {#if $currentVoiceAiModel === model.id}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              {/if}
                            </div>
                          </button>
                        {/each}
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <div class="setting-group active-provider-group">
          <div class="group-label">Voice conversation</div>
          <div class="provider-details-card">
            <div class="detail-row key-section">
              <div class="detail-row-header">
                <div class="detail-info">
                  <span class="detail-label">Provider</span>
                  <span class="detail-desc">
                    Powers the orchestrator brain in agent voice mode, so you can switch the conversation model independently from typed chat and dictation refinement.
                  </span>
                </div>
                {#if providerKeyStatus[$voiceConversationAiProvider] === 'saved'}
                  <span class="status-badge success">Ready</span>
                {:else if providerKeyStatus[$voiceConversationAiProvider] === 'loading'}
                  <span class="status-badge loading">checking</span>
                {:else if providerKeyStatus[$voiceConversationAiProvider] === 'error'}
                  <span class="status-badge error">{isLocalProvider($voiceConversationAiProvider) ? 'Offline' : 'Error'}</span>
                {:else}
                  <span class="status-badge idle">{isLocalProvider($voiceConversationAiProvider) ? 'No URL' : 'No key'}</span>
                {/if}
              </div>

              <div class="model-selector-wrap" bind:this={voiceConversationProviderDropdownEl}>
                <button
                  type="button"
                  class="model-trigger"
                  onclick={() => (voiceConversationProviderDropdownOpen = !voiceConversationProviderDropdownOpen)}
                  aria-haspopup="listbox"
                  aria-expanded={voiceConversationProviderDropdownOpen}
                >
                  <div class="model-trigger-left">
                    <span class="model-trigger-badge" data-provider={modelBadge($voiceConversationAiProvider, '')}>
                      {modelBadge($voiceConversationAiProvider, '')}
                    </span>
                    <div class="model-trigger-meta">
                      <div class="model-trigger-name">
                        {getProviderDef($voiceConversationAiProvider).label}
                      </div>
                    </div>
                  </div>
                  <div class="model-trigger-right">
                    {#if getProviderTtsBadge($voiceConversationAiProvider)}
                      <span class="provider-capability-pill" data-kind={getProviderDef($voiceConversationAiProvider).ttsSupport ?? 'none'}>
                        {getProviderTtsBadge($voiceConversationAiProvider)}
                      </span>
                    {/if}
                    <svg class="model-chevron" class:open={voiceConversationProviderDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {#if voiceConversationProviderDropdownOpen}
                  <div class="model-dropdown" role="listbox">
                    <div class="model-list">
                      {#each aiProviders as provider}
                        <button
                          type="button"
                          class="model-option"
                          class:selected={$voiceConversationAiProvider === provider.id}
                          role="option"
                          aria-selected={$voiceConversationAiProvider === provider.id}
                          onclick={() => { $voiceConversationAiProvider = provider.id; voiceConversationProviderDropdownOpen = false; }}
                        >
                          <div class="model-option-left">
                            <span class="model-option-badge" data-provider={modelBadge(provider.id, '')}>
                              {modelBadge(provider.id, '')}
                            </span>
                            <div class="model-option-body">
                              <div class="model-option-name">{provider.label}</div>
                            </div>
                          </div>
                          <div class="model-option-right">
                            {#if getProviderTtsBadge(provider.id)}
                              <span class="provider-capability-pill" data-kind={provider.ttsSupport ?? 'none'}>
                                {getProviderTtsBadge(provider.id)}
                              </span>
                            {/if}
                            {#if $voiceConversationAiProvider === provider.id}
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            {/if}
                          </div>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <div class="detail-row model-section">
              <div class="detail-row-header">
                <div class="detail-info">
                  <span class="detail-label">Model</span>
                  <span class="detail-desc">
                    Uses {activeVoiceConversationProvider.label}'s live catalog when a key or local server URL is configured in the main Models section.
                  </span>
                </div>
              </div>

              <div class="model-label-row">
                <div class="detail-info">
                  <span class="detail-label">Model Selection</span>
                  <span class="detail-desc">
                    {#if providerKeyStatus[$voiceConversationAiProvider] !== 'saved'}
                      {activeVoiceConversationProvider.local ? 'Set a server URL in the main Models section to load live conversation models.' : 'Add a key in the main Models section to load full conversation models.'}
                    {:else if voiceConversationProviderModelsStatus[$voiceConversationAiProvider] === 'loading'}
                      Loading live catalog…
                    {:else if voiceConversationProviderModelsStatus[$voiceConversationAiProvider] === 'error'}
                      Couldn't load live models. <button type="button" class="model-inline-link" title={voiceConversationProviderModelsError[$voiceConversationAiProvider] || 'Retry loading live conversation models'} onclick={() => loadVoiceConversationModels($voiceConversationAiProvider, true)}>Retry</button>
                    {:else if voiceConversationProviderModelsStatus[$voiceConversationAiProvider] === 'loaded'}
                      Using live provider catalog.
                    {:else}
                      Using curated conversation model fallbacks.
                    {/if}
                  </span>
                </div>

                <div class="model-meta-actions">
                  {#if voiceConversationProviderModelsStatus[$voiceConversationAiProvider] === 'loaded'}
                    <span class="model-status-pill live" title="Live catalog successfully fetched using the selected voice conversation provider">
                      <span class="pulse-dot"></span> Live
                    </span>
                  {:else if providerKeyStatus[$voiceConversationAiProvider] === 'saved' && voiceConversationProviderModelsStatus[$voiceConversationAiProvider] === 'loading'}
                    <span class="model-status-pill loading">Checking…</span>
                  {:else if voiceConversationProviderModelsStatus[$voiceConversationAiProvider] === 'error'}
                    <span class="model-status-pill error" title={voiceConversationProviderModelsError[$voiceConversationAiProvider] || 'Failed to load live voice conversation models'}>
                      Error
                    </span>
                  {:else}
                    <span class="model-status-pill curated" title="Using local curated voice conversation defaults">Curated</span>
                  {/if}

                  {#if providerKeyStatus[$voiceConversationAiProvider] === 'saved'}
                    <button
                      type="button"
                      class="model-refresh-btn"
                      title="Reload models from {activeVoiceConversationProvider.label}"
                      aria-label="Reload voice conversation models"
                      onclick={() => loadVoiceConversationModels($voiceConversationAiProvider, true)}
                    >
                      <svg class:spin={voiceConversationProviderModelsStatus[$voiceConversationAiProvider] === 'loading'} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"/>
                        <polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                      </svg>
                    </button>
                  {/if}
                </div>
              </div>

              <div class="model-selector-wrap" bind:this={voiceConversationModelDropdownEl}>
                <button
                  type="button"
                  class="model-trigger"
                  onclick={() => (voiceConversationModelDropdownOpen = !voiceConversationModelDropdownOpen)}
                  aria-haspopup="listbox"
                  aria-expanded={voiceConversationModelDropdownOpen}
                >
                  <div class="model-trigger-left">
                    <span class="model-trigger-badge" data-provider={modelBadge($voiceConversationAiProvider, $currentVoiceConversationAiModel)}>
                      {modelBadge($voiceConversationAiProvider, $currentVoiceConversationAiModel)}
                    </span>
                    <div class="model-trigger-meta">
                      <div class="model-trigger-name">
                        {selectedVoiceConversationModel?.label ?? $currentVoiceConversationAiModel}
                      </div>
                      <div class="model-trigger-desc">
                        {selectedVoiceConversationModel?.description || $currentVoiceConversationAiModel}
                      </div>
                    </div>
                  </div>
                  <div class="model-trigger-right">
                    {#if selectedVoiceConversationModel?.free || $currentVoiceConversationAiModel.includes(':free')}
                      <span class="model-free-badge">Free</span>
                    {/if}
                    <svg class="model-chevron" class:open={voiceConversationModelDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {#if voiceConversationModelDropdownOpen}
                  <div class="model-dropdown" role="listbox">
                    <div class="model-search-bar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        class="model-search-input"
                        type="text"
                        placeholder="Search {activeVoiceConversationProvider.label} models…"
                        bind:value={voiceConversationModelSearch}
                        spellcheck="false"
                        autocomplete="off"
                      />
                      {#if voiceConversationModelSearch}
                        <button type="button" class="model-search-clear" onclick={() => (voiceConversationModelSearch = '')} aria-label="Clear search">×</button>
                      {/if}
                    </div>
                    <div class="model-list">
                      {#if voiceConversationProviderModelsStatus[$voiceConversationAiProvider] === 'loading' && voiceConversationActiveModels.length === 0}
                        <div class="model-empty">Loading {activeVoiceConversationProvider.label} models…</div>
                      {:else if voiceConversationProviderModelsStatus[$voiceConversationAiProvider] === 'error' && voiceConversationActiveModels.length === 0}
                        <div class="model-empty">
                          Couldn't load live models. <button type="button" class="model-inline-link" onclick={() => loadVoiceConversationModels($voiceConversationAiProvider, true)}>Retry</button>
                        </div>
                      {:else if filteredVoiceConversationModels.length === 0}
                        <div class="model-empty">No models match “{voiceConversationModelSearch}”.</div>
                      {:else}
                        {#each filteredVoiceConversationModels as model (model.id)}
                          <button
                            type="button"
                            class="model-option"
                            class:selected={$currentVoiceConversationAiModel === model.id}
                            role="option"
                            aria-selected={$currentVoiceConversationAiModel === model.id}
                            onclick={() => { setVoiceConversationAiModel($voiceConversationAiProvider, model.id); voiceConversationModelDropdownOpen = false; }}
                          >
                            <div class="model-option-left">
                              <span class="model-option-badge" data-provider={modelBadge($voiceConversationAiProvider, model.id)}>
                                {modelBadge($voiceConversationAiProvider, model.id)}
                              </span>
                              <div class="model-option-body">
                                <div class="model-option-name">{model.label}</div>
                                <div class="model-option-desc">{model.description || model.id}</div>
                              </div>
                            </div>
                            <div class="model-option-right">
                              {#if model.free || model.id.endsWith(':free')}
                                <span class="model-free-badge">Free</span>
                              {/if}
                              {#if $currentVoiceConversationAiModel === model.id}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              {/if}
                            </div>
                          </button>
                        {/each}
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            </div>
            <div class="detail-row model-section">
              <div class="detail-row-header">
                <div class="detail-info">
                  <span class="detail-label">Reply output</span>
                  <span class="detail-desc">
                    Spoken replies use the same provider selected above whenever it offers speech output. This is where you choose the speech model and reply voice for agent voice mode.
                  </span>
                </div>
                {#if voiceConversationReplyAudioSupported}
                  <span class="provider-capability-pill" data-kind={activeVoiceConversationProvider.ttsSupport ?? 'none'}>
                    {getProviderTtsBadge($voiceConversationAiProvider) ?? 'TTS'}
                  </span>
                {:else}
                  <span class="status-badge idle">No TTS</span>
                {/if}
              </div>

              {#if !voiceConversationReplyAudioSupported}
                <div class="model-label-row">
                  <div class="detail-info">
                    <span class="detail-label">Availability</span>
                    <span class="detail-desc">
                      {activeVoiceConversationProvider.label} can still run the voice conversation brain, but Soryq cannot synthesize spoken replies through it yet. Choose OpenRouter, Groq, OpenAI, Google, Ollama, or LM Studio here if you want the assistant to talk back.
                    </span>
                  </div>
                </div>
              {:else}
                <div class="model-label-row">
                  <div class="detail-info">
                    <span class="detail-label">Speech model</span>
                    <span class="detail-desc">
                      {#if activeVoiceConversationProvider.local}
                        Enter the model id exposed by your local OpenAI-compatible `/audio/speech` endpoint.
                      {:else}
                        Override the speech model used when {activeVoiceConversationProvider.label} reads replies aloud.
                      {/if}
                    </span>
                  </div>
                </div>

                {#if !activeVoiceConversationProvider.local && voiceConversationTtsModelOptions.length}
                  <div class="model-selector-wrap tts-selector-wrap" bind:this={voiceConversationTtsModelDropdownEl}>
                    <button
                      type="button"
                      class="model-trigger tts-trigger"
                      onclick={() => (voiceConversationTtsModelDropdownOpen = !voiceConversationTtsModelDropdownOpen)}
                      aria-haspopup="listbox"
                      aria-expanded={voiceConversationTtsModelDropdownOpen}
                      disabled={providerKeyStatus[$voiceConversationAiProvider] !== 'saved'}
                    >
                      <div class="model-trigger-left">
                        <span class="tts-model-icon" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 10v4" />
                            <path d="M7 7v10" />
                            <path d="M11 4v16" />
                            <path d="M15 8v8" />
                            <path d="M19 11v2" />
                          </svg>
                        </span>
                        <span class="model-trigger-badge" data-provider={modelBadge($voiceConversationAiProvider, $currentVoiceConversationTtsModel)}>
                          {modelBadge($voiceConversationAiProvider, $currentVoiceConversationTtsModel)}
                        </span>
                        <div class="model-trigger-meta">
                          <div class="model-trigger-name">
                            {selectedVoiceConversationTtsModel?.label ?? $currentVoiceConversationTtsModel}
                          </div>
                          <div class="model-trigger-desc">
                            {selectedVoiceConversationTtsModel?.description || 'Speech synthesis model'}
                          </div>
                        </div>
                      </div>
                      <div class="model-trigger-right">
                        {#if selectedVoiceConversationTtsModel?.voices?.length}
                          <span class="tts-voice-count-pill">{selectedVoiceConversationTtsModel.voices.length} voices</span>
                        {/if}
                        <svg class="model-chevron" class:open={voiceConversationTtsModelDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </div>
                    </button>

                    {#if voiceConversationTtsModelDropdownOpen}
                      <div class="model-dropdown tts-dropdown" role="listbox" aria-label="Speech model">
                        <div class="model-list">
                          {#each getTtsModelOptions($voiceConversationAiProvider) as model (model.id)}
                            <button
                              type="button"
                              class="model-option tts-model-option"
                              class:selected={$currentVoiceConversationTtsModel === model.id}
                              role="option"
                              aria-selected={$currentVoiceConversationTtsModel === model.id}
                              onclick={() => chooseVoiceConversationTtsModel(model.id)}
                            >
                              <div class="model-option-left">
                                <span class="model-option-badge" data-provider={modelBadge($voiceConversationAiProvider, model.id)}>
                                  {modelBadge($voiceConversationAiProvider, model.id)}
                                </span>
                                <div class="model-option-body">
                                  <div class="model-option-name">{model.label}</div>
                                  <div class="model-option-desc">{model.description}</div>
                                </div>
                              </div>
                              <div class="model-option-right">
                                {#if model.voices?.length}
                                  <span class="tts-voice-count-pill compact">{model.voices.length}</span>
                                {/if}
                                {#if $currentVoiceConversationTtsModel === model.id}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                {/if}
                              </div>
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <div class="api-key-input-wrapper">
                    <div class="input-inner-container">
                      <span class="input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4Z" />
                          <path d="M9 11h6" />
                          <path d="M12 8v6" />
                        </svg>
                      </span>
                      <input
                        class="text-input key-input"
                        type="text"
                        value={$currentVoiceConversationTtsModel}
                        placeholder={activeVoiceConversationProvider.local ? 'local-tts-model' : 'Use the provider default speech model'}
                        spellcheck="false"
                        autocomplete="off"
                        oninput={(e) => setVoiceConversationTtsModel($voiceConversationAiProvider, (e.currentTarget as HTMLInputElement).value)}
                      />
                    </div>
                  </div>
                {/if}

                <div class="model-label-row">
                  <div class="detail-info">
                    <span class="detail-label">Reply voice</span>
                    <span class="detail-desc">
                      {#if voiceConversationTtsVoiceOptions.length}
                        Pick the built-in voice for spoken replies. The list follows the selected speech model, so OpenRouter voices change when you switch providers under the OpenRouter umbrella.
                      {:else}
                        {activeVoiceConversationProvider.local
                          ? 'Enter the voice name your local TTS server expects.'
                          : 'Enter the provider voice id you want to use for spoken replies.'}
                      {/if}
                    </span>
                  </div>
                </div>

                {#if voiceConversationTtsVoiceOptions.length}
                  <div class="model-selector-wrap tts-selector-wrap" bind:this={voiceConversationTtsVoiceDropdownEl}>
                    <button
                      type="button"
                      class="model-trigger tts-trigger"
                      onclick={() => (voiceConversationTtsVoiceDropdownOpen = !voiceConversationTtsVoiceDropdownOpen)}
                      aria-haspopup="listbox"
                      aria-expanded={voiceConversationTtsVoiceDropdownOpen}
                    >
                      <div class="model-trigger-left">
                        <span class="tts-model-icon" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 18a6 6 0 0 0 6-6V6a6 6 0 0 0-12 0v6a6 6 0 0 0 6 6Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <path d="M12 19v3" />
                          </svg>
                        </span>
                        <span class="model-trigger-badge" data-provider={modelBadge($voiceConversationAiProvider, '')}>
                          {modelBadge($voiceConversationAiProvider, '')}
                        </span>
                        <div class="model-trigger-meta">
                          <div class="model-trigger-name">
                            {selectedVoiceConversationTtsVoice?.label ?? $currentVoiceConversationTtsVoice}
                          </div>
                          <div class="model-trigger-desc">
                            {selectedVoiceConversationTtsVoice?.description || 'Provider voice'}
                          </div>
                        </div>
                      </div>
                      <div class="model-trigger-right">
                        <svg class="model-chevron" class:open={voiceConversationTtsVoiceDropdownOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </div>
                    </button>

                    {#if voiceConversationTtsVoiceDropdownOpen}
                      <div class="model-dropdown tts-dropdown" role="listbox">
                        <div class="model-list">
                          {#each voiceConversationTtsVoiceOptions as voice (voice.id)}
                            <div class="model-option-row" class:selected={$currentVoiceConversationTtsVoice === voice.id}>
                              <button
                                type="button"
                                class="model-option model-option-select"
                                role="option"
                                aria-selected={$currentVoiceConversationTtsVoice === voice.id}
                                onclick={() => {
                                  setVoiceConversationTtsVoice($voiceConversationAiProvider, voice.id);
                                  voiceConversationTtsVoiceDropdownOpen = false;
                                }}
                              >
                                <div class="model-option-left">
                                  <span class="model-option-badge" data-provider={modelBadge($voiceConversationAiProvider, '')}>
                                    {modelBadge($voiceConversationAiProvider, '')}
                                  </span>
                                  <div class="model-option-body">
                                    <div class="model-option-name">{voice.label}</div>
                                    <div class="model-option-desc">{voice.description}</div>
                                  </div>
                                </div>
                                <div class="model-option-right">
                                  {#if $currentVoiceConversationTtsVoice === voice.id}
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="checkmark-icon">
                                      <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                  {/if}
                                </div>
                              </button>

                              <button
                                type="button"
                                class="model-option-preview"
                                class:playing={previewingVoiceId === voice.id && previewingVoiceProvider === $voiceConversationAiProvider}
                                aria-label={previewingVoiceId === voice.id && previewingVoiceProvider === $voiceConversationAiProvider ? `Stop preview for ${voice.label}` : `Play preview for ${voice.label}`}
                                title={previewingVoiceId === voice.id && previewingVoiceProvider === $voiceConversationAiProvider ? `Stop preview for ${voice.label}` : `Play preview for ${voice.label}`}
                                onclick={(e) => {
                                  e.stopPropagation();
                                  void previewVoiceOption(voice.id);
                                }}
                              >
                                {#if previewingVoiceId === voice.id && previewingVoiceProvider === $voiceConversationAiProvider}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                                  </svg>
                                {:else}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <polygon points="8,6 19,12 8,18" />
                                  </svg>
                                {/if}
                              </button>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <div class="api-key-input-wrapper">
                    <div class="input-inner-container">
                      <span class="input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 18a6 6 0 0 0 6-6V6a6 6 0 0 0-12 0v6a6 6 0 0 0 6 6Z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <path d="M12 19v3" />
                        </svg>
                      </span>
                      <input
                        class="text-input key-input"
                        type="text"
                        value={$currentVoiceConversationTtsVoice}
                        placeholder="default"
                        spellcheck="false"
                        autocomplete="off"
                        oninput={(e) => setVoiceConversationTtsVoice($voiceConversationAiProvider, (e.currentTarget as HTMLInputElement).value)}
                      />
                    </div>
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        </div>

        {:else if activeTab === 'terminal'}
        <div class="section-heading">
          <h2>Terminal</h2>
          <p>Shell selection and terminal appearance.</p>
        </div>

        <!-- Shell picker -->
        <div class="setting-group">
          <div class="group-label">Default shell</div>
          <div class="shell-cards">
            {#if availableShells.length === 0}
              <div class="shell-loading">Detecting shells…</div>
            {:else}
              {#each availableShells as sh}
                {@const basename = sh.program.split(/[\/\\]/).pop() ?? sh.program}
                <button
                  class="shell-card"
                  class:selected={$terminalShell === sh.program || ($terminalShell === '' && sh === availableShells[0])}
                  onclick={() => $terminalShell = sh.program}
                >
                  <span class="shell-icon">
                    {#if basename.toLowerCase().includes('pwsh') || basename.toLowerCase().includes('powershell')}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="3"/><polyline points="8,9 4,12 8,15"/><line x1="12" y1="15" x2="20" y2="15"/></svg>
                    {:else if basename.toLowerCase().includes('cmd')}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="3"/><path d="M6 9l4 3-4 3"/><line x1="14" y1="15" x2="18" y2="15"/></svg>
                    {:else if basename.toLowerCase().includes('bash') || basename.toLowerCase().includes('zsh') || basename.toLowerCase().includes('sh')}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="3"/><path d="M8 8l4 4-4 4"/><line x1="14" y1="16" x2="18" y2="16"/></svg>
                    {:else}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="3"/><circle cx="12" cy="12" r="3"/></svg>
                    {/if}
                  </span>
                  <div class="shell-info">
                    <span class="shell-name">{basename}</span>
                    <span class="shell-path">{sh.program}</span>
                  </div>
                  {#if $terminalShell === sh.program || ($terminalShell === '' && sh === availableShells[0])}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 7l3.5 3.5 6.5-7" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  {/if}
                </button>
              {/each}
            {/if}
          </div>
          <p class="shell-hint">Changes apply to new sessions. Active terminal sessions will automatically restart using the new shell.</p>
        </div>

        <!-- Custom CLI agents -->
        <div class="setting-group">
          <div class="group-label">Coding CLI agents</div>
          <p class="shell-hint" style="margin-top:-2px;margin-bottom:12px;">
            Add your own agent CLI alongside the built-ins (Claude Code, Codex…). It appears in the
            spawn picker, panes running it show its name, and typing its command in any shell is
            recognized as that agent. Agents that read a <code>CLAUDE.md</code> / <code>AGENTS.md</code>
            rules file are briefed automatically.
          </p>

          {#if $customAgents.length > 0}
            <div class="agent-list">
              {#each $customAgents as agent (agent.id)}
                <div class="agent-row">
                  <div class="agent-meta">
                    <span class="agent-name">{agent.name}</span>
                    <code class="agent-cmd">{agent.command}</code>
                  </div>
                  <label class="agent-rules-toggle" title="Reads a CLAUDE.md / AGENTS.md rules file at startup">
                    <input
                      type="checkbox"
                      checked={agent.readsRulesFile}
                      onchange={(e) => updateCustomAgent(agent.id, { readsRulesFile: e.currentTarget.checked })}
                    />
                    <span>Rules file</span>
                  </label>
                  <button
                    class="agent-remove"
                    onclick={() => handleRemoveCustomAgent(agent.id, agent.name)}
                    aria-label={`Remove ${agent.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2m-1 0v14H9V6"/></svg>
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          <div class="agent-add">
            <input
              class="agent-input"
              type="text"
              placeholder="Name (e.g. Aider)"
              bind:value={newAgentName}
              maxlength="40"
            />
            <input
              class="agent-input agent-input-cmd"
              type="text"
              placeholder="Launch command (e.g. aider --no-auto-commits)"
              bind:value={newAgentCommand}
              maxlength="200"
              onkeydown={(e) => { if (e.key === 'Enter') handleAddCustomAgent(); }}
            />
            <button class="agent-add-btn" onclick={handleAddCustomAgent}>Add agent</button>
          </div>
          <label class="agent-rules-row">
            <input type="checkbox" bind:checked={newAgentReadsRules} />
            <span>This CLI reads a <code>CLAUDE.md</code> / <code>AGENTS.md</code> rules file at startup</span>
          </label>
          {#if agentFormError}
            <p class="agent-error">{agentFormError}</p>
          {/if}
        </div>

        <!-- Terminal font size -->
        <div class="setting-group">
          <div class="group-label">Appearance</div>
          <div class="slider-row">
            <div class="toggle-info">
              <span class="toggle-label">Font size</span>
              <span class="toggle-desc">Terminal font size in pixels.</span>
            </div>
            <div class="number-control">
              <button class="num-btn" onclick={() => $terminalFontSize = Math.max(10, $terminalFontSize - 1)}>−</button>
              <span class="num-val">{$terminalFontSize}</span>
              <button class="num-btn" onclick={() => $terminalFontSize = Math.min(22, $terminalFontSize + 1)}>+</button>
            </div>
          </div>

          <div class="toggle-row">
            <div class="toggle-info">
                <span class="toggle-label">Canvas renderer</span>
                <span class="toggle-desc">Use the faster canvas renderer. Leave this off if the terminal blanks or glitches while resizing.</span>
            </div>
            <button
              class="toggle"
              class:on={$terminalRenderer === 'canvas'}
              onclick={() => $terminalRenderer = $terminalRenderer === 'canvas' ? 'dom' : 'canvas'}
                aria-label="Toggle canvas renderer"
              role="switch"
              aria-checked={$terminalRenderer === 'canvas'}
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>
        </div>

      {:else if activeTab === 'shortcuts'}
        <div class="section-heading">
          <div class="heading-row">
            <div>
              <h2>Shortcuts</h2>
              <p>Customize global shortcuts and review the contextual keys used in focused views.</p>
            </div>
            <button class="reset-all-btn" onclick={handleResetAll} title="Reset all shortcuts to defaults">
              Reset All
            </button>
          </div>
        </div>

        <div class="shortcut-container">
          <div class="shortcut-list">
            {#each $userShortcuts || [] as s (s.id)}
              {@const conflictLabel = getConflictLabel(s.id, s.keys)}
              {@const defaultShortcut = getDefaultShortcut(s.id)}
              <div class="shortcut-row" class:recording={recordingId === s.id}>
                <div class="shortcut-info">
                  <span class="sc-category-badge">{getActionCategory(s.id)}</span>
                  <div class="sc-label-group">
                    <span class="sc-label">{s.label}</span>
                    {#if conflictLabel}
                      <span class="sc-conflict">Conflicts with {conflictLabel}</span>
                    {/if}
                  </div>
                </div>
                
                <div class="shortcut-actions-row">
                  {#if recordingId === s.id}
                    <button 
                      class="sc-key-recorder recording-active" 
                      onclick={stopRecording}
                      title="Click to cancel recording"
                    >
                      <span class="record-indicator"></span>
                      <span>{recordedKeys}</span>
                      <span class="esc-hint">(Esc to cancel)</span>
                    </button>
                  {:else}
                    <button 
                      class="sc-key-recorder" 
                      onclick={() => startRecording(s.id)}
                      title="Click to edit shortcut"
                    >
                      {s.keys || 'Unbound'}
                    </button>
                  {/if}

                  <button
                    class="shortcut-reset-btn"
                    onclick={() => resetShortcut(s.id)}
                    title={defaultShortcut ? `Reset to ${defaultShortcut.keys}` : 'Remove custom shortcut'}
                    aria-label="Reset shortcut for {s.label}"
                  >
                    Reset
                  </button>

                  <button 
                    class="shortcut-delete-btn" 
                    onclick={() => deleteShortcut(s.id)}
                    title="Delete shortcut"
                    aria-label="Delete shortcut for {s.label}"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>

          <!-- Add Shortcut Section -->
          <div class="add-shortcut-section">
            {#if !addingShortcut}
              <button class="add-btn-trigger" onclick={() => { addingShortcut = true; newShortcutKeys = ''; newShortcutActionId = ''; }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Add Keyboard Shortcut</span>
              </button>
            {:else}
              <div class="add-shortcut-panel">
                <div class="panel-title">Add Keyboard Shortcut</div>
                <div class="panel-form">
                  <div class="form-field">
                    <label for="shortcut-action-select">Command Action</label>
                    {#if availableActions.length === 0}
                      <div class="no-actions-msg">All actions are already bound.</div>
                    {:else}
                      <div class="select-wrapper" style="position: relative; z-index: 100;">
                        <Dropdown
                          options={actionOptions}
                          bind:value={newShortcutActionId}
                          placeholder="Select an action..."
                          ariaLabel="Select command action"
                        />
                      </div>
                    {/if}
                  </div>

                  <div class="form-field">
                    <span class="form-label">Keys Combination</span>
                    <div class="recorder-wrapper">
                      {#if newShortcutRecording}
                        <button 
                          class="sc-key-recorder recording-active" 
                          onclick={stopNewRecording}
                          title="Click to cancel recording"
                        >
                          <span class="record-indicator"></span>
                          <span>{newShortcutKeys}</span>
                          <span class="esc-hint">(Esc to cancel)</span>
                        </button>
                      {:else}
                        <button 
                          class="sc-key-recorder" 
                          class:empty={!newShortcutKeys}
                          onclick={startNewRecording}
                          title="Click to record keys"
                        >
                          {newShortcutKeys || 'Click to Record...'}
                        </button>
                      {/if}
                    </div>
                  </div>

                  <div class="panel-actions">
                    <button class="panel-btn-cancel" onclick={() => addingShortcut = false}>Cancel</button>
                    <button class="panel-btn-save" onclick={handleAddShortcut} disabled={!newShortcutActionId || !newShortcutKeys || newShortcutRecording}>Save</button>
                  </div>
                </div>
              </div>
            {/if}
          </div>

          <div class="context-shortcut-section">
            <div class="context-shortcut-header">
              <h3>Contextual Shortcuts</h3>
              <p>These keys work only in the specific surface shown here.</p>
            </div>

            <div class="context-shortcut-list">
              {#each contextualShortcuts as shortcut}
                <div class="context-shortcut-row">
                  <div class="context-shortcut-info">
                    <span class="context-shortcut-label">{shortcut.label}</span>
                    <span class="context-shortcut-context">{shortcut.context}</span>
                  </div>
                  <kbd class="context-shortcut-keys">{shortcut.keys}</kbd>
                </div>
              {/each}
            </div>
          </div>
        </div>

      {:else if activeTab === 'themes'}
        <div class="section-heading">
          <h2>Themes</h2>
          <p>Choose a color theme and set a background image for the interface.</p>
        </div>

        {#if showingCustomThemeEditor}
          <div class="custom-theme-editor">
            <div class="group-label">Custom Theme</div>
            <div class="ct-field">
              <span class="ct-label">Theme Name</span>
              <input class="text-input" type="text" bind:value={customThemeName} placeholder="My Custom Theme" />
            </div>
            <div class="ct-field">
              <span class="ct-label">Theme ID</span>
              <input class="text-input" type="text" bind:value={customThemeId} placeholder="my-custom-theme (auto)" />
            </div>
            <div class="ct-section-label">Interface Colors</div>
            <div class="ct-grid">
              {#each themeColorFields.filter(f => f.category === 'colors') as field}
                <div class="ct-color-field">
                  <span class="ct-color-label">{field.label}</span>
                  <input class="color-input" type="color" bind:value={customThemeColors[field.key]} />
                </div>
              {/each}
            </div>
            <div class="ct-section-label">Syntax Colors</div>
            <div class="ct-grid">
              {#each themeColorFields.filter(f => f.category === 'syntax') as field}
                <div class="ct-color-field">
                  <span class="ct-color-label">{field.label}</span>
                  <input class="color-input" type="color" bind:value={customThemeSyntax[field.key]} />
                </div>
              {/each}
            </div>
            <div class="ct-actions">
              <button class="ct-btn" onclick={() => showingCustomThemeEditor = false}>Cancel</button>
              <button class="ct-btn primary" onclick={handleSaveCustomTheme}>Save Theme</button>
            </div>
          </div>
        {:else}
          <!-- Preset themes grid -->
          <div class="theme-grid">
            {#each presetThemes as theme}
              <button
                class="theme-card"
                class:active={$activeTheme?.id === theme.id}
                onclick={() => switchPresetTheme(theme.id)}
              >
                <div class="theme-preview">
                  {#each ['#ff7b72', '#a5d6ff', '#d2a8ff', '#7ee787', '#79c0ff'] as color, i}
                    <span class="preview-bar" style="background: {theme.syntax[['keyword', 'string', 'function', 'type', 'constant'][i]] || color}"></span>
                  {/each}
                </div>
                <div class="theme-meta">
                  <span class="theme-name">{theme.name}</span>
                  {#if $activeTheme?.id === theme.id}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}

        <!-- Backend themes -->
        {#if showingCustomThemeEditor}
          <!-- hidden during editor -->
        {:else}
          <div class="theme-actions">
            <button class="theme-action-btn" onclick={handleImportTheme}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Import Theme
            </button>
            <button class="theme-action-btn" onclick={openCustomThemeEditor}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Create Custom Theme
            </button>
          </div>

          <!-- Interface transparency (always available) -->
          <div class="setting-group bg-image-group">
            <div class="group-label">Interface</div>
            <div class="slider-row">
              <div class="toggle-info">
                <span class="toggle-label">Transparency</span>
                <span class="toggle-desc">Make every surface more see-through (revealing the desktop or your background image) or more solid. Drag left for solid, right for glassy.</span>
              </div>
              <div class="slider-control">
                <input
                  class="bg-slider"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  bind:value={$interfaceTransparency}
                  aria-label="Interface transparency"
                />
                <span class="slider-value">{$interfaceTransparency}%</span>
              </div>
            </div>
          </div>

          <!-- Background media -->
          <div class="setting-group bg-image-group">
            <div class="group-label">Background Media</div>
            <div class="toggle-row">
              <div class="toggle-info">
                <span class="toggle-label">Custom background</span>
                <span class="toggle-desc">Show an image or live wallpaper behind the interface. Use the Transparency slider above to balance it against legibility.</span>
              </div>
              <div class="bg-actions">
                <button class="bg-btn" onclick={chooseBackgroundImage}>
                  {$backgroundImagePresent ? 'Change…' : 'Choose…'}
                </button>
                {#if $backgroundImagePresent}
                  <button class="bg-btn bg-btn-danger" onclick={removeBackgroundImage}>Remove</button>
                {/if}
              </div>
            </div>

            {#if $backgroundImagePresent}
              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Show background</span>
                  <span class="toggle-desc">Toggle the background on or off without removing it.</span>
                </div>
                <button
                  class="toggle"
                  class:on={$backgroundImageEnabled}
                  onclick={() => $backgroundImageEnabled = !$backgroundImageEnabled}
                  aria-label="Toggle background image"
                  role="switch"
                  aria-checked={$backgroundImageEnabled}
                >
                  <span class="toggle-thumb"></span>
                </button>
              </div>

              {#if $backgroundImageEnabled}
                <div class="slider-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Background opacity</span>
                    <span class="toggle-desc">Dim the background against the desktop. Lower it so the UI stays readable.</span>
                  </div>
                  <div class="slider-control">
                    <input
                      class="bg-slider"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      bind:value={$backgroundImageOpacity}
                      aria-label="Background image opacity"
                    />
                    <span class="slider-value">{$backgroundImageOpacity}%</span>
                  </div>
                </div>

                <div class="slider-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Background blur</span>
                    <span class="toggle-desc">Soften the background so text and panels read more clearly over it.</span>
                  </div>
                  <div class="slider-control">
                    <input
                      class="bg-slider"
                      type="range"
                      min="0"
                      max="60"
                      step="1"
                      bind:value={$backgroundImageBlur}
                      aria-label="Background image blur"
                    />
                    <span class="slider-value">{$backgroundImageBlur}px</span>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        {/if}

      {:else if activeTab === 'about'}
        <div class="section-heading">
          <h2>About</h2>
          <p>Version and build information.</p>
        </div>

        <div class="about-card">
          <div class="about-logo">
            {#if !iconError}
              <img
                src="/icon.png?v=4"
                alt="Soryq"
                class="about-app-icon"
                onerror={() => iconError = true}
              />
            {:else}
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
                <circle cx="9" cy="12" r="6" stroke-opacity="0.9" />
                <circle cx="15" cy="12" r="6" stroke-opacity="0.6" />
              </svg>
            {/if}
          </div>
          <h3 class="about-name">Soryq</h3>
          <p class="about-tagline">Terminal-first developer workspace</p>
        </div>

        <div class="about-rows">
          {#each [
            ['Version', appVersion],
            ['Built with', 'Tauri 2 · Svelte 5 · Rust'],
            ['Runtime', 'WebView2 (Windows)'],
            ['License', 'Proprietary'],
          ] as [label, value]}
            <div class="about-row">
              <span class="about-label">{label}</span>
              <span class="about-value">{value}</span>
            </div>
          {/each}
        </div>

        <div class="security-summary">
          <div class="security-summary-row">
            <span class="security-summary-label">Active project</span>
            <span>Terminal, Git, review, database, preview, and container actions use the project currently open in Soryq.</span>
          </div>
          <div class="security-summary-row">
            <span class="security-summary-label">Secrets</span>
            <span>AI provider keys and GitHub tokens are kept in the OS keychain. Saved values are not displayed back in the app.</span>
          </div>
          <div class="security-summary-row">
            <span class="security-summary-label">Network</span>
            <span>AI providers, GitHub, update checks, HTTP requests, and external previews can contact outside services.</span>
          </div>
        </div>

        <div class="tour-section" style="margin: 20px 0 10px; display: flex; flex-direction: column; gap: 8px;">
          <button
            class="tour-btn"
            onclick={openChangelog}
            title="See what's new in Soryq"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="8" y1="13" x2="16" y2="13"/>
              <line x1="8" y1="17" x2="14" y2="17"/>
            </svg>
            View Changelog
          </button>
          <button
            class="tour-btn"
            onclick={() => { onboardingCompleted.set(false); onclose(); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            Restart Welcome Tour
          </button>
        </div>

        <div class="reset-section">
          <button
            class="reset-btn"
            class:confirming={resetConfirming}
            onclick={handleResetApp}
            onblur={() => resetConfirming = false}
          >
            {resetConfirming ? 'Click again to confirm — this cannot be undone' : 'Reset App Data'}
          </button>
        </div>

        <div class="updater-section">
          {#if updateStatus === 'idle'}
            <button class="updater-btn" onclick={handleCheckForUpdates}>
              Check for Updates
            </button>
          {:else if updateStatus === 'checking'}
            <div class="updater-status checking">
              <svg class="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                <polyline points="21 3 21 8 16 8"/>
              </svg>
              <span>Checking for updates...</span>
            </div>
          {:else if updateStatus === 'latest'}
            <div class="updater-status success">
              <div class="status-left">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <div class="updater-text">
                  <span class="status-title">Up to date</span>
                  <span class="status-desc">Soryq v{appVersion} is the latest version.</span>
                </div>
              </div>
              <button class="updater-btn-subtle" onclick={handleCheckForUpdates}>
                Check again
              </button>
            </div>
          {:else if updateStatus === 'available'}
            <div class="updater-status success">
              <div class="status-left">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <div class="updater-text">
                  <span class="status-title">Update available</span>
                  <span class="status-desc">{updateMessage}</span>
                </div>
              </div>
            </div>
          {:else if updateStatus === 'error'}
            <div class="updater-status error">
              <div class="status-left">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div class="updater-text">
                  <span class="status-title">Check Failed</span>
                  <span class="status-desc">Could not connect to the update server.</span>
                </div>
              </div>
              <button class="updater-btn-subtle" onclick={handleCheckForUpdates}>
                Retry
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* ── Backdrop ─────────────────────────── */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: backdropIn 0.18s ease;
  }

  @keyframes backdropIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* ── Modal card ───────────────────────── */
  .modal {
    width: 600px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    background: rgba(var(--editor-bg-rgb, 24, 24, 30), var(--frost-chrome, 0.62));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border: 1px solid var(--border);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--glass-shadow, 0 24px 64px rgba(0,0,0,0.35)), inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
    animation: modalIn 0.2s cubic-bezier(0.34,1.56,0.64,1);
  }

  :global(:root:not(.solid-theme)) .modal {
    --bg-primary: rgba(var(--bg-primary-rgb, 24, 24, 30), var(--frost-base, 0.45));
  }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.94) translateY(12px); }
    to   { opacity: 1; transform: scale(1)    translateY(0); }
  }

  /* ── Header + tabs ────────────────────── */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 16px 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: transparent;
  }

  .modal-tabs {
    display: flex;
    justify-content: space-between;
    flex-grow: 1;
    margin-right: 24px;
  }

  .modal-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 0;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    border-radius: 0;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
    position: relative;
    bottom: -1px;
    background: transparent;
    border-top: none;
    border-left: none;
    border-right: none;
    cursor: pointer;
  }

  .modal-tab:hover { color: var(--text-secondary); }
  .modal-tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }

  .tab-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    opacity: 0.7;
  }

  .modal-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    color: var(--text-muted);
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .modal-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ── Body ─────────────────────────────── */
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  }

  /* ── Section heading ──────────────────── */
  .section-heading h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }
  .section-heading p {
    font-size: 12.5px;
    color: var(--text-muted);
  }

  /* ── Setting groups ───────────────────── */
  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .group-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.9px;
    color: var(--text-muted);
    margin-bottom: 10px;
    display: block;
  }

  /* ── Background image ─────────────────── */
  .bg-image-group {
    margin-top: 22px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }

  .bg-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .bg-btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1.5px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .bg-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }

  .bg-btn-danger:hover {
    border-color: var(--error);
    color: var(--error);
  }

  .slider-control {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .slider-value {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    min-width: 38px;
    text-align: right;
  }

  .bg-slider {
    flex-shrink: 0;
    width: 180px;
    height: 4px;
    appearance: none;
    -webkit-appearance: none;
    background: var(--bg-active, var(--bg-tertiary));
    border-radius: 999px;
    outline: none;
    cursor: pointer;
  }

  .bg-slider::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--bg-primary);
    transition: transform 0.12s;
  }

  .bg-slider::-webkit-slider-thumb:hover {
    transform: scale(1.15);
  }

  .bg-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--bg-primary);
  }

  /* ── Appearance cards ─────────────────── */
  .appearance-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .appearance-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 20px 12px;
    background: var(--bg-primary);
    border: 1.5px solid var(--border);
    border-radius: 12px;
    transition: border-color 0.15s, background 0.15s;
    cursor: pointer;
  }

  .appearance-card:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
  }

  .appearance-card.selected {
    border-color: var(--accent);
    background: var(--accent-light);
  }

  .option-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .option-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 14px;
    background: var(--bg-primary);
    border: 1.5px solid var(--border);
    border-radius: 10px;
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
    min-width: 0;
  }

  .option-card:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
    color: var(--text-primary);
  }

  .option-card.selected {
    border-color: var(--accent);
    background: var(--accent-light);
    color: var(--text-primary);
  }

  .option-title {
    font-size: 12px;
    font-weight: 700;
  }

  .option-desc {
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-muted);
  }

  .appearance-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    transition: color 0.15s, transform 0.2s;
  }

  .appearance-card:hover .appearance-icon {
    color: var(--text-primary);
    transform: translateY(-2px);
  }

  .appearance-card.selected .appearance-icon {
    color: var(--accent);
  }

  .appearance-label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-primary);
  }

  /* ── Dropdown ─────────────────────────── */
  .select-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .styled-select {
    width: 100%;
    appearance: none;
    -webkit-appearance: none;
    background: var(--bg-primary);
    border: 1.5px solid var(--border);
    color: var(--text-primary);
    padding: 11px 40px 11px 14px;
    border-radius: 10px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }

  .styled-select:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
  }

  .styled-select:focus {
    border-color: var(--accent);
  }

  .styled-select option {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .select-chevron {
    position: absolute;
    right: 12px;
    color: var(--text-muted);
    pointer-events: none;
  }

  /* ── AI feature toggle card ───────────── */
  .ai-feature-icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: rgba(var(--accent-rgb, 99, 102, 241), 0.1);
    color: var(--accent);
    flex-shrink: 0;
  }

  /* ── Provider grid and cards ──────────── */
  .provider-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(116px, 1fr));
    gap: 10px;
    margin-top: 6px;
    align-items: stretch;
  }

  .voice-input-provider-grid {
    grid-template-columns: repeat(3, minmax(0, 164px));
    justify-content: flex-start;
    gap: 8px;
  }

  @media (max-width: 900px) {
    .provider-grid {
      grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
    }

    .voice-input-provider-grid {
      grid-template-columns: repeat(3, minmax(0, 148px));
    }
  }

  @media (max-width: 580px) {
    .provider-grid {
      grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
    }

    .voice-input-provider-grid {
      grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
      justify-content: stretch;
    }

    .detail-row-header,
    .refinement-row,
    .refinement-copy {
      align-items: flex-start;
    }

    .detail-row-header,
    .refinement-row {
      flex-direction: column;
    }

    .provider-card-subtitle {
      min-height: 0;
    }
  }

  .provider-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 14px 10px;
    background: var(--bg-primary);
    border: 1.5px solid var(--border);
    border-radius: 12px;
    cursor: pointer;
    gap: 10px;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    outline: none;
    position: relative;
    box-shadow: var(--shadow-sm);
  }

  .voice-input-provider-card {
    min-height: 122px;
    padding: 9px 8px;
    gap: 6px;
  }

  .voice-input-provider-card .provider-card-top {
    gap: 5px;
  }

  .provider-card-top {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
  }

  .provider-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--text-muted);
    transition: color 0.2s ease, transform 0.2s ease;
  }

  .voice-input-provider-card .provider-card-icon {
    width: 20px;
    height: 20px;
  }

  .voice-input-provider-card .provider-card-icon svg {
    width: 16px;
    height: 16px;
  }

  .provider-card:hover .provider-card-icon {
    transform: scale(1.08);
  }

  .provider-card:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 1px rgba(var(--accent-rgb, 99, 102, 241), 0.2), 0 0 18px rgba(var(--accent-rgb, 99, 102, 241), 0.18);
  }

  .provider-card-name {
    font-size: clamp(10px, 2.2vw, 12px);
    font-weight: 600;
    color: var(--text-secondary);
    transition: color 0.2s ease;
    text-align: center;
    line-height: 1.15;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .provider-card-subtitle {
    font-size: clamp(9px, 1.9vw, 10.5px);
    line-height: 1.3;
    text-align: center;
    color: var(--text-muted);
    min-height: 2.4em;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .voice-input-provider-card .provider-card-name {
    font-size: clamp(9px, 1.6vw, 11px);
    word-break: break-word;
  }

  /* Subtitle and badge sizing overrides are in global.css
     (Svelte strips descendant selectors inside {#each} blocks) */

  .provider-card-status {
    font-size: 9px;
    font-weight: 500;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    transition: all 0.2s ease;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .provider-card-status.ready {
    color: #10B981;
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.15);
  }

  .provider-key-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
  }

  .provider-card-status.ready .provider-key-dot {
    background: #10B981;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
  }

  .provider-card-status.error {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.15);
  }

  .provider-card-status.error .error-dot {
    background: #ef4444;
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
  }

  .provider-key-dot.loading {
    background: #fb923c;
    box-shadow: 0 0 6px rgba(251, 146, 60, 0.5);
    animation: blinker 1s linear infinite;
  }

  /* Provider Card Brand Focus & Selected Styling */
  .provider-card[data-provider="openai"].selected,
  .provider-card[data-provider="openai"]:hover,
  .provider-card[data-provider="openai"]:focus-visible {
    border-color: #10a37f;
    box-shadow: 0 0 10px rgba(16, 163, 127, 0.12);
  }
  .provider-card[data-provider="openai"].selected {
    background: rgba(16, 163, 127, 0.06);
  }
  .provider-card[data-provider="openai"].selected .provider-card-icon {
    color: #10a37f;
  }
  .provider-card[data-provider="openai"].selected .provider-card-name {
    color: var(--text-primary);
  }

  .provider-card[data-provider="anthropic"].selected,
  .provider-card[data-provider="anthropic"]:hover,
  .provider-card[data-provider="anthropic"]:focus-visible {
    border-color: #d9775f;
    box-shadow: 0 0 10px rgba(217, 119, 95, 0.12);
  }
  .provider-card[data-provider="anthropic"].selected {
    background: rgba(217, 119, 95, 0.06);
  }
  .provider-card[data-provider="anthropic"].selected .provider-card-icon {
    color: #d9775f;
  }
  .provider-card[data-provider="anthropic"].selected .provider-card-name {
    color: var(--text-primary);
  }

  .provider-card[data-provider="google"].selected,
  .provider-card[data-provider="google"]:hover,
  .provider-card[data-provider="google"]:focus-visible {
    border-color: #4285f4;
    box-shadow: 0 0 10px rgba(66, 133, 244, 0.12);
  }
  .provider-card[data-provider="google"].selected {
    background: rgba(66, 133, 244, 0.06);
  }
  .provider-card[data-provider="google"].selected .provider-card-icon {
    color: #4285f4;
  }
  .provider-card[data-provider="google"].selected .provider-card-name {
    color: var(--text-primary);
  }

  .provider-card[data-provider="groq"].selected,
  .provider-card[data-provider="groq"]:hover,
  .provider-card[data-provider="groq"]:focus-visible {
    border-color: #f55036;
    box-shadow: 0 0 10px rgba(245, 80, 54, 0.12);
  }
  .provider-card[data-provider="groq"].selected {
    background: rgba(245, 80, 54, 0.06);
  }
  .provider-card[data-provider="groq"].selected .provider-card-icon {
    color: #f55036;
  }
  .provider-card[data-provider="groq"].selected .provider-card-name {
    color: var(--text-primary);
  }

  .provider-card[data-provider="openrouter"].selected,
  .provider-card[data-provider="openrouter"]:hover,
  .provider-card[data-provider="openrouter"]:focus-visible {
    border-color: #7e22ce;
    box-shadow: 0 0 10px rgba(126, 34, 206, 0.12);
  }
  .provider-card[data-provider="openrouter"].selected {
    background: rgba(126, 34, 206, 0.06);
  }
  .provider-card[data-provider="openrouter"].selected .provider-card-icon {
    color: #7e22ce;
  }
  .provider-card[data-provider="openrouter"].selected .provider-card-name {
    color: var(--text-primary);
  }

  .provider-card[data-provider="webspeech"].selected,
  .provider-card[data-provider="webspeech"]:hover,
  .provider-card[data-provider="webspeech"]:focus-visible {
    border-color: #38bdf8;
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.14);
  }
  .provider-card[data-provider="webspeech"].selected {
    background: rgba(56, 189, 248, 0.06);
  }
  .provider-card[data-provider="webspeech"].selected .provider-card-icon {
    color: #38bdf8;
  }
  .provider-card[data-provider="webspeech"].selected .provider-card-name {
    color: var(--text-primary);
  }

  /* Local providers (Ollama, LM Studio) share a teal "runs on your machine" hue. */
  .provider-card[data-provider="ollama"].selected,
  .provider-card[data-provider="ollama"]:hover,
  .provider-card[data-provider="ollama"]:focus-visible,
  .provider-card[data-provider="lmstudio"].selected,
  .provider-card[data-provider="lmstudio"]:hover,
  .provider-card[data-provider="lmstudio"]:focus-visible {
    border-color: #0d9488;
    box-shadow: 0 0 10px rgba(13, 148, 136, 0.12);
  }
  .provider-card[data-provider="ollama"].selected,
  .provider-card[data-provider="lmstudio"].selected {
    background: rgba(13, 148, 136, 0.06);
  }
  .provider-card[data-provider="ollama"].selected .provider-card-icon,
  .provider-card[data-provider="lmstudio"].selected .provider-card-icon {
    color: #0d9488;
  }
  .provider-card[data-provider="ollama"].selected .provider-card-name,
  .provider-card[data-provider="lmstudio"].selected .provider-card-name {
    color: var(--text-primary);
  }

  /* ── Active Provider Details Section ── */
  .provider-details-card {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-shadow: var(--shadow-sm);
  }

  .detail-row {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .detail-row.key-section {
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
  }

  .detail-row.refinement-section {
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
  }

  .refinement-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .refinement-copy {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1;
    min-width: 0;
  }

  .detail-row-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .detail-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .detail-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .detail-desc {
    font-size: 11.5px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .security-note {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 7%, var(--bg-primary));
    color: var(--text-secondary);
    font-size: 11.5px;
    line-height: 1.45;
  }

  .security-note.compact {
    margin-bottom: 2px;
  }

  .security-note-label {
    flex: 0 0 auto;
    color: var(--accent);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .provider-key-link {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
    margin-left: 2px;
  }

  .provider-key-link:hover {
    text-decoration: underline;
  }

  /* Inline API Key input box */
  .api-key-input-wrapper {
    display: flex;
    align-items: center;
    background: var(--bg-tertiary);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    height: 38px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .api-key-input-wrapper:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .input-inner-container {
    display: flex;
    align-items: center;
    flex: 1;
    height: 100%;
    padding-left: 10px;
  }

  .input-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .key-input {
    background: transparent !important;
    border: none !important;
    color: var(--text-primary);
    padding: 0 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    width: 100%;
    height: 100%;
    outline: none;
    box-shadow: none !important;
  }

  .api-key-input-wrapper select.text-input {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    width: 100%;
    height: 100%;
    min-width: 0;
    padding: 0 10px;
    cursor: pointer;
  }

  .api-key-input-wrapper select.text-input option {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .api-key-actions {
    display: flex;
    height: 100%;
    border-left: 1px solid var(--border);
  }

  .key-btn {
    padding: 0 16px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    height: 100%;
    transition: background 0.15s, color 0.15s;
  }

  .save-btn {
    background: var(--accent);
    color: #ffffff;
  }

  .save-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .save-btn:disabled {
    background: var(--bg-hover);
    color: var(--text-muted);
    cursor: not-allowed;
  }

  .clear-btn {
    background: transparent;
    color: var(--error);
    border-right: 1px solid var(--border);
  }

  .clear-btn:hover {
    background: rgba(239, 68, 68, 0.08);
  }

  .key-status-indicator {
    margin-top: 2px;
  }

  .voice-input-key-hint {
    max-width: 100%;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .voice-input-key-hint-badge {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
    line-height: 1.35;
    align-items: flex-start;
  }

  .status-badge.success {
    background: rgba(16, 185, 129, 0.08);
    color: #10B981;
    border: 1px solid rgba(16, 185, 129, 0.15);
  }

  .status-badge.loading {
    background: rgba(245, 158, 11, 0.08);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.15);
  }

  .status-badge.error {
    background: rgba(239, 68, 68, 0.08);
    color: #EF4444;
    border: 1px solid rgba(239, 68, 68, 0.15);
  }

  .status-badge.idle {
    background: rgba(156, 163, 175, 0.08);
    color: var(--text-muted);
    border: 1px solid rgba(156, 163, 175, 0.15);
  }

  /* ── Model Selector dropdown trigger ── */
  .model-selector-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .model-label-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    width: 100%;
  }

  .model-meta-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .model-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2.5px 7px;
    border-radius: 5px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.2px;
    text-transform: uppercase;
  }

  .model-status-pill.live {
    background: rgba(16, 185, 129, 0.08);
    color: #10B981;
    border: 1px solid rgba(16, 185, 129, 0.15);
  }

  .model-status-pill.curated {
    background: rgba(156, 163, 175, 0.08);
    color: var(--text-muted);
    border: 1px solid rgba(156, 163, 175, 0.15);
  }

  .model-status-pill.loading {
    background: rgba(245, 158, 11, 0.08);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.15);
  }

  .model-status-pill.error {
    background: rgba(239, 68, 68, 0.08);
    color: #EF4444;
    border: 1px solid rgba(239, 68, 68, 0.15);
  }

  .pulse-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #10B981;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
    animation: blinker 1.5s infinite ease-in-out;
  }

  .model-refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
  }

  .model-refresh-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .model-inline-link {
    background: none;
    border: none;
    color: var(--accent);
    text-decoration: underline;
    font-weight: 500;
    cursor: pointer;
    padding: 0 2px;
  }

  /* Big Model Trigger Button */
  .model-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--bg-primary);
    border: 1.5px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    transition: border-color 0.15s, background 0.15s;
    outline: none;
    box-shadow: var(--shadow-sm);
  }

  .model-trigger:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }

  .model-trigger:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    box-shadow: none;
  }

  .model-trigger:disabled:hover {
    background: var(--bg-primary);
    border-color: var(--border);
  }

  .model-trigger-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .model-trigger-badge,
  .model-option-badge {
    flex-shrink: 0;
    font-size: 9.5px;
    font-weight: 700;
    padding: 2.5px 6.5px;
    border-radius: 5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .model-trigger-badge[data-provider="Anthropic"],
  .model-option-badge[data-provider="Anthropic"] {
    background: rgba(217, 119, 95, 0.12);
    color: #d9775f;
    border: 1px solid rgba(217, 119, 95, 0.2);
  }

  .model-trigger-badge[data-provider="Google"],
  .model-option-badge[data-provider="Google"] {
    background: rgba(66, 133, 244, 0.12);
    color: #4285f4;
    border: 1px solid rgba(66, 133, 244, 0.2);
  }

  .model-trigger-badge[data-provider="OpenAI"],
  .model-option-badge[data-provider="OpenAI"] {
    background: rgba(16, 163, 127, 0.12);
    color: #10a37f;
    border: 1px solid rgba(16, 163, 127, 0.2);
  }

  .model-trigger-badge[data-provider="Groq"],
  .model-option-badge[data-provider="Groq"] {
    background: rgba(245, 80, 54, 0.12);
    color: #f55036;
    border: 1px solid rgba(245, 80, 54, 0.2);
  }

  .model-trigger-badge[data-provider="Mistral"],
  .model-option-badge[data-provider="Mistral"] {
    background: rgba(255, 112, 67, 0.12);
    color: #ff7043;
    border: 1px solid rgba(255, 112, 67, 0.22);
  }

  .model-trigger-badge[data-provider="Microsoft"],
  .model-option-badge[data-provider="Microsoft"] {
    background: rgba(0, 120, 212, 0.12);
    color: #3794ff;
    border: 1px solid rgba(0, 120, 212, 0.22);
  }

  .model-trigger-badge[data-provider="NVIDIA"],
  .model-option-badge[data-provider="NVIDIA"] {
    background: rgba(118, 185, 0, 0.12);
    color: #76b900;
    border: 1px solid rgba(118, 185, 0, 0.22);
  }

  .model-trigger-badge[data-provider="Qwen"],
  .model-option-badge[data-provider="Qwen"] {
    background: rgba(99, 102, 241, 0.12);
    color: #818cf8;
    border: 1px solid rgba(99, 102, 241, 0.22);
  }

  .model-trigger-badge[data-provider="xAI"],
  .model-option-badge[data-provider="xAI"] {
    background: rgba(148, 163, 184, 0.14);
    color: #cbd5e1;
    border: 1px solid rgba(148, 163, 184, 0.24);
  }

  .model-trigger-badge[data-provider="Zyphra"],
  .model-option-badge[data-provider="Zyphra"] {
    background: rgba(14, 165, 233, 0.12);
    color: #38bdf8;
    border: 1px solid rgba(14, 165, 233, 0.22);
  }

  .model-trigger-badge[data-provider="Sesame"],
  .model-option-badge[data-provider="Sesame"] {
    background: rgba(234, 179, 8, 0.12);
    color: #eab308;
    border: 1px solid rgba(234, 179, 8, 0.22);
  }

  .model-trigger-badge[data-provider="Canopy"],
  .model-option-badge[data-provider="Canopy"] {
    background: rgba(34, 197, 94, 0.12);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.22);
  }

  .model-trigger-badge[data-provider="Kokoro"],
  .model-option-badge[data-provider="Kokoro"] {
    background: rgba(236, 72, 153, 0.12);
    color: #ec4899;
    border: 1px solid rgba(236, 72, 153, 0.22);
  }

  .model-trigger-badge[data-provider="Other"],
  .model-option-badge[data-provider="Other"] {
    background: rgba(126, 34, 206, 0.12);
    color: #a855f7;
    border: 1px solid rgba(126, 34, 206, 0.2);
  }

  .model-trigger-badge[data-provider="Local"],
  .model-option-badge[data-provider="Local"] {
    background: rgba(13, 148, 136, 0.12);
    color: #14b8a6;
    border: 1px solid rgba(13, 148, 136, 0.2);
  }

  .model-trigger-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .model-trigger-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .model-trigger-desc {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .model-trigger-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .model-chevron {
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform 0.2s ease;
  }

  .model-chevron.open {
    transform: rotate(180deg);
  }

  .model-free-badge {
    flex-shrink: 0;
    font-size: 9.5px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 5px;
    letter-spacing: 0.04em;
    background: rgba(74, 222, 128, 0.12);
    color: var(--success, #4ade80);
    border: 1px solid rgba(74, 222, 128, 0.2);
    text-transform: uppercase;
  }

  .provider-capability-pill {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 999px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    border: 1px solid transparent;
    color: var(--text-secondary);
    background: rgba(156, 163, 175, 0.1);
  }

  .provider-capability-pill[data-kind="native"] {
    color: #0f766e;
    background: rgba(20, 184, 166, 0.12);
    border-color: rgba(20, 184, 166, 0.22);
  }

  .provider-capability-pill[data-kind="self-hosted"] {
    color: #2563eb;
    background: rgba(59, 130, 246, 0.12);
    border-color: rgba(59, 130, 246, 0.22);
  }

  /* Dropdown styling */
  .model-dropdown {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: 100;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), var(--frost-surface, 0.72));
    backdrop-filter: blur(var(--glass-blur, 20px));
    -webkit-backdrop-filter: blur(var(--glass-blur, 20px));
    border: 1.5px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow-sm), 0 8px 24px rgba(0, 0, 0, 0.25);
    /* The dropdown itself is the scroll container so the search bar can stick
       to the top; height hugs its content up to the cap (no reserved gap). */
    overflow-y: auto;
    overflow-x: hidden;
    max-height: 280px;
    animation: modelDropdownIn 0.15s ease;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  }

  @keyframes modelDropdownIn {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .model-search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    /* Pinned to the top of the scrolling dropdown. A translucent, blurred
       backdrop keeps the glass look instead of an opaque strip. */
    position: sticky;
    top: 0;
    z-index: 2;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), var(--frost-surface, 0.72));
    backdrop-filter: blur(var(--glass-blur, 20px));
    -webkit-backdrop-filter: blur(var(--glass-blur, 20px));
    color: var(--text-muted);
  }

  .model-search-input {
    width: 100%;
    background: transparent !important;
    border: none !important;
    color: var(--text-primary);
    font-size: 12.5px;
    outline: none;
    padding: 0;
  }

  .model-search-clear {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 0 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .model-search-clear:hover {
    color: var(--text-primary);
  }

  .model-list {
    display: flex;
    flex-direction: column;
  }

  .model-empty {
    padding: 20px;
    text-align: center;
    font-size: 12px;
    color: var(--text-muted);
  }

  .model-option {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    transition: background 0.12s;
  }

  .model-option:not(:last-child) {
    border-bottom: 1px solid var(--border-subtle);
  }

  .model-option:hover {
    background: var(--bg-hover);
  }

  .model-option.selected {
    background: var(--bg-tertiary);
  }

  .model-option-row {
    display: flex;
    align-items: stretch;
    gap: 0;
    transition: background 0.12s;
  }

  .model-option-row:not(:last-child) {
    border-bottom: 1px solid var(--border-subtle);
  }

  .model-option-row:hover {
    background: var(--bg-hover);
  }

  .model-option-row.selected {
    background: var(--bg-tertiary);
  }

  .model-option-row .model-option {
    border-bottom: none;
    background: transparent;
  }

  .model-option-row .model-option:hover {
    background: transparent;
  }

  .model-option-select {
    flex: 1;
  }

  .model-option-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .model-option-body {
    min-width: 0;
    flex: 1;
  }

  .model-option-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .model-option-desc {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 1px;
  }

  .model-option-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .checkmark-icon {
    color: var(--accent);
    flex-shrink: 0;
  }

  .model-option-preview {
    width: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
  }

  .model-option-preview:hover,
  .model-option-preview.playing {
    color: var(--accent);
    background: rgba(255, 255, 255, 0.04);
  }


  /* ── Toggle rows ──────────────────────── */
  .stt-selector-wrap {
    max-width: 560px;
  }

  .stt-trigger {
    min-height: 52px;
    padding: 10px 13px;
    background:
      linear-gradient(135deg, rgba(20, 184, 166, 0.075), transparent 44%),
      var(--bg-primary);
  }

  .stt-trigger:hover {
    background:
      linear-gradient(135deg, rgba(20, 184, 166, 0.12), transparent 46%),
      var(--bg-hover);
  }

  .stt-trigger .model-trigger-left {
    gap: 9px;
    flex: 1;
  }

  .stt-model-icon {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 8px;
    color: #14b8a6;
    background: rgba(20, 184, 166, 0.1);
    border: 1px solid rgba(20, 184, 166, 0.2);
  }

  .stt-mode-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: max-content;
    padding: 3px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: #14b8a6;
    background: rgba(20, 184, 166, 0.1);
    border: 1px solid rgba(20, 184, 166, 0.2);
  }

  .stt-dropdown {
    max-height: 318px;
    border-color: rgba(20, 184, 166, 0.24);
  }

  .stt-model-option {
    min-height: 56px;
  }

  .stt-model-option .model-option-name,
  .stt-model-option .model-option-desc {
    overflow-wrap: anywhere;
    line-height: 1.35;
  }

  @media (max-width: 640px) {
    .stt-trigger {
      align-items: flex-start;
    }

    .stt-trigger .model-trigger-left {
      align-items: flex-start;
    }

    .stt-trigger .model-trigger-badge,
    .stt-mode-pill {
      display: none;
    }

    .stt-trigger .model-trigger-right {
      padding-top: 7px;
    }
  }

  .tts-selector-wrap {
    max-width: 560px;
  }

  .tts-trigger {
    min-height: 54px;
    padding: 11px 13px;
    background:
      linear-gradient(135deg, rgba(var(--accent-rgb, 59, 130, 246), 0.06), transparent 42%),
      var(--bg-primary);
  }

  .tts-trigger:hover {
    background:
      linear-gradient(135deg, rgba(var(--accent-rgb, 59, 130, 246), 0.1), transparent 44%),
      var(--bg-hover);
  }

  .tts-trigger .model-trigger-left {
    gap: 9px;
  }

  .tts-model-icon {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 8px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
  }

  .tts-voice-count-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: max-content;
    padding: 3px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--bg-tertiary) 80%, transparent);
    border: 1px solid var(--border);
  }

  .tts-voice-count-pill.compact {
    min-width: 24px;
    height: 22px;
    padding: 0 6px;
  }

  .tts-dropdown {
    max-height: 320px;
    border-color: color-mix(in srgb, var(--accent) 20%, var(--border));
  }

  .tts-model-option {
    min-height: 58px;
  }

  .tts-model-option .model-option-name,
  .model-option-row .model-option-name {
    overflow-wrap: anywhere;
  }

  .tts-model-option .model-option-desc,
  .model-option-row .model-option-desc {
    line-height: 1.35;
  }

  .model-option-row .model-option-preview {
    width: 34px;
    margin: 8px 8px 8px 0;
    border-radius: 8px;
    border: 1px solid transparent;
  }

  .model-option-row .model-option-preview:hover,
  .model-option-row .model-option-preview.playing {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
    border-color: color-mix(in srgb, var(--accent) 20%, var(--border));
  }

  @media (max-width: 640px) {
    .tts-trigger {
      align-items: flex-start;
    }

    .tts-trigger .model-trigger-left {
      align-items: flex-start;
    }

    .tts-trigger .model-trigger-badge {
      display: none;
    }

    .tts-trigger .model-trigger-right {
      padding-top: 7px;
    }

    .tts-voice-count-pill {
      display: none;
    }
  }

  .toggle-row, .slider-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 10px;
    margin-top: 6px;
    gap: 16px;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }

  .toggle-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .toggle-desc {
    font-size: 11.5px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  /* ── Toggle switch ────────────────────── */
  .toggle {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.2s, border-color 0.2s;
  }

  .toggle.on {
    background: var(--accent);
    border-color: var(--accent);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--text-primary);
    box-shadow: 0 1px 4px rgba(0,0,0,0.35);
    transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
  }

  .toggle.on .toggle-thumb {
    transform: translateX(20px);
  }

  /* ── Number controls ──────────────────── */
  .number-control {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .num-btn {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    cursor: pointer;
  }
  .num-btn:hover { background: var(--bg-hover); }

  .num-btn-reset {
    padding: 0 10px;
    height: 28px;
    border-radius: 7px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
    cursor: pointer;
    margin-left: 4px;
  }
  .num-btn-reset:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .num-val {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 24px;
    text-align: center;
  }

  .text-input {
    height: 32px;
    padding: 0 10px;
    border-radius: 7px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    outline: none;
    min-width: 200px;
    transition: border-color 0.15s;
  }

  .text-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  /* ── Shortcuts ────────────────────────── */
  .heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .reset-all-btn {
    padding: 6px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .reset-all-btn:hover {
    background: rgba(248, 113, 113, 0.12);
    color: var(--error);
    border-color: rgba(248, 113, 113, 0.2);
  }

  .shortcut-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .shortcut-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .shortcut-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 10px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .shortcut-row.recording {
    border-color: var(--accent);
    box-shadow: 0 0 10px var(--accent-glow);
  }

  .shortcut-info {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .sc-label-group {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sc-category-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .sc-label {
    font-size: 12.5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sc-conflict {
    font-size: 10.5px;
    color: var(--error);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shortcut-actions-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  /* Key Recorder button styles */
  .sc-key-recorder {
    font-size: 11px;
    font-family: var(--editor-font-family, monospace);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-bottom: 2px solid var(--text-muted);
    border-radius: 6px;
    padding: 5px 12px;
    color: var(--text-primary);
    letter-spacing: 0.3px;
    box-shadow: 0 1px 0 var(--border) inset, var(--shadow-sm);
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 90px;
    justify-content: center;
  }

  .sc-key-recorder:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .sc-key-recorder.empty {
    color: var(--text-muted);
    font-style: italic;
  }

  .sc-key-recorder.recording-active {
    background: var(--bg-primary);
    border-color: var(--accent);
    border-bottom-color: var(--accent);
    box-shadow: 0 0 12px var(--accent-light);
    color: var(--accent);
    animation: recorderPulse 1.5s infinite ease-in-out;
  }

  @keyframes recorderPulse {
    0% { box-shadow: 0 0 4px var(--accent-light); }
    50% { box-shadow: 0 0 12px rgba(6, 182, 212, 0.4); }
    100% { box-shadow: 0 0 4px var(--accent-light); }
  }

  .record-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--error);
    animation: blinker 1s linear infinite;
    display: inline-block;
  }

  @keyframes blinker {
    50% { opacity: 0; }
  }

  .esc-hint {
    font-size: 9px;
    color: var(--text-muted);
    font-family: inherit;
  }

  .shortcut-delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .shortcut-delete-btn:hover {
    background: rgba(248, 113, 113, 0.12);
    color: var(--error);
    border-color: rgba(248, 113, 113, 0.2);
  }

  .shortcut-reset-btn {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .shortcut-reset-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--accent);
  }

  /* Add Shortcut Section */
  .add-shortcut-section {
    margin-top: 8px;
    border-top: 1px dashed var(--border);
    padding-top: 16px;
  }

  .add-btn-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    background: var(--bg-primary);
    border: 1px dashed var(--border);
    color: var(--text-secondary);
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .add-btn-trigger:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .add-shortcut-panel {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: slideDown 0.2s ease-out;
  }

  .context-shortcut-section {
    border-top: 1px dashed var(--border);
    padding-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .context-shortcut-header h3 {
    margin: 0 0 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .context-shortcut-header p {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .context-shortcut-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .context-shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 14px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .context-shortcut-info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .context-shortcut-label {
    font-size: 12.5px;
    color: var(--text-primary);
  }

  .context-shortcut-context {
    font-size: 11px;
    color: var(--text-muted);
  }

  .context-shortcut-keys {
    flex-shrink: 0;
    min-width: 74px;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-family: var(--editor-font-family, monospace);
    font-size: 11px;
    text-align: center;
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .panel-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-field label,
  .form-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    display: block;
  }

  .no-actions-msg {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
    padding: 6px 0;
  }

  .recorder-wrapper {
    display: flex;
  }

  .recorder-wrapper .sc-key-recorder {
    width: 100%;
    justify-content: center;
    padding: 8px;
  }

  .panel-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 4px;
  }

  .panel-btn-cancel {
    padding: 6px 12px;
    background: transparent;
    border: 1.5px solid var(--border);
    color: var(--text-secondary);
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .panel-btn-cancel:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .panel-btn-save {
    padding: 6px 16px;
    background: var(--button-bg);
    color: var(--button-text);
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    border: none;
  }

  .panel-btn-save:hover:not(:disabled) {
    background: var(--button-hover-bg);
  }

  .panel-btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── About ────────────────────────────── */
  .about-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 28px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 14px;
  }

  .about-logo {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: var(--accent-light);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
    overflow: hidden;
  }

  .about-app-icon {
    width: 42px;
    height: 42px;
    object-fit: contain;
    border-radius: 8px;
  }

  .about-name {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .about-tagline {
    font-size: 12px;
    color: var(--text-muted);
  }

  .about-rows {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .about-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .about-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .about-value {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .security-summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }

  .security-summary-row {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 11.5px;
    line-height: 1.45;
  }

  .security-summary-label {
    color: var(--text-primary);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  /* ── Tour Section ──────────────────────── */
  .tour-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    border-radius: 6px;
    background: var(--accent-light);
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 600;
    border: 1px solid var(--border-focus);
    cursor: pointer;
    transition: all 0.15s;
  }

  .tour-btn:hover {
    background: color-mix(in srgb, var(--accent) 25%, var(--accent-light));
  }

  :global(.light-theme) .tour-btn {
    background: color-mix(in srgb, var(--accent) 12%, rgba(255, 255, 255, 0.45));
    color: var(--accent-hover, var(--accent));
    border-color: color-mix(in srgb, var(--accent) 35%, rgba(0, 0, 0, 0.1));
  }

  :global(.light-theme) .tour-btn:hover {
    background: color-mix(in srgb, var(--accent) 22%, rgba(255, 255, 255, 0.45));
    border-color: var(--accent-hover, var(--accent));
    color: var(--accent-hover, var(--accent));
    box-shadow: 0 2px 8px rgba(var(--accent-rgb, 6, 182, 212), 0.12);
  }

  /* ── Reset Section ─────────────────────── */
  .reset-section {
    margin-top: 16px;
    display: flex;
    justify-content: flex-end;
  }

  .reset-btn {
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 8px;
    background: transparent;
    color: var(--error);
    border: 1px solid var(--error);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .reset-btn:hover {
    background: var(--error);
    color: #fff;
  }

  .reset-btn.confirming {
    background: var(--error);
    color: #fff;
    max-width: 360px;
    white-space: normal;
    text-align: center;
    line-height: 1.4;
  }

  /* ── Updater Section ───────────────────── */
  .updater-section {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .updater-btn {
    width: 100%;
    padding: 12px;
    background: var(--button-bg);
    color: var(--button-text);
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    text-align: center;
    border: 1px solid transparent;
    transition: background-color 0.15s, transform 0.1s, box-shadow 0.15s;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .updater-btn:hover {
    background: var(--button-hover-bg);
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .updater-btn:active {
    transform: scale(0.985);
  }

  .updater-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 10px;
    gap: 16px;
  }

  .updater-status.checking {
    justify-content: center;
    color: var(--text-secondary);
    font-size: 12.5px;
    font-weight: 500;
    gap: 10px;
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .updater-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .status-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .status-desc {
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .updater-btn-subtle {
    padding: 6px 12px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 500;
    transition: background 0.15s, color 0.15s;
    cursor: pointer;
    white-space: nowrap;
  }

  .updater-btn-subtle:hover {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .spin-icon {
    animation: spin-anim 1s linear infinite;
  }

  @keyframes spin-anim {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Shell cards ──────────────────────── */
  .shell-cards {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .shell-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--bg-primary);
    border: 1.5px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    text-align: left;
  }

  .shell-card:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
  }

  .shell-card.selected {
    border-color: var(--accent);
    background: var(--accent-light);
  }

  .shell-icon {
    color: var(--text-muted);
    display: flex;
    flex-shrink: 0;
  }

  .shell-card.selected .shell-icon {
    color: var(--accent);
  }

  .shell-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .shell-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .shell-path {
    font-size: 10.5px;
    color: var(--text-muted);
    font-family: 'JetBrains Mono', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shell-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 8px;
    padding: 0 2px;
  }
  .shell-hint code {
    font-size: 10.5px;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--bg-elevated, rgba(255, 255, 255, 0.06));
  }

  /* ── Custom CLI agents ── */
  .agent-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }
  .agent-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
    border-radius: 10px;
    background: var(--bg-elevated, rgba(255, 255, 255, 0.03));
  }
  .agent-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .agent-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .agent-cmd {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent-rules-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .agent-rules-toggle input {
    cursor: pointer;
    accent-color: var(--accent);
  }
  .agent-remove {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .agent-remove:hover {
    background: var(--danger-bg, rgba(248, 113, 113, 0.12));
    color: var(--danger, #f87171);
  }
  .agent-add {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .agent-input {
    padding: 8px 10px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    background: var(--bg-input, rgba(0, 0, 0, 0.2));
    color: var(--text);
    font-size: 12px;
    font-family: inherit;
  }
  .agent-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .agent-input-cmd {
    flex: 1;
    min-width: 180px;
    font-family: var(--font-mono, monospace);
  }
  .agent-add-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-contrast, #06231f);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .agent-add-btn:hover {
    filter: brightness(1.08);
  }
  .agent-rules-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 11.5px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .agent-rules-row input {
    cursor: pointer;
    accent-color: var(--accent);
  }
  .agent-rules-row code,
  .agent-rules-toggle code {
    font-size: 10.5px;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--bg-elevated, rgba(255, 255, 255, 0.06));
  }
  .agent-error {
    margin-top: 8px;
    font-size: 11.5px;
    color: var(--danger, #f87171);
  }

  .shell-loading {
    font-size: 12px;
    color: var(--text-muted);
    padding: 16px;
    text-align: center;
  }

  /* ── Themes tab ───────────────────────── */
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .theme-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    border: 1.5px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    padding: 0;
    text-align: left;
  }

  .theme-card:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
  }

  .theme-card.active {
    border-color: var(--accent);
    background: var(--accent-light);
  }

  .theme-preview {
    display: flex;
    height: 32px;
    overflow: hidden;
  }

  .preview-bar {
    flex: 1;
  }

  .theme-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    gap: 8px;
  }

  .theme-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .theme-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }

  .theme-action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    background: var(--bg-primary);
    border: 1.5px solid var(--border);
    color: var(--text-secondary);
    border-radius: 10px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .theme-action-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
    color: var(--text-primary);
  }

  /* ── Custom Theme Editor ──────────────── */
  .custom-theme-editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .ct-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ct-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .ct-section-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 8px 0 2px;
    border-top: 1px solid var(--border);
    margin-top: 4px;
  }

  .ct-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .ct-color-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    gap: 8px;
  }

  .ct-color-label {
    font-size: 11px;
    color: var(--text-secondary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .color-input {
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0;
    cursor: pointer;
    background: none;
    flex-shrink: 0;
  }

  .color-input::-webkit-color-swatch-wrapper {
    padding: 2px;
  }

  .color-input::-webkit-color-swatch {
    border: none;
    border-radius: 2px;
  }

  .ct-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .ct-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    border: 1.5px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
  }

  .ct-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .ct-btn.primary {
    background: var(--button-bg);
    color: var(--button-text);
    border-color: transparent;
  }

  .ct-btn.primary:hover {
    background: var(--button-hover-bg);
  }

  @media (max-width: 640px) {
    .modal {
      width: 100%;
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - 16px);
      border-radius: 12px;
    }
    .modal-body {
      padding: 16px;
    }
    .modal-tab {
      padding: 8px 10px;
      font-size: 11px;
    }
    .tab-icon {
      display: none;
    }
    .appearance-cards {
      grid-template-columns: 1fr;
    }
    .toggle-row, .slider-row {
      padding: 12px;
    }
    .theme-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .ct-grid {
      grid-template-columns: 1fr;
    }
    .security-note {
      flex-direction: column;
      gap: 4px;
    }
    .security-summary-row {
      grid-template-columns: 1fr;
      gap: 4px;
    }
  }
</style>
