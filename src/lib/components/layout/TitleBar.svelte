<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { activeProject, closeProject, activeProjectId, activeWorkspaceId, activeWorkspace, clearAllStores } from '$lib/stores/workspace';
  import { openSettings, layout, toggleSidebar, setSidebarTab } from '$lib/stores/layout';
  import { floatingNoteOpen, toggleFloatingNote } from '$lib/stores/notes';
  import { isOpen as paletteOpen, search as paletteSearch, toggleCommandPalette } from '$lib/stores/commandpalette';
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import { showToast } from '$lib/stores/notification';
  import { openFile, jumpToLine } from '$lib/stores/editor';

  const win = getCurrentWindow();

  let iconError = $state(false);
  // On macOS, the native traffic-light buttons handle minimize/maximize/close.
  // We detect the platform to hide our custom controls so they don't double up.
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

  // Git state
  function handleGitButtonClick() {
    if ($layout.sidebarVisible && $layout.sidebarTab === 'git') {
      layout.update((l) => ({ ...l, sidebarVisible: false }));
    } else {
      layout.update((l) => ({ ...l, sidebarVisible: true, sidebarTab: 'git' }));
    }
  }

  // Codebase search state
  let searchResults = $state<any[]>([]);
  let isSearching = $state(false);
  let searchFocused = $state(false);
  let searchError = $state<string | null>(null);

  // Debounced search logic when typing inside search input
  let debounceTimeout: any;
  $effect(() => {
    const query = $paletteSearch;
    const project = $activeProject;
    
    if (debounceTimeout) clearTimeout(debounceTimeout);
    
    if (!project || !query.trim()) {
      searchResults = [];
      isSearching = false;
      searchError = null;
      return;
    }
    
    isSearching = true;
    debounceTimeout = setTimeout(async () => {
      try {
        const results = await invoke<any[]>('workspace_search_codebase', {
          projectPath: project.root_path,
          query: query
        });
        if (get(paletteSearch) === query) {
          searchResults = results;
          searchError = null;
        }
      } catch (err) {
        console.error('Search failed:', err);
        searchError = String(err);
      } finally {
        if (get(paletteSearch) === query) {
          isSearching = false;
        }
      }
    }, 200); // 200ms debounce
  });

  async function minimize() { await win.minimize(); }
  async function toggleMaximize() {
    if (await win.isMaximized()) { await win.unmaximize(); }
    else { await win.maximize(); }
  }
  async function close() { await win.close(); }

  function handleSearchKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      paletteSearch.set('');
      searchResults = [];
      searchFocused = false;
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if ($activeProject) {
        if (searchResults.length > 0) {
          selectResult(searchResults[0]);
        }
      } else {
        // Welcomescreen command palette or filtering: no active project
      }
    }
  }

  function handleSearchClick(e: Event) {
    if (!$activeProject) {
      // Welcome screen: click opens command palette or does default action
    }
  }

  function handleInputClick(e: MouseEvent) {
    e.stopPropagation();
    if ($activeProject) {
      searchFocused = true;
    }
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.titlebar-search')) {
      searchFocused = false;
    }
  }

  async function selectResult(result: any) {
    try {
      await openFile(result.file_path);
      jumpToLine.set({ path: result.file_path, line: result.line_number });
      paletteSearch.set('');
      searchResults = [];
      searchFocused = false;
      
      const activeInput = document.querySelector('.search-input') as HTMLInputElement;
      if (activeInput) activeInput.blur();
    } catch (err) {
      console.error('Failed to open search result:', err);
      showToast('Failed to open search result', 'error');
    }
  }

  // Go home: return to welcome screen by clearing active workspace
  function goHome() {
    activeWorkspaceId.set(null);
    clearAllStores();
  }

  function goBack() { window.history.back(); }
  function goForward() { window.history.forward(); }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="titlebar" data-tauri-drag-region>

  <!-- Brand -->
  <div class="titlebar-brand">
    <div class="titlebar-icon">
      {#if !iconError}
        <img
          src="/icon.png?v=2"
          alt="Soryq"
          class="titlebar-app-icon"
          onerror={() => iconError = true}
        />
      {:else}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="titlebar-app-icon" aria-hidden="true">
          <rect width="16" height="16" rx="3.5" fill="#1e1b4b"/>
          <polyline points="2.5,10 4.5,8 2.5,6" fill="none" stroke="#8b5cf6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="5.5" y="7.3" width="5" height="1.2" rx="0.6" fill="rgba(255,255,255,0.5)"/>
        </svg>
      {/if}
    </div>
    <span class="titlebar-name">Soryq</span>
  </div>

  <!-- Navigation: Home, Back, Forward -->
  <div class="titlebar-nav">
    <button class="nav-btn" onclick={goHome} aria-label="Go to home" title="Home">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12L12 3l9 9"/>
        <path d="M9 21V12h6v9"/>
      </svg>
    </button>
    <button class="nav-btn" onclick={goBack} aria-label="Go back" title="Back">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
    <button class="nav-btn" onclick={goForward} aria-label="Go forward" title="Forward">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
    {#if $activeWorkspaceId}
      <button
        class="nav-btn toggle-sidebar-btn"
        class:active={$layout.sidebarVisible}
        onclick={toggleSidebar}
        aria-label="Toggle Sidebar"
        title="Toggle File Explorer (Ctrl+B)"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="9" y1="3" x2="9" y2="21"/>
        </svg>
      </button>
    {/if}
  </div>

  <!-- Centre breadcrumb (drag region) -->
  <div class="titlebar-center" data-tauri-drag-region>
    {#if $activeWorkspace}
      <span class="titlebar-project">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 7a2 2 0 012-2h3.586a2 2 0 011.414.586L11.414 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
        </svg>
        {$activeWorkspace.name}{$activeProject ? ` - ${$activeProject.name}` : ''}
      </span>
      {:else}
      <span class="titlebar-no-project">Soryq</span>
    {/if}
  </div>

  <!-- Right side: Search + Settings + Window controls -->
  <div class="titlebar-right">
    <!-- GitHub Button connected to Source Control panel -->
    {#if $activeProjectId}
      <button
        class="github-push-btn"
        class:active={$layout.sidebarVisible && $layout.sidebarTab === 'git'}
        onclick={handleGitButtonClick}
        title="Source Control"
        aria-label="Source Control"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
        </svg>
      </button>
    {/if}

    <!-- Codebase Search bar — opens command palette -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="titlebar-search"
      class:focused={searchFocused}
      onclick={handleSearchClick}
      title={$activeProject ? "Search (Ctrl+Shift+P)" : ($activeWorkspaceId ? "No active folder" : "Filter recent workspaces")}
    >
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <circle cx="11" cy="11" r="8"/>
        <path d="M21 21l-4.35-4.35"/>
      </svg>
      <input
        class="search-input"
        type="text"
        placeholder={$activeProject ? "Ask or search codebase..." : ($activeWorkspaceId ? "No active folder..." : "Filter recent workspaces...")}
        bind:value={$paletteSearch}
        onkeydown={handleSearchKeyDown}
        onclick={handleInputClick}
        onfocus={() => { if ($activeProject) searchFocused = true; }}
        aria-label="Search codebase"
        spellcheck="false"
      />
      {#if $paletteSearch}
        <button
          class="search-clear"
          onclick={(e) => { e.stopPropagation(); paletteSearch.set(''); }}
          aria-label="Clear search"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      {:else}
        <kbd class="search-hint">⌃⇧P</kbd>
      {/if}

      <!-- Search results dropdown overlay -->
      {#if searchFocused && $activeProject}
        <div class="search-results-dropdown" onclick={(e) => e.stopPropagation()}>
          {#if isSearching}
            <div class="dropdown-status">
              <svg class="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                <polyline points="21 3 21 8 16 8"/>
              </svg>
              <span>Searching codebase...</span>
            </div>
          {:else if searchError}
            <div class="dropdown-status error">
              <span>Error: {searchError}</span>
            </div>
          {:else if !$paletteSearch.trim()}
            <div class="dropdown-status">
              <span>Type to search codebase content</span>
            </div>
          {:else if searchResults.length === 0}
            <div class="dropdown-status">
              <span>No matches found</span>
            </div>
          {:else}
            <div class="dropdown-results-list">
              {#each searchResults as result}
                <button class="dropdown-result-item" onclick={() => selectResult(result)}>
                  <div class="result-meta">
                    <span class="result-file" title={result.relative_path}>{result.relative_path}</span>
                    <span class="result-line-number">Line {result.line_number}</span>
                  </div>
                  <div class="result-snippet" title={result.line_content}>{result.line_content}</div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Scratchpad button -->
    <button
      class="icon-btn"
      class:active={$floatingNoteOpen}
      onclick={toggleFloatingNote}
      aria-label="Scratchpad"
      title="Toggle Scratchpad (Ctrl+Shift+N)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    </button>

    <!-- Settings button -->
    <button class="icon-btn" onclick={openSettings} aria-label="Settings" title="Settings (Ctrl+,)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    </button>

    <!-- Window controls -->
    <div class="titlebar-controls">
      <button class="wc-btn wc-min" onclick={minimize} aria-label="Minimize" title="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="wc-btn wc-max" onclick={toggleMaximize} aria-label="Maximize" title="Maximize">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="3" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
          <path d="M4 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="wc-btn wc-close" onclick={close} aria-label="Close" title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    height: 38px;
    background: var(--titlebar-bg);
    border-bottom: 1px solid var(--titlebar-border);
    user-select: none;
    flex-shrink: 0;
    z-index: 100;
  }

  /* Brand */
  .titlebar-brand {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 10px 0 14px;
    -webkit-app-region: no-drag;
    app-region: no-drag;
    z-index: 2;
    flex-shrink: 0;
  }

  .titlebar-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    overflow: hidden;
    background: transparent;
  }

  .titlebar-app-icon {
    width: 18px;
    height: 18px;
    object-fit: contain;
    border-radius: 4px;
  }

  .titlebar-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--titlebar-text);
    letter-spacing: 0.3px;
  }

  /* Navigation buttons */
  .titlebar-nav {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 4px;
    border-right: 1px solid var(--titlebar-border);
    margin-right: 4px;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--titlebar-text);
    opacity: 0.8;
    transition: background 0.15s, color 0.15s, opacity 0.15s;
  }
  .nav-btn:hover {
    background: var(--bg-hover);
    color: var(--titlebar-text);
    opacity: 1;
  }
  .nav-btn.active {
    color: var(--accent);
    background: var(--accent-light);
    opacity: 1;
  }

  /* Center */
  .titlebar-center {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    pointer-events: none;
  }

  .titlebar-project {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-secondary);
    pointer-events: auto;
    -webkit-app-region: no-drag;
  }

  .titlebar-no-project {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
    letter-spacing: 0.5px;
  }

  /* Right side */
  .titlebar-right {
    display: flex;
    align-items: center;
    margin-left: auto;
    gap: 3px;
    -webkit-app-region: no-drag;
    app-region: no-drag;
    z-index: 2;
    padding-right: 0;
  }

  /* Search bar — clicking opens command palette */
  .titlebar-search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 10px;
    height: 26px;
    width: 200px;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: text;
    text-align: left;
  }

  .titlebar-search:hover {
    border-color: var(--accent-hover);
    background: var(--bg-hover);
  }

  .titlebar-search.focused {
    width: 320px;
    border-color: var(--accent);
    background: var(--bg-primary);
    box-shadow: 0 0 0 2px var(--accent-light);
  }

  .search-icon {
    color: var(--titlebar-text);
    flex-shrink: 0;
    opacity: 0.5;
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 11px;
    color: var(--text-primary);
    font-family: inherit;
    min-width: 0;
    cursor: text;
  }

  .search-input::placeholder { color: var(--text-muted); }

  .search-clear {
    display: flex;
    align-items: center;
    color: var(--titlebar-text);
    opacity: 0.7;
    transition: opacity 0.15s, color 0.15s, background 0.15s;
    flex-shrink: 0;
    padding: 2px;
    border-radius: 3px;
  }
  .search-clear:hover {
    opacity: 1;
    color: var(--titlebar-text);
    background: var(--bg-hover);
  }

  .search-hint {
    font-size: 9px;
    color: var(--text-secondary);
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1px 4px;
    font-family: inherit;
    letter-spacing: 0.5px;
    flex-shrink: 0;
    opacity: 0.8;
    pointer-events: none;
  }

  /* ─── Search Results Dropdown Overlay ─── */
  .search-results-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 320px;
    max-height: 380px;
    background: var(--bg-secondary);
    backdrop-filter: blur(12px);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5), 0 1px 1px 0 var(--border) inset;
    z-index: 1000;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    animation: fadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    cursor: default;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .dropdown-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    color: var(--text-muted);
    font-size: 11px;
    width: 100%;
    box-sizing: border-box;
  }

  .dropdown-status.error {
    color: var(--error);
  }

  .dropdown-results-list {
    display: flex;
    flex-direction: column;
    padding: 4px;
    gap: 2px;
  }

  .dropdown-result-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
    width: 100%;
    color: inherit;
  }

  .dropdown-result-item:hover {
    background: var(--bg-hover);
    border-color: var(--border);
  }

  .result-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    gap: 8px;
  }

  .result-file {
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    transition: color 0.15s ease;
  }

  .dropdown-result-item:hover .result-file {
    color: var(--accent-hover);
  }

  .result-line-number {
    font-size: 10px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .result-snippet {
    font-size: 10px;
    color: var(--text-primary);
    font-family: var(--editor-font-family, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
    background: var(--bg-tertiary);
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  /* Icon button (settings) */
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--titlebar-text);
    opacity: 0.8;
    transition: background 0.15s, color 0.15s, opacity 0.15s;
    flex-shrink: 0;
  }
  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--titlebar-text);
    opacity: 1;
  }
  .icon-btn.active {
    background: var(--accent-light);
    color: var(--accent);
    opacity: 1;
  }

  /* ─── Window Controls ─────────────────── */
  .titlebar-controls {
    display: flex;
    align-items: center;
    height: 100%;
    margin-left: 6px;
    /* Subtle separator on the left */
    border-left: 1px solid var(--titlebar-border);
  }

  .wc-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 38px;
    color: var(--titlebar-text);
    opacity: 0.8;
    transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    -webkit-app-region: no-drag;
    app-region: no-drag;
    position: relative;
    flex-shrink: 0;
  }

  .wc-btn:hover {
    color: var(--titlebar-text);
    opacity: 1;
  }

  .wc-min:hover { background: var(--bg-hover); }
  .wc-max:hover { background: var(--bg-hover); }

  .wc-close:hover {
    background: var(--error);
    color: #ffffff;
    opacity: 1;
  }

  /* GitHub Push Button Styles */
  .github-push-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--titlebar-text);
    opacity: 0.8;
    transition: background 0.15s, color 0.15s, opacity 0.15s, transform 0.1s;
    flex-shrink: 0;
  }
  .github-push-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--accent);
    opacity: 1;
  }
  .github-push-btn.active {
    background: var(--bg-hover);
    color: var(--accent);
    opacity: 1;
  }
  .github-push-btn:active:not(:disabled) {
    transform: scale(0.95);
  }
  .github-push-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .spin-icon {
    animation: spin 1s linear infinite;
    color: var(--accent);
  }

  @media (max-width: 800px) {
    .titlebar-search {
      width: 140px;
    }
    .titlebar-search.focused {
      width: 200px;
    }
    .search-hint {
      display: none;
    }
    .titlebar-brand {
      padding: 0 6px 0 10px;
    }
    .titlebar-right {
      gap: 2px;
    }
  }

  @media (max-width: 640px) {
    .titlebar-search {
      width: 36px;
      padding: 0 6px;
    }
    .titlebar-search.focused {
      width: 180px;
      position: absolute;
      right: 100px;
      z-index: 200;
    }
    .github-push-btn {
      display: none;
    }
    .titlebar-nav {
      display: none;
    }
    .titlebar-center {
      display: none;
    }
    .titlebar-right {
      gap: 1px;
    }
  }
</style>
