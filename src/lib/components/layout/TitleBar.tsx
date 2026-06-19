import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { get } from '$lib/stores/storeCompat';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { saveProjectState } from '$lib/stores/workspace';
import { useWorkspaceStore } from '$lib/stores/zustand/workspace';
import { openQuickCapture, openSettings } from '$lib/stores/layout';
import { useSettingsStore } from '$lib/stores/zustand/settings';
import { search as paletteSearch } from '$lib/stores/commandpalette';
import { showToast } from '$lib/stores/notification';
import { openFile, jumpToLine } from '$lib/stores/editor';
import { canGoBack, canGoForward, navigateBack, navigateForward } from '$lib/stores/navigation';
import { isTauriRuntime } from '$lib/utils/tauri';
import { useStore } from '$lib/react/useStore';
import WorkspaceSwitcher from '$lib/components/workspace/WorkspaceSwitcher.tsx';
import ProjectSwitcher from '$lib/components/workspace/ProjectSwitcher.tsx';
import packageJson from '../../../../package.json';
import './TitleBar.css';

// On macOS, the native traffic-light buttons handle minimize/maximize/close.
// We detect the platform to hide our custom controls so they don't double up.
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

export default function TitleBar() {
  const win = useMemo(() => (isTauriRuntime() ? getCurrentWindow() : null), []);

  // Cache-bust the titlebar icon by app version so an update always paints the
  // new icon. The webview caches `/icon.png` by URL; without a version-tied
  // query the old icon would persist across updates until the string changed by
  // hand. Bumping the app version (which every release does) yields a fresh URL.
  const iconSrc = `/icon.png?v=${packageJson.version}`;

  const [iconError, setIconError] = useState(false);

  // Reactive store reads — the React equivalent of `$store`.
  const projectId = useWorkspaceStore((s) => s.activeProjectId);
  const project = useWorkspaceStore((s) => (s.activeProjectId ? s.projects.get(s.activeProjectId) ?? null : null));
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspace = useWorkspaceStore((s) => (s.activeWorkspaceId ? s.recentWorkspaces.find((w) => w.id === s.activeWorkspaceId) ?? null : null));
  const search = useStore(paletteSearch);
  const goBackEnabled = useStore(canGoBack);
  const goForwardEnabled = useStore(canGoForward);

  // Codebase search state.
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Debounced search whenever the query or active project changes.
  useEffect(() => {
    if (!project || !search.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    const handle = setTimeout(async () => {
      try {
        const results = await invoke<any[]>('workspace_search_codebase', {
          projectPath: project.root_path,
          query: search,
        });
        if (get(paletteSearch) === search) {
          setSearchResults(results);
          setSearchError(null);
        }
      } catch (err) {
        console.error('Search failed:', err);
        setSearchError(String(err));
      } finally {
        if (get(paletteSearch) === search) {
          setIsSearching(false);
        }
      }
    }, 200); // 200ms debounce

    return () => clearTimeout(handle);
  }, [search, project]);

  // Close the search dropdown when clicking outside of it (window click handler).
  useEffect(() => {
    const handleWindowClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.titlebar-search')) {
        setSearchFocused(false);
      }
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  async function minimize() {
    await win?.minimize();
  }
  async function toggleMaximize() {
    if (!win) return;
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  }
  async function close() {
    const currProjectId = useWorkspaceStore.getState().activeProjectId;
    if (currProjectId) saveProjectState(currProjectId);
    if (!win) return;
    if (useSettingsStore.getState().closeBehavior === 'minimize') {
      await win.minimize();
    } else {
      await win.destroy();
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      paletteSearch.set('');
      setSearchResults([]);
      setSearchFocused(false);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (project) {
        if (searchResults.length > 0) {
          selectResult(searchResults[0]);
        }
      } else {
        // Welcomescreen command palette or filtering: no active project
      }
    }
  }

  function handleSearchClick() {
    if (!project) {
      // Welcome screen: click opens command palette or does default action
    }
  }

  function handleInputClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (project) {
      setSearchFocused(true);
    }
  }

  async function selectResult(result: any) {
    try {
      await openFile(result.file_path);
      jumpToLine.set({ path: result.file_path, line: result.line_number });
      paletteSearch.set('');
      setSearchResults([]);
      setSearchFocused(false);

      const activeInput = document.querySelector('.search-input') as HTMLInputElement;
      if (activeInput) activeInput.blur();
    } catch (err) {
      console.error('Failed to open search result:', err);
      showToast('Failed to open search result', 'error');
    }
  }

  function goHome() {
    const pid = useWorkspaceStore.getState().activeProjectId;
    if (pid) saveProjectState(pid);
    useWorkspaceStore.getState().__set('activeWorkspaceId', null);
  }

  async function goBack() {
    await navigateBack();
  }
  async function goForward() {
    await navigateForward();
  }

  const controlsContainerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    pointerEvents: 'auto',
    // Non-standard Tauri drag-region hints; cast through unknown for TS.
    WebkitAppRegion: 'no-drag',
    appRegion: 'no-drag',
  } as CSSProperties;

  const dividerStyle: CSSProperties = {
    width: '1px',
    height: '16px',
    background: 'var(--titlebar-border, rgba(255, 255, 255, 0.08))',
    margin: '0 4px',
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      {/* Brand */}
      <div className="titlebar-brand">
        <div className="titlebar-icon">
          {!iconError ? (
            <img
              src={iconSrc}
              alt="Soryq"
              className="titlebar-app-icon"
              onError={() => setIconError(true)}
            />
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="titlebar-app-icon"
              aria-hidden="true"
            >
              <rect width="16" height="16" rx="3.5" fill="#2f343b" />
              <polyline
                points="2.5,10 4.5,8 2.5,6"
                fill="none"
                stroke="#aeb6c2"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect x="5.5" y="7.3" width="5" height="1.2" rx="0.6" fill="rgba(255,255,255,0.5)" />
            </svg>
          )}
        </div>
        <span className="titlebar-name">Soryq</span>
      </div>

      {/* Navigation: Home, Back, Forward */}
      <div className="titlebar-nav">
        <button className="nav-btn" onClick={goHome} aria-label="Go to home" title="Home">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12L12 3l9 9" />
            <path d="M9 21V12h6v9" />
          </svg>
        </button>
        <button
          className="nav-btn tb-collapse-2"
          onClick={goBack}
          disabled={!goBackEnabled}
          aria-label="Go back"
          title="Back"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          className="nav-btn tb-collapse-2"
          onClick={goForward}
          disabled={!goForwardEnabled}
          aria-label="Go forward"
          title="Forward"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Centre breadcrumb (drag region) */}
      <div
        className={`titlebar-center${workspace ? ' left-align' : ''}`}
        data-tauri-drag-region
      >
        {workspace && (
          <div className="titlebar-controls-container" style={controlsContainerStyle}>
            <WorkspaceSwitcher />
            <div className="tb-divider" style={dividerStyle}></div>
            <ProjectSwitcher />
          </div>
        )}
      </div>

      {/* Right side: Search + Settings + Window controls */}
      <div className="titlebar-right">
        {/* Codebase Search bar — opens command palette */}
        <div
          className={`titlebar-search${searchFocused ? ' focused' : ''}`}
          onClick={handleSearchClick}
          title={
            project
              ? 'Search (Ctrl+Shift+P)'
              : workspaceId
                ? 'No active folder'
                : 'Filter recent workspaces'
          }
        >
          <svg
            className="search-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder={
              project
                ? 'Ask or search codebase...'
                : workspaceId
                  ? 'No active folder...'
                  : 'Filter recent workspaces...'
            }
            value={search}
            onChange={(e) => paletteSearch.set(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onClick={handleInputClick}
            onFocus={() => {
              if (project) setSearchFocused(true);
            }}
            aria-label="Search codebase"
            spellCheck={false}
          />
          {search ? (
            <button
              className="search-clear"
              onClick={(e) => {
                e.stopPropagation();
                paletteSearch.set('');
              }}
              aria-label="Clear search"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <kbd className="search-hint">⌃⇧P</kbd>
          )}

          {/* Search results dropdown overlay */}
          {searchFocused && project && (
            <div className="search-results-dropdown" onClick={(e) => e.stopPropagation()}>
              {isSearching ? (
                <div className="dropdown-status">
                  <svg
                    className="spin-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  >
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <polyline points="21 3 21 8 16 8" />
                  </svg>
                  <span>Searching codebase...</span>
                </div>
              ) : searchError ? (
                <div className="dropdown-status error">
                  <span>Error: {searchError}</span>
                </div>
              ) : !search.trim() ? (
                <div className="dropdown-status">
                  <span>Type to search codebase content</span>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="dropdown-status">
                  <span>No matches found</span>
                </div>
              ) : (
                <div className="dropdown-results-list">
                  {searchResults.map((result, i) => (
                    <button
                      key={`${result.file_path}:${result.line_number}:${i}`}
                      className="dropdown-result-item"
                      onClick={() => selectResult(result)}
                    >
                      <div className="result-meta">
                        <span className="result-file" title={result.relative_path}>
                          {result.relative_path}
                        </span>
                        <span className="result-line-number">Line {result.line_number}</span>
                      </div>
                      <div className="result-snippet" title={result.line_content}>
                        {result.line_content}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick Capture button */}
        <button
          className="icon-btn tb-collapse-1"
          onClick={openQuickCapture}
          aria-label="Quick Capture"
          title="Quick Capture (Ctrl+Shift+Space)"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>

        {/* Settings button */}
        <button
          className="icon-btn"
          onClick={openSettings}
          aria-label="Settings"
          title="Settings (Ctrl+,)"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Window controls — rendered unconditionally, matching the original
            markup (the isMac detection exists but did not gate them). */}
        <div className="titlebar-controls">
          <button className="wc-btn wc-min" onClick={minimize} aria-label="Minimize" title="Minimize">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button className="wc-btn wc-max" onClick={toggleMaximize} aria-label="Maximize" title="Maximize">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M4 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H9"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button className="wc-btn wc-close" onClick={close} aria-label="Close" title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
