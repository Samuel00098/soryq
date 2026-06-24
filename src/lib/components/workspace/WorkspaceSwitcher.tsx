import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  recentWorkspaces,
  activeWorkspaceId,
  activeWorkspace,
  openWorkspace,
  newWorkspacePromptOpen,
  renameWorkspace,
} from '$lib/stores/workspace';
import { useStore } from '$lib/react/useStore';
import './WorkspaceSwitcher.css';

function wsColor(name: string): string {
  const hash =
    Math.abs(name.split('').reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0)) % 360;
  return `hsl(${hash} 50% 55%)`;
}

export default function WorkspaceSwitcher() {
  const workspaces = useStore(recentWorkspaces);
  const workspaceId = useStore(activeWorkspaceId);
  const workspace = useStore(activeWorkspace);

  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0, w: 200 });
  const triggerEl = useRef<HTMLButtonElement | null>(null);

  // Inline rename state.
  const [editing, setEditing] = useState(false);
  const [tempName, setTempName] = useState('');

  // openWorkspace() moves the active workspace to the front of recentWorkspaces
  // (for the Welcome screen's "recent" list). Keep the popup list in a stable
  // creation order so entries don't reshuffle when you switch between them.
  // Workspace ids are `ws-${Date.now()}`, so they sort chronologically.
  const orderedWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => a.id.localeCompare(b.id)),
    [workspaces],
  );

  function toggleMenu() {
    if (open) {
      setOpen(false);
      return;
    }
    if (triggerEl.current) {
      const rect = triggerEl.current.getBoundingClientRect();
      setMenuPos({ x: rect.left, y: rect.bottom + 4, w: Math.max(rect.width, 200) });
    }
    setOpen(true);
  }

  async function handleSwitch(id: string) {
    setOpen(false);
    if (id === workspaceId) return;
    await openWorkspace(id);
  }

  function handleNew() {
    setOpen(false);
    newWorkspacePromptOpen.set(true);
  }

  // ── Rename ──
  function startRename(e: React.MouseEvent) {
    e.stopPropagation();
    if (workspace) {
      setTempName(workspace.name);
      setEditing(true);
    }
  }

  function saveRename() {
    const trimmed = tempName.trim();
    if (trimmed && workspace) {
      renameWorkspace(workspace.id, trimmed);
    }
    setEditing(false);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') saveRename();
    else if (e.key === 'Escape') setEditing(false);
  }

  // Dismiss popup on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', dismiss);
    document.addEventListener('contextmenu', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', dismiss);
      document.removeEventListener('contextmenu', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const menuStyle: CSSProperties = {
    top: `${menuPos.y}px`,
    left: `${menuPos.x}px`,
    minWidth: `${menuPos.w}px`,
  };

  return (
    <>
      <div className="ws-header">
        {editing ? (
          <input
            className="ws-rename-input"
            type="text"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={saveRename}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <>
            <button
              ref={triggerEl}
              className={`ws-trigger${open ? ' open' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleMenu();
              }}
              title="Switch workspace"
            >
              <span
                className="ws-dot"
                style={{ background: wsColor(workspace?.name ?? 'Workspace') }}
              ></span>
              <span className="ws-trigger-name">{workspace?.name ?? 'Workspace'}</span>
              <svg
                className="ws-caret"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button className="ws-rename-btn" onClick={startRename} title="Rename workspace">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.122 2.122 0 1 1 3 3L12 15l-4 1 1-4z" />
              </svg>
            </button>
          </>
        )}
      </div>

      {open && (
        <div
          className="ws-menu"
          role="menu"
          tabIndex={-1}
          style={menuStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ws-menu-label">Workspaces</div>
          <div className="ws-menu-list">
            {orderedWorkspaces.map((ws) => (
              <button
                key={ws.id}
                className={`ws-menu-item${workspaceId === ws.id ? ' active' : ''}`}
                onClick={() => handleSwitch(ws.id)}
              >
                <span className="ws-dot" style={{ background: wsColor(ws.name) }}></span>
                <span className="ws-menu-name">{ws.name}</span>
                {workspaceId === ws.id && (
                  <svg
                    className="ws-check"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
          <div className="ws-menu-sep"></div>
          <button className="ws-menu-item ws-menu-new" onClick={handleNew}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New workspace</span>
          </button>
        </div>
      )}
    </>
  );
}
