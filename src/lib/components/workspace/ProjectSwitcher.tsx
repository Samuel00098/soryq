import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  openProjectsList,
  activeProjectId,
  switchToProject,
  closeProject,
  openProject,
  recentWorkspaces,
  activeWorkspaceId,
  moveProjectToWorkspace,
} from '$lib/stores/workspace';
import { setActiveView } from '$lib/stores/layout';
import type { Project } from '$lib/types/workspace';
import { useStore } from '$lib/react/useStore';
import './ProjectSwitcher.css';

interface ContextMenu {
  project: Project;
  x: number;
  y: number;
}

function projectColor(name: string): string {
  const hash = Math.abs(name.split('').reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0)) % 360;
  return `hsl(${hash} 55% 60%)`;
}

export default function ProjectSwitcher() {
  const projects = useStore(openProjectsList);
  const projectId = useStore(activeProjectId);
  const workspaces = useStore(recentWorkspaces);
  const workspaceId = useStore(activeWorkspaceId);

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  const otherWorkspaces = useMemo(
    () => workspaces.filter((w) => w.id !== workspaceId),
    [workspaces, workspaceId],
  );

  async function handleOpen() {
    await openProject();
    setActiveView('editor');
  }

  function handleClose(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    closeProject(id);
  }

  function handleContextMenu(e: React.MouseEvent, project: Project) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ project, x: e.clientX, y: e.clientY });
  }

  function handleMove(targetWorkspaceId: string) {
    if (contextMenu) {
      moveProjectToWorkspace(contextMenu.project.root_path, targetWorkspaceId);
    }
    setContextMenu(null);
  }

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    document.addEventListener('click', dismiss, { once: true });
    document.addEventListener('contextmenu', dismiss, { once: true });
    return () => {
      document.removeEventListener('click', dismiss);
      document.removeEventListener('contextmenu', dismiss);
    };
  }, [contextMenu]);

  const ctxStyle: CSSProperties | undefined = contextMenu
    ? { top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }
    : undefined;

  return (
    <>
      {projects.length > 0 ? (
        <div
          className="project-switcher"
          onWheel={(e) => {
            if (e.deltaY !== 0 && e.deltaX === 0) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          {projects.map((project) => (
            <div
              key={project.id}
              className={`project-tab${projectId === project.id ? ' active' : ''}`}
              onClick={() => switchToProject(project.id)}
              onContextMenu={(e) => handleContextMenu(e, project)}
              role="tab"
              title={project.root_path}
            >
              <span className="project-dot" style={{ background: projectColor(project.name) }}></span>
              <span className="project-tab-name">{project.name}</span>
              <button
                className="project-close"
                onClick={(e) => handleClose(e, project.id)}
                aria-label="Close project"
              >
                <svg width="9" height="9" viewBox="0 0 9 9">
                  <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
          <button className="project-add-btn" onClick={handleOpen} title="Add folder to workspace">
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
          </button>
        </div>
      ) : (
        <div className="project-switcher project-switcher-empty">
          <button className="project-add-full" onClick={handleOpen} title="Add folder to workspace">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M16 5V1" />
              <path d="M14 3h4" />
            </svg>
            Add folder
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div className="ctx-menu" style={ctxStyle} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-label">Move to workspace</div>
          {otherWorkspaces.length === 0 ? (
            <div className="ctx-empty">No other workspaces</div>
          ) : (
            otherWorkspaces.map((ws) => (
              <button key={ws.id} className="ctx-item" onClick={() => handleMove(ws.id)}>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span className="ctx-ws-name">{ws.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </>
  );
}
