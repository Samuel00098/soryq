<script lang="ts">
  import TitleBar from './TitleBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import FileExplorer from '$lib/components/explorer/FileExplorer.svelte';
  import ProjectSwitcher from '$lib/components/workspace/ProjectSwitcher.svelte';
  import TerminalPanel from '$lib/components/terminal/TerminalPanel.svelte';
  import EditorPanel from '$lib/components/editor/EditorPanel.svelte';
  import PreviewPanel from '$lib/components/preview/PreviewPanel.svelte';
  import MarkdownPreview from '$lib/components/preview/MarkdownPreview.svelte';
  import WelcomeScreen from '$lib/components/workspace/WelcomeScreen.svelte';

  import { layout, toggleSidebar, setActiveView, toggleEditorSplitPreview, openSettings, setSidebarTab } from '$lib/stores/layout';
  import { activeProject, openProject } from '$lib/stores/workspace';
  import SourceControl from '$lib/components/explorer/SourceControl.svelte';
  import { toggleCommandPalette } from '$lib/stores/commandpalette';
  import { saveActiveFile, formatActiveFile, activeFile, fileCache } from '$lib/stores/editor';
  import { invoke } from '@tauri-apps/api/core';
  import { setTargetPort, startProxy, stopProxy } from '$lib/stores/preview';
  import { userShortcuts, matchShortcut, uiZoom } from '$lib/stores/settings';
  import { createTerminalSession } from '$lib/stores/terminal';

  // Watch active project and automatically detect/open preview
  let lastProjectId = $state<string | null>(null);

  $effect(() => {
    const project = $activeProject;
    if (project) {
      if (project.id !== lastProjectId) {
        lastProjectId = project.id;
        
        // Auto-detect and set up preview (but don't open it)
        (async () => {
          try {
            const port = await invoke<number>('workspace_detect_port', { path: project.root_path });
            await setTargetPort(port);
            await startProxy();
          } catch (err) {
            console.error('Failed to set up preview:', err);
          }
        })();
      }
    } else {
      lastProjectId = null;
    }
  });

  // Sidebar resize state
  let sidebarResizing = $state(false);
  let sidebarStartX = 0;
  let sidebarStartWidth = 0;
  let windowWidth = $state(window.innerWidth);

  // Collapse threshold scales with zoom so at zoom-in the sidebar collapses more eagerly
  const BASE_COLLAPSE_THRESHOLD = 180;

  let effectiveCollapseThreshold = $derived(BASE_COLLAPSE_THRESHOLD * ($uiZoom / 100));

  let tabsCollapsed = $derived($layout.sidebarWidth < effectiveCollapseThreshold);

  let activeFileIsMarkdown = $derived(
    $activeFile !== null && ($activeFile.endsWith('.md') || $activeFile.endsWith('.markdown'))
  );

  let markdownContent = $derived(
    activeFileIsMarkdown ? ($fileCache.get($activeFile!)?.content ?? '') : ''
  );

  // Adjust sidebar width dynamically when screen size changes, and collapse if very narrow screen
  $effect(() => {
    const zoom = $uiZoom;
    // At higher zoom, the effective viewport is smaller, so we need more aggressive collapsing
    const effectiveWindowWidth = windowWidth / (zoom / 100);
    if (effectiveWindowWidth < 640) {
      if ($layout.sidebarWidth >= effectiveCollapseThreshold) {
        layout.update((l) => ({ ...l, sidebarWidth: 48 }));
      }
    } else {
      const maxAllowedWidth = Math.min(600, effectiveWindowWidth - 250);
      if ($layout.sidebarWidth > maxAllowedWidth) {
        layout.update((l) => ({
          ...l,
          sidebarWidth: Math.max(48, maxAllowedWidth),
        }));
      }
    }
  });

  function openSidebarTab(tab: 'files' | 'git') {
    layout.update((l) => ({
      ...l,
      sidebarVisible: true,
      sidebarWidth: l.sidebarWidth < effectiveCollapseThreshold ? 260 : l.sidebarWidth,
      sidebarTab: tab
    }));
  }

  function onSidebarMouseDown(e: MouseEvent) {
    sidebarResizing = true;
    sidebarStartX = e.clientX;
    sidebarStartWidth = $layout.sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onMouseMove(e: MouseEvent) {
    if (!sidebarResizing) return;
    const delta = e.clientX - sidebarStartX;
    const maxAllowedWidth = Math.min(600, windowWidth - 250);
    layout.update((l) => ({
      ...l,
      sidebarWidth: Math.max(48, Math.min(maxAllowedWidth, sidebarStartWidth + delta)),
    }));
  }

  function onMouseUp() {
    sidebarResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  function handleKeyDown(e: KeyboardEvent) {
    const activeShortcuts = $userShortcuts || [];
    const matched = activeShortcuts.find(s => s && matchShortcut(e, s.keys));
    if (matched) {
      e.preventDefault();
      switch (matched.id) {
        case 'commandPalette':
          toggleCommandPalette();
          break;
        case 'openSettings':
          openSettings();
          break;
        case 'goToTerminal':
          setActiveView('terminal');
          break;
        case 'goToEditor':
          setActiveView('editor');
          break;
        case 'goToPreview':
          setActiveView('preview');
          break;
        case 'toggleSidebar':
          toggleSidebar();
          break;
        case 'saveFile':
          saveActiveFile();
          break;
        case 'openFolder':
          openProject();
          break;
        case 'newTerminal':
          setActiveView('terminal');
          createTerminalSession();
          break;
        case 'splitPreview':
          toggleEditorSplitPreview();
          break;
        case 'formatDocument':
          formatActiveFile();
          break;
        case 'startProxy':
          startProxy();
          break;
        case 'stopProxy':
          stopProxy();
          break;
      }
    }
  }
</script>

<svelte:window bind:innerWidth={windowWidth} onmousemove={onMouseMove} onmouseup={onMouseUp} onkeydown={handleKeyDown} />

<div class="app-shell">
  <TitleBar />

  <div class="zoom-wrapper">
  {#if $activeProject}
    <!-- Project is open: show full workspace -->
    <div class="zoom-content">
    <div class="app-body" class:resizing={sidebarResizing}>
      {#if sidebarResizing}
        <div class="resize-overlay"></div>
      {/if}
      <!-- Sidebar with view tabs above explorer -->
      {#if $layout.sidebarVisible}
        <div
          class="sidebar"
          class:collapsed={tabsCollapsed}
          style="width: {tabsCollapsed ? 48 : $layout.sidebarWidth}px; min-width: {tabsCollapsed ? 48 : $layout.sidebarWidth}px;"
        >
          <!-- Project tabs (hide when very narrow) -->
          {#if !tabsCollapsed}
            <ProjectSwitcher />
          {/if}

          <!-- View Tabs: icons-only when narrow, icon+label when wide -->
          <div class="sidebar-view-tabs" class:tabs-icon-only={tabsCollapsed}>
            {#if tabsCollapsed}
              <button
                class="svt-btn"
                class:svt-active={$layout.sidebarTab === 'files'}
                onclick={() => openSidebarTab('files')}
                title="Files"
                aria-label="Files"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h3.586a2 2 0 0 1 1.414.586L11.414 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
                </svg>
              </button>
              <button
                class="svt-btn"
                class:svt-active={$layout.sidebarTab === 'git'}
                onclick={() => openSidebarTab('git')}
                title="Source Control"
                aria-label="Source Control"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="18" cy="18" r="3"/>
                  <circle cx="6" cy="6" r="3"/>
                  <circle cx="6" cy="18" r="3"/>
                  <path d="M18 15V9a4 4 0 0 0-4-4H9"/>
                  <line x1="6" y1="9" x2="6" y2="15"/>
                </svg>
              </button>
              <div class="svt-separator"></div>
            {/if}

            <button
              class="svt-btn"
              class:svt-active={$layout.activeView === 'editor'}
              onclick={() => setActiveView('editor')}
              title="Editor"
              aria-label="Editor"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              {#if !tabsCollapsed}<span>Editor</span>{/if}
            </button>
            <button
              class="svt-btn"
              class:svt-active={$layout.activeView === 'terminal'}
              onclick={() => setActiveView('terminal')}
              title="Terminal"
              aria-label="Terminal"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="18" rx="3"/>
                <polyline points="8,9 4,12 8,15"/>
                <line x1="12" y1="15" x2="20" y2="15"/>
              </svg>
              {#if !tabsCollapsed}<span>Terminal</span>{/if}
            </button>
            <button
              class="svt-btn"
              class:svt-active={$layout.activeView === 'preview'}
              onclick={() => setActiveView('preview')}
              title="Preview"
              aria-label="Preview"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
              {#if !tabsCollapsed}<span>Preview</span>{/if}
            </button>
          </div>

          <!-- Section Header (hide when very narrow) -->
          {#if !tabsCollapsed}
            <div class="sidebar-header">
              <span class="sidebar-section-label">{$activeProject.name}</span>
            </div>

            <div class="sidebar-header-tabs">
              <button
                class="sidebar-tab"
                class:active={$layout.sidebarTab === 'files'}
                onclick={() => setSidebarTab('files')}
                title="Files"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 7a2 2 0 012-2h3.586a2 2 0 011.414.586L11.414 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
                </svg>
                <span>Files</span>
              </button>
              <button
                class="sidebar-tab"
                class:active={$layout.sidebarTab === 'git'}
                onclick={() => setSidebarTab('git')}
                title="Source Control"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="18" cy="18" r="3"/>
                  <circle cx="6" cy="6" r="3"/>
                  <circle cx="6" cy="18" r="3"/>
                  <path d="M18 15V9a4 4 0 0 0-4-4H9"/>
                  <line x1="6" y1="9" x2="6" y2="15"/>
                </svg>
                <span>Source Control</span>
              </button>
            </div>
          {/if}

          <!-- File Tree / Source Control (hide when icon-only) -->
          {#if !tabsCollapsed}
            <div class="sidebar-content">
              {#if $layout.sidebarTab === 'files'}
                <FileExplorer />
              {:else if $layout.sidebarTab === 'git'}
                <SourceControl />
              {/if}
            </div>
          {/if}
        </div>

        <!-- Resize Handle -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="sidebar-resize-handle"
          class:resizing={sidebarResizing}
          onmousedown={onSidebarMouseDown}
          role="separator"
          aria-label="Resize sidebar"
        ></div>
      {/if}

      <!-- Main Content Area -->
      <div class="main-content" class:pointer-none={sidebarResizing}>
        <!-- Editor View -->
        <div class="view-editor" class:split={$layout.editorSplitPreview} class:hidden={$layout.activeView !== 'editor'}>
          <div class="editor-pane">
            <EditorPanel />
          </div>
          {#if $layout.editorSplitPreview}
            <div class="split-divider"></div>
            <div class="preview-pane">
              {#if activeFileIsMarkdown}
                <MarkdownPreview content={markdownContent} />
              {:else}
                <PreviewPanel />
              {/if}
            </div>
          {/if}
        </div>

        <!-- Terminal View -->
        <div class="view-fill" class:hidden={$layout.activeView !== 'terminal'}>
          <TerminalPanel />
        </div>

        <!-- Standalone Preview View -->
        <div class="view-fill" class:hidden={$layout.activeView !== 'preview'}>
          {#if activeFileIsMarkdown}
            <MarkdownPreview content={markdownContent} />
          {:else}
            <PreviewPanel />
          {/if}
        </div>
      </div>
    </div>

    </div>
  {:else}
    <!-- No project: full-page welcome -->
    <div class="zoom-content">
    <div class="welcome-fullpage">
      <WelcomeScreen />
    </div>
    </div>
  {/if}
  </div>

  <StatusBar />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .zoom-wrapper {
    flex: 1;
    overflow: hidden;
    display: flex;
    min-height: 0;
  }

  .zoom-content {
    --zoom-factor: calc(var(--ui-zoom-percent, 100) / 100);
    width: calc(100% / var(--zoom-factor));
    height: calc(100% / var(--zoom-factor));
    transform: scale(var(--zoom-factor));
    transform-origin: top left;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }

  .app-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  /* Prevent iframe/canvas stealing events during resize */
  .app-body.resizing .main-content {
    pointer-events: none;
  }

  .welcome-fullpage {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  /* ─── Sidebar ─────────────────────────── */
  .sidebar {
    background: var(--sidebar-bg);
    border-right: 1px solid var(--sidebar-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
    /* Ensure sidebar never expands into the main area */
    max-width: 600px;
    transition: none; /* no transition during drag */
  }

  /* View Tabs above the file explorer */
  .sidebar-view-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 5px 6px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    background: var(--sidebar-bg);
    overflow: hidden;
  }

  /* Icon-only mode: center icons vertically */
  .sidebar-view-tabs.tabs-icon-only {
    flex-direction: column;
    padding: 6px 4px;
    gap: 4px;
    border-bottom: none;
    border-right: none;
    align-items: center;
  }

  .svt-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 0;
    position: relative;
  }

  /* Left border indicator for active panel view */
  .svt-btn::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%) scaleY(0);
    width: 2.5px;
    height: 12px;
    background: var(--accent);
    border-radius: 0 3px 3px 0;
    transition: transform 0.2s;
  }

  /* Adjust indicator for icon-only mode */
  .tabs-icon-only .svt-btn::before {
    left: 0;
    height: 14px;
  }

  .svt-btn.svt-active::before {
    transform: translateY(-50%) scaleY(1);
  }

  /* Icon-only: square buttons */
  .tabs-icon-only .svt-btn {
    padding: 7px;
    width: 34px;
    height: 34px;
    justify-content: center;
  }

  .svt-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .svt-btn.svt-active {
    color: var(--text-primary);
    background: var(--bg-active);
  }

  .svt-separator {
    width: 20px;
    height: 1px;
    background: var(--border-subtle);
    margin: 4px 0;
    flex-shrink: 0;
  }

  .sidebar-header {
    height: 28px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    flex-shrink: 0;
  }

  .sidebar-header-tabs {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--sidebar-bg);
    padding: 0 8px;
    height: 32px;
    flex-shrink: 0;
    gap: 4px;
  }

  .sidebar-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    height: 24px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
    min-width: 0;
  }

  .sidebar-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .sidebar-tab.active {
    color: var(--text-primary);
    background: var(--bg-active);
    font-weight: 500;
  }

  .sidebar-section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidebar-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    overscroll-behavior: none;
  }

  /* Resize handle */
  .sidebar-resize-handle {
    width: 3px;
    cursor: col-resize;
    background: transparent;
    transition: background-color 0.15s;
    flex-shrink: 0;
    z-index: 20;
    position: relative;
  }

  .sidebar-resize-handle::after {
    content: '';
    position: absolute;
    left: 1px;
    top: 0;
    width: 1px;
    height: 100%;
    background: var(--border);
    transition: background-color 0.15s, box-shadow 0.15s;
  }

  .sidebar-resize-handle:hover::after,
  .sidebar-resize-handle.resizing::after {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
  }

  /* ─── Main Content ────────────────────── */
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--editor-bg);
    min-width: 0;
  }

  /* ─── Views ───────────────────────────── */
  .view-fill {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .view-editor {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .editor-pane {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .split-divider {
    width: 4px;
    background: var(--border);
    flex-shrink: 0;
    cursor: col-resize;
  }

  .preview-pane {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .resize-overlay {
    position: absolute;
    inset: 0;
    z-index: 9999;
    cursor: col-resize;
    background: transparent;
  }

  .hidden {
    display: none !important;
  }

  @media (max-width: 640px) {
    .sidebar {
      width: 48px !important;
      min-width: 48px !important;
    }
    .sidebar-header,
    .sidebar-header-tabs,
    .sidebar-content {
      display: none !important;
    }
    .sidebar-view-tabs {
      flex-direction: column;
      padding: 6px 4px;
      gap: 4px;
      border-bottom: none;
      align-items: center;
    }
    .sidebar-view-tabs .svt-btn span {
      display: none;
    }
  }
</style>
