import { writable, derived, get } from '$lib/stores/storeCompat';
import type { Project, Workspace } from '$lib/types/workspace';
import { openFiles, activeFile, fileCache, activeLine, activeColumn, restoreEditorFiles } from './editor';
import { sessions, activeSessionId, gridLayout, paneAssignments, activePaneIndex, createTerminalSession, attachTerminalSession, killSession, getTerminalProjectState, restoreTerminalProjectState, setActiveTerminalProject, setTerminalProjectRoot, applyRestoredSessionMetadata, relaunchRestoredAgentSession } from './terminal';
import { targetPort, proxyPort, proxyStarted, currentUrl, preferredLocalHost, parseLocalPreviewUrl, previewTabs, activePreviewTabId, restorePreviewTabsState, resetPreviewTabsState, setPreferredLocalHost, setTargetPort, type PreviewTab } from './preview';
import { expandedPaths, selectedPath, selectedPaths } from './explorer';
import { resetSettingsToDefault } from './settings';
import { resetLayoutToDefault, layout, sanitiseActiveView, sanitiseSidebarTab } from './layout';
import { layoutSnapshot, requestAmbientLayout, type AmbientLayout } from './layoutControl';
import { isTauriRuntime } from '$lib/utils/tauri';
import { useWorkspaceStore } from './zustand/workspace';

function syncWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  const zustandVal = (useWorkspaceStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;
  const store = writable<T>(initial);
  void useWorkspaceStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) store.set(next);
  });
  return {
    subscribe: store.subscribe,
    set(value: T) { (useWorkspaceStore.getState() as any).__set(key, value); },
    update(fn: (val: T) => T) {
      const current = (useWorkspaceStore.getState() as any)[key] as T;
      (useWorkspaceStore.getState() as any).__set(key, fn(current));
    },
  };
}

export const recentWorkspaces = syncWritable<Workspace[]>('recentWorkspaces', []);
export const activeWorkspaceId = syncWritable<string | null>('activeWorkspaceId', null);

export const activeWorkspace = derived(
  [recentWorkspaces, activeWorkspaceId],
  ([$recentWorkspaces, $activeWorkspaceId]) =>
    $activeWorkspaceId ? $recentWorkspaces.find((w) => w.id === $activeWorkspaceId) ?? null : null
);

export const projects = syncWritable<Map<string, Project>>('projects', new Map());
export const activeProjectId = syncWritable<string | null>('activeProjectId', null);
export const openProjectIds = syncWritable<string[]>('openProjectIds', []); // ordered list of open project tabs
export const isLoading = syncWritable<boolean>('isLoading', false);

export const activeProject = derived(
  [projects, activeProjectId],
  ([$projects, $activeProjectId]) =>
    $activeProjectId ? $projects.get($activeProjectId) ?? null : null
);

export const newWorkspacePromptOpen = syncWritable<boolean>('newWorkspacePromptOpen', false);

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
  ambient: AmbientLayout;
  layout: {
    activeView: string;
    editorVisible: boolean;
    previewVisible: boolean;
    reviewVisible: boolean;
    httpVisible: boolean;
    tasksVisible: boolean;
    orchestratorVisible: boolean;
    dbVisible: boolean;
    toolboxVisible: boolean;
    lastAuxView: string;
    editorSplitPreview: boolean;
    auxPanelWidth: number;
    auxEditorHeight: number;
    sidebarVisible: boolean;
    sidebarWidth: number;
    sidebarTab: string;
  };
}

const projectStateCache = new Map<string, ProjectWorkspaceState>();
let restoreProjectStateGeneration = 0;
let projectAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
let isRestoringProjectState = false;
export const isProjectSwitching = syncWritable<boolean>('isProjectSwitching', false);

function cancelPendingProjectAutosave() {
  if (projectAutosaveTimer) {
    clearTimeout(projectAutosaveTimer);
    projectAutosaveTimer = null;
  }
}

function scheduleProjectAutosave() {
  if (isRestoringProjectState) return;
  if (typeof window === 'undefined') return;
  const projectId = get(activeProjectId);
  if (!projectId) return;

  if (projectAutosaveTimer) {
    clearTimeout(projectAutosaveTimer);
  }

  projectAutosaveTimer = setTimeout(() => {
    projectAutosaveTimer = null;
    const currentId = get(activeProjectId);
    if (!currentId || isRestoringProjectState) return;
    saveProjectState(currentId);
  }, 150);
}

