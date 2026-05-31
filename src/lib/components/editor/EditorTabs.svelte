<script lang="ts">
  import { openFiles, activeFile, fileCache, closeFile } from '$lib/stores/editor';

  function handleTabClick(path: string) {
    activeFile.set(path);
  }

  function handleCloseClick(e: MouseEvent, path: string) {
    e.stopPropagation();
    closeFile(path);
  }

  function getFileName(path: string) {
    return path.split(/[\\\/]/).pop() || path;
  }
</script>

<div class="editor-tabs">
  {#each $openFiles as file (file)}
    {@const fileState = $fileCache.get(file)}
    {#if fileState}
      <button
        class="editor-tab"
        class:active={$activeFile === file}
        class:dirty={fileState.isDirty}
        onclick={() => handleTabClick(file)}
        title={file}
      >
        <span class="tab-icon">
          {#if fileState.language === 'rust'}
            🦀
          {:else}
            📄
          {/if}
        </span>
        <span class="tab-label">{getFileName(file)}</span>
        {#if fileState.isDirty}
          <span class="tab-dirty-indicator"></span>
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="tab-close-btn"
          onclick={(e) => handleCloseClick(e, file)}
          role="button"
          tabindex="0"
          aria-label="Close tab"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 2l8 8M10 2l-8 8"/>
          </svg>
        </span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .editor-tabs {
    display: flex;
    height: 35px;
    background: transparent;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
  }

  .editor-tabs::-webkit-scrollbar {
    height: 3px;
  }

  .editor-tabs::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 9999px;
  }

  .editor-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding: 0 14px;
    background: transparent;
    border-right: 1px solid var(--tab-border);
    color: var(--text-secondary);
    user-select: none;
    cursor: pointer;
    font-size: 11.5px;
    position: relative;
    transition: background-color 0.2s, color 0.2s;
    min-width: 100px;
    max-width: 180px;
  }

  .editor-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .editor-tab.active {
    /* Reads continuous with the frosted editor surface below it. No own
       backdrop-filter — the parent .editor-panel already provides the glass. */
    background: rgba(var(--editor-bg-rgb, 24, 24, 30), var(--frost-surface, 0.72));
    color: var(--text-primary);
  }

  .editor-tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    box-shadow: 0 -2px 8px var(--accent-glow);
  }

  .tab-icon {
    font-size: 13px;
    display: flex;
    align-items: center;
    opacity: 0.8;
  }

  .tab-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }

  .tab-dirty-indicator {
    width: 6px;
    height: 6px;
    background: var(--accent);
    border-radius: 50%;
    margin-right: 2px;
  }

  .tab-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.15s ease, background-color 0.15s, color 0.15s;
  }

  .editor-tab:hover .tab-close-btn,
  .editor-tab.active .tab-close-btn {
    opacity: 1;
  }

  .tab-close-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-primary);
  }

  .editor-tab.dirty:hover .tab-dirty-indicator {
    display: none;
  }

  .editor-tab.dirty .tab-close-btn {
    display: none;
  }

  .editor-tab.dirty:hover .tab-close-btn {
    display: flex;
  }
</style>
