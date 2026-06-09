<!-- SearchPanel.svelte — project-wide, gitignore-aware text search -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { openFile, jumpToLine } from '$lib/stores/editor';
  import {
    searchQuery,
    searchCaseSensitive,
    searchWholeWord,
    searchUseRegex,
    searchInclude,
    searchResults,
    searchLoading,
    searchError,
    type SearchFileResult,
    type SearchMatch,
    type SearchResponse,
  } from '$lib/stores/projectsearch';

  let collapsed = $state<Record<string, boolean>>({});
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEl = $state<HTMLInputElement | undefined>(undefined);

  onMount(() => {
    inputEl?.focus();
    inputEl?.select();
  });

  async function runSearch() {
    const query = $searchQuery;
    if (!query) {
      searchResults.set(null);
      searchError.set(null);
      searchLoading.set(false);
      return;
    }
    searchLoading.set(true);
    searchError.set(null);
    try {
      const res = await invoke<SearchResponse>('search_in_project', {
        query,
        caseSensitive: $searchCaseSensitive,
        wholeWord: $searchWholeWord,
        useRegex: $searchUseRegex,
        includeGlob: $searchInclude.trim() || null,
      });
      searchResults.set(res);
    } catch (err) {
      searchError.set(String(err));
      searchResults.set(null);
    } finally {
      searchLoading.set(false);
    }
  }

  function scheduleSearch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 250);
  }

  function onQueryInput() {
    scheduleSearch();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (debounceTimer) clearTimeout(debounceTimer);
      void runSearch();
    }
  }

  function toggleOption(store: typeof searchCaseSensitive) {
    store.update((v) => !v);
    scheduleSearch();
  }

  function toggleCollapse(path: string) {
    collapsed[path] = !collapsed[path];
  }

  async function openMatch(file: SearchFileResult, match: SearchMatch) {
    await openFile(file.path);
    jumpToLine.set({ path: file.path, line: match.line });
  }

  // Split a line into [before, hit, after] by char index so the match can be
  // highlighted. Uses code-point slicing to line up with the Rust char counts.
  function splitMatch(text: string, column: number, length: number) {
    const chars = Array.from(text);
    const start = Math.max(0, column - 1);
    const before = chars.slice(0, start).join('');
    const hit = chars.slice(start, start + length).join('');
    const after = chars.slice(start + length).join('');
    return { before, hit, after };
  }

  let totalMatches = $derived($searchResults?.total_matches ?? 0);
  let fileCount = $derived($searchResults?.files.length ?? 0);
</script>

