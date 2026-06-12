<script lang="ts">
  import TitleBar from './TitleBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import FileExplorer from '$lib/components/explorer/FileExplorer.svelte';
  import SearchPanel from '$lib/components/explorer/SearchPanel.svelte';
  import ProjectSwitcher from '$lib/components/workspace/ProjectSwitcher.svelte';
  import WorkspaceSwitcher from '$lib/components/workspace/WorkspaceSwitcher.svelte';
  import TerminalPanel from '$lib/components/terminal/TerminalPanel.svelte';
  import EditorPanel from '$lib/components/editor/EditorPanel.svelte';
  import PreviewPanel from '$lib/components/preview/PreviewPanel.svelte';
  import WelcomeScreen from '$lib/components/workspace/WelcomeScreen.svelte';
  import ReviewPanel from '$lib/components/review/ReviewPanel.svelte';
  import TasksPanel from '$lib/components/workspace/TasksPanel.svelte';
  import SnapshotsPanel from '$lib/components/layout/SnapshotsPanel.svelte';
  import TerminalSnippetsPanel from '$lib/components/explorer/TerminalSnippetsPanel.svelte';
  import AgentCommandCenter from '$lib/components/terminal/AgentCommandCenter.svelte';
  import { agentCenterOpen } from '$lib/stores/orchestrator';
  import HttpClientPanel from '$lib/components/http/HttpClientPanel.svelte';
  import FloatingPromptBar from '$lib/components/terminal/FloatingPromptBar.svelte';
  import UpdateBanner from '$lib/components/shared/UpdateBanner.svelte';
  import DbExplorerPanel from '$lib/components/db/DbExplorerPanel.svelte';
  // Developer workspace panels
  import ToolboxPanel from '$lib/components/toolbox/ToolboxPanel.svelte';
  import DevPetPanel from '$lib/components/pet/DevPetPanel.svelte';
  import { checkForUpdate } from '$lib/stores/updater';
  import { fly } from 'svelte/transition';

  import { layout, toggleSidebar, setActiveView, toggleEditorSplitPreview, openSettings, toggleSidebarTab, toggleEditorVisible, togglePreviewVisible, toggleTerminal, toggleReviewVisible, toggleHttpVisible, toggleTasksVisible, toggleDbVisible, toggleToolboxVisible, openQuickCapture, openEnvManager } from '$lib/stores/layout';
  import { initNavigationHistory } from '$lib/stores/navigation';
  import SketchCanvas from '$lib/components/workspace/SketchCanvas.svelte';
  import { sketchCanvasOpen, toggleSketchCanvas } from '$lib/stores/sketch';
  import { openDailyNote } from '$lib/stores/dailyNote';
  import { activeProject, openProject, activeWorkspaceId, newWorkspacePromptOpen, isProjectSwitching } from '$lib/stores/workspace';
  import SourceControl from '$lib/components/explorer/SourceControl.svelte';
  import { toggleCommandPalette } from '$lib/stores/commandpalette';
  import { saveActiveFile, formatActiveFile, activeFile, fileCache } from '$lib/stores/editor';
  import { startProxy, stopProxy } from '$lib/stores/preview';
  import { userShortcuts, matchShortcut, uiZoom } from '$lib/stores/settings';
  import { createTerminalSession, focusPromptBar, launchPromptBarVoiceMode } from '$lib/stores/terminal';

  // Sidebar resize state
  let sidebarResizing = $state(false);
  let sidebarStartX = 0;
  let sidebarStartWidth = 0;
  let windowWidth = $state(window.innerWidth);

  // Auxiliary panel resize state — initialised from layout store, synced back on mouse-up
  let auxPanelWidth = $state($layout.auxPanelWidth);
  let auxEditorHeight = $state($layout.auxEditorHeight);
  let auxResizing = $state(false);
  let auxRowResizing = $state(false);

  // Keep local state in sync when the active project changes (project switch restores layout)
  $effect(() => {
    auxPanelWidth = $layout.auxPanelWidth;
    auxEditorHeight = $layout.auxEditorHeight;
  });

  let auxStartX = 0;
  let auxStartWidth = 0;
  let auxStartY = 0;
  let auxStartHeight = 0;

  // Aux panel tabs collapse to icon-only when the panel is too narrow for labels
  let auxTabsNarrow = $derived(auxPanelWidth < 300);

  // Edge-fade affordance for the horizontally-scrollable aux tab bar: fade the
  // left/right edge only when there are more tabs hidden that way, so the masks
  // stay pinned ("sticky") to the container edges as the tabs scroll under them.
  let auxFadeLeft = $state(false);
  let auxFadeRight = $state(false);
  function auxTabsScrollFade(node: HTMLElement, _deps?: unknown) {
    const measure = () => {
      const max = node.scrollWidth - node.clientWidth;
      auxFadeLeft = node.scrollLeft > 1;
      auxFadeRight = max > 1 && node.scrollLeft < max - 1;
    };
    const schedule = () => requestAnimationFrame(measure);
    schedule();
    node.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(node);
    return {
      update() { schedule(); }, // re-measure when icon-only / width changes
      destroy() {
        node.removeEventListener('scroll', measure);
        ro.disconnect();
      },
    };
  }

  const sidebarTabsList = ['files', 'git', 'snapshots', 'snippets'];
  let activeTabIdx = $derived(sidebarTabsList.indexOf($layout.sidebarTab));

  let visiblePanels = $derived([
    { id: 'editor', visible: $layout.editorVisible },
    { id: 'preview', visible: $layout.previewVisible },
    { id: 'review', visible: $layout.reviewVisible },
    { id: 'http', visible: $layout.httpVisible },
    { id: 'tasks', visible: $layout.tasksVisible },
    { id: 'db', visible: $layout.dbVisible },
    { id: 'toolbox', visible: $layout.toolboxVisible },
    { id: 'pet', visible: $layout.petVisible },
  ].filter(p => p.visible));

  let firstPanelId = $derived(visiblePanels[0]?.id);
  let secondPanelId = $derived(visiblePanels[1]?.id);
  let thirdPanelId = $derived(visiblePanels[2]?.id);

  // Adjust sidebar width dynamically when screen size changes, and close panel if very narrow screen
  $effect(() => {
    if (windowWidth < 500 || (typeof document !== 'undefined' && document.hidden)) return;
    const zoom = $uiZoom;
    const effectiveWindowWidth = windowWidth / (zoom / 100);
    if (effectiveWindowWidth < 640) {
      if ($layout.sidebarVisible) {
        layout.update((l) => ({ ...l, sidebarVisible: false }));
      }
    } else {
      const maxAllowedWidth = Math.min(600, effectiveWindowWidth - 250 - 48);
      if ($layout.sidebarWidth > maxAllowedWidth) {
        layout.update((l) => ({
          ...l,
          sidebarWidth: Math.max(180, maxAllowedWidth),
        }));
      }
    }
  });

  // Horizontal space the aux panel may occupy before the flex row overflows its
  // `overflow: hidden` container and gets clipped on the right. Beyond the
  // activity bar + sidebar, it must also reserve the terminal's min-width (250)
  // and the surrounding chrome: app-body padding (24px) plus the inter-panel
  // gaps and resize handles (~36px). Under-reserving here is what cut the panel
  // off on smaller windows.
  function auxMaxWidth(): number {
    const zoom = $uiZoom / 100;
    const sidebar = 48 + ($layout.sidebarVisible ? $layout.sidebarWidth : 0);
    const TERMINAL_MIN = 250;
    const CHROME = 60;
    return (windowWidth / zoom) - sidebar - TERMINAL_MIN - CHROME;
  }

  // Clamp auxiliary panel width dynamically when screen size, zoom, or sidebar changes
  $effect(() => {
    if (windowWidth < 500 || (typeof document !== 'undefined' && document.hidden)) return;
    const maxAllowedWidth = auxMaxWidth();
    if (($layout.editorVisible || $layout.previewVisible || $layout.reviewVisible || $layout.httpVisible || $layout.tasksVisible || $layout.dbVisible || $layout.toolboxVisible || $layout.petVisible) && auxPanelWidth > maxAllowedWidth) {
      auxPanelWidth = Math.max(200, maxAllowedWidth);
    }
  });

  function onSidebarMouseDown(e: MouseEvent) {
    sidebarResizing = true;
    sidebarStartX = e.clientX;
    sidebarStartWidth = $layout.sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onAuxMouseDown(e: MouseEvent) {
    auxResizing = true;
    auxStartX = e.clientX;
    auxStartWidth = auxPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onAuxRowMouseDown(e: MouseEvent) {
    auxRowResizing = true;
    auxStartY = e.clientY;
    auxStartHeight = auxEditorHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }

  function onMouseMove(e: MouseEvent) {
    const zoom = $uiZoom / 100;
    if (sidebarResizing) {
      const delta = (e.clientX - sidebarStartX) / zoom;
      const maxAllowedWidth = Math.min(600, (windowWidth / zoom) - 250 - 48);
      layout.update((l) => ({
        ...l,
        sidebarWidth: Math.max(180, Math.min(maxAllowedWidth, sidebarStartWidth + delta)),
      }));
    } else if (auxResizing) {
      const delta = (e.clientX - auxStartX) / zoom;
      const nextWidth = auxStartWidth - delta;
      const maxAllowedWidth = auxMaxWidth();
      auxPanelWidth = Math.max(200, Math.min(maxAllowedWidth, nextWidth));
    } else if (auxRowResizing) {
      const deltaY = (e.clientY - auxStartY) / zoom;
      const container = document.querySelector('.auxiliary-panel');
      if (container) {
        const totalHeight = container.clientHeight;
        if (totalHeight > 0) {
          const deltaPercent = (deltaY / totalHeight) * 100;
          auxEditorHeight = Math.max(10, Math.min(90, auxStartHeight + deltaPercent));
        }
      }
    }
  }

  function onMouseUp() {
    const wasAuxResize = auxResizing || auxRowResizing;
    sidebarResizing = false;
    auxResizing = false;
    auxRowResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Persist panel dimensions to the layout store so they're saved per-project
    if (wasAuxResize) {
      layout.update((l) => ({ ...l, auxPanelWidth, auxEditorHeight }));
    }
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
        case 'newWorkspace':
          newWorkspacePromptOpen.set(true);
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
        case 'openSearch':
          toggleSidebarTab('search');
          break;
        case 'openEnvManager':
          openEnvManager();
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
        case 'quickCapture':
          openQuickCapture();
          break;
        case 'openDailyNote':
          if ($activeProject) openDailyNote($activeProject, true).catch(() => {});
          break;
        case 'toggleSketch':
          toggleSketchCanvas();
          break;
        case 'openPromptBar':
          focusPromptBar();
          break;
        case 'launchVoiceMode':
          launchPromptBarVoiceMode();
          break;
      }
    }
  }

  // Check for updates 5s after launch so it doesn't block startup
  $effect(() => {
    const t = setTimeout(() => {
      void checkForUpdate().catch(() => {});
    }, 5000);
    return () => clearTimeout(t);
  });
