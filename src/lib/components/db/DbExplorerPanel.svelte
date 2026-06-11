<!-- DbExplorerPanel.svelte -->
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { activeProject } from '$lib/stores/workspace';
  import { onMount } from 'svelte';

  interface QueryResult {
    columns: string[];
    rows: any[][];
    affected_rows: number;
    is_select: boolean;
  }

  let dbPath = $state('');
  let tables = $state<string[]>([]);
  let query = $state('SELECT * FROM sqlite_master WHERE type="table";');
  let result = $state<QueryResult | null>(null);
  let errorMsg = $state('');
  let loading = $state(false);

  // Load active connection for current project
  $effect(() => {
    if ($activeProject) {
      const stored = localStorage.getItem(`soryq_db_path_${$activeProject.id}`);
      if (stored) {
        dbPath = stored;
        void loadTables();
      } else {
        dbPath = '';
        tables = [];
        result = null;
        errorMsg = '';
      }
    }
  });

  async function browseDbFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'SQLite Databases', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }]
      });
      if (selected && typeof selected === 'string') {
        dbPath = selected;
        if ($activeProject) {
          localStorage.setItem(`soryq_db_path_${$activeProject.id}`, selected);
        }
        await loadTables();
      }
    } catch (err: any) {
      errorMsg = err.toString();
    }
  }

  async function loadTables() {
    if (!dbPath) return;
    try {
      errorMsg = '';
      tables = await invoke<string[]>('db_list_tables', { path: dbPath });
    } catch (err: any) {
      errorMsg = `Failed to load tables: ${err}`;
      tables = [];
    }
  }

  // Returns a human warning when a query would irreversibly change data, or null
  // when it's safe. Strips both line (`--`) and block (`/* */`) comments first so
  // a commented-out WHERE can't mask a full-table DELETE/UPDATE — e.g.
  // `DELETE FROM t /* WHERE id=1 */` must still trip the no-WHERE warning.
  function destructiveWarning(sql: string): string | null {
    const q = sql
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
      .toLowerCase();
    if (/^drop\b/.test(q)) return 'This will DROP a table or index. The data and its structure will be permanently removed.';
    if (/^truncate\b/.test(q)) return 'This will TRUNCATE the table. Every row will be permanently removed.';
    if (/^delete\b/.test(q) && !/\bwhere\b/.test(q)) return 'This DELETE has no WHERE clause. Every row in the table will be removed.';
    if (/^update\b/.test(q) && !/\bwhere\b/.test(q)) return 'This UPDATE has no WHERE clause. Every row in the table will be modified.';
    return null;
  }

  async function runQuery() {
    if (!dbPath) {
      errorMsg = 'Please select a database file first.';
      return;
    }
    if (!query.trim()) {
      errorMsg = 'Please write a query to execute.';
      return;
    }
    const warning = destructiveWarning(query);
    if (warning && !confirm(`${warning}\n\nRun this query anyway?`)) {
      return;
    }
    loading = true;
    errorMsg = '';
    result = null;
    try {
      result = await invoke<QueryResult>('db_execute_query', {
        path: dbPath,
        query: query
      });
    } catch (err: any) {
      errorMsg = err.toString();
    } finally {
      loading = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void runQuery();
    }
  }

  function selectTable(table: string) {
    query = `SELECT * FROM ${table} LIMIT 100;`;
    void runQuery();
  }

  function disconnect() {
    dbPath = '';
    tables = [];
    result = null;
    errorMsg = '';
    if ($activeProject) {
      localStorage.removeItem(`soryq_db_path_${$activeProject.id}`);
    }
  }

  function copyResultsJson() {
    if (!result || !result.is_select) return;
    const formatted = result.rows.map(row => {
      const obj: Record<string, any> = {};
      result!.columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    });
    navigator.clipboard.writeText(JSON.stringify(formatted, null, 2))
      .then(() => alert('Copied results as JSON to clipboard!'))
      .catch(err => alert(`Failed to copy: ${err}`));
  }
