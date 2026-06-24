import { useState } from 'react';
import {
  deleteSnapshot,
  renameSnapshot,
  restoreSnapshot,
  saveSnapshot,
  type WorkspaceSnapshot,
} from '$lib/stores/snapshot';
import { useSnapshotStore } from '$lib/stores/zustand/snapshot';
import { showToast } from '$lib/stores/notification';
import './SnapshotsPanel.css';

const LAYOUT_ICONS: Record<string, string> = {
  single: '□',
  '2h': '□□',
  '2v': '□\n□',
  '3h': '□□□',
  '3v': '□\n□\n□',
  '4': '⊞',
  '9': '⊟',
};

const ROLE_COLORS: Record<string, string> = {
  Server: '#4ade80',
  Tests: '#60a5fa',
  Build: '#fb923c',
  Agent: '#a78bfa',
  Git: '#fbbf24',
};

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function EmptyIllustration() {
  return (
    <svg width="48" height="48" viewBox="0 0 64 64" fill="none" stroke="currentColor" className="animated-svg-floating" style={{ marginBottom: 8 }}>
      <circle cx="32" cy="32" r="28" fill="var(--bg-hover)" stroke="var(--border)" strokeWidth="1" />
      <rect x="20" y="24" width="24" height="18" rx="3" stroke="var(--text-secondary)" strokeWidth="1.5" />
      <path d="M 28,24 L 30,20 L 34,20 L 36,24" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="32" cy="33" r="5" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx="41" cy="27" r="1.5" fill="var(--text-muted)" />
      <g className="animated-layout-box" style={{ animation: 'floating-sub 5s ease-in-out infinite' }}>
        <rect x="14" y="12" width="10" height="8" rx="1.5" fill="rgba(6, 182, 212, 0.15)" stroke="var(--accent)" strokeWidth="1" />
        <line x1="19" y1="12" x2="19" y2="20" stroke="var(--accent)" strokeWidth="0.8" />
      </g>
      <g className="animated-layout-box-2" style={{ animation: 'floating-sub 5s ease-in-out infinite 2s' }}>
        <rect x="42" y="14" width="10" height="8" rx="1.5" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1" />
      </g>
    </svg>
  );
}

function RestoreIcon({ spinning }: { spinning: boolean }) {
  if (spinning) {
    return (
      <svg className="spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
      </svg>
    );
  }

  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.122 2.122 0 1 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function UrlIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10z" />
    </svg>
  );
}

export default function SnapshotsPanel() {
  const list = useSnapshotStore((s) => s.snapshots);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const snapshot = saveSnapshot(newName);
      showToast(`Saved "${snapshot.name}"`, 'success');
      setNewName('');
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(snapshot: WorkspaceSnapshot) {
    if (restoring) return;
    setRestoring(snapshot.id);
    try {
      await restoreSnapshot(snapshot);
      showToast(`Restored "${snapshot.name}"`, 'success');
    } catch {
      showToast('Failed to restore snapshot', 'error');
    } finally {
      setRestoring(null);
    }
  }

  function startEdit(snapshot: WorkspaceSnapshot) {
    setEditingId(snapshot.id);
    setEditingName(snapshot.name);
  }

  function commitEdit(id: string) {
    renameSnapshot(id, editingName);
    setEditingId(null);
  }

  function handleEditKey(event: React.KeyboardEvent<HTMLInputElement>, id: string) {
    if (event.key === 'Enter') {
      commitEdit(id);
      event.stopPropagation();
    }
    if (event.key === 'Escape') {
      setEditingId(null);
      event.stopPropagation();
    }
  }

  return (
    <div className="snapshots-panel">
      <div className="panel-header">
        <span className="panel-title">Workspace Snapshots</span>
      </div>

      <div className="save-section">
        <input
          className="name-input"
          type="text"
          placeholder="Snapshot name..."
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSave();
          }}
        />
        <button className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? '...' : 'Save'}
        </button>
      </div>

      <div className="snap-list">
        {list.length === 0 ? (
          <div className="empty-state">
            <EmptyIllustration />
            <p style={{ fontWeight: 550, color: 'var(--text-primary)' }}>No Snapshots Yet</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '10.5px', lineHeight: 1.4 }}>Save your current layout configuration to restore it later.</p>
          </div>
        ) : (
          list.map((snapshot) => (
            <div className="snap-card" key={snapshot.id}>
              <div className="snap-top">
                <span className="layout-badge" title={`Grid layout: ${snapshot.gridLayout}`}>
                  {LAYOUT_ICONS[snapshot.gridLayout] ?? snapshot.gridLayout}
                </span>

                <div className="snap-name-area">
                  {editingId === snapshot.id ? (
                    <input
                      className="snap-name-input"
                      type="text"
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => handleEditKey(event, snapshot.id)}
                      onBlur={() => commitEdit(snapshot.id)}
                      autoFocus
                    />
                  ) : (
                    <span className="snap-name" onDoubleClick={() => startEdit(snapshot)}>{snapshot.name}</span>
                  )}
                  <span className="snap-date">{formatDate(snapshot.savedAt)}</span>
                </div>

                <div className="snap-actions">
                  <button className="snap-btn restore-btn" onClick={() => void handleRestore(snapshot)} disabled={restoring === snapshot.id} title="Restore this snapshot">
                    <RestoreIcon spinning={restoring === snapshot.id} />
                  </button>
                  <button className="snap-btn edit-btn" onClick={() => startEdit(snapshot)} title="Rename">
                    <EditIcon />
                  </button>
                  <button className="snap-btn delete-btn" onClick={() => deleteSnapshot(snapshot.id)} title="Delete snapshot">
                    <DeleteIcon />
                  </button>
                </div>
              </div>

              {snapshot.panes.some(Boolean) && (
                <div className="pane-preview">
                  {snapshot.panes.map((pane, index) => (
                    <div className={`pane-chip${pane === null ? ' empty' : ''}`} key={`${snapshot.id}:${index}`}>
                      {pane?.role ? (
                        <>
                          <span className="pane-role-dot" style={{ background: ROLE_COLORS[pane.role] ?? '#9ca3af' }} />
                          <span className="pane-role-label">{pane.role}</span>
                        </>
                      ) : pane !== null ? (
                        <span className="pane-role-label muted">Terminal</span>
                      ) : (
                        <span className="pane-role-label muted">-</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {snapshot.previewUrl && snapshot.previewUrl !== '/' && snapshot.previewUrl !== 'about:blank' && (
                <div className="snap-url">
                  <UrlIcon />
                  {snapshot.previewUrl.length > 36 ? `${snapshot.previewUrl.slice(0, 36)}...` : snapshot.previewUrl}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