function bindProjectAutosave() {
  const trackedStores = [
    openFiles,
    activeFile,
    fileCache,
    activeLine,
    activeColumn,
    sessions,
    activeSessionId,
    gridLayout,
    paneAssignments,
    activePaneIndex,
    targetPort,
    proxyPort,
    proxyStarted,
    currentUrl,
    previewTabs,
    activePreviewTabId,
    expandedPaths,
    selectedPath,
    layout,
  ];

  for (const store of trackedStores) {
    store.subscribe(() => {
      scheduleProjectAutosave();
    });
  }
}

bindProjectAutosave();

// ── Per-project localStorage persistence ──────────────────────────────────

interface PersistedTerminalPane {
  backendSessionId?: number | null;
  role: string | null;
  cwd: string | null;
  hasSession: boolean;
  title?: string | null;
  paneTitle?: string | null;
  agentName?: string | null;
  agentPreset?: string | null;
  taskSummary?: string | null;
}

interface PersistedProjectState {
  openFiles: string[];
  activeFile: string | null;
  expandedPaths: string[];
  terminalLayout?: string;
  terminalPanes?: PersistedTerminalPane[];
  /** The workspace's ambient room arrangement (Focus / Split / Gallery). */
  ambient?: AmbientLayout;
  layout?: {
    activeView: string;
    editorVisible: boolean;
    previewVisible: boolean;
    reviewVisible: boolean;
    httpVisible: boolean;
    tasksVisible?: boolean;
    orchestratorVisible?: boolean;
    dbVisible?: boolean;
    toolboxVisible?: boolean;
    lastAuxView?: string;
    editorSplitPreview: boolean;
    auxPanelWidth: number;
    auxEditorHeight: number;
    sidebarVisible: boolean;
    sidebarWidth: number;
    sidebarTab: string;
  };
}

function projectStorageKey(projectId: string) {
  return `soryq_project_${projectId}`;
}

function saveProjectStateToStorage(projectId: string) {
  if (typeof window === 'undefined') return;
  const terminalState = getTerminalProjectState(projectId);
  const terminalPanes: PersistedTerminalPane[] = terminalState.sessions
    .filter((session) => session.isRunning && session.agentPreset)
    .map((session) => {
      return {
        backendSessionId: session.id,
        role: session.role ?? null,
        cwd: session.cwd ?? null,
        hasSession: Boolean(session),
        title: session.title ?? null,
        paneTitle: session.paneTitle ?? null,
        agentName: session.agentName ?? null,
        agentPreset: session.agentPreset ?? null,
        taskSummary: session.taskSummary ?? null,
      };
    });
  const currentLayout = get(layout);
  const state: PersistedProjectState = {
    openFiles: get(openFiles).slice(0, 100),
    activeFile: get(activeFile),
    expandedPaths: Array.from(get(expandedPaths)).slice(0, 500),
    terminalLayout: 'single',
    terminalPanes,
    ambient: get(layoutSnapshot).ambient,
    layout: {
      activeView: currentLayout.activeView,
      editorVisible: currentLayout.editorVisible,
      previewVisible: currentLayout.previewVisible,
      reviewVisible: currentLayout.reviewVisible,
      httpVisible: currentLayout.httpVisible,
      tasksVisible: currentLayout.tasksVisible,
      orchestratorVisible: currentLayout.orchestratorVisible,
      dbVisible: currentLayout.dbVisible,
      toolboxVisible: currentLayout.toolboxVisible,
      lastAuxView: currentLayout.lastAuxView,
      editorSplitPreview: currentLayout.editorSplitPreview,
      auxPanelWidth: currentLayout.auxPanelWidth,
      auxEditorHeight: currentLayout.auxEditorHeight,
      sidebarVisible: currentLayout.sidebarVisible,
      sidebarWidth: currentLayout.sidebarWidth,
      sidebarTab: currentLayout.sidebarTab,
    },
  };
  try { localStorage.setItem(projectStorageKey(projectId), JSON.stringify(state)); } catch {
    // localStorage quota exceeded — persist a minimal state instead
    try { localStorage.setItem(projectStorageKey(projectId), JSON.stringify({ ...state, openFiles: state.openFiles.slice(0, 10), expandedPaths: [] })); } catch {}
  }
}

