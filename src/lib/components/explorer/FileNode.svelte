<script lang="ts">
  import { get } from 'svelte/store';
  import FileIcon from './FileIcon.svelte';
  import FileNode from './FileNode.svelte';
  import type { FileNode as FileNodeType } from '$lib/types/explorer';
  import { toggleNode, selectedPaths, selectSingle, toggleSelection, selectRangeTo, showContextMenu, renamingPath, renamingValue, confirmRename, cancelRename, creatingPath, creatingType, creatingValue, confirmCreate, cancelCreate } from '$lib/stores/explorer';

  export let node: FileNodeType;
  const DRAG_THRESHOLD = 6;
  let pendingDrag:
    | {
        path: string;
        startX: number;
        startY: number;
        active: boolean;
      }
    | null = null;
  let suppressClick = false;

  async function handleClick(e: MouseEvent | KeyboardEvent) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // Ctrl/Cmd toggles a single item; Shift extends a range. Neither opens or
    // expands the node — they only adjust the selection (standard explorer UX).
    if (e.ctrlKey || e.metaKey) {
      toggleSelection(node.entry.path);
      return;
    }
    if (e.shiftKey) {
      selectRangeTo(node.entry.path);
      return;
    }
    // Plain click: collapse the selection to this one item, then open/expand it.
    selectSingle(node.entry.path);
    await toggleNode(node);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e);
    }
  }

  function handleContextMenu(e: MouseEvent) {
    // Right-clicking an item outside the current selection resets the selection
    // to just that item, so the menu's Delete acts on what the user pointed at.
    if (!get(selectedPaths).has(node.entry.path)) {
      selectSingle(node.entry.path);
    }
    showContextMenu(e, node.entry.path, node.entry.is_dir);
  }

  function cleanupPointerDrag() {
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
    pendingDrag = null;
  }

  function handleMouseDown(event: MouseEvent) {
    if (event.button !== 0) return;
    pendingDrag = {
      path: node.entry.path,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  }

  function handleWindowMouseMove(event: MouseEvent) {
    if (!pendingDrag) return;
    const deltaX = event.clientX - pendingDrag.startX;
    const deltaY = event.clientY - pendingDrag.startY;
    const movedEnough = Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD;

    if (!pendingDrag.active && !movedEnough) {
      return;
    }

    if (!pendingDrag.active) {
      pendingDrag.active = true;
      suppressClick = true;
      window.dispatchEvent(new CustomEvent('soryq-explorer-drag-start', {
        detail: { path: pendingDrag.path }
      }));
    }

    window.dispatchEvent(new CustomEvent('soryq-explorer-drag-move', {
      detail: {
        path: pendingDrag.path,
        clientX: event.clientX,
        clientY: event.clientY
      }
    }));
  }

  function handleWindowMouseUp(event: MouseEvent) {
    if (!pendingDrag) return;
    const completedDrag = pendingDrag;
    cleanupPointerDrag();

    if (!completedDrag.active) return;

    event.preventDefault();
    window.dispatchEvent(new CustomEvent('soryq-explorer-drag-end', {
      detail: {
        path: completedDrag.path,
        clientX: event.clientX,
        clientY: event.clientY
      }
    }));
    requestAnimationFrame(() => {
      suppressClick = false;
    });
  }
</script>

{#if node.entry.is_dir}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="file-node dir"
    class:selected={$selectedPaths.has(node.entry.path)}
    class:expanded={node.expanded}
    style="padding-left: {node.depth * 16 + 8}px"
    onclick={handleClick}
    onkeydown={handleKeydown}
    oncontextmenu={handleContextMenu}
    role="treeitem"
    aria-expanded={node.expanded}
    aria-selected={$selectedPaths.has(node.entry.path)}
    tabindex="0"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class="chevron"
      class:rotated={node.expanded}
    >
      <polyline points="9,18 15,12 9,6"/>
    </svg>
    <FileIcon name={node.entry.name} isDir={true} />
    {#if $renamingPath === node.entry.path}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="rename-input"
        type="text"
        bind:value={$renamingValue}
        autofocus
        onclick={(e) => e.stopPropagation()}
        onblur={cancelRename}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmRename(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); } }}
      />
    {:else}
      <span class="node-name">{node.entry.name}</span>
    {/if}
    {#if node.loading}
      <span class="loading-spinner"></span>
    {/if}
  </div>
  {#if $creatingPath === node.entry.path}
    <div class="create-input" style="padding-left: {(node.depth + 1) * 16 + 8}px">
      <FileIcon name={$creatingValue} isDir={$creatingType === 'dir'} />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        placeholder={$creatingType === 'file' ? 'filename.ts' : 'folder-name'}
        bind:value={$creatingValue}
        autofocus
        onclick={(e) => e.stopPropagation()}
        onblur={cancelCreate}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmCreate(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelCreate(); } }}
      />
    </div>
  {/if}
  {#if node.expanded && node.children}
    {#each node.children as child (child.entry.path)}
      <FileNode node={child} />
    {/each}
  {/if}
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="file-node file"
    class:selected={$selectedPaths.has(node.entry.path)}
    style="padding-left: {node.depth * 16 + 8}px"
    onclick={handleClick}
    onmousedown={handleMouseDown}
    onkeydown={handleKeydown}
    oncontextmenu={handleContextMenu}
    role="treeitem"
    aria-selected={$selectedPaths.has(node.entry.path)}
    tabindex="0"
  >
    <span class="chevron-placeholder"></span>
    <FileIcon name={node.entry.name} isDir={false} />
    {#if $renamingPath === node.entry.path}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="rename-input"
        type="text"
        bind:value={$renamingValue}
        autofocus
        onclick={(e) => e.stopPropagation()}
        onblur={cancelRename}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmRename(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); } }}
      />
    {:else}
      <span class="node-name">{node.entry.name}</span>
    {/if}
  </div>
{/if}

<style>
  .file-node {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    cursor: pointer;
    user-select: none;
    font-size: 13px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-node:hover {
    background: var(--bg-hover);
  }

  .file-node.selected {
    background: var(--selection-bg);
    color: var(--text-primary);
  }

  .chevron {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  .chevron.rotated {
    transform: rotate(90deg);
  }

  .chevron-placeholder {
    width: 16px;
    flex-shrink: 0;
  }

  .node-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
    background: var(--input-bg, rgba(255,255,255,0.06));
    border: 1px solid var(--accent, #06b6d4);
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    padding: 0 4px;
    height: 18px;
    outline: none;
  }

  .loading-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .create-input {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding-right: 8px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .create-input input {
    flex: 1;
    min-width: 0;
    background: var(--input-bg);
    border: 1px solid var(--input-focus-border, var(--accent));
    outline: none;
    color: var(--text-primary);
    font-size: 12px;
    padding: 1px 4px;
    border-radius: 2px;
    height: 18px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
