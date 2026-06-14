<script lang="ts">
  import { openFiles, activeFile, fileCache, closeFile } from '$lib/stores/editor';
  import { clampHorizontalScroll } from '$lib/actions/clampHorizontalScroll';

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

  // Short, language-specific badge (label + brand color) shown on each tab,
  // replacing a generic "TXT" for every file. Keyed by the language ids that
  // detectLanguage() produces (see stores/editor.ts).
  type Badge = { label: string; color: string };
  const LANG_BADGE: Record<string, Badge> = {
    image: { label: 'IMG', color: '#b78cf0' },
    javascript: { label: 'JS', color: '#f0db4f' },
    typescript: { label: 'TS', color: '#3178c6' },
    html: { label: 'HTML', color: '#e34f26' },
    css: { label: 'CSS', color: '#519aba' },
    scss: { label: 'SCSS', color: '#cd6799' },
    sass: { label: 'SASS', color: '#cd6799' },
    rust: { label: 'RS', color: '#dea584' },
    json: { label: 'JSON', color: '#cbcb41' },
    markdown: { label: 'MD', color: '#519aba' },
    python: { label: 'PY', color: '#ffd43b' },
    java: { label: 'JAVA', color: '#e76f00' },
    cpp: { label: 'C++', color: '#5e97d0' },
    csharp: { label: 'C#', color: '#a074c4' },
    svelte: { label: 'SV', color: '#ff3e00' },
    toml: { label: 'TOML', color: '#b8845f' },
    php: { label: 'PHP', color: '#8993be' },
    sql: { label: 'SQL', color: '#e38c00' },
    xml: { label: 'XML', color: '#e37933' },
    yaml: { label: 'YAML', color: '#cb171e' },
    go: { label: 'GO', color: '#00add8' },
    swift: { label: 'SW', color: '#f05138' },
    kotlin: { label: 'KT', color: '#a97bff' },
    shell: { label: 'SH', color: '#89e051' },
    plaintext: { label: 'TXT', color: 'var(--text-muted)' },
  };

  function langBadge(language: string | undefined, kind: string): Badge {
    if (kind === 'image') return LANG_BADGE.image;
    return LANG_BADGE[language ?? ''] ?? LANG_BADGE.plaintext;
  }
</script>

<div class="editor-tabs" use:clampHorizontalScroll>
  {#each $openFiles as file (file)}
    {@const fileState = $fileCache.get(file)}
    {#if fileState}
      {@const badge = langBadge(fileState.language, fileState.kind)}
      <button
        class="editor-tab"
        class:active={$activeFile === file}
        class:dirty={fileState.isDirty}
        onclick={() => handleTabClick(file)}
        title={file}
      >
        <span class="tab-icon" style:color={badge.color}>{badge.label}</span>
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
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
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
    scroll-snap-align: start;
  }

  .editor-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .editor-tab.active {
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
    min-width: 22px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.45px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.95;
    flex-shrink: 0;
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