function isSafePath(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length < 4096 && !/[\0\x01-\x1f]/.test(v);
}

function isSafeLabel(v: unknown, maxLength = 512): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLength && !/[\0\x01-\x1f]/.test(v);
}

function sanitisePersistedProjectState(raw: unknown): PersistedProjectState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const openFiles = Array.isArray(r.openFiles)
    ? (r.openFiles as unknown[]).filter(isSafePath)
    : [];

  const activeFile = isSafePath(r.activeFile) ? r.activeFile : null;

  const expandedPaths = Array.isArray(r.expandedPaths)
    ? (r.expandedPaths as unknown[]).filter(isSafePath)
    : [];

  // cwd: must be a safe path; role: alphanumeric + common separators only, no control chars
  const rawPanes = Array.isArray(r.terminalPanes) ? r.terminalPanes : [];
  const terminalPanes: PersistedTerminalPane[] = rawPanes.map((p: unknown) => {
    if (!p || typeof p !== 'object') return { role: null, cwd: null, hasSession: false };
    const pane = p as Record<string, unknown>;
    const cwd = isSafePath(pane.cwd) ? pane.cwd : null;
    const backendSessionId = typeof pane.backendSessionId === 'number' && Number.isInteger(pane.backendSessionId) && pane.backendSessionId > 0
      ? pane.backendSessionId
      : null;
    const role = typeof pane.role === 'string' && /^[\w\-. ]{0,63}$/.test(pane.role) ? pane.role : null;
    const title = isSafeLabel(pane.title, 128) ? pane.title : null;
    const paneTitle = isSafeLabel(pane.paneTitle, 256) ? pane.paneTitle : null;
    const agentName = isSafeLabel(pane.agentName, 80) ? pane.agentName : null;
    const agentPreset = isSafeLabel(pane.agentPreset, 128) && /^[\w\-./:@ ]{1,128}$/.test(pane.agentPreset) ? pane.agentPreset : null;
    const taskSummary = isSafeLabel(pane.taskSummary, 256) ? pane.taskSummary : null;
    // Back-compat: entries persisted before hasSession existed are treated as
    // occupied panes so previously-saved terminals still get recreated.
    const hasSession = pane.hasSession === undefined ? true : Boolean(pane.hasSession);
    return { backendSessionId, role, cwd, hasSession, title, paneTitle, agentName, agentPreset, taskSummary };
  });

  const terminalLayout = typeof r.terminalLayout === 'string' ? r.terminalLayout : undefined;

  const ambient: AmbientLayout | undefined =
    r.ambient === 'focus' || r.ambient === 'split' || r.ambient === 'gallery' ? r.ambient : undefined;

  // Sanitise layout sub-object: clamp numerics, strip unknown view names
  let layout: PersistedProjectState['layout'] | undefined;
  if (r.layout && typeof r.layout === 'object') {
    const l = r.layout as Record<string, unknown>;
    layout = {
      activeView: typeof l.activeView === 'string' ? l.activeView : 'terminal',
      editorVisible: Boolean(l.editorVisible),
      previewVisible: Boolean(l.previewVisible),
      reviewVisible: Boolean(l.reviewVisible),
      httpVisible: Boolean(l.httpVisible),
      tasksVisible: Boolean(l.tasksVisible),
      orchestratorVisible: Boolean(l.orchestratorVisible),
      dbVisible: Boolean(l.dbVisible),
      toolboxVisible: Boolean(l.toolboxVisible),
      lastAuxView: typeof l.lastAuxView === 'string' ? l.lastAuxView : undefined,
      editorSplitPreview: Boolean(l.editorSplitPreview),
      auxPanelWidth: typeof l.auxPanelWidth === 'number' ? Math.max(180, Math.min(2000, l.auxPanelWidth)) : 550,
      auxEditorHeight: typeof l.auxEditorHeight === 'number' ? Math.max(10, Math.min(90, l.auxEditorHeight)) : 50,
      sidebarVisible: Boolean(l.sidebarVisible ?? true),
      sidebarWidth: typeof l.sidebarWidth === 'number' ? Math.max(100, Math.min(600, l.sidebarWidth)) : 260,
      sidebarTab: typeof l.sidebarTab === 'string' ? l.sidebarTab : 'files',
    };
  }

  return { openFiles, activeFile, expandedPaths, terminalPanes, terminalLayout, ambient, layout };
}

