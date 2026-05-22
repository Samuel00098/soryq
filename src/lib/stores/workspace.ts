import { writable, derived, get } from 'svelte/store';
import type { Project, RecentProject } from '$lib/types/workspace';
import { openFiles, activeFile, fileCache, activeLine, activeColumn } from './editor';
import { sessions, activeSessionId, gridLayout, paneAssignments, activePaneIndex, createTerminalSession, killSession } from './terminal';
import { targetPort, proxyPort, proxyStarted, currentUrl, setTargetPort, startProxy } from './preview';
import { expandedPaths, selectedPath } from './explorer';
import { resetSettingsToDefault } from './settings';
import { resetLayoutToDefault } from './layout';

export const projects = writable<Map<string, Project>>(new Map());
export const activeProjectId = writable<string | null>(null);
export const openProjectIds = writable<string[]>([]); // ordered list of open project tabs
export const recentProjects = writable<RecentProject[]>([]);
export const isLoading = writable(false);

export const activeProject = derived(
  [projects, activeProjectId],
  ([$projects, $activeProjectId]) =>
    $activeProjectId ? $projects.get($activeProjectId) ?? null : null
);

export const openProjectsList = derived(
  [projects, openProjectIds],
  ([$projects, $openProjectIds]) =>
    $openProjectIds.map((id) => $projects.get(id)).filter(Boolean) as Project[]
);

interface ProjectWorkspaceState {
  editor: {
    openFiles: string[];
    activeFile: string | null;
    fileCache: Map<string, any>;
    activeLine: number;
    activeColumn: number;
  };
  terminal: {
    sessions: any[];
    activeSessionId: number | null;
    gridLayout: any;
    paneAssignments: (number | null)[];
    activePaneIndex: number;
  };
  preview: {
    targetPort: number;
    proxyPort: number | null;
    proxyStarted: boolean;
    currentUrl: string;
  };
  explorer: {
    expandedPaths: Set<string>;
    selectedPath: string | null;
  };
}

const projectStateCache = new Map<string, ProjectWorkspaceState>();

export function saveProjectState(projectId: string) {
  projectStateCache.set(projectId, {
    editor: {
      openFiles: get(openFiles),
      activeFile: get(activeFile),
      fileCache: new Map(get(fileCache)),
      activeLine: get(activeLine),
      activeColumn: get(activeColumn),
    },
    terminal: {
      sessions: get(sessions),
      activeSessionId: get(activeSessionId),
      gridLayout: get(gridLayout),
      paneAssignments: get(paneAssignments),
      activePaneIndex: get(activePaneIndex),
    },
    preview: {
      targetPort: get(targetPort),
      proxyPort: get(proxyPort),
      proxyStarted: get(proxyStarted),
      currentUrl: get(currentUrl),
    },
    explorer: {
      expandedPaths: new Set(get(expandedPaths)),
      selectedPath: get(selectedPath),
    }
  });
}

function saveCurrentProjectState() {
  const currentId = get(activeProjectId);
  if (currentId) {
    saveProjectState(currentId);
  }
}

export async function restoreProjectState(projectId: string, rootPath: string) {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('workspace_set_active', { projectId });
  } catch (e) {
    console.error('Failed to notify backend of active project switch:', e);
  }

  const cached = projectStateCache.get(projectId);
  if (cached) {
    openFiles.set(cached.editor.openFiles);
    activeFile.set(cached.editor.activeFile);
    fileCache.set(new Map(cached.editor.fileCache));
    activeLine.set(cached.editor.activeLine);
    activeColumn.set(cached.editor.activeColumn);

    sessions.set(cached.terminal.sessions);
    activeSessionId.set(cached.terminal.activeSessionId);
    gridLayout.set(cached.terminal.gridLayout);
    paneAssignments.set(cached.terminal.paneAssignments);
    activePaneIndex.set(cached.terminal.activePaneIndex);

    targetPort.set(cached.preview.targetPort);
    proxyPort.set(cached.preview.proxyPort);
    proxyStarted.set(cached.preview.proxyStarted);
    currentUrl.set('/'); // Always reset to root to start fresh on project switch/restore

    expandedPaths.set(new Set(cached.explorer.expandedPaths));
    selectedPath.set(cached.explorer.selectedPath);

    // Sync preview target port with the backend
    try {
      await invoke('preview_set_target_port', { port: cached.preview.targetPort });
    } catch (e) {
      console.error('Failed to restore preview target port:', e);
    }
  } else {
    // Reset to defaults for a new project
    clearAllStores();

    // Auto-detect and set up preview for a new project
    try {
      const port = await invoke<number>('workspace_detect_port', { path: rootPath });
      await setTargetPort(port);
      await startProxy();
    } catch (err) {
      console.error('Failed to auto-detect/set up preview for new project:', err);
    }

    // Spawn initial terminal session
    await createTerminalSession(rootPath);
  }
}

