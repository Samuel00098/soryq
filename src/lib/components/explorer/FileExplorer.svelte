<script lang="ts">
  import { get } from 'svelte/store';
  import FileNode from './FileNode.svelte';
  import FileIcon from './FileIcon.svelte';
  import EmptyWorkspace from './EmptyWorkspace.svelte';
  import {
    contextMenu,
    hideContextMenu,
    selectedPaths,
    deletePaths,
    loadRootDirectory,
    projectRootNodes,
    loadingProjectRoots,
    startRename,
    cancelRename,
    confirmRename,
    renamingPath,
    startCreate,
    cancelCreate,
    confirmCreate,
    creatingPath,
    creatingType,
    creatingValue,
  } from '$lib/stores/explorer';
  import {
    activeProject,
    openProject
  } from '$lib/stores/workspace';

  let contextMenuEl = $state<HTMLDivElement | null>(null);

  function handleContextAction(action: string) {
    const { path, isDir } = $contextMenu;
    hideContextMenu();

    switch (action) {
      case 'new-file':
        startCreate(path, 'file');
        break;
      case 'new-dir':
        startCreate(path, 'dir');
        break;
      case 'rename':
        startRename(path);
        break;
      case 'delete': {
        // Act on the whole selection. handleContextMenu in FileNode guarantees
        // the right-clicked item is part of it, so a single-item selection here
        // is just the one path the user pointed at.
        const targets = Array.from(get(selectedPaths));
        const list = targets.length > 0 ? targets : (path ? [path] : []);
        if (list.length === 0) break;
        const label = list.length === 1
          ? `${isDir ? 'folder' : 'file'} "${list[0].split(/[\\\/]/).pop()}"`
          : `${list.length} items`;
        if (confirm(`Delete ${label}?`)) {
          deletePaths(list);
        }
        break;
      }
    }
  }

  function startNewFile() {
    if ($activeProject) startCreate($activeProject.root_path, 'file');
  }

  function startNewDir() {
    if ($activeProject) startCreate($activeProject.root_path, 'dir');
  }

  function refreshExplorer() {
    if ($activeProject) loadRootDirectory($activeProject.root_path);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      cancelCreate();
      cancelRename();
      hideContextMenu();
    }
    if (e.key === 'Enter') {
      if ($creatingPath !== null) confirmCreate();
      if ($renamingPath) confirmRename();
    }
    if (e.key === 'Delete') {
      const target = e.target as HTMLElement | null;
      // Ignore when typing in a field, when not focused inside the explorer, or
      // mid rename/create — Delete there belongs to the input, not the tree.
      if (!target || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (!target.closest('.file-explorer')) return;
      if ($renamingPath || $creatingPath !== null) return;
      const targets = Array.from(get(selectedPaths));
      if (targets.length === 0) return;
      e.preventDefault();
      const label = targets.length === 1
        ? `"${targets[0].split(/[\\\/]/).pop()}"`
        : `${targets.length} items`;
      if (confirm(`Delete ${label}?`)) deletePaths(targets);
    }
  }

  function handleWindowMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if ($contextMenu.visible && contextMenuEl && !contextMenuEl.contains(target)) {
      hideContextMenu();
    }

    if ($creatingPath !== null && !target.closest('.create-input')) {
      cancelCreate();
    }

    if ($renamingPath && !target.closest('.rename-input')) {
      cancelRename();
    }
  }

  $effect(() => {
    if ($activeProject && !$projectRootNodes.has($activeProject.root_path)) {
      loadRootDirectory($activeProject.root_path);
    }
  });


</script>

<svelte:window onkeydown={handleKeydown} onmousedown={handleWindowMouseDown} />

