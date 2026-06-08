<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { activeProject, closeProject, activeProjectId, activeWorkspaceId, activeWorkspace, clearAllStores, saveProjectState } from '$lib/stores/workspace';
  import { layout, toggleSidebar, toggleEditorVisible, toggleTerminal, openQuickCapture } from '$lib/stores/layout';
  import { isOpen as paletteOpen, search as paletteSearch, toggleCommandPalette } from '$lib/stores/commandpalette';
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import { showToast } from '$lib/stores/notification';
  import { openFile, jumpToLine } from '$lib/stores/editor';
  import { canGoBack, canGoForward, navigateBack, navigateForward } from '$lib/stores/navigation';
  import WorkspaceSwitcher from '$lib/components/workspace/WorkspaceSwitcher.svelte';
  import ProjectSwitcher from '$lib/components/workspace/ProjectSwitcher.svelte';

  const win = getCurrentWindow();

  let iconError = $state(false);
  // On macOS, the native traffic-light buttons handle minimize/maximize/close.
  // We detect the platform to hide our custom controls so they don't double up.
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);



  function handleToggleAuxPanel() {
    toggleTerminal();
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
  async function close() {
    const projectId = get(activeProjectId);
    if (projectId) saveProjectState(projectId);
    await win.destroy();
  }

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

  function goHome() {
    // Persist the active project before leaving the workspace so its state
    // (terminals, layout, open files) is restored when the user comes back.
    const pid = get(activeProjectId);
    if (pid) saveProjectState(pid);
    activeWorkspaceId.set(null);
  }

  async function goBack() { await navigateBack(); }
  async function goForward() { await navigateForward(); }
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
    <button class="nav-btn tb-collapse-2" onclick={goBack} disabled={!$canGoBack} aria-label="Go back" title="Back">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
    <button class="nav-btn tb-collapse-2" onclick={goForward} disabled={!$canGoForward} aria-label="Go forward" title="Forward">
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
  <div class="titlebar-center" class:left-align={$activeWorkspace} data-tauri-drag-region>
    {#if $activeWorkspace}
      <div class="titlebar-controls-container" style="display: flex; align-items: center; gap: 8px; pointer-events: auto; -webkit-app-region: no-drag; app-region: no-drag;">
        <WorkspaceSwitcher />
        <div class="tb-divider" style="width: 1px; height: 16px; background: var(--titlebar-border, rgba(255, 255, 255, 0.08)); margin: 0 4px;"></div>
        <ProjectSwitcher />
      </div>
    {/if}
  </div>

  <!-- Right side: Search + Settings + Window controls -->
  <div class="titlebar-right">

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

    <!-- Toggle Right Panel button -->
    {#if $activeWorkspaceId}
      <button
        class="icon-btn"
        class:active={$layout.editorVisible || $layout.previewVisible || $layout.reviewVisible || $layout.httpVisible || $layout.tasksVisible || $layout.dbVisible || $layout.toolboxVisible}
        onclick={handleToggleAuxPanel}
        aria-label="Toggle Right Panel"
        title="Toggle Right Panel"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="15" y1="3" x2="15" y2="21"/>
        </svg>
      </button>
    {/if}

    <!-- Quick Capture button -->
    <button
      class="icon-btn tb-collapse-1"
      onclick={openQuickCapture}
      aria-label="Quick Capture"
      title="Quick Capture (Ctrl+Shift+Space)"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
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
    background: transparent;
    user-select: none;
    flex-shrink: 0;
    z-index: 995; /* Elevate titlebar above panel toolbars (z-index: 100) so search dropdown fits on top, but below main overlays like command palette (z-index: 9999) */
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
  .nav-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--titlebar-text);
    opacity: 1;
  }
  .nav-btn.active {
    color: var(--accent);
    background: var(--accent-light);
    opacity: 1;
  }
  .nav-btn:disabled {
    opacity: 0.35;
    pointer-events: none;
    cursor: default;
  }

  /* Center — a real flex item so it shrinks and truncates between the nav and
     the right-hand controls instead of floating over them (the old absolute
     centring overlapped the search bar at medium widths). */
  .titlebar-center {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    z-index: 1;
    pointer-events: none;
  }

  .titlebar-center.left-align {
    justify-content: flex-start;
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
    flex-shrink: 0;
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
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.4);
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
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), var(--frost-surface, 0.72));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--glass-shadow, 0 16px 36px rgba(0, 0, 0, 0.45)), 
                inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
    z-index: 1000;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    animation: fadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    cursor: default;
  }

  :root.solid-theme .search-results-dropdown {
    background: var(--bg-secondary) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
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
    padding: 6px;
    gap: 3px;
  }

  .dropdown-result-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px 10px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    border-left: 3px solid transparent;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    width: 100%;
    color: inherit;
  }

  .dropdown-result-item:hover {
    background: var(--accent-light);
    border-color: var(--border);
    border-left-color: var(--accent);
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
    opacity: 0.85;
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.45);
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .dropdown-result-item:hover .result-snippet {
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.7);
    border-color: rgba(var(--accent-rgb, 6, 182, 212), 0.25);
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

  /* ─── Responsive: progressively condense the bar as it narrows ───────────
     Controls drop in priority order so the essentials (window controls,
     settings, search access, sidebar toggle, home) survive the longest. Every
     hidden action still has a keyboard shortcut, so nothing becomes unreachable.

     Tier 1 (.tb-collapse-1): note-taking trio — daily note, quick capture,
       scratchpad. First to go.
     Tier 2 (.tb-collapse-2): back/forward nav + source control. Next.
  */

  /* Tighten spacing and trim the search hint + brand label first. */
  @media (max-width: 960px) {
    .titlebar-name {
      display: none;
    }
    .titlebar-brand {
      padding: 0 6px 0 10px;
    }
    .titlebar-right {
      gap: 2px;
    }
    .titlebar-search {
      width: 170px;
    }
    .titlebar-search.focused {
      width: 260px;
    }
    .search-hint {
      display: none;
    }
  }

  /* Drop the note-taking trio; the breadcrumb keeps shrinking/truncating. */
  @media (max-width: 820px) {
    .tb-collapse-1 {
      display: none;
    }
    .titlebar-search {
      width: 150px;
    }
    .titlebar-search.focused {
      width: 240px;
    }
  }

  /* Drop back/forward + source control; shrink the remaining buttons and
     collapse the search to an icon that expands over the bar on focus. */
  @media (max-width: 680px) {
    .tb-collapse-2 {
      display: none;
    }
    .titlebar-center {
      display: none;
    }
    .nav-btn,
    .icon-btn,
    .github-push-btn {
      width: 26px;
      height: 26px;
    }
    .titlebar-nav {
      padding: 0 3px;
      margin-right: 3px;
    }
    .titlebar-search {
      width: 34px;
      padding: 0 6px;
    }
    .titlebar-search.focused {
      width: 200px;
      position: absolute;
      right: 88px;
      z-index: 200;
    }
  }

  /* Bare minimum: home + sidebar toggle stay (core navigation); narrow the
     window controls and tighten the rest so everything still fits. */
  @media (max-width: 520px) {
    .wc-btn {
      width: 38px;
    }
    .icon-btn,
    .nav-btn,
    .github-push-btn {
      width: 24px;
      height: 24px;
    }
    .titlebar-right {
      gap: 0;
    }
    .titlebar-search.focused {
      right: 70px;
    }
  }
</style>
