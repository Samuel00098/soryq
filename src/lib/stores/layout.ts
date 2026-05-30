import { writable } from 'svelte/store';
import type { LayoutState, ActiveView, SidebarTab } from '$lib/types/layout';
import { loadJson } from '$lib/utils/storage';

const VALID_ACTIVE_VIEWS = new Set<ActiveView>(['editor', 'terminal', 'preview', 'settings', 'review', 'http', 'tasks']);
const VALID_SIDEBAR_TABS = new Set<SidebarTab>(['files', 'git', 'snapshots', 'history']);

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
  auxPanelWidth: 700,
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
    if (parsed.auxPanelWidth < 700) {
      parsed.auxPanelWidth = 700;
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

export function toggleSidebar() {
  layout.update((l) => ({ ...l, sidebarVisible: !l.sidebarVisible }));
}

function restoreLastAuxView(l: LayoutState): LayoutState {
  const view = l.lastAuxView;
  if (view === 'editor')  return { ...l, activeView: 'editor',  editorVisible: true,  previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false };
  if (view === 'preview') return { ...l, activeView: 'preview', previewVisible: true, editorVisible: false,  reviewVisible: false, httpVisible: false, tasksVisible: false };
  if (view === 'review')  return { ...l, activeView: 'review',  reviewVisible: true,  editorVisible: false,  previewVisible: false, httpVisible: false, tasksVisible: false };
  if (view === 'http')    return { ...l, activeView: 'http',    httpVisible: true,    editorVisible: false,  previewVisible: false, reviewVisible: false, tasksVisible: false };
  if (view === 'tasks')   return { ...l, activeView: 'tasks',   tasksVisible: true,   editorVisible: false,  previewVisible: false, reviewVisible: false, httpVisible: false };
  return { ...l, activeView: 'editor', editorVisible: true, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false };
}

export function setActiveView(view: ActiveView) {
  layout.update((l) => {
    if (view === 'terminal') {
      const anyAuxVisible = l.editorVisible || l.previewVisible || l.reviewVisible || l.httpVisible || l.tasksVisible;
      if (anyAuxVisible) {
        return { ...l, activeView: 'terminal', editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, editorSplitPreview: false };
      }
      // Already on terminal — restore last aux panel (acts as a toggle)
      return restoreLastAuxView(l);
    }
    if (view === 'editor') {
      return { ...l, activeView: 'editor', lastAuxView: 'editor', editorVisible: true, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, editorSplitPreview: false };
    }
    if (view === 'preview') {
      return { ...l, activeView: 'preview', lastAuxView: 'preview', previewVisible: true, editorVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, editorSplitPreview: false };
    }
    if (view === 'review') {
      return { ...l, activeView: 'review', lastAuxView: 'review', reviewVisible: true, editorVisible: false, previewVisible: false, httpVisible: false, tasksVisible: false, editorSplitPreview: false };
    }
    if (view === 'http') {
      return { ...l, activeView: 'http', lastAuxView: 'http', httpVisible: true, editorVisible: false, previewVisible: false, reviewVisible: false, tasksVisible: false, editorSplitPreview: false };
    }
    if (view === 'tasks') {
      return { ...l, activeView: 'tasks', lastAuxView: 'tasks', tasksVisible: true, editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, editorSplitPreview: false };
    }
    return { ...l, activeView: view };
  });
}

export function toggleEditorVisible() {
  layout.update((l) => {
    if (l.editorVisible) {
      return { ...l, editorVisible: false, editorSplitPreview: false, activeView: 'terminal' };
    }
    return { ...l, editorVisible: true, lastAuxView: 'editor', previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, editorSplitPreview: false, activeView: 'editor' };
  });
}

export function togglePreviewVisible() {
  layout.update((l) => {
    if (l.previewVisible) {
      return { ...l, previewVisible: false, editorSplitPreview: false, activeView: 'terminal' };
    }
    return { ...l, previewVisible: true, lastAuxView: 'preview', editorVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, editorSplitPreview: false, activeView: 'preview' };
  });
}

export function toggleReviewVisible() {
  layout.update((l) => {
    if (l.reviewVisible) {
      return { ...l, reviewVisible: false, activeView: 'terminal' };
    }
    return { ...l, reviewVisible: true, lastAuxView: 'review', editorVisible: false, previewVisible: false, httpVisible: false, tasksVisible: false, editorSplitPreview: false, activeView: 'review' };
  });
}

export function toggleHttpVisible() {
  layout.update((l) => {
    if (l.httpVisible) {
      return { ...l, httpVisible: false, activeView: 'terminal' };
    }
    return { ...l, httpVisible: true, lastAuxView: 'http', editorVisible: false, previewVisible: false, reviewVisible: false, tasksVisible: false, editorSplitPreview: false, activeView: 'http' };
  });
}

export function toggleTasksVisible() {
  layout.update((l) => {
    if (l.tasksVisible) {
      return { ...l, tasksVisible: false, activeView: 'terminal' };
    }
    return { ...l, tasksVisible: true, lastAuxView: 'tasks', editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, editorSplitPreview: false, activeView: 'tasks' };
  });
}

// Make the terminal the active/focused view without toggling the aux panel.
// Used by actions like Quick Run that just need the terminal focused so the
// command output is visible — they must not open or close the right aux panel.
export function focusTerminal() {
  layout.update((l) => (l.activeView === 'terminal' ? l : { ...l, activeView: 'terminal' }));
}

export function toggleTerminal() {
  layout.update((l) => {
    if (l.editorVisible || l.previewVisible || l.reviewVisible || l.httpVisible || l.tasksVisible) {
      return { ...l, editorVisible: false, previewVisible: false, reviewVisible: false, httpVisible: false, tasksVisible: false, editorSplitPreview: false, activeView: 'terminal' };
    }
    // Aux panel is closed — restore the last tab the user was on
    return restoreLastAuxView(l);
  });
}

export function setSidebarTab(tab: SidebarTab) {
  layout.update((l) => ({ ...l, sidebarTab: tab }));
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
