import { useMemo, useState } from 'react';
import { runHistory, clearRunHistory, type RunEntry } from '$lib/stores/runHistory';
import { requestTerminalInput, getAgentDisplayName } from '$lib/stores/terminal';
import { activeProject } from '$lib/stores/workspace';
import { useStore } from '$lib/react/useStore';
import './RunHistoryPanel.css';

type FilterTab = 'all' | 'running' | 'success' | 'failed';
type ScopeTab = 'project' | 'all';

const FILTER_TABS: FilterTab[] = ['all', 'running', 'success', 'failed'];

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

export default function RunHistoryPanel() {
  const history = useStore(runHistory);
  const project = useStore(activeProject);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [activeScope, setActiveScope] = useState<ScopeTab>('project');
  const [clearConfirm, setClearConfirm] = useState(false);

  function handleReplay(entry: RunEntry) {
    requestTerminalInput(entry.sessionId, entry.command);
  }

  function handleClearClick() {
    if (clearConfirm) {
      clearRunHistory();
      setClearConfirm(false);
    } else {
      setClearConfirm(true);
    }
  }

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const projectId = project?.id ?? null;
    const all = [...history].reverse();
    return all.filter((entry) => {
      if (activeScope === 'project' && projectId && entry.projectId !== projectId) return false;
      if (q && !entry.command.toLowerCase().includes(q)) return false;
      const status = entryStatus(entry);
      if (activeFilter === 'running') return status === 'running';
      if (activeFilter === 'success') return status === 'success';
      if (activeFilter === 'failed') return status === 'failed';
      return true;
    });
  }, [history, project, searchQuery, activeScope, activeFilter]);

  return (
    <div className="history-panel">
      <div className="panel-header">
        <span className="panel-title">Run History</span>
        <div className="header-actions">
          {clearConfirm ? (
            <>
              <button className="clear-confirm-btn" onClick={handleClearClick}>
                Really clear?
              </button>
              <button className="clear-cancel-btn" onClick={() => setClearConfirm(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="clear-btn"
              onClick={handleClearClick}
              title="Clear all run history"
              disabled={history.length === 0}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="search-row">
        <div className="search-wrap">
          <svg className="search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Search commands..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')} title="Clear search">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="filter-tabs">
        <button
          className={`scope-tab${activeScope === 'project' ? ' active' : ''}`}
          onClick={() => setActiveScope('project')}
          title={project ? `Show only runs for ${project.name}` : 'Show only runs for the active project'}
        >
          Current Project
        </button>
        <button
          className={`scope-tab${activeScope === 'all' ? ' active' : ''}`}
          onClick={() => setActiveScope('all')}
          title="Show runs across all open projects"
        >
          All Projects
        </button>
      </div>

      <div className="filter-tabs">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            className={`filter-tab${activeFilter === tab ? ' active' : ''}`}
            onClick={() => setActiveFilter(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="entries-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            {history.length === 0 ? (
              <>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="empty-icon">
                  <path d="M3 3v5h5" />
                  <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                  <line x1="12" y1="7" x2="12" y2="12" />
                  <line x1="12" y1="12" x2="15.5" y2="14" />
                </svg>
                <p>No commands run yet.</p>
                <p className="empty-sub">Commands sent via the prompt bar will appear here.</p>
              </>
            ) : (
              <p>No results match your filter.</p>
            )}
          </div>
        ) : (
          filtered.map((entry) => {
            const status = entryStatus(entry);
            return (
              <div className="entry-card" key={entry.id}>
                <div className="entry-header">
                  <span
                    className={`status-dot${status === 'running' ? ' running' : ''}${status === 'success' ? ' success' : ''}${status === 'failed' ? ' failed' : ''}${status === 'unknown' ? ' unknown' : ''}`}
                    title={status}
                  ></span>

                  <div className="entry-summary">
                    <span className="entry-command" title={entry.command}>{entry.command}</span>
                    {agentLabel(entry) && (
                      <span className="entry-agent">CLI: {agentLabel(entry)}</span>
                    )}
                    {status === 'running' ? (
                      <span className="entry-progress" aria-label="Generating response">
                        <span className="entry-progress-dot"></span>
                        <span className="entry-progress-bar">
                          <span className="entry-progress-bar-fill"></span>
                        </span>
                      </span>
                    ) : (
                      <span className="entry-response-preview" title={responsePreview(entry)}>{responsePreview(entry)}</span>
                    )}
                  </div>

                  <div className="entry-info-badges">
                    {entry.sessionLabel && (
                      <span className="label-badge">{entry.sessionLabel}</span>
                    )}
                    {entry.sessionRole && (
                      <span className="role-badge">{entry.sessionRole}</span>
                    )}
                  </div>

                  <div className="entry-meta">
                    <span className="entry-duration">{formatDuration(entry)}</span>
                    <span className="entry-time">{formatRelative(entry.startedAt)}</span>
                  </div>

                  <div className="entry-actions">
                    <button
                      className="replay-btn"
                      onClick={() => handleReplay(entry)}
                      title="Replay this command"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
