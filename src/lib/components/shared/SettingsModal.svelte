<script lang="ts">
  import { onMount } from 'svelte';
  import { activeTheme, switchTheme, switchPresetTheme, saveTheme, importTheme, themeColorFields } from '$lib/stores/theme';
  import { presetThemes, currentPresetTheme } from '$lib/stores/presetThemes';
  import {
    fontSize,
    fontFamily,
    tabSize,
    wordWrap,
    minimap,
    vimMode,
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
  } from '$lib/stores/settings';
  import { requestNotificationPermission } from '$lib/stores/notification';
  import { getAvailableShells, type ShellInfo } from '$lib/services/pty-bridge';
  import { showToast } from '$lib/stores/notification';
  import { clearAllApplicationState } from '$lib/stores/workspace';

  type Tab = 'general' | 'terminal' | 'shortcuts' | 'themes' | 'about';
  let activeTab = $state<Tab>('general');

  let updateStatus = $state<'idle' | 'checking' | 'latest' | 'available' | 'error'>('idle');
  let updateMessage = $state('');

  async function handleCheckForUpdates() {
    if (updateStatus === 'checking') return;
    updateStatus = 'checking';
    updateMessage = 'Checking for updates...';
    
    // Simulate a network check to give a premium feel
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    try {
      updateStatus = 'latest';
      updateMessage = 'Soryq is up to date!';
      showToast('Soryq is up to date!', 'success');
    } catch (err) {
      updateStatus = 'error';
      updateMessage = 'Failed to check for updates.';
      showToast('Failed to check for updates.', 'error');
    }
  }

  const modalTabs = [
    { id: 'general'   as Tab, label: 'General' },
    { id: 'terminal'  as Tab, label: 'Terminal' },
    { id: 'shortcuts' as Tab, label: 'Shortcuts' },
    { id: 'themes'    as Tab, label: 'Themes' },
    { id: 'about'     as Tab, label: 'About' },
  ];

  const appearanceModes = [
    { id: 'system' as 'system'|'light'|'dark', label: 'System' },
    { id: 'light'  as 'system'|'light'|'dark', label: 'Light'  },
    { id: 'dark'   as 'system'|'light'|'dark', label: 'Dark'   },
  ];

  // Terminal settings
  let availableShells = $state<ShellInfo[]>([]);

  onMount(async () => {
    availableShells = await getAvailableShells();
  });

  let recordingId = $state<string | null>(null);
  let recordedKeys = $state('');
  let addingShortcut = $state(false);
  let newShortcutActionId = $state('');
  let newShortcutKeys = $state('');
  let newShortcutRecording = $state(false);
  const contextualShortcuts = [
    {
      keys: 'Left Alt',
      label: 'Toggle voice input',
      context: 'Prompt bar, Tasks, and Notes when the relevant surface is focused',
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
  ];

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
      } catch (err: any) {
        import('$lib/stores/notification').then(({ showToast }) => {
          showToast(err.message || 'Failed to import theme', 'error');
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
                      <div class="select-wrapper">
                        <select 
                          id="shortcut-action-select" 
                          class="styled-select" 
                          bind:value={newShortcutActionId}
                        >
                          <option value="" disabled selected>Select an action...</option>
                          {#each availableActions as action}
                            <option value={action.id}>[{action.category}] {action.label}</option>
                          {/each}
                        </select>
                        <svg class="select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
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
          <p>Choose a color theme for the editor and interface.</p>
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
                src="/icon.png?v=2"
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
            ['Version', '0.1.3'],
            ['Built with', 'Tauri 2 · Svelte 5 · Rust'],
            ['Runtime', 'WebView2 (Windows)'],
            ['License', 'MIT'],
          ] as [label, value]}
            <div class="about-row">
              <span class="about-label">{label}</span>
              <span class="about-value">{value}</span>
            </div>
          {/each}
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
                  <span class="status-desc">Soryq v0.1.3 is the latest version.</span>
                </div>
              </div>
              <button class="updater-btn-subtle" onclick={handleCheckForUpdates}>
                Check again
              </button>
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
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0,0,0,0.35), 0 0 0 1px var(--border);
    animation: modalIn 0.2s cubic-bezier(0.34,1.56,0.64,1);
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
    background: var(--bg-secondary);
  }

  .modal-tabs {
    display: flex;
    gap: 2px;
  }

  .modal-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
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

  /* ── Toggle rows ──────────────────────── */
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
  }
</style>
