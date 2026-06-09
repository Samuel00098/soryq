<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { isOpen, search, commands, toggleCommandPalette, initDefaultCommands } from '$lib/stores/commandpalette';
    import { switchTheme } from '$lib/stores/theme';

  let inputEl: HTMLInputElement;
  let selectedIndex = 0;

  onMount(() => {
    initDefaultCommands();
    setupThemeCommands();
  });

  async function setupThemeCommands() {
    try {
      // Let's dynamically load themes and register command palette entries for them
      const { invoke } = await import('@tauri-apps/api/core');
      interface ThemeInfo {
        id: string;
        name: string;
        author: string;
      }
      const themes = await invoke<ThemeInfo[]>('theme_list');
      themes.forEach(theme => {
        commands.update(cmds => {
          const id = `theme.activate.${theme.id}`;
          if (cmds.some(c => c.id === id)) return cmds;
          return [...cmds, {
            id,
            name: `Use Theme: ${theme.name}`,
            category: 'Preferences',
            action: async () => {
              await switchTheme(theme.id);
            }
          }];
        });
      });
    } catch (err) {
      console.error('Failed to register theme commands:', err);
    }
  }

  // Focus input when palette opens
  $: if ($isOpen) {
    selectedIndex = 0;
    setTimeout(() => {
      if (inputEl) inputEl.focus();
    }, 50);
  }

  $: filteredCommands = $commands.filter(cmd => 
    cmd.name.toLowerCase().includes($search.toLowerCase()) ||
    cmd.category.toLowerCase().includes($search.toLowerCase())
  );

  function handleKeyDown(e: KeyboardEvent) {
    if (!$isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % filteredCommands.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        executeCommand(filteredCommands[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      isOpen.set(false);
    }
  }

  function executeCommand(cmd: any) {
    cmd.action();
    isOpen.set(false);
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if $isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="command-palette-overlay" onclick={() => isOpen.set(false)}>
    <div class="command-palette" onclick={e => e.stopPropagation()}>
      <div class="search-container">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          bind:this={inputEl}
          type="text"
          placeholder="Type a command to execute..."
          bind:value={$search}
          class="palette-input"
        />
      </div>

      <div class="results-container">
        {#if filteredCommands.length === 0}
          <div class="no-results">No commands found matching "{$search}"</div>
        {:else}
          {#each filteredCommands as cmd, i}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="command-item"
              class:selected={i === selectedIndex}
              onclick={() => executeCommand(cmd)}
              onmouseenter={() => selectedIndex = i}
            >
              <div class="command-details">
                <span class="command-category">{cmd.category}</span>
                <span class="command-name">{cmd.name}</span>
              </div>
              {#if cmd.shortcut}
                <span class="command-shortcut">{cmd.shortcut}</span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .command-palette-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-glass, rgba(4, 4, 6, 0.65));
    backdrop-filter: blur(12px);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 15vh;
    z-index: 9999;
  }

  .command-palette {
    width: 600px;
    max-width: 90%;
    background: rgba(var(--editor-bg-rgb, 24, 24, 30), var(--frost-chrome, 0.62));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--glass-shadow, var(--shadow-lg)), inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: min(400px, 70vh);
    animation: scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes scaleUp {
    from {
      transform: scale(0.97);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  .search-container {
    display: flex;
    align-items: center;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    gap: 12px;
  }

  .search-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .palette-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 14px;
    font-family: inherit;
  }

  .palette-input::placeholder {
    color: var(--text-muted);
  }

  .results-container {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }

  .no-results {
    padding: 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }

  .command-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
    user-select: none;
    border-left: 2px solid transparent;
  }

  .command-item.selected {
    background: var(--accent-light);
    border-left-color: var(--accent);
    color: var(--text-primary);
  }

  .command-item.selected .command-name {
    color: var(--text-primary);
  }

  .command-item.selected .command-category {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent) !important;
  }

  .command-item.selected .command-shortcut {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--text-primary) !important;
  }

  .command-details {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .command-category {
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 0.5px;
    background: var(--bg-hover);
    padding: 2px 6px;
    border-radius: 4px;
    transition: background-color 0.15s, color 0.15s;
  }

  .command-name {
    font-size: 13px;
    color: var(--text-primary);
  }

  .command-shortcut {
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--editor-font-family, monospace);
    transition: background-color 0.15s, color 0.15s;
  }
</style>