export function clearAllStores() {
  openFiles.set([]);
  activeFile.set(null);
  fileCache.set(new Map());
  activeLine.set(1);
  activeColumn.set(1);

  sessions.set([]);
  activeSessionId.set(null);
  gridLayout.set('single');
  paneAssignments.set([null]);
  activePaneIndex.set(0);

  targetPort.set(5173);
  proxyPort.set(null);
  proxyStarted.set(false);
  currentUrl.set('/');

  expandedPaths.set(new Set());
  selectedPath.set(null);
}

export function setActiveProject(project: Project) {
  saveCurrentProjectState();

  projects.update((p) => { p.set(project.id, project); return p; });

  // Add to open projects if not already there
  openProjectIds.update((ids) => {
    if (!ids.includes(project.id)) return [...ids, project.id];
    return ids;
  });

  activeProjectId.set(project.id);
  loadRecentProjects();

  restoreProjectState(project.id, project.root_path);
}

export function clearActiveProject() {
  saveCurrentProjectState();
  activeProjectId.set(null);
  clearAllStores();
  import('@tauri-apps/api/core').then(({ invoke }) => {
    invoke('workspace_set_active', { projectId: null }).catch((e) => {
      console.error('Failed to clear active project on backend:', e);
    });
  });
}

export function closeProject(projectId: string) {
  // Kill terminal sessions for this project
  const cached = projectStateCache.get(projectId);
  if (cached && cached.terminal && cached.terminal.sessions) {
    for (const session of cached.terminal.sessions) {
      killSession(session.id);
    }
  }

  const current = get(activeProjectId);
  if (current === projectId) {
    const currentSessions = get(sessions);
    for (const session of currentSessions) {
      killSession(session.id);
    }
  }

  // Remove from cache
  projectStateCache.delete(projectId);

  if (current === projectId) {
    const ids = get(openProjectIds);
    const remainingIds = ids.filter((id) => id !== projectId);
    openProjectIds.set(remainingIds);

    const nextId = remainingIds.length > 0 ? remainingIds[remainingIds.length - 1] : null;
    activeProjectId.set(nextId);

    if (nextId) {
      const nextProject = get(projects).get(nextId);
      if (nextProject) {
        restoreProjectState(nextId, nextProject.root_path);
      }
    } else {
      clearAllStores();
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('workspace_set_active', { projectId: null }).catch((e) => {
          console.error('Failed to clear active project on backend:', e);
        });
      });
    }
  } else {
    openProjectIds.update((ids) => ids.filter((id) => id !== projectId));
  }
}

export function switchToProject(projectId: string) {
  const current = get(activeProjectId);
  if (current === projectId) return; // already active

  if (current) {
    saveProjectState(current);
  }

  const p = get(projects).get(projectId);
  if (p) {
    activeProjectId.set(projectId);
    restoreProjectState(projectId, p.root_path);
  }
}

export function addRecent(project: RecentProject) {
  recentProjects.update((r) => [project, ...r.filter((x) => x.id !== project.id)].slice(0, 20));
}

export async function loadRecentProjects() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const recents = await invoke<RecentProject[]>('workspace_get_recent');
    recentProjects.set(recents);
  } catch (err) {
    console.error('Failed to load recent projects:', err);
  }
}

export async function openProjectByPath(path: string) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const project = await invoke<Project>('workspace_open_project', { path });
    setActiveProject(project);
  } catch (err) {
    console.error('Failed to open project by path:', err);
  }
}

export async function openProject() {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Open Folder',
  });
  if (selected) {
    await openProjectByPath(selected);
  }
}

export async function clearAllApplicationState() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('workspace_clear_recent');
  } catch (err) {
    console.error('Failed to clear recent projects on backend:', err);
  }

  if (typeof window !== 'undefined') {
    localStorage.clear();
  }

  resetSettingsToDefault();
  resetLayoutToDefault();
  clearAllStores();
  recentProjects.set([]);
}
