<script lang="ts">
  import { runHistory, clearRunHistory, type RunEntry } from '$lib/stores/runHistory';
  import { requestTerminalInput } from '$lib/stores/terminal';
  import { getAgentDisplayName } from '$lib/stores/terminal';
  import { activeProject } from '$lib/stores/workspace';

  type FilterTab = 'all' | 'running' | 'success' | 'failed';
  type ScopeTab = 'project' | 'all';

  let searchQuery = $state('');
  let activeFilter = $state<FilterTab>('all');
  let activeScope = $state<ScopeTab>('project');
  let clearConfirm = $state(false);

  const ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJrsu]/g;

  function stripAnsi(text: string): string {
    return text.replace(ANSI_RE, '');
  }

  function entryStatus(entry: RunEntry): 'running' | 'success' | 'failed' | 'unknown' {
    if (entry.finishedAt === undefined) return 'running';
    if (entry.exitCode === 0) return 'success';
    if (entry.exitCode !== undefined) return 'failed';
    return 'success';
  }

  function formatDuration(entry: RunEntry): string {
    if (entry.finishedAt === undefined) return 'running...';
    const ms = entry.finishedAt - entry.startedAt;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatRelative(ts: number): string {
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function handleReplay(entry: RunEntry) {
    requestTerminalInput(entry.sessionId, entry.command);
  }

  function handleClearClick() {
    if (clearConfirm) {
      clearRunHistory();
      clearConfirm = false;
    } else {
      clearConfirm = true;
    }
  }

  function extractResponseText(entry: RunEntry): string {
    const clean = stripAnsi(entry.output || '').replace(/\r/g, '').trim();
    if (!clean) return '';
    let response = clean;
    const escapedCommand = entry.command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    response = response.replace(new RegExp(`^${escapedCommand}\\n*`), '').trim();
    return response;
  }

  function responsePreview(entry: RunEntry): string {
    const response = extractResponseText(entry);
    if (!response) return entryStatus(entry) === 'running' ? 'Waiting for response...' : 'No response captured.';
    const firstLine = response.split('\n').find((line) => line.trim().length > 0) ?? response;
    return firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
  }

  function agentLabel(entry: RunEntry): string | null {
    return getAgentDisplayName(entry.agentPreset);
  }

  let filtered = $derived((() => {
    const q = searchQuery.toLowerCase();
    const projectId = $activeProject?.id ?? null;
    const all = [...$runHistory].reverse();
    return all.filter((entry) => {
      if (activeScope === 'project' && projectId && entry.projectId !== projectId) return false;
      if (q && !entry.command.toLowerCase().includes(q)) return false;
      const status = entryStatus(entry);
      if (activeFilter === 'running') return status === 'running';
      if (activeFilter === 'success') return status === 'success';
      if (activeFilter === 'failed') return status === 'failed';
      return true;
    });
  })());
</script>

<div class="history-panel">
  <div class="panel-header">
    <span class="panel-title">Run History</span>
    <div class="header-actions">
      {#if clearConfirm}
        <button class="clear-confirm-btn" onclick={handleClearClick}>
          Really clear?
        </button>
        <button class="clear-cancel-btn" onclick={() => clearConfirm = false}>
          Cancel
        </button>
      {:else}
        <button
          class="clear-btn"
          onclick={handleClearClick}
          title="Clear all run history"
          disabled={$runHistory.length === 0}
        >
          Clear
        </button>
      {/if}
    </div>
  </div>

  <div class="search-row">
    <div class="search-wrap">
      <svg class="search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        class="search-input"
        type="text"
        placeholder="Search commands..."
        bind:value={searchQuery}
      />
      {#if searchQuery}
        <button class="search-clear" onclick={() => searchQuery = ''} title="Clear search">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <div class="filter-tabs">
    <button
      class="scope-tab"
      class:active={activeScope === 'project'}
      onclick={() => activeScope = 'project'}
      title={$activeProject ? `Show only runs for ${$activeProject.name}` : 'Show only runs for the active project'}
    >
      Current Project
    </button>
    <button
      class="scope-tab"
      class:active={activeScope === 'all'}
      onclick={() => activeScope = 'all'}
      title="Show runs across all open projects"
    >
      All Projects
    </button>
  </div>

  <div class="filter-tabs">
    {#each (['all', 'running', 'success', 'failed'] as FilterTab[]) as tab}
      <button
        class="filter-tab"
        class:active={activeFilter === tab}
        onclick={() => activeFilter = tab}
      >
        {tab.charAt(0).toUpperCase() + tab.slice(1)}
      </button>
    {/each}
  </div>

  <div class="entries-list">
    {#if filtered.length === 0}
      <div class="empty-state">
        {#if $runHistory.length === 0}
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
            <path d="M3 3v5h5"/>
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/>
            <line x1="12" y1="7" x2="12" y2="12"/>
            <line x1="12" y1="12" x2="15.5" y2="14"/>
          </svg>
          <p>No commands run yet.</p>
          <p class="empty-sub">Commands sent via the prompt bar will appear here.</p>
        {:else}
          <p>No results match your filter.</p>
        {/if}
      </div>
    {:else}
      {#each filtered as entry (entry.id)}
        {@const status = entryStatus(entry)}
        <div class="entry-card">
          <div class="entry-header">
            <span
              class="status-dot"
              class:running={status === 'running'}
              class:success={status === 'success'}
              class:failed={status === 'failed'}
              class:unknown={status === 'unknown'}
              title={status}
            ></span>

            <div class="entry-summary">
              <span class="entry-command" title={entry.command}>{entry.command}</span>
              {#if agentLabel(entry)}
                <span class="entry-agent">CLI: {agentLabel(entry)}</span>
              {/if}
              {#if status === 'running'}
                <span class="entry-progress" aria-label="Generating response">
                  <span class="entry-progress-dot"></span>
                  <span class="entry-progress-bar">
                    <span class="entry-progress-bar-fill"></span>
                  </span>
                </span>
              {:else}
                <span class="entry-response-preview" title={responsePreview(entry)}>{responsePreview(entry)}</span>
              {/if}
            </div>

            <div class="entry-info-badges">
              {#if entry.sessionLabel}
                <span class="label-badge">{entry.sessionLabel}</span>
              {/if}
              {#if entry.sessionRole}
                <span class="role-badge">{entry.sessionRole}</span>
              {/if}
            </div>

            <div class="entry-meta">
              <span class="entry-duration">{formatDuration(entry)}</span>
              <span class="entry-time">{formatRelative(entry.startedAt)}</span>
            </div>

            <div class="entry-actions">
              <button
                class="replay-btn"
                onclick={() => handleReplay(entry)}
                title="Replay this command"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .history-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
  }

  /* â”€â”€ Header â”€â”€ */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 6px;
    border-bottom: 1px solid var(--border-subtle, var(--border));
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-muted);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .clear-btn {
    font-size: 10px;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: color 0.12s, background 0.12s;
  }

  .clear-btn:hover:not(:disabled) {
    color: var(--error);
    background: rgba(239, 68, 68, 0.1);
  }

  .clear-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .clear-confirm-btn {
    font-size: 10px;
    color: var(--error);
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.25);
    cursor: pointer;
    padding: 2px 7px;
    border-radius: 4px;
    font-weight: 600;
    transition: background 0.12s;
  }

  .clear-confirm-btn:hover {
    background: rgba(239, 68, 68, 0.22);
  }

  .clear-cancel-btn {
    font-size: 10px;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 5px;
    border-radius: 4px;
    transition: color 0.12s;
  }

  .clear-cancel-btn:hover {
    color: var(--text-primary);
  }

  /* â”€â”€ Search â”€â”€ */
  .search-row {
    padding: 6px 8px 4px;
    flex-shrink: 0;
  }

  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 8px;
    color: var(--text-muted);
    pointer-events: none;
    flex-shrink: 0;
  }

  .search-input {
    width: 100%;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 28px 5px 28px;
    font-size: 11.5px;
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.12s;
    box-sizing: border-box;
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-clear {
    position: absolute;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0;
    transition: color 0.12s, background 0.12s;
  }

  .search-clear:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  /* â”€â”€ Filter tabs â”€â”€ */
  .filter-tabs {
    display: flex;
    gap: 2px;
    padding: 0 8px 6px;
    flex-shrink: 0;
  }

  .scope-tab {
    flex: 1;
    padding: 4px 0;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
  }

  .scope-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .scope-tab.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-secondary));
  }

  .filter-tab {
    flex: 1;
    padding: 3px 0;
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
  }

  .filter-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .filter-tab.active {
    color: var(--text-primary);
    background: var(--bg-active, var(--bg-secondary));
  }

  /* â”€â”€ Entries list â”€â”€ */
  .entries-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb, rgba(128,128,128,0.2)) transparent;
  }

  /* â”€â”€ Empty state â”€â”€ */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 32px 16px;
    text-align: center;
    color: var(--text-muted);
  }

  .empty-icon {
    opacity: 0.35;
    margin-bottom: 4px;
  }

  .empty-state p {
    margin: 0;
    font-size: 12px;
  }

  .empty-sub {
    font-size: 11px !important;
    opacity: 0.7;
  }

  /* â”€â”€ Entry card â”€â”€ */
  .entry-card {
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg-secondary);
    overflow: hidden;
    transition: border-color 0.12s;
  }

  .entry-card:hover {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  }


  .entry-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 8px;
    min-width: 0;
  }

  /* â”€â”€ Status dot â”€â”€ */
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-muted);
    opacity: 0.45;
  }

  .status-dot.running {
    background: var(--accent);
    opacity: 1;
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent);
    animation: pulse-dot 1.4s ease infinite;
  }

  .status-dot.success {
    background: var(--success, #4ade80);
    opacity: 1;
  }

  .status-dot.failed {
    background: var(--error, #f85149);
    opacity: 1;
  }

  .status-dot.unknown {
    background: var(--text-muted);
    opacity: 0.45;
  }

  @keyframes pulse-dot {
    0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent); }
    60%  { box-shadow: 0 0 0 5px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  @keyframes history-pulse {
    0%, 100% { opacity: 0.45; transform: scale(0.9); }
    50% { opacity: 1; transform: scale(1); }
  }

  @keyframes history-bar-slide {
    0% { transform: translateX(-100%); opacity: 0.35; }
    20% { opacity: 1; }
    100% { transform: translateX(260%); opacity: 0.45; }
  }

  /* â”€â”€ Command text â”€â”€ */
  .entry-command {
    font-family: var(--editor-font-family, monospace);
    font-size: 11px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-summary {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-response-preview {
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-progress {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 14px;
  }

  .entry-progress-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    animation: history-pulse 1.1s ease-in-out infinite;
  }

  .entry-progress-bar {
    position: relative;
    width: 86px;
    height: 4px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-primary));
  }

  .entry-progress-bar-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: 34px;
    border-radius: inherit;
    background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent) 75%, white) 55%, var(--accent) 100%);
    animation: history-bar-slide 1s ease-in-out infinite;
  }

  .entry-agent {
    font-size: 9.5px;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-info-badges {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .label-badge {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    letter-spacing: 0.2px;
  }

  /* â”€â”€ Role badge â”€â”€ */
  .role-badge {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 15%, var(--bg-primary));
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  /* â”€â”€ Entry meta â”€â”€ */
  .entry-meta {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
  }

  .entry-duration {
    font-size: 9.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .entry-time {
    font-size: 9px;
    color: var(--text-muted);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  /* â”€â”€ Entry actions â”€â”€ */
  .entry-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .replay-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    border: none;
    cursor: pointer;
    background: transparent;
    color: var(--text-muted);
    transition: background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .replay-btn:hover {
    background: color-mix(in srgb, var(--accent) 15%, var(--bg-primary));
    color: var(--accent);
  }
</style>
