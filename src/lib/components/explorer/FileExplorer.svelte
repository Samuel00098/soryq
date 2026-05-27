<script lang="ts">
  import FileNode from './FileNode.svelte';
  import EmptyWorkspace from './EmptyWorkspace.svelte';
  import {
    contextMenu,
    hideContextMenu,
    createFile,
    createDir,
    deleteFile,
    renameFile,
    loadRootDirectory,
    projectRootNodes,
    loadingProjectRoots
  } from '$lib/stores/explorer';
  import {
    activeProject,
    activeWorkspace,
    openProjectIds,
    openProjectsList,
    switchToProject,
    closeProject,
    openProject
  } from '$lib/stores/workspace';

  let collapsedRoots = $state<Set<string>>(new Set());
  let renamingPath = $state<string | null>(null);
  let renamingValue = $state('');
  let creating = $state<{ parentPath: string; type: 'file' | 'dir' } | null>(null);
  let creatingValue = $state('');

  function handleContextAction(action: string) {
    const { path, isDir } = $contextMenu;
    hideContextMenu();

    switch (action) {
      case 'new-file':
        creating = { parentPath: path, type: 'file' };
        creatingValue = '';
        break;
      case 'new-dir':
        creating = { parentPath: path, type: 'dir' };
        creatingValue = '';
        break;
      case 'rename':
        renamingPath = path;
        renamingValue = path.split(/[\\\/]/).pop() || '';
        break;
      case 'delete':
        if (confirm(`Delete ${isDir ? 'folder' : 'file'} "${path.split(/[\\\/]/).pop()}"?`)) {
          deleteFile(path);
        }
        break;
    }
  }

  function startNewFile() {
    if ($activeProject) {
      creating = { parentPath: $activeProject.root_path, type: 'file' };
      creatingValue = '';
    }
  }

  function startNewDir() {
    if ($activeProject) {
      creating = { parentPath: $activeProject.root_path, type: 'dir' };
      creatingValue = '';
    }
  }

  function refreshExplorer() {
    for (const project of $openProjectsList) {
      loadRootDirectory(project.root_path);
    }
  }

  function toggleRootCollapse(projectId: string) {
    const next = new Set(collapsedRoots);
    if (next.has(projectId)) {
      next.delete(projectId);
    } else {
      next.add(projectId);
    }
    collapsedRoots = next;
  }

  function isRootCollapsed(projectId: string) {
    return collapsedRoots.has(projectId);
  }

  function activateProjectRoot(projectId: string) {
    switchToProject(projectId);
    collapsedRoots = new Set(
      $openProjectsList
        .map((project) => project.id)
        .filter((id) => id !== projectId)
    );
  }

  async function confirmCreate() {
    if (!creating) return;
    const val = creatingValue.trim();
    if (!val) {
      cancelCreate();
      return;
    }
    const newPath = creating.parentPath + '/' + val;
    const type = creating.type;
    cancelCreate();
    try {
      if (type === 'file') {
        await createFile(newPath);
      } else {
        await createDir(newPath);
      }
    } catch (err) {
      console.error('Failed to create:', err);
    }
  }

  function cancelCreate() {
    creating = null;
    creatingValue = '';
  }

  async function confirmRename() {
    if (!renamingPath) return;
    const val = renamingValue.trim();
    if (!val) {
      cancelRename();
      return;
    }
    const oldPath = renamingPath;
    const parts = oldPath.split(/[\\\/]/);
    parts.pop();
    const newPath = parts.join('/') + '/' + val;
    cancelRename();
    try {
      if (newPath !== oldPath) {
        await renameFile(oldPath, newPath);
      }
    } catch (err) {
      console.error('Failed to rename:', err);
    }
  }

  function cancelRename() {
    renamingPath = null;
    renamingValue = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      cancelCreate();
      cancelRename();
      hideContextMenu();
    }
    if (e.key === 'Enter') {
      if (creating) confirmCreate();
      if (renamingPath) confirmRename();
    }
  }

  $effect(() => {
    for (const project of $openProjectsList) {
      if (!$projectRootNodes.has(project.root_path)) {
        loadRootDirectory(project.root_path);
      }
    }
  });

  $effect(() => {
    const activeId = $activeProject?.id;
    if (!activeId) return;
    collapsedRoots = new Set(
      $openProjectsList
        .map((project) => project.id)
        .filter((id) => id !== activeId)
    );
  });
