import { writable, derived, get } from 'svelte/store';
import type { Project, RecentProject, Workspace } from '$lib/types/workspace';
import { openFiles, activeFile, fileCache, activeLine, activeColumn, restoreEditorFiles } from './editor';
import { sessions, activeSessionId, gridLayout, paneAssignments, activePaneIndex, createTerminalSession, killSession } from './terminal';
import { targetPort, proxyPort, proxyStarted, currentUrl, preferredLocalHost, parseLocalPreviewUrl, previewTabs, activePreviewTabId, restorePreviewTabsState, resetPreviewTabsState, setPreferredLocalHost, setTargetPort, type PreviewTab } from './preview';
import { expandedPaths, selectedPath } from './explorer';
import { resetSettingsToDefault } from './settings';
import { resetLayoutToDefault } from './layout';

function persistentWritable<T>(key: string, defaultValue: T): import('svelte/store').Writable<T> {
  if (typeof window === 'undefined') {
    return writable(defaultValue);
  }
  const stored = localStorage.getItem(`forge_ws_${key}`);
  const initialValue = stored !== null ? JSON.parse(stored) : defaultValue;
  const store = writable<T>(initialValue);
  store.subscribe((val) => {
    localStorage.setItem(`forge_ws_${key}`, JSON.stringify(val));
  });
  return store;
}

export const recentWorkspaces = persistentWritable<Workspace[]>('recentWorkspaces', []);
export const activeWorkspaceId = persistentWritable<string | null>('activeWorkspaceId', null);

export const activeWorkspace = derived(
  [recentWorkspaces, activeWorkspaceId],
  ([$recentWorkspaces, $activeWorkspaceId]) =>
    $activeWorkspaceId ? $recentWorkspaces.find((w) => w.id === $activeWorkspaceId) ?? null : null
);

export const projects = writable<Map<string, Project>>(new Map());
export const activeProjectId = writable<string | null>(null);
export const openProjectIds = writable<string[]>([]); // ordered list of open project tabs
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
    tabs: PreviewTab[];
    activeTabId: string | null;
  };
  explorer: {
    expandedPaths: Set<string>;
    selectedPath: string | null;
  };
}

const projectStateCache = new Map<string, ProjectWorkspaceState>();

// ── Per-project localStorage persistence ──────────────────────────────────

interface PersistedTerminalPane {
  role: string | null;
  cwd: string | null;
}

interface PersistedProjectState {
  openFiles: string[];
  activeFile: string | null;
  expandedPaths: string[];
  terminalLayout?: string;
  terminalPanes?: PersistedTerminalPane[];
}

function projectStorageKey(projectId: string) {
  return `devdock_project_${projectId}`;
}

function saveProjectStateToStorage(projectId: string) {
  if (typeof window === 'undefined') return;
  const currentSessions = get(sessions);
  const currentPanes = get(paneAssignments);
  const terminalPanes: PersistedTerminalPane[] = currentPanes.map((sessionId) => {
    const session = currentSessions.find((s) => s.id === sessionId);
    return { role: session?.role ?? null, cwd: session?.cwd ?? null };
  });
  const state: PersistedProjectState = {
    openFiles: get(openFiles),
    activeFile: get(activeFile),
    expandedPaths: Array.from(get(expandedPaths)),
    terminalLayout: get(gridLayout),
    terminalPanes,
  };
  localStorage.setItem(projectStorageKey(projectId), JSON.stringify(state));
}

