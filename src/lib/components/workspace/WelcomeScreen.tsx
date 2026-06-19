import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import packageJson from '../../../../package.json';
import {
  addFolderToWorkspace,
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
import { openFile } from '$lib/stores/editor';
import { useStore } from '$lib/react/useStore';
import { isTauriRuntime } from '$lib/utils/tauri';
import type { Workspace } from '$lib/types/workspace';
import './WelcomeScreen.css';

type HnStory = {
  id: number;
  title: string;
  url?: string;
  score?: number;
  by?: string;
  kids?: number[];
};

type GithubRepo = {
  full_name: string;
  description?: string | null;
  html_url: string;
  language?: string | null;
  stargazers_count: number;
};

type DailyNote = {
  project_path: string;
  project_name: string;
  filepath: string;
  date: string;
  focus: string[];
  done: string[];
};

const iconSrc = `/icon.png?v=${packageJson.version}`;

function FolderIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
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

async function fetchCorsFree(url: string, headers: Record<string, string> = {}): Promise<any> {
  const requestHeaders = {
    'User-Agent': 'Soryq-Developer-Workspace/1.0',
    ...headers,
  };

  if (!isTauriRuntime()) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    return response.json();
  }

  const payload = await invoke<{ body: string }>('http_send_request', {
    method: 'GET',
    url,
    headers: requestHeaders,
    body: null,
  });
  return JSON.parse(payload.body);
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
  const [hnStories, setHnStories] = useState<HnStory[]>([]);
  const [loadingHn, setLoadingHn] = useState(false);
  const [ghRepos, setGhRepos] = useState<GithubRepo[]>([]);
  const [loadingGh, setLoadingGh] = useState(false);


  const isLight = theme?.type === 'light';
  const workspaceCount = workspaces.length;
  const projectCount = workspaces.reduce((total, workspace) => total + (workspace.project_paths?.length ?? 0), 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const activeThemeName = theme?.name ?? 'Custom theme';
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

  async function loadHnStories() {
    setLoadingHn(true);
    try {
      const ids = await fetchCorsFree('https://hacker-news.firebaseio.com/v0/topstories.json');
      const topIds = ids.slice(0, 6);
      const stories = await Promise.all(topIds.map((id: number) => fetchCorsFree(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
      setHnStories(stories);
    } catch (err) {
      console.error('Failed to load HN stories:', err);
    } finally {
      setLoadingHn(false);
    }
  }

  async function loadGhRepos() {
    setLoadingGh(true);
    try {
      const data = await fetchCorsFree('https://api.github.com/search/repositories?q=stars:>15000+language:rust+language:typescript+language:python&sort=stars&order=desc&per_page=5');
      setGhRepos(data.items || []);
    } catch (err) {
      console.error('Failed to load GitHub trending:', err);
    } finally {
      setLoadingGh(false);
    }
  }



  async function openUrl(url?: string) {
    if (!url) return;
    if (!isTauriRuntime()) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await invoke('preview_open_in_browser', { url });
    } catch (err) {
      console.error('Failed to open URL:', err);
    }
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
    void loadHnStories();
    void loadGhRepos();
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`welcome${isLight ? ' light' : ''}`}>
      <header className="welcome-header">
        <div className="welcome-identity">
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
          <div className="header-text">
            <span className="welcome-kicker">{greeting}</span>
            <h1 className="app-name">Soryq</h1>
            <p className="app-tagline">{dateString} - {timeString}</p>
          </div>
        </div>
        <div className="welcome-rhythm" aria-label="Workspace overview">
          <div className="rhythm-card">
            <span>Workspaces</span>
            <strong>{workspaceCount}</strong>
          </div>
          <div className="rhythm-card">
            <span>Projects</span>
            <strong>{projectCount}</strong>
          </div>
          <div className="rhythm-card wide">
            <span>Theme</span>
            <strong>{activeThemeName}</strong>
          </div>
          <div className="rhythm-card">
            <span>Version</span>
            <strong>{packageJson.version}</strong>
          </div>
        </div>
      </header>

      <div className="welcome-content">
        <div className="welcome-col left-col">
          <div className="action-group bento-card welcome-card launchpad-card">
            <span className="section-label">Launchpad</span>
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

          <div className="recents bento-card welcome-card">
            <div className="recents-header">
              <span className="section-label">Recent Workspaces</span>
              {workspaces.length > 0 && <button className="text-btn danger" onClick={clearAllApplicationState}>Clear all</button>}
            </div>

            {filteredWorkspaces.length > 0 ? (
              <div className="recent-list scrollable">
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
              </div>
            )}
          </div>
        </div>

        <div className="welcome-col right-col">
          <FeedSection title="Hacker News top stories" loading={loadingHn} onRefresh={() => void loadHnStories()}>
            {hnStories.filter(Boolean).map((story) => (
              <button key={story.id} className="feed-item" onClick={() => void openUrl(story.url)}>
                <span className="feed-main">
                  <span className="feed-title">{story.title}</span>
                  <span className="feed-meta"><span>{story.score || 0} points</span><span className="dot">.</span><span>by {story.by}</span></span>
                </span>
                {story.kids && (
                  <span className="comments-btn" onClick={(event) => { event.stopPropagation(); void openUrl(`https://news.ycombinator.com/item?id=${story.id}`); }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                    {story.kids.length}
                  </span>
                )}
              </button>
            ))}
          </FeedSection>

          <FeedSection title="Popular GitHub Repositories" loading={loadingGh} onRefresh={() => void loadGhRepos()}>
            {ghRepos.map((repo) => (
              <button key={repo.full_name} className="feed-item" onClick={() => void openUrl(repo.html_url)}>
                <span className="feed-main">
                  <span className="feed-title repo-name"><FolderIcon size={11} /><span className="repo-text">{repo.full_name}</span></span>
                  <span className="repo-desc">{repo.description || 'No description provided.'}</span>
                  <span className="feed-meta">
                    {repo.language && <span className="repo-lang badge">{repo.language}</span>}
                    <span className="repo-stars">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                      {Math.round(repo.stargazers_count / 100) / 10}k
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </FeedSection>

          <div className="shortcuts-row bento-card welcome-card">
            <span className="section-label">Quick shortcuts</span>
            <div className="shortcut-grid">
              {[
                ['Command palette', 'Ctrl+Shift+P'],
                ['Toggle sidebar', 'Ctrl+B'],
                ['Focus terminal', 'Ctrl+`'],
                ['Open preview', 'Ctrl+Alt+P'],
              ].map(([label, keys]) => (
                <div className="shortcut-item" key={label}>
                  <span>{label}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
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
      <span className="recent-avatar" style={avatarStyle}><FolderIcon /></span>
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

function FeedSection({ title, loading, onRefresh, children }: { title: string; loading: boolean; onRefresh: () => void; children: React.ReactNode }) {
  return (
    <div className="feed-section bento-card welcome-card">
      <div className="feed-header">
        <span className="section-label">{title}</span>
        <button className="icon-btn" onClick={onRefresh} disabled={loading} title={`Refresh ${title}`}><RefreshIcon /></button>
      </div>
      <div className="feed-list scrollable">
        {loading ? <div className="shimmer-feed"><div className="shimmer-item" /><div className="shimmer-item" /><div className="shimmer-item" /></div> : children}
      </div>
    </div>
  );
}


