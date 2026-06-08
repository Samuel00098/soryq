<script lang="ts">
  import { activeProject } from '$lib/stores/workspace';
  import { activeFile, fileCache, activeLine, activeColumn } from '$lib/stores/editor';
  import { layout, setSidebarTab } from '$lib/stores/layout';
  import { uiZoom } from '$lib/stores/settings';
  import { branchInfo } from '$lib/stores/gitBranch';

  $: activeFileInfo = $activeFile ? $fileCache.get($activeFile) : null;
  $: languageLabel = activeFileInfo
    ? activeFileInfo.language.charAt(0).toUpperCase() + activeFileInfo.language.slice(1)
    : '';
  $: activeFileIsText = activeFileInfo?.kind === 'text';

  const viewColors: Record<string, string> = {
    editor: 'var(--accent)',
    terminal: 'var(--success)',
    preview: 'var(--accent)',
    settings: 'var(--accent)',
  };
</script>

<footer class="statusbar">
  <div class="sb-left">
    <span
      class="sb-view-badge"
      style="--vc: {viewColors[$layout.activeView] ?? '#06b6d4'}"
    >
      {$layout.activeView}
    </span>

    {#if $activeProject}
      <span class="sb-sep">.</span>
      <span class="sb-item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>
        {$activeProject.name}
      </span>
    {/if}
    {#if $branchInfo?.current}
      <span class="sb-sep">.</span>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="sb-item sb-branch" onclick={() => setSidebarTab('git')} title="Switch branch">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
          <path d="M18 9a9 9 0 01-9 9"/>
        </svg>
        {$branchInfo.current}
      </span>
    {/if}
  </div>

  <div class="sb-right">
    {#if activeFileInfo}
      {#if activeFileIsText}
        <span class="sb-item">Ln {$activeLine}, Col {$activeColumn}</span>
        <span class="sb-sep">.</span>
      {/if}
      <span class="sb-item">{languageLabel}</span>
      <span class="sb-sep">.</span>
    {/if}
    {#if !activeFileInfo || activeFileIsText}
      <span class="sb-item">UTF-8</span>
      <span class="sb-sep">.</span>
      <span class="sb-item">LF</span>
      <span class="sb-sep">.</span>
    {/if}
    <span class="sb-item zoom-indicator">{$uiZoom}%</span>
  </div>
</footer>

<style>
  .statusbar {
    height: 26px;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    font-size: 11.5px;
    color: var(--text-secondary);
    flex-shrink: 0;
    letter-spacing: 0.2px;
  }

  .sb-left, .sb-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sb-view-badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: capitalize;
    color: var(--vc);
    letter-spacing: 0.5px;
    padding: 1px 6px;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--vc) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--vc) 18%, transparent);
  }

  .sb-sep {
    opacity: 0.4;
    font-size: 11px;
    color: var(--text-muted);
  }

  .sb-item {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-secondary);
    transition: color 0.15s ease;
  }

  .sb-item:hover {
    color: var(--text-primary);
  }

  .sb-item svg {
    width: 13px;
    height: 13px;
  }

  .zoom-indicator {
    min-width: 36px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .sb-branch { cursor: pointer; }
  .sb-branch:hover { color: var(--accent); }
</style>
