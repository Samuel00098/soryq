<script lang="ts">
  import { onMount } from 'svelte';
  import EditorTabs from './EditorTabs.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import ImageViewer from './ImageViewer.svelte';
  import MarkdownPreview from '$lib/components/preview/MarkdownPreview.svelte';
  import { openFiles, activeFile, fileCache, saveActiveFile } from '$lib/stores/editor';
  import { layout, toggleEditorSplitPreview } from '$lib/stores/layout';

  let showMarkdownPreview = $state(false);

  // Automatically reset to editor mode when switching files
  $effect(() => {
    const file = $activeFile;
    showMarkdownPreview = false;
  });

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
        {#if file.kind === 'text' && file.language === 'markdown'}
          <button
            class="markdown-toggle-btn"
            class:active={showMarkdownPreview}
            onclick={() => showMarkdownPreview = !showMarkdownPreview}
            title={showMarkdownPreview ? "Show Editor" : "Show Preview"}
            aria-label="Toggle markdown preview"
          >
            {#if showMarkdownPreview}
              <!-- Code icon -->
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              <span>Show Code</span>
            {:else}
              <!-- Eye icon -->
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>Show Preview</span>
            {/if}
          </button>
        {/if}
      </div>
      <div class="editor-workspace-area">
        {#if file.kind === 'image' && file.imageSrc}
          <ImageViewer
            src={file.imageSrc}
            path={file.path}
            mimeType={file.mimeType}
            size={file.size}
          />
        {:else if file.language === 'markdown' && showMarkdownPreview}
          <MarkdownPreview content={file.content} />
        {:else}
          {#key file.path}
            <CodeEditor
              filePath={file.path}
              initialContent={file.content}
              language={file.language}
            />
          {/key}
        {/if}
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
    /* Transparent so the parent .auxiliary-panel provides the frosted glass. */
    background: transparent;
    overflow: hidden;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: transparent;
    width: 100%;
    height: 35px;
    padding-right: 32px;
    box-sizing: border-box;
  }

  .markdown-toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    margin-right: 8px;
    user-select: none;
  }

  .markdown-toggle-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .markdown-toggle-btn.active {
    background: var(--accent-light);
    color: var(--accent);
    border-color: var(--accent);
  }

  .editor-workspace-area {
    flex: 1;
    overflow: hidden;
    position: relative;
    width: 100%;
  }

  .editor-empty-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 8px;
    color: var(--text-muted);
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
