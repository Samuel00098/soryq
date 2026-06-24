import { create } from 'zustand';
import type { LayoutState, ActiveView, SidebarTab } from '$lib/types/layout';
import { loadJson } from '$lib/utils/storage';

export type { ActiveView, SidebarTab };

const VALID_ACTIVE_VIEWS = new Set<ActiveView>(['editor', 'terminal', 'preview', 'settings', 'review', 'http', 'tasks', 'orchestrator', 'db', 'containers', 'toolbox', 'youtube']);
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
  youtubeVisible: false,
  auxPanelWidth: 550,
  auxEditorHeight: 50,
  rightDrawerWidth: 380,
};

// The right utility drawer hosts the "summoned tool" panels. They are mutually
// exclusive among themselves (one drawer body at a time) but, unlike the aux
// rooms, opening one does NOT disturb the main rooms (editor/preview/etc.) or
// the active view — the drawer is a right-edge overlay you pop open and dismiss.
export const RIGHT_DRAWER_TOOLS = ['toolbox', 'http', 'db', 'containers', 'env'] as const;
export type RightDrawerTool = (typeof RIGHT_DRAWER_TOOLS)[number];

// The tools whose open state is a persisted aux flag on LayoutState. 'env' is
// handled separately — its open state is the transient `envManagerOpen` flag
// (kept in sync below so the drawer stays single-body).
const AUX_DRAWER_FLAGS: Record<Exclude<RightDrawerTool, 'env'>, keyof LayoutState> = {
  toolbox: 'toolboxVisible',
  http: 'httpVisible',
  db: 'dbVisible',
  containers: 'containersVisible',
};

/** Show exactly one right-drawer tool (or none), clearing every other one. */
function showRightDrawerTool(l: LayoutState, tool: RightDrawerTool | null): LayoutState {
  const next: LayoutState = { ...l };
  for (const t of Object.keys(AUX_DRAWER_FLAGS) as Array<Exclude<RightDrawerTool, 'env'>>) {
    (next as unknown as Record<string, boolean>)[AUX_DRAWER_FLAGS[t]] = t === tool;
  }
  (next as unknown as Record<string, boolean>).envManagerOpen = tool === 'env';
  if (tool && tool !== 'env') next.lastAuxView = tool;
  return next;
}

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
  setRightDrawerTool: (tool: RightDrawerTool | null) => void;
  setRightDrawerWidth: (width: number) => void;
  toggleYoutubeVisible: () => void;
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
  // NOTE: `youtube` is intentionally NOT listed here. It is a free-floating
  // pop-up window (see FloatingYouTube), not an aux room — keeping it out of the
  // aux-flag system means opening another panel never force-closes it, and the
  // window survives ambient mode switches. Its `youtubeVisible` flag is toggled
  // independently by `toggleYoutubeVisible`.
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

  // Env lives in the right utility drawer, so opening it selects the env tool
  // (clearing the other drawer tools) and closing it clears the drawer.
  openEnvManager: () => set((l) => { const next = showRightDrawerTool(l, 'env'); persistLayout(next); return next; }),
  closeEnvManager: () => set((l) => { const next = showRightDrawerTool(l, null); persistLayout(next); return next; }),

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
      if (view === 'youtube') {
        // YouTube is a floating pop-up, not a view to switch to: just open the
        // window and leave the current active view in place.
        const next: LayoutState = { ...l, youtubeVisible: true };
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
      const next = showRightDrawerTool(l, l.httpVisible ? null : 'http');
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
      const next = showRightDrawerTool(l, l.dbVisible ? null : 'db');
      persistLayout(next);
      return next;
    });
  },

  toggleContainersVisible: () => {
    set((l) => {
      const next = showRightDrawerTool(l, l.containersVisible ? null : 'containers');
      persistLayout(next);
      return next;
    });
  },

  toggleToolboxVisible: () => {
    set((l) => {
      const next = showRightDrawerTool(l, l.toolboxVisible ? null : 'toolbox');
      persistLayout(next);
      return next;
    });
  },

  // Force the drawer to a specific tool (used by the drawer's own tab strip), or
  // null to close it. Unlike the toggles, selecting the active tab does not close.
  setRightDrawerTool: (tool: RightDrawerTool | null) => {
    set((l) => {
      const next = showRightDrawerTool(l, tool);
      persistLayout(next);
      return next;
    });
  },

  setRightDrawerWidth: (width: number) => {
    set((l) => {
      const next: LayoutState = { ...l, rightDrawerWidth: Math.max(280, Math.min(720, width)) };
      persistLayout(next);
      return next;
    });
  },

  // YouTube is a free-floating pop-up window, not an aux room: toggling it just
  // flips its own visibility and leaves the rest of the layout (active view,
  // other panels, ambient mode) completely untouched, so it can pop up over any
  // page and persist across mode switches.
  toggleYoutubeVisible: () => {
    if (getState().youtubeVisible) {
      try {
        const raw = localStorage.getItem('soryq_youtube_window');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.minimized) {
            window.dispatchEvent(new CustomEvent('soryq-youtube-restore'));
            return;
          }
        }
      } catch {
        // ignore
      }
    }
    set((l) => {
      const next: LayoutState = { ...l, youtubeVisible: !l.youtubeVisible };
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
