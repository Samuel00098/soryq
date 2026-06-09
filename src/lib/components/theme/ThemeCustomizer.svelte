<script lang="ts">
  import { onMount } from 'svelte';
  import { activeTheme, availableThemes, switchTheme, saveTheme } from '$lib/stores/theme';
  import type { Theme } from '$lib/types/theme';
  import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.svelte';

  let themeOptions = $derived<DropdownOption[]>(
    $availableThemes.map(t => ({
      value: t.id,
      label: t.name
    }))
  );

  const themeTypeOptions: DropdownOption[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' }
  ];

  let currentTheme = $state<Theme | null>(null);
  let isCustom = $derived(currentTheme?.id.startsWith('custom-') ?? false);
  let activeTab = $state<'ui' | 'syntax'>('ui');

  // Load active theme details locally on mount and when it changes
  onMount(() => {
    const unsubscribe = activeTheme.subscribe(theme => {
      if (theme && (!currentTheme || currentTheme.id !== theme.id)) {
        currentTheme = JSON.parse(JSON.stringify(theme));
      }
    });
    return unsubscribe;
  });

  // Apply edits to current DOM elements in real-time
  function handleColorChange(key: string, value: string, isSyntax = false) {
    if (!currentTheme) return;
    if (isSyntax) {
      currentTheme.syntax[key] = value;
      document.documentElement.style.setProperty(`--syntax-${key}`, value);
    } else {
      currentTheme.colors[key] = value;
      document.documentElement.style.setProperty(`--${key}`, value);
    }
  }

  function cloneTheme() {
    if (!currentTheme) return;
    const newName = `${currentTheme.name} Copy`;
    const newId = `custom-${Date.now()}`;
    currentTheme = {
      ...currentTheme,
      id: newId,
      name: newName
    };
  }

  async function saveCustomTheme() {
    if (!currentTheme) return;
    
    // Ensure we are saving as a custom theme
    if (!isCustom) {
      cloneTheme();
    }
    
    await saveTheme(currentTheme as Theme);
  }

  function resetTheme() {
    if ($activeTheme) {
      currentTheme = JSON.parse(JSON.stringify($activeTheme));
      // Re-apply original CSS
      const root = document.documentElement;
      for (const [key, value] of Object.entries($activeTheme.colors)) {
        root.style.setProperty(`--${key}`, value);
      }
      for (const [key, value] of Object.entries($activeTheme.syntax)) {
        root.style.setProperty(`--syntax-${key}`, value);
      }
    }
  }

  const uiColorLabels: { key: string; label: string }[] = [
    { key: 'bg-primary', label: 'Primary Background' },
    { key: 'bg-secondary', label: 'Secondary Background' },
    { key: 'bg-tertiary', label: 'Tertiary Background' },
    { key: 'bg-hover', label: 'Hover Background' },
    { key: 'text-primary', label: 'Primary Text' },
    { key: 'text-secondary', label: 'Secondary Text' },
    { key: 'accent', label: 'Accent Color' },
    { key: 'accent-hover', label: 'Accent Hover' },
    { key: 'border', label: 'Border Color' },
    { key: 'editor-bg', label: 'Editor Background' },
    { key: 'statusbar-bg', label: 'Status Bar Background' },
    { key: 'sidebar-bg', label: 'Sidebar Background' },
    { key: 'panel-bg', label: 'Panel Background' },
    { key: 'titlebar-bg', label: 'Title Bar Background' },
    { key: 'titlebar-text', label: 'Title Bar Text' },
    { key: 'titlebar-border', label: 'Title Bar Border' }
  ];

  const syntaxColorLabels: { key: string; label: string }[] = [
    { key: 'keyword', label: 'Keywords (if, let)' },
    { key: 'string', label: 'Strings ("text")' },
    { key: 'comment', label: 'Comments (// text)' },
    { key: 'function', label: 'Functions (fn_name)' },
    { key: 'number', label: 'Numbers (42)' },
    { key: 'type', label: 'Types (struct, enum)' },
    { key: 'variable', label: 'Variables (var)' },
    { key: 'operator', label: 'Operators (+, =)' },
    { key: 'constant', label: 'Constants (MAX)' }
  ];
</script>