function loadProjectStateFromStorage(projectId: string): PersistedProjectState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(projectStorageKey(projectId));
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────

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
      tabs: get(previewTabs),
      activeTabId: get(activePreviewTabId),
    },
    explorer: {
      expandedPaths: new Set(get(expandedPaths)),
      selectedPath: get(selectedPath),
    }
  });
  // Also persist to localStorage so state survives app close
  saveProjectStateToStorage(projectId);
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

    const restoredUrl = cached.preview.currentUrl || '/';
    const localPreview = parseLocalPreviewUrl(restoredUrl);
    const restoredTargetPort = localPreview?.port ?? cached.preview.targetPort;

    targetPort.set(restoredTargetPort);
    proxyPort.set(cached.preview.proxyPort);
    proxyStarted.set(cached.preview.proxyStarted);
    restorePreviewTabsState(cached.preview.tabs, cached.preview.activeTabId);
    preferredLocalHost.set(localPreview?.host || 'localhost');

    expandedPaths.set(new Set(cached.explorer.expandedPaths));
    selectedPath.set(cached.explorer.selectedPath);

    // Sync preview target with the backend. A local URL in the address bar wins over stale cached ports.
    try {
      await setPreferredLocalHost(localPreview?.host ?? null);
      await invoke('preview_set_target_port', { port: restoredTargetPort });
    } catch (e) {
      console.error('Failed to restore preview target port:', e);
    }
  } else {
    // No in-memory cache — check localStorage for persisted state from a previous session
    const persisted = loadProjectStateFromStorage(projectId);

    clearAllStores();

    // Auto-detect a likely local dev port, but leave preview off until the user enables it.
    try {
      const port = await invoke<number>('workspace_detect_port', { path: rootPath });
      await setTargetPort(port, { silent: true });
    } catch (err) {
      console.error('Failed to auto-detect/set up preview for new project:', err);
    }

    if (persisted && persisted.openFiles.length > 0) {
      // Restore editor tabs from disk (silently, without switching view)
      await restoreEditorFiles(persisted.openFiles, persisted.activeFile);
      expandedPaths.set(new Set(persisted.expandedPaths));
    }

    // Restore terminal layout if saved, otherwise spawn a single fresh session
    if (persisted?.terminalPanes && persisted.terminalPanes.length > 0) {
      const { setGridLayout, setSessionRole } = await import('./terminal');
      if (persisted.terminalLayout) {
        setGridLayout(persisted.terminalLayout as any);
      }
      const spawnedIds: number[] = [];
      for (let i = 0; i < persisted.terminalPanes.length; i++) {
        const pane = persisted.terminalPanes[i];
        const id = await createTerminalSession(pane.cwd || rootPath, i);
        if (id !== null) {
          spawnedIds.push(id);
          if (pane.role) setSessionRole(id, pane.role);
        }
      }
      const { showToast } = await import('./notification');
      if (spawnedIds.length > 1) {
        showToast(`Restored ${spawnedIds.length} terminal sessions`, 'info', 3000);
      }
    } else {
      await createTerminalSession(rootPath);
    }
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
  resetPreviewTabsState();
  currentUrl.set('/');
  preferredLocalHost.set('localhost');

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

  // Update active workspace's active path
  const wsId = get(activeWorkspaceId);
  if (wsId) {
    recentWorkspaces.update((wsList) =>
      wsList.map((w) =>
        w.id === wsId ? { ...w, active_project_path: project.root_path } : w
      )
    );
  }

  restoreProjectState(project.id, project.root_path).catch((e) => console.error('restoreProjectState failed:', e));
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

function getFilename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

export function createNewWorkspace() {
  const id = `ws-${Date.now()}`;
  const newWorkspace: Workspace = {
    id,
    name: 'New Workspace',
    project_paths: [],
    active_project_path: null,
    last_opened: Date.now().toString(),
  };

  recentWorkspaces.update((ws) => [newWorkspace, ...ws]);
  activeWorkspaceId.set(id);

  // Clear current active project and folder list
  clearActiveProject();
  projects.set(new Map());
  openProjectIds.set([]);
}

export async function openWorkspace(workspaceId: string) {
  // Set as active
  activeWorkspaceId.set(workspaceId);

  // Update last_opened timestamp and move to top of the list
  recentWorkspaces.update((list) => {
    const updated = list.map((w) => {
      if (w.id === workspaceId) {
        return { ...w, last_opened: Date.now().toString() };
      }
      return w;
    });
    const ws = updated.find((w) => w.id === workspaceId);
    if (ws) {
      return [ws, ...updated.filter((w) => w.id !== workspaceId)];
    }
    return updated;
  });

  const wsList = get(recentWorkspaces);
  const targetWs = wsList.find((w) => w.id === workspaceId);
  if (!targetWs) return;

  // Clear current project stores
  clearAllStores();
  projects.set(new Map());
  openProjectIds.set([]);
  activeProjectId.set(null);

  // Load all projects in the workspace
  if (targetWs.project_paths.length > 0) {
    for (const path of targetWs.project_paths) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const project = await invoke<Project>('workspace_open_project', { path });
        projects.update((p) => { p.set(project.id, project); return p; });
        openProjectIds.update((ids) => {
          if (!ids.includes(project.id)) return [...ids, project.id];
          return ids;
        });
      } catch (err) {
        console.error(`Failed to open project ${path} in workspace:`, err);
      }
    }

    // Restore active project
    if (targetWs.active_project_path) {
      const allProjects = get(projects);
      const activeProj = Array.from(allProjects.values()).find((p) => p.root_path === targetWs.active_project_path);
      if (activeProj) {
        activeProjectId.set(activeProj.id);
        restoreProjectState(activeProj.id, activeProj.root_path).catch((e) => console.error('restoreProjectState failed:', e));
      } else {
        const firstProjId = get(openProjectIds)[0];
        if (firstProjId) {
          const firstProj = allProjects.get(firstProjId);
          if (firstProj) {
            activeProjectId.set(firstProjId);
            restoreProjectState(firstProjId, firstProj.root_path).catch((e) => console.error('restoreProjectState failed:', e));
          }
        }
      }
    } else {
      const firstProjId = get(openProjectIds)[0];
      if (firstProjId) {
        const firstProj = get(projects).get(firstProjId);
        if (firstProj) {
          activeProjectId.set(firstProjId);
          restoreProjectState(firstProjId, firstProj.root_path).catch((e) => console.error('restoreProjectState failed:', e));
        }
      }
    }
  }
}