</script>

<svelte:window onkeydown={handleKeydown} />

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
    {#if $activeWorkspace}
      <button class="header-btn add-root-btn" onclick={openProject} title="Add Folder to Workspace">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          <line x1="12" y1="11" x2="12" y2="17"/>
          <line x1="9" y1="14" x2="15" y2="14"/>
          <line x1="19" y1="8" x2="19" y2="2"/>
          <line x1="16" y1="5" x2="22" y2="5"/>
        </svg>
      </button>
    {/if}
  </div>

  <div class="explorer-content">
    {#if $openProjectsList.length > 0}
      <div class="root-list" role="tree">
        {#each $openProjectsList as project (project.id)}
          {@const rootChildren = $projectRootNodes.get(project.root_path) ?? []}
          {@const rootLoading = $loadingProjectRoots.has(project.root_path)}
          {@const rootCollapsed = isRootCollapsed(project.id)}
          <section class="root-section">
            <div
              class="root-header"
              class:active={project.id === $activeProject?.id}
              role="treeitem"
              aria-expanded={!rootCollapsed}
              aria-selected={project.id === $activeProject?.id}
              tabindex="0"
              onclick={() => activateProjectRoot(project.id)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  activateProjectRoot(project.id);
                } else if (e.key === 'ArrowLeft' && !rootCollapsed) {
                  e.preventDefault();
                  toggleRootCollapse(project.id);
                } else if (e.key === 'ArrowRight' && rootCollapsed) {
                  e.preventDefault();
                  toggleRootCollapse(project.id);
                }
              }}
            >
              <button
                class="root-chevron"
                class:collapsed={rootCollapsed}
                onclick={(e) => {
                  e.stopPropagation();
                  toggleRootCollapse(project.id);
                }}
                title={rootCollapsed ? 'Expand root' : 'Collapse root'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9,18 15,12 9,6"/>
                </svg>
              </button>
              <div class="root-labels">
                <span class="root-name">{project.name}</span>
                <span class="root-path">{project.root_path}</span>
              </div>
              {#if project.id === $activeProject?.id}
                <span class="root-active-pill">Active</span>
              {/if}
              <button
                class="root-close-btn"
                onclick={(e) => {
                  e.stopPropagation();
                  closeProject(project.id);
                }}
                title="Remove root from workspace"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {#if !rootCollapsed}
              {#if creating && creating.parentPath === project.root_path}
                <div class="create-input" style="padding-left: 24px">
                  {creating.type === 'file' ? 'File' : 'Dir'}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    type="text"
                    placeholder={creating.type === 'file' ? 'filename.ts' : 'folder-name'}
                    bind:value={creatingValue}
                    autofocus
                    onblur={confirmCreate}
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
            {/if}
          </section>
        {/each}
      </div>
    {:else if $activeWorkspace && $openProjectIds.length === 0}
      <EmptyWorkspace />
    {:else}
      <div class="no-project">
        <p>Open a folder to explore files</p>
      </div>
    {/if}
  </div>

  {#if $contextMenu.visible}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
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

  .root-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    margin: 0 6px;
    border-radius: 8px;
    cursor: pointer;
    user-select: none;
    color: var(--text-secondary);
    transition: background 0.15s, color 0.15s;
  }

  .root-header:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .root-header.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text-primary);
  }

  .root-chevron,
  .root-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: inherit;
    flex-shrink: 0;
  }

  .root-chevron:hover,
  .root-close-btn:hover {
    background: var(--bg-active);
  }

  .root-chevron svg {
    transition: transform 0.15s;
  }

  .root-chevron.collapsed svg {
    transform: rotate(-90deg);
  }

  .root-labels {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
  }

  .root-name {
    font-size: 12px;
    font-weight: 600;
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .root-path {
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .root-active-pill {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: 999px;
    padding: 2px 6px;
    flex-shrink: 0;
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
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
    min-width: 160px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
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
    color: #fff;
  }

  .context-item.danger:hover {
    background: var(--error);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
