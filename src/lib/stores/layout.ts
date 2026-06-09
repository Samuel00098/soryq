import { writable } from 'svelte/store';
import type { LayoutState, ActiveView, SidebarTab } from '$lib/types/layout';
import { loadJson } from '$lib/utils/storage';

const VALID_ACTIVE_VIEWS = new Set<ActiveView>(['editor', 'terminal', 'preview', 'settings', 'review', 'http', 'tasks', 'orchestrator', 'db', 'toolbox']);
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
  toolboxVisible: false,
  auxPanelWidth: 550,
  auxEditorHeight: 50,
};

function loadLayout(): LayoutState {
  if (typeof window === 'undefined') return defaultLayout;
  try {
    const stored = loadJson<LayoutState | null>(LAYOUT_KEY, null);
    if (!stored) return defaultLayout;
    // Merge with defaults so new fields added later always have a value
    const parsed = { ...defaultLayout, ...stored } as LayoutState;
    if ((parsed.sidebarTab as string) === 'notes') {
      parsed.sidebarTab = 'files';
    }
    if ((parsed.sidebarTab as string) === 'http') {
      parsed.sidebarTab = 'files';
    }
    if ((parsed.sidebarTab as string) === 'tasks') {
      parsed.sidebarTab = 'files';
    }
    if ((parsed.sidebarTab as string) === 'runs') {
      parsed.sidebarTab = 'files';
    }
    if (parsed.auxPanelWidth < 180) {
      parsed.auxPanelWidth = 180;
    }
    return parsed;
  } catch {
    return defaultLayout;
  }
}

export const layout = writable<LayoutState>(loadLayout());

// Persist every change
layout.subscribe((val) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(val));
  }
});

// Settings modal open state (separate from view navigation)
export const settingsOpen = writable(false);

export function openSettings() { settingsOpen.set(true); }
export function closeSettings() { settingsOpen.set(false); }

// Quick capture overlay state
export const quickCaptureOpen = writable(false);

export function openQuickCapture() { quickCaptureOpen.set(true); }
export function closeQuickCapture() { quickCaptureOpen.set(false); }

// Environment manager overlay state
export const envManagerOpen = writable(false);

export function openEnvManager() { envManagerOpen.set(true); }
export function closeEnvManager() { envManagerOpen.set(false); }

export function toggleSidebar() {
  layout.update((l) => ({ ...l, sidebarVisible: !l.sidebarVisible }));
}

function restoreLastAuxView(l: LayoutState): LayoutState {
  const view = l.lastAuxView;
  if (view === 'editor')  return { ...l, activeView: 'editor',  editorVisible: true,  previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false };
  if (view === 'preview') return { ...l, activeView: 'preview', previewVisible: true, editorVisible: false,  reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false };
  if (view === 'review')  return { ...l, activeView: 'review',  reviewVisible: true,  editorVisible: false,  previewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false };
  if (view === 'http')    return { ...l, activeView: 'http',    httpVisible: true,    editorVisible: false,  previewVisible: false, reviewVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false };
  if (view === 'tasks')   return { ...l, activeView: 'tasks',   tasksVisible: true,   editorVisible: false,  previewVisible: false, reviewVisible: false, httpVisible: false, dbVisible: false, toolboxVisible: false };
  if (view === 'db')      return { ...l, activeView: 'db',      dbVisible: true,      editorVisible: false,  previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, toolboxVisible: false };
  if (view === 'toolbox') return { ...l, activeView: 'toolbox', toolboxVisible: true, editorVisible: false,  previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false };
  return { ...l, activeView: 'editor', editorVisible: true, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false };
}

export function setActiveView(view: ActiveView) {
  layout.update((l) => {
    if (view === 'terminal') {
      const anyAuxVisible = l.editorVisible || l.previewVisible || l.reviewVisible || l.httpVisible || l.tasksVisible || l.dbVisible || l.toolboxVisible;
      if (anyAuxVisible) {
        return { ...l, activeView: 'terminal', editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false };
      }
      // Already on terminal — restore last aux panel (acts as a toggle)
      return restoreLastAuxView(l);
    }
    if (view === 'editor') {
      return { ...l, activeView: 'editor', lastAuxView: 'editor', editorVisible: true, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false };
    }
    if (view === 'preview') {
      return { ...l, activeView: 'preview', lastAuxView: 'preview', previewVisible: true, editorVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false };
    }
    if (view === 'review') {
      return { ...l, activeView: 'review', lastAuxView: 'review', reviewVisible: true, editorVisible: false, previewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false };
    }
    if (view === 'http') {
      return { ...l, activeView: 'http', lastAuxView: 'http', httpVisible: true, editorVisible: false, previewVisible: false, reviewVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false };
    }
    if (view === 'tasks') {
      return { ...l, activeView: 'tasks', lastAuxView: 'tasks', tasksVisible: true, editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false };
    }
    if (view === 'db') {
      return { ...l, activeView: 'db', lastAuxView: 'db', dbVisible: true, editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, toolboxVisible: false, editorSplitPreview: false };
    }
    if (view === 'toolbox') {
      return { ...l, activeView: 'toolbox', lastAuxView: 'toolbox', toolboxVisible: true, editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, editorSplitPreview: false };
    }
    if (view === 'orchestrator') {
      // Orchestrator is now a modal overlay — just toggle it open
      return { ...l, orchestratorVisible: true };
    }
    return { ...l, activeView: view };
  });
}