<div class="theme-customizer">
  {#if currentTheme}
    <div class="customizer-section selection-section">
      <label for="theme-select" class="section-label">Active Theme</label>
      <Dropdown
        options={themeOptions}
        value={$activeTheme?.id ?? ''}
        onChange={switchTheme}
        ariaLabel="Active Theme"
      />
    </div>

    <div class="customizer-section details-section">
      <label class="section-label" for="theme-name-input">Theme Metadata</label>
      <div class="form-group">
        <span class="form-label">Name</span>
        <input
          id="theme-name-input"
          type="text"
          bind:value={currentTheme.name}
          placeholder="My Custom Theme"
          class="customizer-input"
          disabled={!isCustom}
        />
      </div>
      <div class="form-group">
        <span class="form-label">Type</span>
        <div style="width: 100px;">
          <Dropdown
            options={themeTypeOptions}
            bind:value={currentTheme.type}
            disabled={!isCustom}
            ariaLabel="Theme Type"
          />
        </div>
      </div>
    </div>

    <div class="customizer-tabs">
      <button
        class="tab-btn"
        class:active={activeTab === 'ui'}
        onclick={() => activeTab = 'ui'}
      >
        UI Colors
      </button>
      <button
        class="tab-btn"
        class:active={activeTab === 'syntax'}
        onclick={() => activeTab = 'syntax'}
      >
        Syntax Colors
      </button>
    </div>

    <div class="colors-list">
      {#if activeTab === 'ui'}
        {#each uiColorLabels as item}
          <div class="color-item">
            <span class="color-name">{item.label}</span>
            <div class="color-inputs">
              <input
                type="color"
                value={currentTheme.colors[item.key] || '#000000'}
                oninput={(e) => handleColorChange(item.key, (e.target as HTMLInputElement).value, false)}
                class="color-picker"
                disabled={!isCustom}
                aria-label={`Pick ${item.label}`}
              />
              <input
                type="text"
                value={currentTheme.colors[item.key] || ''}
                oninput={(e) => handleColorChange(item.key, (e.target as HTMLInputElement).value, false)}
                class="hex-input"
                disabled={!isCustom}
                placeholder="#000000"
                aria-label={`${item.label} Hex Code`}
              />
            </div>
          </div>
        {/each}
      {:else}
        {#each syntaxColorLabels as item}
          <div class="color-item">
            <span class="color-name">{item.label}</span>
            <div class="color-inputs">
              <input
                type="color"
                value={currentTheme.syntax[item.key] || '#000000'}
                oninput={(e) => handleColorChange(item.key, (e.target as HTMLInputElement).value, true)}
                class="color-picker"
                disabled={!isCustom}
                aria-label={`Pick ${item.label}`}
              />
              <input
                type="text"
                value={currentTheme.syntax[item.key] || ''}
                oninput={(e) => handleColorChange(item.key, (e.target as HTMLInputElement).value, true)}
                class="hex-input"
                disabled={!isCustom}
                placeholder="#000000"
                aria-label={`${item.label} Hex Code`}
              />
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="customizer-actions">
      {#if !isCustom}
        <button class="action-btn secondary" onclick={cloneTheme}>
          Clone Theme
        </button>
      {:else}
        <button class="action-btn danger" onclick={resetTheme}>
          Reset
        </button>
        <button class="action-btn primary" onclick={saveCustomTheme}>
          Save Theme
        </button>
      {/if}
    </div>
  {:else}
    <div class="no-theme-placeholder">
      <p>Loading theme configuration...</p>
    </div>
  {/if}
</div>

<style>
  .theme-customizer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--sidebar-bg);
    color: var(--text-primary);
    font-size: 13px;
    overflow: hidden;
  }

  .customizer-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }

  .selection-section {
    padding: 16px 16px 8px;
  }

  .details-section {
    padding: 8px 16px;
  }

  .section-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-secondary);
    letter-spacing: 0.5px;
  }

  .form-group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .form-label {
    color: var(--text-secondary);
  }

  .customizer-input {
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--text-primary);
    padding: 6px 10px;
    border-radius: 6px;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
  }

  .customizer-input:focus {
    border-color: var(--input-focus-border);
  }

  .customizer-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .customizer-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    gap: 8px;
    flex-shrink: 0;
    padding: 8px 16px 0;
  }

  .tab-btn {
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-weight: 600;
    cursor: pointer;
    font-size: 12px;
    transition: color 0.15s, border-color 0.15s;
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .colors-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    padding: 16px;
    margin: 0;
  }

  .color-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  }

  .color-name {
    color: var(--text-primary);
    font-size: 12px;
  }

  .color-inputs {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-picker {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: none;
    cursor: pointer;
    padding: 0;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-picker::-webkit-color-swatch {
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .color-picker:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .hex-input {
    width: 70px;
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--text-primary);
    padding: 4px 6px;
    border-radius: 4px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    outline: none;
  }

  .hex-input:focus {
    border-color: var(--input-focus-border);
  }

  .hex-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .customizer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding: 12px 16px 16px;
    background: var(--sidebar-bg);
    flex-shrink: 0;
  }

  .action-btn {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: filter 0.15s;
  }

  .action-btn:hover {
    filter: brightness(1.1);
  }

  .action-btn.primary {
    background: var(--button-bg);
    color: var(--button-text);
  }

  .action-btn.danger {
    background: var(--error);
    color: white;
  }

  .action-btn.secondary {
    background: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .no-theme-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
  }
</style>