<div class="search-panel">
  <div class="search-header">
    <div class="search-input-wrap">
      <svg class="search-glass" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        bind:this={inputEl}
        class="search-input"
        type="text"
        placeholder="Search"
        bind:value={$searchQuery}
        oninput={onQueryInput}
        onkeydown={onKeydown}
        spellcheck="false"
        autocomplete="off"
      />
      <div class="search-toggles">
        <button
          class="toggle-btn"
          class:active={$searchCaseSensitive}
          onclick={() => toggleOption(searchCaseSensitive)}
          title="Match case"
          aria-label="Match case"
          aria-pressed={$searchCaseSensitive}
        >Aa</button>
        <button
          class="toggle-btn"
          class:active={$searchWholeWord}
          onclick={() => toggleOption(searchWholeWord)}
          title="Match whole word"
          aria-label="Match whole word"
          aria-pressed={$searchWholeWord}
        ><span class="ab-underline">ab</span></button>
        <button
          class="toggle-btn"
          class:active={$searchUseRegex}
          onclick={() => toggleOption(searchUseRegex)}
          title="Use regular expression"
          aria-label="Use regular expression"
          aria-pressed={$searchUseRegex}
        >.*</button>
      </div>
    </div>
    <input
      class="search-include"
      type="text"
      placeholder="files to include, e.g. *.ts, src/**"
      bind:value={$searchInclude}
      oninput={onQueryInput}
      onkeydown={onKeydown}
      spellcheck="false"
      autocomplete="off"
    />
  </div>

  <div class="search-status">
    {#if $searchLoading}
      <span class="status-text">Searching…</span>
    {:else if $searchError}
      <span class="status-text error">{$searchError}</span>
    {:else if $searchResults}
      {#if totalMatches === 0}
        <span class="status-text">No results found</span>
      {:else}
        <span class="status-text">
          {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {fileCount} {fileCount === 1 ? 'file' : 'files'}
          {#if $searchResults.truncated}<span class="truncated"> (truncated)</span>{/if}
        </span>
      {/if}
    {/if}
  </div>

  <div class="search-results scrollable">
    {#if $searchResults}
      {#each $searchResults.files as file (file.path)}
        <div class="file-group">
          <button type="button" class="file-row" onclick={() => toggleCollapse(file.path)}>
            <svg class="chevron" class:collapsed={collapsed[file.path]} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span class="file-name" title={file.rel_path}>{file.rel_path}</span>
            <span class="file-count">{file.matches.length}</span>
          </button>
          {#if !collapsed[file.path]}
            {#each file.matches as match}
              {@const parts = splitMatch(match.text, match.column, match.length)}
              <button type="button" class="match-row" onclick={() => openMatch(file, match)} title="Line {match.line}">
                <span class="match-line-no">{match.line}</span>
                <span class="match-text"
                  ><span class="match-before">{parts.before}</span><span class="match-hit">{parts.hit}</span><span class="match-after">{parts.after}</span></span
                >
              </button>
            {/each}
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .search-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .search-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border-bottom: 1px solid var(--border-subtle, var(--border));
    flex-shrink: 0;
  }

  .search-input-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--input-bg, color-mix(in srgb, var(--bg-secondary) 60%, transparent));
    border: 1px solid var(--input-border, var(--border));
    border-radius: 7px;
    padding: 0 8px;
    transition: border-color 0.15s;
  }

  .search-input-wrap:focus-within {
    border-color: var(--input-focus-border, var(--accent));
  }

  .search-glass {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 12px;
    padding: 7px 0;
    font-family: inherit;
  }

  .search-toggles {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 4px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.12s;
  }

  .toggle-btn:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .toggle-btn.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .ab-underline {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .search-include {
    background: var(--input-bg, color-mix(in srgb, var(--bg-secondary) 60%, transparent));
    border: 1px solid var(--input-border, var(--border));
    border-radius: 7px;
    padding: 6px 8px;
    color: var(--text-primary);
    font-size: 11px;
    outline: none;
    font-family: inherit;
    transition: border-color 0.15s;
  }

  .search-include:focus {
    border-color: var(--input-focus-border, var(--accent));
  }

  .search-status {
    padding: 6px 12px;
    flex-shrink: 0;
    min-height: 16px;
  }

  .status-text {
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .status-text.error {
    color: var(--error);
  }

  .truncated {
    color: var(--warning);
  }

  .search-results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 4px 8px;
  }

  .file-group {
    margin-bottom: 1px;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    position: sticky;
    top: 0;
    background: var(--bg-primary, var(--bg-secondary));
    z-index: 1;
    font: inherit;
    text-align: left;
  }

  .file-row:hover {
    background: var(--bg-hover);
  }

  .chevron {
    color: var(--text-muted);
    flex-shrink: 0;
    transition: transform 0.12s;
  }

  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  .file-name {
    flex: 1;
    min-width: 0;
    font-size: 11.5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }

  .file-count {
    flex-shrink: 0;
    font-size: 9.5px;
    font-weight: 600;
    color: var(--text-muted);
    background: var(--bg-hover);
    border-radius: 9px;
    padding: 1px 6px;
  }

  .match-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 3px 8px 3px 22px;
    border: none;
    background: transparent;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .match-row:hover {
    background: var(--bg-hover);
  }

  .match-line-no {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-muted);
    min-width: 26px;
    text-align: right;
    opacity: 0.7;
  }

  .match-text {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .match-hit {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: var(--text-primary);
    border-radius: 2px;
    font-weight: 600;
  }

  .scrollable::-webkit-scrollbar {
    width: 5px;
  }
  .scrollable::-webkit-scrollbar-track {
    background: transparent;
  }
  .scrollable::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.15));
    border-radius: 2.5px;
  }
  .scrollable::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--accent) 40%, transparent);
  }
</style>