</script>

<div class="db-explorer">
  <!-- Top connection bar -->
  <div class="connection-bar">
    {#if !dbPath}
      <button class="action-btn primary" onclick={browseDbFile}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
        </svg>
        Open SQLite Database File
      </button>
    {:else}
      <div class="active-connection">
        <span class="db-path" title={dbPath}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          {dbPath.split(/[\\/]/).pop()}
        </span>
        <div class="actions">
          <button class="icon-btn refresh" onclick={loadTables} title="Refresh Tables Schema">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
          <button class="icon-btn disconnect" onclick={disconnect} title="Disconnect">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
              <line x1="12" y1="2" x2="12" y2="12"></line>
            </svg>
          </button>
        </div>
      </div>
    {/if}
  </div>

  {#if dbPath}
    <div class="explorer-body">
      <!-- Left sidebar: Tables -->
      <aside class="tables-sidebar">
        <div class="sidebar-header">TABLES ({tables.length})</div>
        <div class="tables-list scrollable">
          {#each tables as table}
            <button class="table-item" onclick={() => selectTable(table)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="9" y1="21" x2="9" y2="9"></line>
              </svg>
              <span>{table}</span>
            </button>
          {:else}
            <div class="empty-state">No tables found</div>
          {/each}
        </div>
      </aside>

      <!-- Main workspace: Editor & Results -->
      <div class="query-workspace">
        <div class="editor-section">
          <textarea
            class="sql-editor"
            bind:value={query}
            onkeydown={handleKeyDown}
            placeholder="Write SQL query here... (Ctrl+Enter to Run)"
          ></textarea>
          <div class="editor-actions">
            <span class="editor-hint">Ctrl+Enter to Execute</span>
            <button class="action-btn primary" onclick={runQuery} disabled={loading}>
              {#if loading}
                <div class="spinner"></div>
                Running...
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Execute Query
              {/if}
            </button>
          </div>
        </div>

        <!-- Output section -->
        <div class="results-section">
          {#if errorMsg}
            <div class="error-banner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{errorMsg}</span>
            </div>
          {:else if loading}
            <div class="loading-state">
              <div class="shimmer-rows">
                <div class="shimmer-row header"></div>
                <div class="shimmer-row"></div>
                <div class="shimmer-row"></div>
                <div class="shimmer-row"></div>
              </div>
            </div>
          {:else if result}
            <div class="results-container">
              {#if result.is_select}
                <div class="results-header">
                  <span class="results-count">Returned {result.rows.length} rows</span>
                  <button class="text-btn" onclick={copyResultsJson}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copy JSON
                  </button>
                </div>
                <div class="grid-wrapper scrollable">
                  <table class="results-grid">
                    <thead>
                      <tr>
                        {#each result.columns as col}
                          <th>{col}</th>
                        {/each}
                      </tr>
                    </thead>
                    <tbody>
                      {#each result.rows as row}
                        <tr>
                          {#each row as cell}
                            <td>
                              {#if cell === null}
                                <span class="cell-null">NULL</span>
                              {:else if typeof cell === 'object'}
                                <span class="cell-json">{JSON.stringify(cell)}</span>
                              {:else if typeof cell === 'string' && cell.startsWith('blob:')}
                                <span class="cell-blob" title={cell}>BLOB ({Math.round((cell.length - 5) * 0.75)} bytes)</span>
                              {:else}
                                {cell}
                              {/if}
                            </td>
                          {/each}
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else}
                <div class="success-banner">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  <span>Query completed successfully. Affected rows: {result.affected_rows}</span>
                </div>
              {/if}
            </div>
          {:else}
            <div class="empty-results">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                <rect x="4" y="4" width="16" height="16" rx="2"></rect>
                <line x1="9" y1="9" x2="15" y2="9"></line>
                <line x1="9" y1="13" x2="15" y2="13"></line>
                <line x1="9" y1="17" x2="13" y2="17"></line>
              </svg>
              <span>Query results will appear here</span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .db-explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: transparent;
    container-type: inline-size;
  }

  .connection-bar {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    background: color-mix(in srgb, var(--bg-secondary) 30%, transparent);
  }

  .active-connection {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .db-path {
    font-size: 12px;
    color: var(--text-primary);
    font-weight: 550;
    font-family: var(--font-mono, monospace);
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .db-path svg {
    color: var(--success);
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    background: transparent;
    border: none;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, color 0.12s;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn.disconnect:hover {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    color: var(--error);
  }

  .explorer-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  .tables-sidebar {
    width: 180px;
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg-secondary) 15%, transparent);
    flex-shrink: 0;
  }

  .sidebar-header {
    padding: 8px 12px;
    font-size: 10px;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 0.8px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .tables-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overscroll-behavior: none;
    scrollbar-gutter: stable;
  }

  .table-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 5px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11.5px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }

  .table-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .table-item svg {
    color: var(--text-muted);
  }

  .query-workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .editor-section {
    padding: 12px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: color-mix(in srgb, var(--bg-secondary) 10%, transparent);
  }

  .sql-editor {
    width: 100%;
    height: 90px;
    background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    padding: 8px 10px;
    resize: vertical;
    outline: none;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
  }

  .sql-editor:focus {
    border-color: var(--accent);
  }

  .editor-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .editor-hint {
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .results-section {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
  }

  .results-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .results-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--bg-secondary) 12%, transparent);
  }

  .results-count {
    font-size: 11.5px;
    font-weight: 550;
    color: var(--text-secondary);
  }

  .grid-wrapper {
    flex: 1;
    overflow: auto;
    background: color-mix(in srgb, var(--bg-primary) 30%, transparent);
    overscroll-behavior: none;
    scrollbar-gutter: stable;
  }

  .results-grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
    text-align: left;
  }

  .results-grid th {
    position: sticky;
    top: 0;
    background: var(--bg-secondary);
    padding: 8px 10px;
    font-weight: 600;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border);
    z-index: 1;
    white-space: nowrap;
  }

  .results-grid td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-family: var(--font-mono, monospace);
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .results-grid tr:hover td {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .cell-null {
    color: var(--text-muted);
    font-style: italic;
    opacity: 0.65;
  }

  .cell-json {
    color: var(--accent);
  }

  .cell-blob {
    color: var(--warning);
    font-size: 10px;
  }

  .error-banner, .success-banner {
    margin: 12px;
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 12px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    line-height: 1.4;
  }

  .error-banner {
    background: color-mix(in srgb, var(--error) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
    color: var(--error);
  }

  .success-banner {
    background: color-mix(in srgb, var(--success) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
    color: var(--success);
  }

  .empty-results {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-muted);
  }

  .empty-results span {
    font-size: 12px;
  }

  /* Shimmer placeholder */
  .loading-state {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .shimmer-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .shimmer-row {
    height: 18px;
    background: linear-gradient(90deg, var(--bg-hover) 25%, var(--border) 50%, var(--bg-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer-pulse 1.6s infinite linear;
    border-radius: 4px;
  }

  .shimmer-row.header {
    height: 24px;
    margin-bottom: 4px;
  }

  @keyframes shimmer-pulse {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  /* Shared components styling */
  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--border);
    transition: all 0.15s;
  }

  .action-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .action-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover, var(--accent));
  }

  .action-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .text-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
  }

  .text-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin-anim 0.6s infinite linear;
  }

  @keyframes spin-anim {
    to { transform: rotate(360deg); }
  }

  .scrollable::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .scrollable::-webkit-scrollbar-track {
    background: transparent;
  }

  .scrollable::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.15));
    border-radius: 3px;
  }

  .scrollable::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }

  @container (max-width: 540px) {
    .explorer-body {
      flex-direction: column;
    }
    .tables-sidebar {
      width: 100%;
      height: 140px;
      border-right: none;
      border-bottom: 1px solid var(--border-subtle);
    }
  }
</style>