export async function addFolderToWorkspace(path: string) {
  let wsId = get(activeWorkspaceId);
  if (!wsId) {
    createNewWorkspace();
    wsId = get(activeWorkspaceId);
  }
  if (!wsId) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const project = await invoke<Project>('workspace_open_project', { path });

    const currentActiveId = get(activeProjectId);
    if (currentActiveId) {
      saveProjectState(currentActiveId);
    }

    projects.update((p) => { p.set(project.id, project); return p; });
    
    openProjectIds.update((ids) => {
      if (!ids.includes(project.id)) return [...ids, project.id];
      return ids;
    });

    activeProjectId.set(project.id);
    await restoreProjectState(project.id, project.root_path);

    // Update active workspace
    recentWorkspaces.update((wsList) => {
      return wsList.map((w) => {
        if (w.id === wsId) {
          const paths = [...w.project_paths];
          if (!paths.includes(path)) {
            paths.push(path);
          }
          
          let wsName = w.name;
          if (w.name === 'New Workspace' || w.name.trim() === '' || w.name === 'Empty Workspace') {
            wsName = getFilename(path);
          } else {
            const currentNames = w.name.split(', ');
            const newName = getFilename(path);
            if (!currentNames.includes(newName)) {
              wsName = [...currentNames, newName].join(', ');
            }
          }

          return {
            ...w,
            name: wsName,
            project_paths: paths,
            active_project_path: path,
            last_opened: Date.now().toString(),
          };
        }
        return w;
      });
    });
  } catch (err) {
    console.error('Failed to add folder to workspace:', err);
    throw err;
  }
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

  // Remove from in-memory cache and localStorage
  projectStateCache.delete(projectId);
  if (typeof window !== 'undefined') localStorage.removeItem(projectStorageKey(projectId));

  const wsId = get(activeWorkspaceId);
  const p = get(projects).get(projectId);
  if (wsId && p) {
    recentWorkspaces.update((wsList) => {
      return wsList.map((w) => {
        if (w.id === wsId) {
          const paths = w.project_paths.filter((x) => x !== p.root_path);
          let activePath = w.active_project_path;
          if (activePath === p.root_path) {
            activePath = paths.length > 0 ? paths[paths.length - 1] : null;
          }
          
          let newName = 'Empty Workspace';
          if (paths.length > 0) {
            newName = paths.map((path) => getFilename(path)).join(', ');
          }

          return {
            ...w,
            name: newName,
            project_paths: paths,
            active_project_path: activePath,
          };
        }
        return w;
      });
    });
  }

  if (current === projectId) {
    const ids = get(openProjectIds);
    const remainingIds = ids.filter((id) => id !== projectId);
    openProjectIds.set(remainingIds);

    const nextId = remainingIds.length > 0 ? remainingIds[remainingIds.length - 1] : null;
    activeProjectId.set(nextId);

    if (nextId) {
      const nextProject = get(projects).get(nextId);
      if (nextProject) {
        if (wsId) {
          recentWorkspaces.update((wsList) =>
            wsList.map((w) =>
              w.id === wsId ? { ...w, active_project_path: nextProject.root_path } : w
            )
          );
        }
        restoreProjectState(nextId, nextProject.root_path).catch((e) => console.error('restoreProjectState failed:', e));
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
    
    const wsId = get(activeWorkspaceId);
    if (wsId) {
      recentWorkspaces.update((wsList) =>
        wsList.map((w) =>
          w.id === wsId ? { ...w, active_project_path: p.root_path } : w
        )
      );
    }
    
    restoreProjectState(projectId, p.root_path).catch((e) => console.error('restoreProjectState failed:', e));
  }
}

export async function openProjectByPath(path: string) {
  await addFolderToWorkspace(path);
}

export async function openProject() {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Add Folder to Workspace',
  });
  if (selected) {
    await addFolderToWorkspace(selected);
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
  recentWorkspaces.set([]);
  activeWorkspaceId.set(null);
}

export async function initializeWorkspaces() {
  const wsId = get(activeWorkspaceId);
  if (wsId) {
    await openWorkspace(wsId);
  }
}

export function renameWorkspace(workspaceId: string, newName: string) {
  recentWorkspaces.update((list) =>
    list.map((w) => (w.id === workspaceId ? { ...w, name: newName } : w))
  );
}
