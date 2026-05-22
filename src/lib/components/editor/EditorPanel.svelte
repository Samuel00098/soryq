<script lang="ts">
  import { onMount } from 'svelte';
  import EditorTabs from './EditorTabs.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import { openFiles, activeFile, fileCache, saveActiveFile } from '$lib/stores/editor';
  import { layout, toggleEditorSplitPreview } from '$lib/stores/layout';

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveActiveFile();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="editor-panel">
  {#if $openFiles.length > 0 && $activeFile}
    {@const file = $fileCache.get($activeFile)}
    {#if file}
      <div class="editor-toolbar">
        <EditorTabs />
        <button
          class="split-preview-btn"
          class:active={$layout.editorSplitPreview}
          onclick={toggleEditorSplitPreview}
          title={$layout.editorSplitPreview ? 'Close Preview Split' : 'Split Editor + Preview'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="18" rx="2"/>
            <line x1="12" y1="3" x2="12" y2="21"/>
          </svg>
          <span>Preview</span>
        </button>
      </div>
      <div class="editor-workspace-area">
        {#key file.path}
          <CodeEditor
            filePath={file.path}
            initialContent={file.content}
            language={file.language}
          />
        {/key}
      </div>
    {/if}
  {:else}
    <div class="editor-empty-placeholder">
      <div class="placeholder-icon">&#128196;</div>
      <p class="placeholder-text">Open a file from the Explorer</p>
      <p class="placeholder-hint">Click the folder icon in the activity bar to browse files</p>
    </div>
  {/if}
</div>

<style>
  .editor-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--editor-bg);
    overflow: hidden;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--tab-inactive-bg);
  }

  .split-preview-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-muted);
    border-left: 1px solid var(--border);
    height: 100%;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
    white-space: nowrap;
  }

  .split-preview-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .split-preview-btn.active {
    color: var(--accent);
    background: var(--accent-light);
  }

  .editor-workspace-area {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .editor-empty-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 8px;
    color: var(--text-muted);
    height: 100%;
  }

  .placeholder-icon {
    font-size: 48px;
    margin-bottom: 8px;
    opacity: 0.4;
  }

  .placeholder-text {
    font-size: 14px;
    color: var(--text-secondary);
  }

  .placeholder-hint {
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