</script>

<svelte:window bind:innerWidth={windowWidth} onmousemove={onMouseMove} onmouseup={onMouseUp} onkeydown={handleKeyDown} />

<div class="app-shell">
  <TitleBar />
  <UpdateBanner />

  <div class="zoom-wrapper">
  {#if $activeWorkspaceId}
    <!-- Project is open: show full workspace -->
    <div class="zoom-content">
    <div class="app-body" class:resizing={sidebarResizing || auxResizing || auxRowResizing}>
      {#if sidebarResizing || auxResizing || auxRowResizing}
        <div class="resize-overlay" class:row-resize={auxRowResizing}></div>
      {/if}
      <!-- Left Activity Bar (always visible) -->
      <div class="activity-bar bento-card">
        <div class="activity-bar-tabs">
          <button
            class="svt-btn"
            class:svt-active={$layout.sidebarVisible && $layout.sidebarTab === 'files'}
            onclick={() => toggleSidebarTab('files')}
            title="Files"
            aria-label="Files"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h3.586a2 2 0 0 1 1.414.586L11.414 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.sidebarVisible && $layout.sidebarTab === 'search'}
            onclick={() => toggleSidebarTab('search')}
            title="Search"
            aria-label="Search"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <path d="M21 21l-4.3-4.3"/>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.sidebarVisible && $layout.sidebarTab === 'git'}
            onclick={() => toggleSidebarTab('git')}
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
          <button
            class="svt-btn"
            class:svt-active={$layout.sidebarVisible && $layout.sidebarTab === 'snapshots'}
            onclick={() => toggleSidebarTab('snapshots')}
            title="Workspace Snapshots"
            aria-label="Workspace Snapshots"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <path d="M8 21h8M12 17v4"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.sidebarVisible && $layout.sidebarTab === 'snippets'}
            onclick={() => toggleSidebarTab('snippets')}
            title="Shell Snippets"
            aria-label="Shell Snippets"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 17l6-6-6-6M12 19h8"/>
            </svg>
          </button>
          <div class="svt-separator"></div>

          <button
            class="svt-btn"
            class:svt-active={$layout.editorVisible}
            onclick={toggleEditorVisible}
            title="Editor"
            aria-label="Editor"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.activeView === 'terminal'}
            onclick={toggleTerminal}
            title="Terminal"
            aria-label="Terminal"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="18" rx="3"/>
              <polyline points="8,9 4,12 8,15"/>
              <line x1="12" y1="15" x2="20" y2="15"/>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.previewVisible}
            onclick={togglePreviewVisible}
            title="Preview"
            aria-label="Preview"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
              <path d="M2 12h20"/>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.reviewVisible}
            onclick={toggleReviewVisible}
            title="Code Review"
            aria-label="Code Review"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="18" r="3"/>
              <circle cx="6" cy="6" r="3"/>
              <path d="M13 6h3a2 2 0 0 1 2 2v7"/>
              <path d="M11 18H8a2 2 0 0 1-2-2V9"/>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.httpVisible}
            onclick={toggleHttpVisible}
            title="HTTP Client"
            aria-label="HTTP Client"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.tasksVisible}
            onclick={toggleTasksVisible}
            title="Tasks"
            aria-label="Tasks"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="5" height="18" rx="1"/>
              <rect x="10" y="3" width="5" height="12" rx="1"/>
              <rect x="17" y="3" width="5" height="8" rx="1"/>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.dbVisible}
            onclick={toggleDbVisible}
            title="Database Explorer"
            aria-label="Database Explorer"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
              <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
            </svg>
          </button>
          <button
            class="svt-btn"
            class:svt-active={$layout.toolboxVisible}
            onclick={toggleToolboxVisible}
            title="Dev Toolbox"
            aria-label="Dev Toolbox"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
            </svg>
          </button>
        </div>

        <div class="activity-bar-bottom">
          <button
            class="svt-btn"
            class:svt-active={$sketchCanvasOpen}
            onclick={toggleSketchCanvas}
            title="Toggle Sketch Canvas (Ctrl+Shift+N)"
            aria-label="Sketch Canvas"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          {#if $activeProject}
            <button
              class="svt-btn"
              onclick={() => openDailyNote($activeProject!, true).catch(() => {})}
              title="Open Today's Note (Ctrl+Shift+D)"
              aria-label="Open Daily Note"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
                <line x1="8" y1="15" x2="16" y2="15"/>
              </svg>
            </button>
          {/if}
          <button
            class="svt-btn"
            onclick={openSettings}
            title="Settings (Ctrl+,)"
            aria-label="Settings"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Collapsible Sidebar Panel -->
      {#if $layout.sidebarVisible}
        <div
          class="sidebar bento-card"
          style="width: {$layout.sidebarWidth}px; min-width: 180px;"
        >
          <div class="sidebar-content">
            {#if $layout.sidebarTab === 'files'}
              <FileExplorer />
            {:else if $layout.sidebarTab === 'search'}
              <SearchPanel />
            {:else if $layout.sidebarTab === 'git'}
              <SourceControl />
            {:else if $layout.sidebarTab === 'snapshots'}
              <SnapshotsPanel />
            {:else if $layout.sidebarTab === 'snippets'}
              <TerminalSnippetsPanel />
            {/if}
          </div>
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
        <div
          class="main-content"
          class:has-aux-panel={visiblePanels.length > 0}
          class:pointer-none={sidebarResizing || auxResizing || auxRowResizing}
        >
          <!-- Left Pane: Terminal Panel (always visible, resizing dynamically) -->
          <div class="terminal-container bento-card" class:active-glow={$layout.activeView === 'terminal'}>
            <TerminalPanel />
            {#if $isProjectSwitching}
              <div class="project-switch-overlay"></div>
            {/if}
          </div>

        <!-- If any auxiliary panel is visible, show the resize divider and the right auxiliary panel -->
        {#if $layout.editorVisible || $layout.previewVisible || $layout.reviewVisible || $layout.httpVisible || $layout.tasksVisible || $layout.dbVisible || $layout.toolboxVisible || $layout.petVisible}
          <!-- Vertical Resize Handle between Terminal and Auxiliary Panel -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="aux-resize-handle"
            class:resizing={auxResizing}
            onmousedown={onAuxMouseDown}
            role="separator"
            aria-label="Resize panels"
          ></div>

          <!-- Right Auxiliary Panel -->
          <div 
            class="auxiliary-panel bento-card" 
            class:active-glow={$layout.activeView !== 'terminal'}
            style="width: {auxPanelWidth}px; min-width: 200px;"
            transition:fly={{ x: 150, duration: 220 }}
          >
            <!-- Close Panel Button -->
            <button
              class="aux-close-btn"
              onclick={toggleTerminal}
              title="Close panel"
              aria-label="Close panel"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            <!-- Auxiliary Sidebar Tabs -->
            <div
              class="aux-tabs-bar"
              class:icon-only={auxTabsNarrow}
              class:fade-left={auxFadeLeft}
              class:fade-right={auxFadeRight}
              use:auxTabsScrollFade={auxTabsNarrow}
            >
              <button
                class="aux-tab"
                class:active={$layout.editorVisible}
                onclick={() => setActiveView('editor')}
                title="Editor"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                <span>Editor</span>
              </button>
              <button
                class="aux-tab"
                class:active={$layout.previewVisible}
                onclick={() => setActiveView('preview')}
                title="Browser Preview"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 2a14.5 14.5 0 000 20 14.5 14.5 0 000-20"/>
                  <path d="M2 12h20"/>
                </svg>
                <span>Preview</span>
              </button>
              <button
                class="aux-tab"
                class:active={$layout.reviewVisible}
                onclick={() => setActiveView('review')}
                title="AI Review"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
                </svg>
                <span>Review</span>
              </button>
              <button
                class="aux-tab"
                class:active={$layout.httpVisible}
                onclick={() => setActiveView('http')}
                title="HTTP Client"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                <span>HTTP Client</span>
              </button>
              <button
                class="aux-tab"
                class:active={$layout.tasksVisible}
                onclick={() => setActiveView('tasks')}
                title="Tasks"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="5" height="18" rx="1"/>
                  <rect x="10" y="3" width="5" height="12" rx="1"/>
                  <rect x="17" y="3" width="5" height="8" rx="1"/>
                </svg>
                <span>Tasks</span>
              </button>
              <button
                class="aux-tab"
                class:active={$layout.dbVisible}
                onclick={() => setActiveView('db')}
                title="Database Explorer"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                  <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
                </svg>
                <span>Database</span>
              </button>
              <button
                class="aux-tab"
                class:active={$layout.toolboxVisible}
                onclick={() => setActiveView('toolbox')}
                title="Dev Toolbox"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
                </svg>
                <span>Toolbox</span>
              </button>
              <button
                class="aux-tab"
                class:active={$layout.petVisible}
                onclick={() => setActiveView('pet')}
                title="DevPet Playground"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
                <span>DevPet</span>
              </button>
            </div>

            <div class="aux-content-area">
              {#if visiblePanels.length === 3}
                <!-- Three panels: split equally in thirds -->
                <div class="aux-pane split-pane-third" style="height: 33.3%; min-height: 10%;">
                  {#if firstPanelId === 'editor'}
                    <EditorPanel />
                  {:else if firstPanelId === 'preview'}
                    <PreviewPanel />
                  {:else if firstPanelId === 'review'}
                    <ReviewPanel />
                  {:else if firstPanelId === 'http'}
                    <HttpClientPanel />
                  {:else if firstPanelId === 'tasks'}
                    <TasksPanel />
                  {:else if firstPanelId === 'db'}
                    <DbExplorerPanel />
                  {:else if firstPanelId === 'toolbox'}
                    <ToolboxPanel />
                  {:else if firstPanelId === 'pet'}
                    <DevPetPanel />
                  {/if}
                </div>
                <div class="aux-separator-line"></div>
                <div class="aux-pane split-pane-third" style="height: 33.3%; min-height: 10%;">
                  {#if secondPanelId === 'editor'}
                    <EditorPanel />
                  {:else if secondPanelId === 'preview'}
                    <PreviewPanel />
                  {:else if secondPanelId === 'review'}
                    <ReviewPanel />
                  {:else if secondPanelId === 'http'}
                    <HttpClientPanel />
                  {:else if secondPanelId === 'tasks'}
                    <TasksPanel />
                  {:else if secondPanelId === 'db'}
                    <DbExplorerPanel />
                  {:else if secondPanelId === 'toolbox'}
                    <ToolboxPanel />
                  {:else if secondPanelId === 'pet'}
                    <DevPetPanel />
                  {/if}
                </div>
                <div class="aux-separator-line"></div>
                <div class="aux-pane split-pane-third" style="height: 33.4%; min-height: 10%;">
                  {#if thirdPanelId === 'editor'}
                    <EditorPanel />
                  {:else if thirdPanelId === 'preview'}
                    <PreviewPanel />
                  {:else if thirdPanelId === 'review'}
                    <ReviewPanel />
                  {:else if thirdPanelId === 'http'}
                    <HttpClientPanel />
                  {:else if thirdPanelId === 'tasks'}
                    <TasksPanel />
                  {:else if thirdPanelId === 'db'}
                    <DbExplorerPanel />
                  {:else if thirdPanelId === 'toolbox'}
                    <ToolboxPanel />
                  {:else if thirdPanelId === 'pet'}
                    <DevPetPanel />
                  {/if}
                </div>
              {:else if visiblePanels.length === 2}
                <!-- Two panels: resizable split layout -->
                <div class="aux-pane split-pane-top" style="height: {auxEditorHeight}%; min-height: 10%;">
                  {#if firstPanelId === 'editor'}
                    <EditorPanel />
                  {:else if firstPanelId === 'preview'}
                    <PreviewPanel />
                  {:else if firstPanelId === 'review'}
                    <ReviewPanel />
                  {:else if firstPanelId === 'http'}
                    <HttpClientPanel />
                  {:else if firstPanelId === 'tasks'}
                    <TasksPanel />
                  {:else if firstPanelId === 'db'}
                    <DbExplorerPanel />
                  {:else if firstPanelId === 'toolbox'}
                    <ToolboxPanel />
                  {:else if firstPanelId === 'pet'}
                    <DevPetPanel />
                  {/if}
                </div>

                <!-- Horizontal Split Resize Handle -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                  class="aux-row-resize-handle"
                  class:resizing={auxRowResizing}
                  onmousedown={onAuxRowMouseDown}
                  role="separator"
                  aria-label="Resize panels"
                ></div>

                <div class="aux-pane split-pane-bottom" style="height: {100 - auxEditorHeight}%; min-height: 10%;">
                  {#if secondPanelId === 'editor'}
                    <EditorPanel />
                  {:else if secondPanelId === 'preview'}
                    <PreviewPanel />
                  {:else if secondPanelId === 'review'}
                    <ReviewPanel />
                  {:else if secondPanelId === 'http'}
                    <HttpClientPanel />
                  {:else if secondPanelId === 'tasks'}
                    <TasksPanel />
                  {:else if secondPanelId === 'db'}
                    <DbExplorerPanel />
                  {:else if secondPanelId === 'toolbox'}
                    <ToolboxPanel />
                  {:else if secondPanelId === 'pet'}
                    <DevPetPanel />
                  {/if}
                </div>
              {:else if visiblePanels.length === 1}
                <!-- One panel: full height -->
                <div class="aux-pane full-pane">
                  {#if firstPanelId === 'editor'}
                    <EditorPanel />
                  {:else if firstPanelId === 'preview'}
                    <PreviewPanel />
                  {:else if firstPanelId === 'review'}
                    <ReviewPanel />
                  {:else if firstPanelId === 'http'}
                    <HttpClientPanel />
                  {:else if firstPanelId === 'tasks'}
                    <TasksPanel />
                  {:else if firstPanelId === 'db'}
                    <DbExplorerPanel />
                  {:else if firstPanelId === 'toolbox'}
                    <ToolboxPanel />
                  {:else if firstPanelId === 'pet'}
                    <DevPetPanel />
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if $sketchCanvasOpen}
          <SketchCanvas />
        {/if}

        <FloatingPromptBar />
      </div>
    </div>

    </div>
  {:else}
    <!-- No project: full-page welcome -->
    <div class="zoom-content">
    <div class="welcome-fullpage" class:with-pet-panel={$layout.petVisible}>
      <div class="welcome-main">
        <WelcomeScreen />
      </div>

      {#if $layout.petVisible}
        <aside
          class="welcome-pet-panel bento-card"
          aria-label="DevPet Playground"
          transition:fly={{ x: 120, duration: 220 }}
        >
          <button
            class="aux-close-btn"
            onclick={toggleTerminal}
            title="Close pet playground"
            aria-label="Close pet playground"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <DevPetPanel />
        </aside>
      {/if}
    </div>
    </div>
  {/if}
  </div>

  {#if $agentCenterOpen}
    <AgentCommandCenter />
  {/if}

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
    zoom: var(--zoom-factor);
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }

  .app-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    position: relative;
    min-height: 0;
    padding: var(--bento-padding, 12px);
    padding-top: 4px; /* Air under Custom Title Bar */
    gap: var(--bento-gap, 12px);
  }

  /* Prevent iframe/canvas stealing events during resize */
  .app-body.resizing .main-content {
    pointer-events: none;
  }

  .welcome-fullpage {
    flex: 1;
    overflow: hidden;
    display: flex;
    min-height: 0;
    gap: var(--bento-gap, 12px);
    padding: var(--bento-padding, 12px);
    padding-top: 4px;
  }

  .welcome-main {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    display: flex;
  }

  .welcome-fullpage:not(.with-pet-panel) {
    padding: 0;
    gap: 0;
  }

  .welcome-pet-panel {
    width: min(420px, 34vw);
    min-width: 280px;
    max-width: 520px;
    height: 100%;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  @media (max-width: 760px) {
    .welcome-fullpage.with-pet-panel {
      flex-direction: column;
    }

    .welcome-pet-panel {
      width: 100%;
      max-width: none;
      min-width: 0;
      height: min(48vh, 420px);
    }
  }

  /* ─── Sidebar ─────────────────────────── */
  .sidebar {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
    /* Ensure sidebar never expands into the main area */
    max-width: 600px;
    transition: none; /* no transition during drag */
  }

  /* ─── Activity Bar ─────────────────────────── */
  .activity-bar {
    width: 48px;
    min-width: 48px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
    padding: 8px 0;
    overflow: hidden;
  }

  .activity-bar-tabs {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .activity-bar-tabs::-webkit-scrollbar {
    display: none;
  }

  .activity-bar-bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid var(--border-subtle);
  }

  .svt-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 7px;
    border-radius: 6px;
    color: var(--text-muted);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    background: transparent;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* Left border indicator for active panel view */
  .svt-btn::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%) scaleY(0);
    width: 2.5px;
    height: 14px;
    background: var(--accent);
    border-radius: 0 3px 3px 0;
    transition: transform 0.2s;
  }

  .svt-btn.svt-active::before {
    transform: translateY(-50%) scaleY(1);
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



  .sidebar-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    overscroll-behavior: none;
  }

  /* Resize handle */
  .sidebar-resize-handle {
    width: var(--bento-gap, 12px);
    margin: 0 calc(-0.5 * var(--bento-gap, 12px));
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
    z-index: 20;
    position: relative;
  }

  .sidebar-resize-handle::after {
    content: '';
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: 25px;
    bottom: 25px;
    width: 2px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.08);
    transition: background-color 0.18s ease, box-shadow 0.18s ease, width 0.18s ease;
  }

  :root.light-theme .sidebar-resize-handle::after {
    background: rgba(0, 0, 0, 0.06);
  }

  .sidebar-resize-handle:hover::after,
  .sidebar-resize-handle.resizing::after {
    background: var(--accent);
    width: 3px;
    box-shadow: 0 0 10px var(--accent);
  }

  /* ─── Main Content (Split Workspace Layout) ─── */
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
    background: transparent;
    min-width: 0;
    position: relative;
    gap: var(--bento-gap, 12px);
  }

  .terminal-container {
    flex: 1;
    min-width: 250px;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
    container-type: inline-size;
    container-name: center-panel;
  }

  .project-switch-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: var(--bg-primary, #111116);
    opacity: 0;
    animation: project-switch-fade 0.22s ease forwards;
    pointer-events: none;
  }

  @keyframes project-switch-fade {
    0%   { opacity: 0.55; }
    60%  { opacity: 0.55; }
    100% { opacity: 0; }
  }

  /* Auxiliary Panel col resize handle */
  .aux-resize-handle {
    width: var(--bento-gap, 12px);
    margin: 0 calc(-0.5 * var(--bento-gap, 12px));
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
    z-index: 10;
    position: relative;
  }

  .aux-resize-handle::before {
    content: '';
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: 25px;
    bottom: 25px;
    width: 2px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.08);
    transition: background-color 0.18s ease, box-shadow 0.18s ease, width 0.18s ease;
  }

  :root.light-theme .aux-resize-handle::before {
    background: rgba(0, 0, 0, 0.06);
  }

  .aux-resize-handle:hover::before,
  .aux-resize-handle.resizing::before {
    background: var(--accent);
    width: 3px;
    box-shadow: 0 0 10px var(--accent);
  }

  /* Auxiliary Panel right side container */
  .auxiliary-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
    position: relative;
  }

  @media (max-width: 640px) {
    .main-content.has-aux-panel {
      display: block;
    }

    .main-content.has-aux-panel .terminal-container {
      display: none;
    }

    .main-content.has-aux-panel .aux-resize-handle {
      display: none;
    }

    .main-content.has-aux-panel .auxiliary-panel {
      width: 100% !important;
      min-width: 0 !important;
      max-width: none;
    }
  }

  .aux-close-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 100;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .aux-close-btn:hover {
    background: rgba(248, 113, 113, 0.12);
    color: var(--error);
    border-color: color-mix(in srgb, var(--error) 40%, transparent);
  }

  /* Panes within the auxiliary panel */
  .aux-pane {
    width: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: transparent;
  }

  .aux-pane.full-pane {
    height: 100%;
  }

  .aux-separator-line {
    height: 1px;
    background: var(--border-subtle, #2e2e2e);
    width: 100%;
    flex-shrink: 0;
  }

  /* Horizontal split resize handle */
  .aux-row-resize-handle {
    height: 1px;
    cursor: row-resize;
    background: var(--border);
    flex-shrink: 0;
    z-index: 10;
    position: relative;
    transition: background-color 0.15s;
  }

  .aux-row-resize-handle::before {
    content: '';
    position: absolute;
    top: -5px;
    left: 0;
    height: 11px;
    width: 100%;
    cursor: row-resize;
  }

  .aux-row-resize-handle:hover,
  .aux-row-resize-handle.resizing {
    background: var(--accent);
  }

  .resize-overlay {
    position: absolute;
    inset: 0;
    z-index: 9999;
    cursor: col-resize;
    background: transparent;
  }

  .resize-overlay.row-resize {
    cursor: row-resize;
  }



  /* Auxiliary Panel Tabs Navigation Header */
  /* Animatable edge-fade widths so the masks ease in/out as you scroll. */
  @property --aux-fade-left {
    syntax: '<length>';
    inherits: false;
    initial-value: 0px;
  }
  @property --aux-fade-right {
    syntax: '<length>';
    inherits: false;
    initial-value: 0px;
  }

  .aux-tabs-bar {
    display: flex;
    align-items: center;
    background: transparent;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    height: 38px;
    padding: 0 8px;
    padding-right: 44px;
    gap: 4px;
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
    overflow-x: auto;
    scrollbar-width: none;
    /* Fade widths default to 0 (no mask); set by .fade-left / .fade-right when
       there are tabs scrolled out of view on that side. The gradient is relative
       to the element box, so it stays pinned to the edges while tabs scroll. */
    --aux-fade-left: 0px;
    --aux-fade-right: 0px;
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 var(--aux-fade-left),
      #000 calc(100% - var(--aux-fade-right)),
      transparent 100%
    );
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 var(--aux-fade-left),
      #000 calc(100% - var(--aux-fade-right)),
      transparent 100%
    );
    transition: --aux-fade-left 0.18s ease, --aux-fade-right 0.18s ease;
  }

  .aux-tabs-bar.fade-left { --aux-fade-left: 24px; }
  .aux-tabs-bar.fade-right { --aux-fade-right: 32px; }

  :root.light-theme .aux-tabs-bar {
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }

  .aux-tabs-bar::-webkit-scrollbar { display: none; }

  /* Icon-only mode when panel is narrow */
  .aux-tabs-bar.icon-only {
    padding: 0 4px;
    padding-right: 34px;
    gap: 2px;
    justify-content: space-around;
  }

  .aux-tabs-bar.icon-only .aux-tab {
    padding: 0 7px;
    gap: 0;
    min-width: 28px;
    flex: 1;
    justify-content: center;
  }

  .aux-tabs-bar.icon-only .aux-tab span {
    display: none;
  }

  .aux-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 28px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    position: relative;
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .aux-tab:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .aux-tab.active {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), var(--shadow-sm);
  }

  :root.light-theme .aux-tab.active {
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.04);
    box-shadow: var(--shadow-sm);
  }

  .aux-tab svg {
    opacity: 0.6;
    transition: all 0.15s ease;
  }

  .aux-tab.active svg {
    opacity: 1;
    color: var(--accent);
    transform: scale(1.05);
  }

  /* Wrap content beneath the tabs bar */
  .aux-content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }
</style>
