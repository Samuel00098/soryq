import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  const [dropUp, setDropUp] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerEl = useRef<HTMLButtonElement | null>(null);
  const menuEl = useRef<HTMLDivElement | null>(null);

  const [editing, setEditing] = useState(false);
  const [tempName, setTempName] = useState('');

  const orderedWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => a.id.localeCompare(b.id)),
    [workspaces],
  );

  const updatePlacement = useCallback(() => {
    if (!triggerEl.current) return;
    const r = triggerEl.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const willDropUp = below < 200 && above > below;
    setDropUp(willDropUp);

    const maxHeight = Math.max(160, Math.min(280, (willDropUp ? above : below) - 16));
    const next: CSSProperties = {
      position: 'fixed',
      left: `${r.left}px`,
      minWidth: `${Math.max(r.width, 200)}px`,
      maxHeight,
    };
    if (willDropUp) {
      next.bottom = `${window.innerHeight - r.top + 6}px`;
    } else {
      next.top = `${r.bottom + 6}px`;
    }
    setMenuStyle(next);
  }, []);

  function toggleMenu(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open) updatePlacement();
    setOpen((o) => !o);
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

  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerEl.current?.contains(target)) return;
      if (menuEl.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const reposition = () => updatePlacement();
    document.addEventListener('mousedown', handlePointer);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, updatePlacement]);

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
              onClick={toggleMenu}
              title="Switch workspace"
            >
              <span
                className="ws-dot"
                style={{ background: wsColor(workspace?.name ?? 'Workspace') }}
              />
              <span className="ws-trigger-name">{workspace?.name ?? 'Workspace'}</span>
              <svg
                className="ws-caret"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button className="ws-rename-btn" onClick={startRename} title="Rename workspace">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
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

      {open && createPortal(
        <div
          ref={menuEl}
          className={`ws-menu${dropUp ? ' drop-up' : ''}`}
          role="menu"
          style={menuStyle}
        >
          <div className="ws-menu-label">Workspaces</div>
          <div className="ws-menu-list">
            {orderedWorkspaces.map((ws) => (
              <button
                key={ws.id}
                className={`ws-menu-item${workspaceId === ws.id ? ' active' : ''}`}
                onClick={() => handleSwitch(ws.id)}
              >
                <span className="ws-dot" style={{ background: wsColor(ws.name) }} />
                <span className="ws-menu-name">{ws.name}</span>
                {workspaceId === ws.id && (
                  <svg
                    className="ws-check"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
          <div className="ws-menu-sep" />
          <button className="ws-menu-item ws-menu-new" onClick={handleNew}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New workspace</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