function loadProjectStateFromStorage(projectId: string): PersistedProjectState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(projectStorageKey(projectId));
    if (!stored) return null;
    return sanitisePersistedProjectState(JSON.parse(stored));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────

export function saveProjectState(projectId: string) {
  const terminalState = getTerminalProjectState(projectId);
  projectStateCache.set(projectId, {
    editor: {
      openFiles: get(openFiles),
      activeFile: get(activeFile),
      fileCache: new Map(get(fileCache)),
      activeLine: get(activeLine),
      activeColumn: get(activeColumn),
    },
    terminal: {
      sessions: terminalState.sessions,
      activeSessionId: terminalState.activeSessionId,
      gridLayout: terminalState.gridLayout,
      paneAssignments: terminalState.paneAssignments,
      activePaneIndex: terminalState.activePaneIndex,
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
    },
    ambient: get(layoutSnapshot).ambient,
    layout: {
      activeView: get(layout).activeView,
      editorVisible: get(layout).editorVisible,
      previewVisible: get(layout).previewVisible,
      reviewVisible: get(layout).reviewVisible,
      httpVisible: get(layout).httpVisible,
      tasksVisible: get(layout).tasksVisible,
      orchestratorVisible: get(layout).orchestratorVisible,
      dbVisible: get(layout).dbVisible,
      toolboxVisible: get(layout).toolboxVisible,
      lastAuxView: get(layout).lastAuxView,
      editorSplitPreview: get(layout).editorSplitPreview,
      auxPanelWidth: get(layout).auxPanelWidth,
      auxEditorHeight: get(layout).auxEditorHeight,
      sidebarVisible: get(layout).sidebarVisible,
      sidebarWidth: get(layout).sidebarWidth,
      sidebarTab: get(layout).sidebarTab,
    },
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
  const generation = ++restoreProjectStateGeneration;
  const { invoke } = await import('@tauri-apps/api/core');
  isRestoringProjectState = true;
  isProjectSwitching.set(true);
  try {
    try {
      await invoke('workspace_set_active', { projectId });
    } catch (e) {
      console.error('Failed to notify backend of active project switch:', e);
    }
    if (generation !== restoreProjectStateGeneration) return;

    clearAllStores();
    setActiveTerminalProject(projectId);
    // Make this project's root available to the terminal store so agents typed
    // straight into a shell (no explicit cwd) can still be briefed via their
    // rules file (CLAUDE.md / AGENTS.md) instead of falling back to the paste.
    setTerminalProjectRoot(projectId, rootPath);

    const cached = projectStateCache.get(projectId);
    if (cached) {
      if (generation !== restoreProjectStateGeneration) return;
      openFiles.set(cached.editor.openFiles);
      activeFile.set(cached.editor.activeFile);
      fileCache.set(new Map(cached.editor.fileCache));
      activeLine.set(cached.editor.activeLine);
      activeColumn.set(cached.editor.activeColumn);

      const currentTerminalState = getTerminalProjectState(projectId);
      const hasLiveTerminalState =
        currentTerminalState.sessions.length > 0 ||
        currentTerminalState.activeSessionId !== null ||
        currentTerminalState.paneAssignments.some((value) => value !== null);
      if (!hasLiveTerminalState) {
        restoreTerminalProjectState(projectId, cached.terminal as any);
        setActiveTerminalProject(projectId);
      }

      const restoredUrl = cached.preview.currentUrl || '/';
      const localPreview = parseLocalPreviewUrl(restoredUrl);
      const restoredTargetPort = localPreview?.port ?? cached.preview.targetPort;

      // Point the shared preview proxy at THIS project's dev server BEFORE we
      // restore the tabs / show the panel. The proxy's target port is
      // process-global, so mounting this project's iframes (which immediately
      // hit the proxy) while the backend still targets the previous project's
      // port leaks that project's content into this preview — and it sticks,
      // because the iframe never re-requests once the port catches up.
      try {
        await setPreferredLocalHost(localPreview?.host ?? null);
        if (generation !== restoreProjectStateGeneration) return;
        await invoke('preview_set_target_port', { port: restoredTargetPort });
      } catch (e) {
        console.error('Failed to restore preview target port:', e);
      }
      if (generation !== restoreProjectStateGeneration) return;

      targetPort.set(restoredTargetPort);
      proxyPort.set(cached.preview.proxyPort);
      proxyStarted.set(cached.preview.proxyStarted);
      restorePreviewTabsState(cached.preview.tabs, cached.preview.activeTabId);
      preferredLocalHost.set(localPreview?.host || 'localhost');

      expandedPaths.set(new Set(cached.explorer.expandedPaths));
      selectedPath.set(cached.explorer.selectedPath);
      selectedPaths.set(new Set(cached.explorer.selectedPath ? [cached.explorer.selectedPath] : []));

      layout.update((l) => ({
        ...l,
        activeView: sanitiseActiveView(cached.layout.activeView, l.activeView),
        editorVisible: cached.layout.editorVisible,
        previewVisible: cached.layout.previewVisible,
        reviewVisible: cached.layout.reviewVisible,
        httpVisible: cached.layout.httpVisible,
        tasksVisible: cached.layout.tasksVisible,
        orchestratorVisible: cached.layout.orchestratorVisible,
        dbVisible: cached.layout.dbVisible,
        toolboxVisible: cached.layout.toolboxVisible,
        lastAuxView: sanitiseActiveView(cached.layout.lastAuxView, l.lastAuxView),
        editorSplitPreview: cached.layout.editorSplitPreview,
        auxPanelWidth: cached.layout.auxPanelWidth,
        auxEditorHeight: cached.layout.auxEditorHeight,
        sidebarVisible: cached.layout.sidebarVisible,
        sidebarWidth: cached.layout.sidebarWidth,
        sidebarTab: sanitiseSidebarTab(cached.layout.sidebarTab, l.sidebarTab),
      }));

      // Restore the workspace's ambient room arrangement (Focus / Split /
      // Gallery) for this project via the AppShell command bus, defaulting to
      // Focus so a project without a saved arrangement doesn't inherit the
      // previous project's.
      requestAmbientLayout(cached.ambient ?? 'focus');
    } else {
      const persisted = loadProjectStateFromStorage(projectId);
      if (generation !== restoreProjectStateGeneration) return;

      try {
        const port = await invoke<number>('workspace_detect_port', { path: rootPath });
        if (generation !== restoreProjectStateGeneration) return;
        await setTargetPort(port, { silent: true });
      } catch (err) {
        console.error('Failed to auto-detect/set up preview for new project:', err);
      }

      if (persisted && persisted.openFiles.length > 0) {
        if (generation !== restoreProjectStateGeneration) return;
        await restoreEditorFiles(persisted.openFiles, persisted.activeFile);
        expandedPaths.set(new Set(persisted.expandedPaths));
      }

      if (generation !== restoreProjectStateGeneration) return;
      if (persisted?.layout) {
        layout.update((l) => ({
          ...l,
          activeView: sanitiseActiveView(persisted.layout!.activeView, 'terminal'),
          editorVisible: persisted.layout!.editorVisible ?? false,
          previewVisible: persisted.layout!.previewVisible ?? false,
          reviewVisible: persisted.layout!.reviewVisible ?? false,
          httpVisible: persisted.layout!.httpVisible ?? false,
          tasksVisible: persisted.layout!.tasksVisible ?? false,
          orchestratorVisible: persisted.layout!.orchestratorVisible ?? false,
          dbVisible: persisted.layout!.dbVisible ?? false,
          toolboxVisible: persisted.layout!.toolboxVisible ?? false,
          lastAuxView: sanitiseActiveView(persisted.layout!.lastAuxView, l.lastAuxView),
          editorSplitPreview: persisted.layout!.editorSplitPreview ?? false,
          auxPanelWidth: persisted.layout!.auxPanelWidth ?? 550,
          auxEditorHeight: persisted.layout!.auxEditorHeight ?? 50,
          sidebarVisible: persisted.layout!.sidebarVisible ?? true,
          sidebarWidth: persisted.layout!.sidebarWidth ?? 260,
          sidebarTab: sanitiseSidebarTab(persisted.layout!.sidebarTab, 'files'),
        }));
      }

      // Restore (or default) this project's ambient room arrangement so each
      // project keeps its own Focus / Split / Gallery layout.
      requestAmbientLayout(persisted?.ambient ?? 'focus');

      const existingTerminalState = getTerminalProjectState(projectId);
      const hasLiveTerminalState =
        existingTerminalState.sessions.length > 0 ||
        existingTerminalState.activeSessionId !== null ||
        existingTerminalState.paneAssignments.some((id) => id !== null);

      if (!hasLiveTerminalState) {
        const occupiedPanes = persisted?.terminalPanes?.filter((pane) => pane.hasSession) ?? [];
        if (persisted?.terminalPanes && occupiedPanes.length > 0) {
          const { setGridLayout } = await import('./terminal');
          if (persisted.terminalLayout) {
            setGridLayout(persisted.terminalLayout as any);
          }
          const spawnedIds: number[] = [];
          // Recreate a session only for panes that actually held one, keeping
          // each session in its original pane slot and leaving empty panes empty.
          for (let i = 0; i < persisted.terminalPanes.length; i++) {
            if (generation !== restoreProjectStateGeneration) return;
            const pane = persisted.terminalPanes[i];
            if (!pane.hasSession) continue;
            const metadata = {
              title: pane.title,
              paneTitle: pane.paneTitle,
              agentName: pane.agentName,
              agentPreset: pane.agentPreset,
              role: pane.role,
              taskSummary: pane.taskSummary,
            };
            if (pane.agentPreset) {
              // Agents are their own rooms — they must NOT be slotted into the
              // user's terminal grid, or the mosaic renders their cell as an empty
              // "Agent is open as a panel" pane (the stray empty terminals seen on
              // reload). Restore them with assignPane:false so they surface as
              // rooms; if their backend PTY is gone (cold start), relaunch the CLI
              // into a fresh room rather than leaving a dead shell behind.
              const attachedId = pane.backendSessionId
                ? await attachTerminalSession(pane.backendSessionId, pane.cwd || rootPath, undefined, projectId, metadata, { assignPane: false })
                : null;
              if (attachedId !== null) {
                spawnedIds.push(attachedId);
              } else {
                const roomId = await createTerminalSession(pane.cwd || rootPath, undefined, projectId, { assignPane: false, agentPreset: pane.agentPreset });
                if (roomId !== null) {
                  spawnedIds.push(roomId);
                  relaunchRestoredAgentSession(roomId, pane.agentPreset, metadata);
                }
              }
              continue;
            }
            // Legacy plain-terminal panes (persisted before only agents were
            // saved): keep the original behaviour of restoring into the grid.
            const attachedId = pane.backendSessionId
              ? await attachTerminalSession(pane.backendSessionId, pane.cwd || rootPath, i, projectId, metadata)
              : null;
            const id = attachedId ?? await createTerminalSession(pane.cwd || rootPath, i);
            if (id !== null) {
              spawnedIds.push(id);
              if (attachedId === null) {
                applyRestoredSessionMetadata(id, metadata);
              }
            }
          }
          const { showToast } = await import('./notification');
          if (generation !== restoreProjectStateGeneration) return;
          if (spawnedIds.length > 1) {
            showToast(`Restored ${spawnedIds.length} terminal sessions`, 'info', 3000);
          }
        } else {
          if (generation !== restoreProjectStateGeneration) return;
          await createTerminalSession(rootPath);
        }
      }
    }
  } finally {
    isRestoringProjectState = false;
    isProjectSwitching.set(false);
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
  selectedPaths.set(new Set());

  layout.update((l) => ({
    ...l,
    activeView: 'terminal',
    editorVisible: false,
    previewVisible: false,
    reviewVisible: false,
    httpVisible: false,
    tasksVisible: false,
    orchestratorVisible: false,
    dbVisible: false,
    toolboxVisible: false,
    editorSplitPreview: false,
    auxPanelWidth: 550,
    auxEditorHeight: 50,
    sidebarTab: 'files',
  }));
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
  setActiveTerminalProject(project.id);

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
  setActiveTerminalProject(null);
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

export function createNewWorkspace(name?: string) {
  const id = `ws-${Date.now()}`;
  const newWorkspace: Workspace = {
    id,
    name: name?.trim() || 'New Workspace',
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
  // Save the current project's state before leaving it so it can be restored later
  saveCurrentProjectState();
  // Drop any debounced autosave still queued from the outgoing project — the
  // clearAllStores() below mutates the tracked stores, and a stale timer firing
  // mid-switch would write transitional/cleared state under the wrong id.
  cancelPendingProjectAutosave();

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
  setActiveTerminalProject(null);

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
        setActiveTerminalProject(activeProj.id);
        restoreProjectState(activeProj.id, activeProj.root_path).catch((e) => console.error('restoreProjectState failed:', e));
      } else {
        const firstProjId = get(openProjectIds)[0];
        if (firstProjId) {
          const firstProj = allProjects.get(firstProjId);
          if (firstProj) {
            activeProjectId.set(firstProjId);
            setActiveTerminalProject(firstProjId);
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
          setActiveTerminalProject(firstProjId);
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
    setActiveTerminalProject(project.id);
    await restoreProjectState(project.id, project.root_path);

    // Update active workspace
    recentWorkspaces.update((wsList) => {
      return wsList.map((w) => {
        if (w.id === wsId) {
          const paths = [...w.project_paths];
          if (!paths.includes(path)) {
            paths.push(path);
          }
          
          // Only auto-name a freshly-created (placeholder) workspace after its
          // first folder. Once a workspace has a real name, leave it untouched —
          // adding more projects must not rewrite the user's chosen name.
          let wsName = w.name;
          if (w.name === 'New Workspace' || w.name.trim() === '' || w.name === 'Empty Workspace') {
            wsName = getFilename(path);
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

          // Keep the user's workspace name; closing a project must not rename it.
          return {
            ...w,
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
        // Switch the visible terminal state to the fallback project synchronously,
        // BEFORE restoreProjectState. This keeps gridLayout updating in the same
        // effect flush as activeProject so TerminalPanel's layout effects stay
        // coordinated and the project's saved pane layout isn't clobbered by a
        // stale preset re-apply. Mirrors switchToProject / openProjectByPath.
        setActiveTerminalProject(nextId);
        restoreProjectState(nextId, nextProject.root_path).catch((e) => console.error('restoreProjectState failed:', e));
      }
    } else {
      setActiveTerminalProject(null);
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
    setActiveTerminalProject(projectId);
    
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
  if (!isTauriRuntime()) return;
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
    const keysToRemove = Object.keys(localStorage).filter(
      (k) => k.startsWith('soryq_') || k.startsWith('forge_')
    );
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }

  resetSettingsToDefault();
  resetLayoutToDefault();
  setActiveTerminalProject(null);
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

export function moveProjectToWorkspace(projectPath: string, targetWorkspaceId: string) {
  const currentWsId = get(activeWorkspaceId);
  if (!currentWsId || currentWsId === targetWorkspaceId) return;

  const folderName = getFilename(projectPath);

  recentWorkspaces.update((list) =>
    list.map((w) => {
      if (w.id === currentWsId) {
        // Source workspace keeps its name; only its project list changes.
        const paths = w.project_paths.filter((p) => p !== projectPath);
        return {
          ...w,
          project_paths: paths,
          active_project_path: w.active_project_path === projectPath ? (paths[0] ?? null) : w.active_project_path,
        };
      }
      if (w.id === targetWorkspaceId) {
        const paths = w.project_paths.includes(projectPath) ? w.project_paths : [...w.project_paths, projectPath];
        // Only auto-name the target if it's still an unnamed placeholder.
        let newName = w.name;
        if (w.name === 'New Workspace' || w.name === 'Empty Workspace' || w.name.trim() === '') {
          newName = folderName;
        }
        return { ...w, name: newName, project_paths: paths };
      }
      return w;
    })
  );

  // Close the project in the current workspace if it's open
  const currentProjects = get(projects);
  for (const [id, proj] of currentProjects) {
    if (proj.root_path === projectPath) {
      closeProject(id);
      break;
    }
  }
}
