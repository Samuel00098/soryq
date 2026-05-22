<script lang="ts">
  import FileIcon from './FileIcon.svelte';
  import FileNode from './FileNode.svelte';
  import type { FileNode as FileNodeType } from '$lib/types/explorer';
  import { toggleNode, selectedPath, showContextMenu } from '$lib/stores/explorer';

  export let node: FileNodeType;

  async function handleClick() {
    await toggleNode(node);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }

  function handleContextMenu(e: MouseEvent) {
    showContextMenu(e, node.entry.path, node.entry.is_dir);
  }

  function handleDragStart(e: DragEvent) {
    e.dataTransfer?.setData('text/plain', node.entry.path);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }
</script>

{#if node.entry.is_dir}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="file-node dir"
    class:selected={$selectedPath === node.entry.path}
    class:expanded={node.expanded}
    style="padding-left: {node.depth * 16 + 8}px"
    onclick={handleClick}
    onkeydown={handleKeydown}
    oncontextmenu={handleContextMenu}
    ondragover={handleDragOver}
    role="treeitem"
    aria-expanded={node.expanded}
    aria-selected={$selectedPath === node.entry.path}
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
    <span class="node-name">{node.entry.name}</span>
    {#if node.loading}
      <span class="loading-spinner"></span>
    {/if}
  </div>
  {#if node.expanded && node.children}
    {#each node.children as child (child.entry.path)}
      <FileNode node={child} />
    {/each}
  {/if}
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="file-node file"
    class:selected={$selectedPath === node.entry.path}
    style="padding-left: {node.depth * 16 + 8}px"
    onclick={handleClick}
    onkeydown={handleKeydown}
    oncontextmenu={handleContextMenu}
    draggable="true"
    ondragstart={handleDragStart}
    role="treeitem"
    aria-selected={$selectedPath === node.entry.path}
    tabindex="0"
  >
    <span class="chevron-placeholder"></span>
    <FileIcon name={node.entry.name} isDir={false} />
    <span class="node-name">{node.entry.name}</span>
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

  .loading-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