/**
 * Unconditionally switch to the terminal view, hiding any aux panel.
 * Unlike `setActiveView('terminal')`, this never toggles back to the last aux
 * view — use it when something (e.g. a "Focus" notification) must reliably land
 * the user on the terminal.
 */
export function showTerminal() {
  layout.update((l) => ({
    ...l,
    activeView: 'terminal',
    editorVisible: false,
    previewVisible: false,
    reviewVisible: false,
    httpVisible: false,
    tasksVisible: false,
    dbVisible: false,
    toolboxVisible: false,
    editorSplitPreview: false,
    // orchestratorVisible intentionally not touched — modal is independent
  }));
}

export function toggleEditorVisible() {
  layout.update((l) => {
    if (l.editorVisible) {
      return { ...l, editorVisible: false, editorSplitPreview: false, activeView: 'terminal' };
    }
    return { ...l, editorVisible: true, lastAuxView: 'editor', previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'editor' };
  });
}

export function togglePreviewVisible() {
  layout.update((l) => {
    if (l.previewVisible) {
      return { ...l, previewVisible: false, editorSplitPreview: false, activeView: 'terminal' };
    }
    return { ...l, previewVisible: true, lastAuxView: 'preview', editorVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'preview' };
  });
}

export function toggleReviewVisible() {
  layout.update((l) => {
    if (l.reviewVisible) {
      return { ...l, reviewVisible: false, activeView: 'terminal' };
    }
    return { ...l, reviewVisible: true, lastAuxView: 'review', editorVisible: false, previewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'review' };
  });
}

export function toggleHttpVisible() {
  layout.update((l) => {
    if (l.httpVisible) {
      return { ...l, httpVisible: false, activeView: 'terminal' };
    }
    return { ...l, httpVisible: true, lastAuxView: 'http', editorVisible: false, previewVisible: false, reviewVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'http' };
  });
}

export function toggleTasksVisible() {
  layout.update((l) => {
    if (l.tasksVisible) {
      return { ...l, tasksVisible: false, activeView: 'terminal' };
    }
    return { ...l, tasksVisible: true, lastAuxView: 'tasks', editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'tasks' };
  });
}

export function toggleDbVisible() {
  layout.update((l) => {
    if (l.dbVisible) {
      return { ...l, dbVisible: false, activeView: 'terminal' };
    }
    return { ...l, dbVisible: true, lastAuxView: 'db', editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'db' };
  });
}

export function toggleToolboxVisible() {
  layout.update((l) => {
    if (l.toolboxVisible) {
      return { ...l, toolboxVisible: false, activeView: 'terminal' };
    }
    return { ...l, toolboxVisible: true, lastAuxView: 'toolbox', editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, editorSplitPreview: false, activeView: 'toolbox' };
  });
}

export function toggleOrchestratorVisible() {
  layout.update((l) => ({ ...l, orchestratorVisible: !l.orchestratorVisible }));
}

export function toggleTerminal() {
  layout.update((l) => {
    if (l.editorVisible || l.previewVisible || l.reviewVisible || l.httpVisible || l.tasksVisible || l.dbVisible || l.toolboxVisible) {
      return { ...l, editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, dbVisible: false, toolboxVisible: false, editorSplitPreview: false, activeView: 'terminal' };
    }
    // Aux panel is closed — restore the last tab the user was on
    return restoreLastAuxView(l);
  });
}

export function setSidebarTab(tab: SidebarTab) {
  layout.update((l) => ({ ...l, sidebarTab: tab, sidebarVisible: true }));
}

export function toggleSidebarTab(tab: SidebarTab) {
  layout.update((l) => {
    if (l.sidebarVisible && l.sidebarTab === tab) {
      return { ...l, sidebarVisible: false };
    }
    return { ...l, sidebarVisible: true, sidebarTab: tab };
  });
}

export function toggleEditorSplitPreview() {
  layout.update((l) => {
    const nextSplit = !l.editorSplitPreview;
    return {
      ...l,
      editorSplitPreview: nextSplit,
      editorVisible: true,
      previewVisible: nextSplit,
      reviewVisible: false,
      httpVisible: false,
      activeView: nextSplit ? 'preview' : 'editor'
    };
  });
}

export function setSidebarWidth(width: number) {
  layout.update((l) => ({ ...l, sidebarWidth: Math.max(100, Math.min(600, width)) }));
}

export function resetLayoutToDefault() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(LAYOUT_KEY);
  }
  layout.set({ ...defaultLayout });
}
