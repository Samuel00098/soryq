<script lang="ts">
  import FileNode from './FileNode.svelte';
  import { rootNodes, isLoading, loadRootDirectory } from '$lib/stores/explorer';
  import { activeProject } from '$lib/stores/workspace';
  import { onMount } from 'svelte';

  // Load root directory whenever activeProject changes
  $: if ($activeProject) {
    loadRootDirectory($activeProject.root_path);
  }
</script>

<div class="file-tree" role="tree">
  {#if $isLoading}
    <div class="tree-loading">
      <span class="loading-spinner"></span>
      <span>Loading files...</span>
    </div>
  {:else if $rootNodes.length > 0}
    {#each $rootNodes as node (node.entry.path)}
      <FileNode {node} />
    {/each}
  {:else}
    <div class="tree-empty">
      <p>No files found</p>
    </div>
  {/if}
</div>

<style>
  .file-tree {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: none;
    padding: 4px 0;
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
    padding: 16px;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
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
