import type { CSSProperties } from 'react';
import { useWorkspaceStore } from '$lib/stores/zustand/workspace';
import { useEditorStore } from '$lib/stores/zustand/editor';
import { useLayoutStore } from '$lib/stores/zustand/layout';
import { setSidebarTab } from '$lib/stores/layout';
import { branchInfo } from '$lib/stores/gitBranch';
import { useSettingsStore } from '$lib/stores/zustand/settings';
import { useStore } from '$lib/react/useStore';
import './StatusBar.css';

const viewColors: Record<string, string> = {
  editor: 'var(--accent)',
  terminal: 'var(--success)',
  preview: 'var(--accent)',
  settings: 'var(--accent)',
};

export default function StatusBar() {
  const project = useWorkspaceStore((s) => (s.activeProjectId ? s.projects.get(s.activeProjectId) ?? null : null));
  const file = useEditorStore((s) => s.activeFile);
  const cache = useEditorStore((s) => s.fileCache);
  const line = useEditorStore((s) => s.activeLine);
  const column = useEditorStore((s) => s.activeColumn);
  const layoutState = useLayoutStore();
  const zoom = useSettingsStore((s) => s.uiZoom);
  const branch = useStore(branchInfo);

  const activeFileInfo = file ? cache.get(file) : null;
  const languageLabel = activeFileInfo
    ? activeFileInfo.language.charAt(0).toUpperCase() + activeFileInfo.language.slice(1)
    : '';
  const activeFileIsText = activeFileInfo?.kind === 'text';

  return (
    <footer className="statusbar">
      <div className="sb-left">
        <span
          className="sb-view-badge"
          style={{ '--vc': viewColors[layoutState.activeView] ?? '#06b6d4' } as CSSProperties}
        >
          {layoutState.activeView}
        </span>

        {project && (
          <>
            <span className="sb-sep">.</span>
            <span className="sb-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              {project.name}
            </span>
          </>
        )}
        {branch?.current && (
          <>
            <span className="sb-sep">.</span>
            <span className="sb-item sb-branch" onClick={() => setSidebarTab('git')} title="Switch branch">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 01-9 9" />
              </svg>
              {branch.current}
            </span>
          </>
        )}
      </div>

      <div className="sb-right">
        {activeFileInfo && (
          <>
            {activeFileIsText && (
              <>
                <span className="sb-item">
                  Ln {line}, Col {column}
                </span>
                <span className="sb-sep">.</span>
              </>
            )}
            <span className="sb-item">{languageLabel}</span>
            <span className="sb-sep">.</span>
          </>
        )}
        {(!activeFileInfo || activeFileIsText) && (
          <>
            <span className="sb-item">UTF-8</span>
            <span className="sb-sep">.</span>
            <span className="sb-item">LF</span>
            <span className="sb-sep">.</span>
          </>
        )}
        <span className="sb-item zoom-indicator">{zoom}%</span>
      </div>
    </footer>
  );
}
