import { useEffect, useMemo, useState } from 'react';
import packageJson from '../../../../package.json';
import {
  clearAllApplicationState,
  newWorkspacePromptOpen,
  openProject,
  openWorkspace,
  recentWorkspaces,
  renameWorkspace,
} from '$lib/stores/workspace';
import { search as paletteSearch } from '$lib/stores/commandpalette';
import { useWorkspaceStore } from '$lib/stores/zustand/workspace';
import { useThemeStore } from '$lib/stores/zustand/theme';
import { openSettings } from '$lib/stores/layout';
import { useStore } from '$lib/react/useStore';
import type { Workspace } from '$lib/types/workspace';
import './WelcomeScreen.css';

const iconSrc = `/icon.png?v=${packageJson.version}`;

function FolderIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function formatTime(ts: string): string {
  try {
    const n = parseInt(ts, 10);
    if (Number.isNaN(n)) return '';
    const diff = Date.now() - n;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d < 7) return `${d}d ago`;
    return new Date(n).toLocaleDateString();
  } catch {
    return '';
  }
}

function shortPath(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts.length <= 2 ? normalized : `.../${parts.slice(-2).join('/')}`;
}

function projectHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

export default function WelcomeScreen() {
  const workspaces = useWorkspaceStore((s) => s.recentWorkspaces);
  const search = useStore(paletteSearch);
  const theme = useThemeStore((s) => s.activeTheme);

  const [iconError, setIconError] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const [timeString, setTimeString] = useState('');
  const [dateString, setDateString] = useState('');

  const isLight = theme?.type === 'light';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const filteredWorkspaces = useMemo(() => {
    const list = workspaces || [];
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter((workspace) =>
      workspace.name.toLowerCase().includes(q) ||
      (workspace.project_paths || []).some((path) => path.toLowerCase().includes(q)),
    );
  }, [search, workspaces]);

  function updateTime() {
    const now = new Date();
    setTimeString(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setDateString(now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }));
  }

  function removeRecent(event: React.MouseEvent, id: string) {
    event.stopPropagation();
    recentWorkspaces.update((current) => current.filter((workspace) => workspace.id !== id));
  }

  function startRename(event: React.MouseEvent, id: string, name: string) {
    event.stopPropagation();
    setRenamingId(id);
    setRenamingName(name);
  }

  function saveRename(id: string) {
    const name = renamingName.trim();
    if (name) renameWorkspace(id, name);
    setRenamingId(null);
    setRenamingName('');
  }

  function handleRenameKey(event: React.KeyboardEvent<HTMLInputElement>, id: string) {
    if (event.key === 'Enter') saveRename(id);
    if (event.key === 'Escape') {
      setRenamingId(null);
      setRenamingName('');
    }
  }

  useEffect(() => {
    updateTime();
    const timer = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`welcome${isLight ? ' light' : ''}`}>
      <div className="welcome-centered-container">
        
        {/* Top Horizontal Brand Header */}
        <header className="welcome-header">
          <div className="brand-title-row">
            <div className="logo-wrap">
              {!iconError ? (
                <img src={iconSrc} alt="Soryq" className="logo-img" onError={() => setIconError(true)} />
              ) : (
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" className="logo-fallback">
                  <rect width="36" height="36" rx="8" fill="#2f343b" />
                  <polyline points="6,22 10,18 6,14" fill="none" stroke="#aeb6c2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x="12" y="16.5" width="11" height="2.5" rx="1.25" fill="rgba(255,255,255,0.55)" />
                  <rect x="12" y="21" width="8" height="2" rx="1" fill="rgba(255,255,255,0.2)" />
                </svg>
              )}
            </div>
          </div>
          <div className="brand-subtitle-row">
            <span className="welcome-kicker">{greeting}</span>
            <span className="subtitle-divider">•</span>
            <span className="app-tagline">{dateString}</span>
            <span className="subtitle-divider">•</span>
            <span className="app-clock">{timeString}</span>
          </div>
        </header>

        {/* Centralized Launchpad Row */}
        <div className="launchpad-row">
          <button className="action-btn primary" onClick={() => newWorkspacePromptOpen.set(true)}>
            <span className="action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg></span>
            <span className="action-label">New Workspace</span>
            <kbd>Ctrl+N</kbd>
          </button>
          <button className="action-btn secondary" onClick={() => void openProject()}>
            <span className="action-icon"><FolderIcon size={15} /></span>
            <span className="action-label">Open Folder</span>
            <kbd>Ctrl+O</kbd>
          </button>
          <button className="action-btn secondary" onClick={openSettings}>
            <span className="action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg></span>
            <span className="action-label">Settings</span>
            <kbd>Ctrl+,</kbd>
          </button>
        </div>

        {/* Centralized Recent Workspaces Card */}
        <section className="dashboard-block recents-block">
          <div className="block-header">
            <div className="header-title-group">
              <span className="section-label">Recent Workspaces</span>
              {search && <span className="search-pill">Filtered: "{search}"</span>}
            </div>
            {workspaces.length > 0 && <button className="text-btn danger" onClick={clearAllApplicationState}>Clear all</button>}
          </div>

          {filteredWorkspaces.length > 0 ? (
            <div className="recent-list-layout scrollable">
              {filteredWorkspaces.map((workspace) => (
                <RecentWorkspaceRow
                  key={workspace.id}
                  workspace={workspace}
                  isLight={isLight}
                  renaming={renamingId === workspace.id}
                  renamingName={renamingName}
                  onOpen={() => void openWorkspace(workspace.id)}
                  onRenameChange={setRenamingName}
                  onRenameKey={(event) => handleRenameKey(event, workspace.id)}
                  onRenameBlur={() => saveRename(workspace.id)}
                  onStartRename={(event) => startRename(event, workspace.id, workspace.name)}
                  onRemove={(event) => removeRecent(event, workspace.id)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>No Recent Workspaces</p>
              <span>Open a workspace to get started</span>
            </div>
          )}
        </section>

        {/* Consolidated Shortcuts Footer */}
        <footer className="welcome-footer">
          <div className="shortcuts-bar">
            <div className="shortcuts-inline">
              {[
                ['New workspace', 'Ctrl+N'],
                ['Open folder', 'Ctrl+O'],
                ['Open settings', 'Ctrl+,'],
                ['Command palette', 'Ctrl+Shift+P'],
                ['Zoom in', 'Ctrl+='],
                ['Zoom out', 'Ctrl+-'],
                ['Reset zoom', 'Ctrl+0'],
              ].map(([label, keys]) => (
                <div className="shortcut-pill" key={label}>
                  <span className="shortcut-key-label">{label}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </div>
          </div>
        </footer>

      </div>
    </div>
  );
}

function RecentWorkspaceRow({
  workspace,
  isLight,
  renaming,
  renamingName,
  onOpen,
  onRenameChange,
  onRenameKey,
  onRenameBlur,
  onStartRename,
  onRemove,
}: {
  workspace: Workspace;
  isLight: boolean;
  renaming: boolean;
  renamingName: string;
  onOpen: () => void;
  onRenameChange: (value: string) => void;
  onRenameKey: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onRenameBlur: () => void;
  onStartRename: (event: React.MouseEvent) => void;
  onRemove: (event: React.MouseEvent) => void;
}) {
  const hue = projectHue(workspace.name);
  const avatarStyle = {
    '--hue': `${hue}`,
    background: isLight ? 'hsl(var(--hue) 50% 92%)' : 'hsl(var(--hue) 35% 20% / 0.45)',
    borderColor: isLight ? 'hsl(var(--hue) 50% 82%)' : 'hsl(var(--hue) 35% 30% / 0.4)',
    color: isLight ? 'hsl(var(--hue) 60% 35%)' : 'hsl(var(--hue) 60% 70%)',
  } as React.CSSProperties;

  return (
    <button className="recent-item" onClick={onOpen}>
      <span className="recent-avatar" style={avatarStyle}>
        {workspace.name ? workspace.name.charAt(0).toUpperCase() : <FolderIcon />}
      </span>
      <span className="recent-info">
        {renaming ? (
          <input
            className="rename-input"
            value={renamingName}
            onChange={(event) => onRenameChange(event.target.value)}
            onKeyDown={onRenameKey}
            onBlur={onRenameBlur}
            onClick={(event) => event.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="recent-name">{workspace.name}</span>
        )}
        <span className="recent-path" title={workspace.project_paths.join(', ')}>
          {workspace.project_paths.length === 0 ? 'Empty workspace' : workspace.project_paths.map(shortPath).join(', ')}
        </span>
      </span>
      <span className="recent-actions">
        {workspace.last_opened && <span className="recent-time">{formatTime(workspace.last_opened)}</span>}
        <span role="button" tabIndex={0} className="icon-btn" onClick={onStartRename} title="Rename" aria-label={`Rename ${workspace.name}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.122 2.122 0 1 1 3 3L12 15l-4 1 1-4z" /></svg>
        </span>
        <span role="button" tabIndex={0} className="icon-btn danger" onClick={onRemove} title="Remove" aria-label={`Remove ${workspace.name}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </span>
      </span>
    </button>
  );
}
