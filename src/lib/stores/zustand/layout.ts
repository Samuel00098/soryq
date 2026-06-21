import { create } from 'zustand';
import type { LayoutState, ActiveView, SidebarTab } from '$lib/types/layout';
import { loadJson } from '$lib/utils/storage';

export type { ActiveView, SidebarTab };

const VALID_ACTIVE_VIEWS = new Set<ActiveView>(['editor', 'terminal', 'preview', 'settings', 'review', 'http', 'tasks', 'orchestrator', 'db', 'containers', 'toolbox', 'pet', 'youtube', 'android', 'ios']);
const VALID_SIDEBAR_TABS = new Set<SidebarTab>(['files', 'search', 'git', 'snapshots', 'history', 'snippets']);

export function sanitiseActiveView(v: unknown, fallback: ActiveView = 'terminal'): ActiveView {
  return VALID_ACTIVE_VIEWS.has(v as ActiveView) ? (v as ActiveView) : fallback;
}

export function sanitiseSidebarTab(v: unknown, fallback: SidebarTab = 'files'): SidebarTab {
  return VALID_SIDEBAR_TABS.has(v as SidebarTab) ? (v as SidebarTab) : fallback;
}

const LAYOUT_KEY = 'soryq_layout';

const defaultLayout: LayoutState = {
  sidebarVisible: true,
  sidebarWidth: 260,
  activeView: 'terminal',
  lastAuxView: 'preview',
  editorSplitPreview: false,
  sidebarTab: 'files',
  editorVisible: false,
  previewVisible: false,
  reviewVisible: false,
  httpVisible: false,
  tasksVisible: false,
  orchestratorVisible: false,
  dbVisible: false,
  containersVisible: false,
  toolboxVisible: false,
  petVisible: false,
  youtubeVisible: false,
  androidVisible: false,
  iosVisible: false,
  auxPanelWidth: 550,
  auxEditorHeight: 50,
};

function loadLayout(): LayoutState {
  if (typeof window === 'undefined') return defaultLayout;
  try {
    const stored = loadJson<LayoutState | null>(LAYOUT_KEY, null);
    if (!stored) return defaultLayout;
    const parsed = { ...defaultLayout, ...stored } as LayoutState;
    if ((parsed.sidebarTab as string) === 'notes') parsed.sidebarTab = 'files';
    if ((parsed.sidebarTab as string) === 'http') parsed.sidebarTab = 'files';
    if ((parsed.sidebarTab as string) === 'tasks') parsed.sidebarTab = 'files';
    if ((parsed.sidebarTab as string) === 'runs') parsed.sidebarTab = 'files';
    if (parsed.auxPanelWidth < 180) parsed.auxPanelWidth = 180;
    return parsed;
  } catch {
    return defaultLayout;
  }
}

function persistLayout(val: LayoutState) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(val));
  }
}

interface LayoutActions {
  setActiveView: (view: ActiveView) => void;
  showTerminal: () => void;
  toggleSidebar: () => void;
  toggleEditorVisible: () => void;
  togglePreviewVisible: () => void;
  toggleReviewVisible: () => void;
  toggleHttpVisible: () => void;
  toggleTasksVisible: () => void;
  toggleDbVisible: () => void;
  toggleContainersVisible: () => void;
  toggleToolboxVisible: () => void;
  togglePetVisible: () => void;
  toggleYoutubeVisible: () => void;
  toggleAndroidVisible: () => void;
  toggleIosVisible: () => void;
  toggleOrchestratorVisible: () => void;
  toggleTerminal: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebarTab: (tab: SidebarTab) => void;
  toggleEditorSplitPreview: () => void;
  setSidebarWidth: (width: number) => void;
  resetLayoutToDefault: () => void;
  /** Merge a partial layout patch into the store and persist it. Used to
   *  restore a project's saved view/panels when switching projects. */
  applyLayoutState: (patch: Partial<LayoutState>) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openQuickCapture: () => void;
  closeQuickCapture: () => void;
  openEnvManager: () => void;
  closeEnvManager: () => void;
  settingsOpen: boolean;
  quickCaptureOpen: boolean;
  envManagerOpen: boolean;
}

// Maps each aux ActiveView to its visibility flag. Adding a panel here wires it
// into restore (toggleTerminal), single-panel clearing, and lastAuxView handling.
const AUX_VIEW_FLAGS = {
  editor: 'editorVisible',
  preview: 'previewVisible',
  review: 'reviewVisible',
  http: 'httpVisible',
  tasks: 'tasksVisible',
  db: 'dbVisible',
  containers: 'containersVisible',
  toolbox: 'toolboxVisible',
  pet: 'petVisible',
  youtube: 'youtubeVisible',
  android: 'androidVisible',
  ios: 'iosVisible',
} as const satisfies Partial<Record<ActiveView, keyof LayoutState>>;

type AuxView = keyof typeof AUX_VIEW_FLAGS;
const AUX_FLAGS = Object.values(AUX_VIEW_FLAGS) as (keyof LayoutState)[];