<div class="file-explorer">
  <div class="explorer-header">
    {#if $activeProject}
      <button class="header-btn" onclick={startNewFile} title="New File">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
      </button>
      <button class="header-btn" onclick={startNewDir} title="New Folder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          <line x1="12" y1="11" x2="12" y2="17"/>
          <line x1="9" y1="14" x2="15" y2="14"/>
        </svg>
      </button>
      <button class="header-btn" onclick={refreshExplorer} title="Refresh">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23,4 23,10 17,10"/>
          <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
        </svg>
      </button>
    {/if}
    <button class="header-btn add-root-btn" onclick={openProject} title="Add Folder to Workspace">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <path d="M16 5V1"/>
        <path d="M14 3h4"/>
      </svg>
    </button>
  </div>

  <div class="explorer-content">
    {#if $activeProject}
      <div class="root-list" role="tree">
        {#each [$activeProject] as project (project.id)}
          {@const rootChildren = $projectRootNodes.get(project.root_path) ?? []}
          {@const rootLoading = $loadingProjectRoots.has(project.root_path)}
          <section class="root-section">
            {#if $creatingPath === project.root_path}
              <div class="create-input" style="padding-left: 24px">
                <FileIcon name={$creatingValue} isDir={$creatingType === 'dir'} />
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  type="text"
                  placeholder={$creatingType === 'file' ? 'filename.ts' : 'folder-name'}
                  bind:value={$creatingValue}
                  autofocus
                  onblur={cancelCreate}
                  onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmCreate(); } else if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); } }}
                />
              </div>
            {/if}

            {#if rootLoading}
              <div class="tree-loading">
                <span class="loading-spinner"></span>
                <span>Loading files...</span>
              </div>
            {:else if rootChildren.length > 0}
              <div class="root-children">
                {#each rootChildren as node (node.entry.path)}
                  <FileNode {node} />
                {/each}
              </div>
            {:else}
              <div class="tree-empty">
                <p>No files found</p>
              </div>
            {/if}
          </section>
        {/each}
      </div>
    {:else}
      <EmptyWorkspace />
    {/if}
  </div>

  {#if $contextMenu.visible}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={contextMenuEl}
      class="context-menu"
      style="left: {$contextMenu.x}px; top: {$contextMenu.y}px"
      onmouseleave={hideContextMenu}
    >
      {#if $contextMenu.isDir}
        <button class="context-item" onclick={() => handleContextAction('new-file')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
          New File
        </button>
        <button class="context-item" onclick={() => handleContextAction('new-dir')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
          New Folder
        </button>
      {/if}
      <button class="context-item" onclick={() => handleContextAction('rename')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Rename
      </button>
      <button class="context-item danger" onclick={() => handleContextAction('delete')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3,6 5,6 21,6"/>
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
        </svg>
        Delete
      </button>
    </div>
  {/if}
</div>

<style>
  .file-explorer {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .explorer-header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .header-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    color: var(--text-muted);
  }

  .header-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .explorer-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .root-list {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: none;
    padding: 4px 0 8px;
  }

  .root-section + .root-section {
    margin-top: 6px;
  }

  .root-children {
    display: flex;
    flex-direction: column;
  }

  .no-project {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 16px;
  }

  .no-project p {
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }

  .create-input {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .create-input input {
    flex: 1;
    background: var(--input-bg);
    border: 1px solid var(--input-focus-border);
    outline: none;
    color: var(--text-primary);
    font-size: 12px;
    padding: 1px 4px;
    border-radius: 2px;
    height: 18px;
  }

  .tree-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .tree-empty {
    padding: 12px 16px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .loading-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .context-menu {
    position: fixed;
    z-index: 1000;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), var(--frost-chrome, 0.62));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
    min-width: 160px;
    box-shadow: var(--glass-shadow, 0 4px 12px rgba(0,0,0,0.3)), inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
  }

  .context-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 8px;
    font-size: 12px;
    color: var(--text-secondary);
    border-radius: 4px;
    text-align: left;
  }

  .context-item:hover {
    background: var(--accent);
    color: var(--button-text, #fff);
  }

  .context-item.danger:hover {
    background: var(--error);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
