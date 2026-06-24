import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { activeProject } from '$lib/stores/workspace';
import { useStore } from '$lib/react/useStore';
import './DbExplorerPanel.css';

interface QueryResult {
  columns: string[];
  rows: any[][];
  affected_rows: number;
  is_select: boolean;
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

function isReadOnlyQuery(sql: string): boolean {
  const q = sql.trim().toLowerCase();
  return /^select\b/.test(q) || /^pragma\b/.test(q) || /^explain\b/.test(q);
}

export default function DbExplorerPanel() {
  const project = useStore(activeProject);

  const [dbPath, setDbPath] = useState('');
  const [tables, setTables] = useState<string[]>([]);
  const [query, setQuery] = useState('SELECT * FROM sqlite_master WHERE type="table";');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadTables(path: string) {
    if (!path) return;
    try {
      setErrorMsg('');
      const loaded = await invoke<string[]>('db_list_tables', { path });
      setTables(loaded);
    } catch (err: any) {
      setErrorMsg(`Failed to load tables: ${err}`);
      setTables([]);
    }
  }

  // Load active connection for current project
  useEffect(() => {
    if (project) {
      const stored = localStorage.getItem(`soryq_db_path_${project.id}`);
      if (stored) {
        setDbPath(stored);
        void loadTables(stored);
      } else {
        setDbPath('');
        setTables([]);
        setResult(null);
        setErrorMsg('');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  async function browseDbFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'SQLite Databases', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }],
      });
      if (selected && typeof selected === 'string') {
        setDbPath(selected);
        if (project) {
          localStorage.setItem(`soryq_db_path_${project.id}`, selected);
        }
        await loadTables(selected);
      }
    } catch (err: any) {
      setErrorMsg(err.toString());
    }
  }

  // Accepts an explicit query override so selectTable() can run immediately
  // against the new query text without waiting on the setQuery() state update
  // to flush (state set in the same tick isn't readable from `query` yet).
  async function runQuery(queryOverride?: string) {
    const q = queryOverride ?? query;
    if (!dbPath) {
      setErrorMsg('Please select a database file first.');
      return;
    }
    if (!q.trim()) {
      setErrorMsg('Please write a query to execute.');
      return;
    }
    const writeQuery = !isReadOnlyQuery(q);
    const warning = destructiveWarning(q) ?? (writeQuery ? 'This query will modify the database.' : null);
    const allowWrite = writeQuery && confirm(`${warning}\n\nRun this query anyway?`);
    if (writeQuery && !allowWrite) {
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setResult(null);
    try {
      const queryResult = await invoke<QueryResult>('db_execute_query', {
        path: dbPath,
        query: q,
        allowWrite,
      });
      setResult(queryResult);
    } catch (err: any) {
      setErrorMsg(err.toString());
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void runQuery();
    }
  }

  function selectTable(table: string) {
    const nextQuery = `SELECT * FROM ${table} LIMIT 100;`;
    setQuery(nextQuery);
    void runQuery(nextQuery);
  }

  function disconnect() {
    setDbPath('');
    setTables([]);
    setResult(null);
    setErrorMsg('');
    if (project) {
      localStorage.removeItem(`soryq_db_path_${project.id}`);
    }
  }

  function copyResultsJson() {
    if (!result || !result.is_select) return;
    const formatted = result.rows.map((row) => {
      const obj: Record<string, any> = {};
      result.columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    });
    navigator.clipboard
      .writeText(JSON.stringify(formatted, null, 2))
      .then(() => alert('Copied results as JSON to clipboard!'))
      .catch((err) => alert(`Failed to copy: ${err}`));
  }

  return (
    <div className="db-explorer">
      {/* Top connection bar */}
      <div className="connection-bar">
        {!dbPath ? (
          <button className="action-btn primary" onClick={browseDbFile}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
              <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
            </svg>
            Open SQLite Database File
          </button>
        ) : (
          <div className="active-connection">
            <span className="db-path" title={dbPath}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              {dbPath.split(/[\\/]/).pop()}
            </span>
            <div className="actions">
              <button className="icon-btn refresh" onClick={() => loadTables(dbPath)} title="Refresh Tables Schema">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
              </button>
              <button className="icon-btn disconnect" onClick={disconnect} title="Disconnect">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                  <line x1="12" y1="2" x2="12" y2="12"></line>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="scope-note">
        <span>Project</span>
        <strong>{project?.name ?? 'No active project'}</strong>
        <em>Database connection is saved for this project. Write queries require confirmation.</em>
      </div>

      {dbPath && (
        <div className="explorer-body">
          {/* Left sidebar: Tables */}
          <aside className="tables-sidebar">
            <div className="sidebar-header">TABLES ({tables.length})</div>
            <div className="tables-list scrollable">
              {tables.length > 0 ? (
                tables.map((table) => (
                  <button key={table} className="table-item" onClick={() => selectTable(table)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                      <line x1="3" y1="9" x2="21" y2="9"></line>
                      <line x1="9" y1="21" x2="9" y2="9"></line>
                    </svg>
                    <span>{table}</span>
                  </button>
                ))
              ) : (
                <div className="empty-state">No tables found</div>
              )}
            </div>
          </aside>

          {/* Main workspace: Editor & Results */}
          <div className="query-workspace">
            <div className="editor-section">
              <textarea
                className="sql-editor"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write SQL query here... (Ctrl+Enter to Run)"
              ></textarea>
              <div className="editor-actions">
                <span className="editor-hint">Ctrl+Enter to Execute</span>
                <button className="action-btn primary" onClick={() => runQuery()} disabled={loading}>
                  {loading ? (
                    <>
                      <div className="spinner"></div>
                      Running...
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                      Execute Query
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Output section */}
            <div className="results-section">
              {errorMsg ? (
                <div className="error-banner">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{errorMsg}</span>
                </div>
              ) : loading ? (
                <div className="loading-state">
                  <div className="shimmer-rows">
                    <div className="shimmer-row header"></div>
                    <div className="shimmer-row"></div>
                    <div className="shimmer-row"></div>
                    <div className="shimmer-row"></div>
                  </div>
                </div>
              ) : result ? (
                <div className="results-container">
                  {result.is_select ? (
                    <>
                      <div className="results-header">
                        <span className="results-count">Returned {result.rows.length} rows</span>
                        <button className="text-btn" onClick={copyResultsJson}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                          Copy JSON
                        </button>
                      </div>
                      <div className="grid-wrapper scrollable">
                        <table className="results-grid">
                          <thead>
                            <tr>
                              {result.columns.map((col, idx) => (
                                <th key={idx}>{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {result.rows.map((row, rowIdx) => (
                              <tr key={rowIdx}>
                                {row.map((cell, cellIdx) => (
                                  <td key={cellIdx}>
                                    {cell === null ? (
                                      <span className="cell-null">NULL</span>
                                    ) : typeof cell === 'object' ? (
                                      <span className="cell-json">{JSON.stringify(cell)}</span>
                                    ) : typeof cell === 'string' && cell.startsWith('blob:') ? (
                                      <span className="cell-blob" title={cell}>
                                        BLOB ({Math.round((cell.length - 5) * 0.75)} bytes)
                                      </span>
                                    ) : (
                                      cell
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="success-banner">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                      <span>Query completed successfully. Affected rows: {result.affected_rows}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-results">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="4" y="4" width="16" height="16" rx="2"></rect>
                    <line x1="9" y1="9" x2="15" y2="9"></line>
                    <line x1="9" y1="13" x2="15" y2="13"></line>
                    <line x1="9" y1="17" x2="13" y2="17"></line>
                  </svg>
                  <span>Query results will appear here</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