/** All aux-panel flags cleared to false — spread before setting the one you want. */
function clearedAuxFlags(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const flag of AUX_FLAGS) out[flag] = false;
  return out;
}

/** Make exactly `view`'s aux panel visible, clearing every other aux panel. */
function showOnlyAux(l: LayoutState, view: AuxView): LayoutState {
  return {
    ...l,
    ...clearedAuxFlags(),
    [AUX_VIEW_FLAGS[view]]: true,
    activeView: view,
    lastAuxView: view,
    sidebarVisible: l.sidebarVisible,
    editorSplitPreview: false,
  };
}

function restoreLastAuxView(l: LayoutState): LayoutState {
  const view = (l.lastAuxView in AUX_VIEW_FLAGS ? l.lastAuxView : 'editor') as AuxView;
  return showOnlyAux(l, view);
}

export const useLayoutStore = create<LayoutState & LayoutActions>((set, getState) => ({
  ...loadLayout(),
  settingsOpen: false,
  quickCaptureOpen: false,
  envManagerOpen: false,

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  openQuickCapture: () => set({ quickCaptureOpen: true }),
  closeQuickCapture: () => set({ quickCaptureOpen: false }),

  openEnvManager: () => set({ envManagerOpen: true }),
  closeEnvManager: () => set({ envManagerOpen: false }),

  toggleSidebar: () => {
    set((s) => {
      const next: LayoutState = { ...s, sidebarVisible: !s.sidebarVisible };
      persistLayout(next);
      return next;
    });
  },

  setActiveView: (view: ActiveView) => {
    set((l) => {
      if (view === 'terminal') {
        const next: LayoutState = { ...l, activeView: 'terminal' as const };
        persistLayout(next);
        return next;
      }
      if (view === 'editor') {
        const next: LayoutState = { ...l, activeView: 'editor' as const, lastAuxView: 'editor' as const, editorVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'preview') {
        const next: LayoutState = { ...l, activeView: 'preview' as const, lastAuxView: 'preview' as const, previewVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'review') {
        const next: LayoutState = { ...l, activeView: 'review' as const, lastAuxView: 'review' as const, reviewVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'http') {
        const next: LayoutState = { ...l, activeView: 'http' as const, lastAuxView: 'http' as const, httpVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'tasks') {
        const next: LayoutState = { ...l, activeView: 'tasks' as const, lastAuxView: 'tasks' as const, tasksVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'db') {
        const next: LayoutState = { ...l, activeView: 'db' as const, lastAuxView: 'db' as const, dbVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'containers') {
        const next: LayoutState = { ...l, activeView: 'containers' as const, lastAuxView: 'containers' as const, containersVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'toolbox') {
        const next: LayoutState = { ...l, activeView: 'toolbox' as const, lastAuxView: 'toolbox' as const, toolboxVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'pet') {
        const next: LayoutState = { ...l, activeView: 'pet' as const, lastAuxView: 'pet' as const, petVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'youtube') {
        const next: LayoutState = { ...l, activeView: 'youtube' as const, lastAuxView: 'youtube' as const, youtubeVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'android') {
        const next: LayoutState = { ...l, activeView: 'android' as const, lastAuxView: 'android' as const, androidVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'ios') {
        const next: LayoutState = { ...l, activeView: 'ios' as const, lastAuxView: 'ios' as const, iosVisible: true };
        persistLayout(next);
        return next;
      }
      if (view === 'orchestrator') {
        const next: LayoutState = { ...l, orchestratorVisible: true };
        persistLayout(next);
        return next;
      }
      const next: LayoutState = { ...l, activeView: view };
      persistLayout(next);
      return next;
    });
  },

  showTerminal: () => {
    set((l) => {
      const next: LayoutState = { ...l, activeView: 'terminal' as const };
      persistLayout(next);
      return next;
    });
  },

  toggleEditorVisible: () => {
    set((l) => {
      const next: LayoutState = l.editorVisible
        ? { ...l, editorVisible: false, editorSplitPreview: false, activeView: 'terminal' as const }
        : { ...l, editorVisible: true, lastAuxView: 'editor' as const, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, containersVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'editor' as const };
      persistLayout(next);
      return next;
    });
  },

  togglePreviewVisible: () => {
    set((l) => {
      const next: LayoutState = l.previewVisible
        ? { ...l, previewVisible: false, editorSplitPreview: false, activeView: 'terminal' as const }
        : { ...l, previewVisible: true, lastAuxView: 'preview' as const, editorVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, containersVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'preview' as const };
      persistLayout(next);
      return next;
    });
  },

  toggleReviewVisible: () => {
    set((l) => {
      const next: LayoutState = l.reviewVisible
        ? { ...l, reviewVisible: false, activeView: 'terminal' as const }
        : { ...l, reviewVisible: true, lastAuxView: 'review' as const, editorVisible: false, previewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, containersVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'review' as const };
      persistLayout(next);
      return next;
    });
  },

  toggleHttpVisible: () => {
    set((l) => {
      const next: LayoutState = l.httpVisible
        ? { ...l, httpVisible: false, activeView: 'terminal' as const }
        : { ...l, httpVisible: true, lastAuxView: 'http' as const, dbVisible: false, containersVisible: false, toolboxVisible: false, activeView: 'http' as const };
      persistLayout(next);
      return next;
    });
  },

  toggleTasksVisible: () => {
    set((l) => {
      const next: LayoutState = l.tasksVisible
        ? { ...l, tasksVisible: false, activeView: 'terminal' as const }
        : { ...l, tasksVisible: true, lastAuxView: 'tasks' as const, editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, dbVisible: false, containersVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'tasks' as const };
      persistLayout(next);
      return next;
    });
  },

  toggleDbVisible: () => {
    set((l) => {
      const next: LayoutState = l.dbVisible
        ? { ...l, dbVisible: false, activeView: 'terminal' as const }
        : { ...l, dbVisible: true, lastAuxView: 'db' as const, httpVisible: false, containersVisible: false, toolboxVisible: false, activeView: 'db' as const };
      persistLayout(next);
      return next;
    });
  },

  toggleContainersVisible: () => {
    set((l) => {
      const next: LayoutState = l.containersVisible
        ? { ...l, containersVisible: false, activeView: 'terminal' as const }
        : { ...l, containersVisible: true, lastAuxView: 'containers' as const, httpVisible: false, dbVisible: false, toolboxVisible: false, activeView: 'containers' as const };
      persistLayout(next);
      return next;
    });
  },

  toggleToolboxVisible: () => {
    set((l) => {
      const next: LayoutState = l.toolboxVisible
        ? { ...l, toolboxVisible: false, activeView: 'terminal' as const }
        : { ...l, toolboxVisible: true, lastAuxView: 'toolbox' as const, httpVisible: false, dbVisible: false, containersVisible: false, activeView: 'toolbox' as const };
      persistLayout(next);
      return next;
    });
  },

  togglePetVisible: () => {
    set((l) => {
      const next: LayoutState = { ...l, petVisible: !l.petVisible };
      persistLayout(next);
      return next;
    });
  },

  toggleYoutubeVisible: () => {
    set((l) => {
      const next: LayoutState = { ...l, youtubeVisible: !l.youtubeVisible };
      persistLayout(next);
      return next;
    });
  },

  toggleAndroidVisible: () => {
    set((l) => {
      const next: LayoutState = l.androidVisible
        ? { ...l, androidVisible: false, activeView: 'terminal' as const }
        : showOnlyAux(l, 'android');
      persistLayout(next);
      return next;
    });
  },

  toggleIosVisible: () => {
    set((l) => {
      const next: LayoutState = l.iosVisible
        ? { ...l, iosVisible: false, activeView: 'terminal' as const }
        : showOnlyAux(l, 'ios');
      persistLayout(next);
      return next;
    });
  },

  toggleOrchestratorVisible: () => {
    set((l) => {
      const next: LayoutState = { ...l, orchestratorVisible: !l.orchestratorVisible };
      persistLayout(next);
      return next;
    });
  },

  toggleTerminal: () => {
    set((l) => {
      const anyAuxVisible = AUX_FLAGS.some((flag) => l[flag]);
      const next: LayoutState = anyAuxVisible
        ? { ...l, ...(clearedAuxFlags() as unknown as Partial<LayoutState>), editorSplitPreview: false, activeView: 'terminal' as const }
        : restoreLastAuxView(l);
      persistLayout(next);
      return next;
    });
  },

  setSidebarTab: (tab: SidebarTab) => {
    set((l) => {
      const next: LayoutState = { ...l, sidebarTab: tab, sidebarVisible: true };
      persistLayout(next);
      return next;
    });
  },

  toggleSidebarTab: (tab: SidebarTab) => {
    set((l) => {
      const next: LayoutState = l.sidebarVisible && l.sidebarTab === tab
        ? { ...l, sidebarVisible: false }
        : { ...l, sidebarVisible: true, sidebarTab: tab };
      persistLayout(next);
      return next;
    });
  },

  toggleEditorSplitPreview: () => {
    set((l) => {
      const nextSplit = !l.editorSplitPreview;
      const next: LayoutState = { ...l, editorSplitPreview: nextSplit, editorVisible: true, previewVisible: nextSplit, reviewVisible: false, httpVisible: false, containersVisible: false, activeView: (nextSplit ? 'preview' : 'editor') as ActiveView };
      persistLayout(next);
      return next;
    });
  },

  setSidebarWidth: (width: number) => {
    set((l) => {
      const next: LayoutState = { ...l, sidebarWidth: Math.max(100, Math.min(600, width)) };
      persistLayout(next);
      return next;
    });
  },

  resetLayoutToDefault: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LAYOUT_KEY);
    }
    set({ ...defaultLayout });
  },

  applyLayoutState: (patch: Partial<LayoutState>) => {
    set((l) => {
      const next = { ...l, ...patch };
      persistLayout(next);
      return next;
    });
  },
}));
