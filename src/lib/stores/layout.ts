import { writable } from 'svelte/store';
import type { LayoutState, ActiveView, SidebarTab } from '$lib/types/layout';

const LAYOUT_KEY = 'devdock_layout';

const defaultLayout: LayoutState = {
  sidebarVisible: true,
  sidebarWidth: 260,
  activeView: 'terminal',
  editorSplitPreview: false,
  sidebarTab: 'files',
  editorVisible: false,
  previewVisible: false,
  reviewVisible: false,
  httpVisible: false,
};

function loadLayout(): LayoutState {
  if (typeof window === 'undefined') return defaultLayout;
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (!stored) return defaultLayout;
    // Merge with defaults so new fields added later always have a value
    const parsed = { ...defaultLayout, ...JSON.parse(stored) } as LayoutState;
    if ((parsed.sidebarTab as string) === 'notes') {
      parsed.sidebarTab = 'files';
    }
    if ((parsed.sidebarTab as string) === 'http') {
      parsed.sidebarTab = 'files';
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

export function toggleSidebar() {
  layout.update((l) => ({ ...l, sidebarVisible: !l.sidebarVisible }));
}

export function setActiveView(view: ActiveView) {
  layout.update((l) => {
    if (view === 'editor') {
      return { ...l, activeView: 'editor', editorVisible: true, previewVisible: false, reviewVisible: false, httpVisible: false, editorSplitPreview: false };
    }
    if (view === 'preview') {
      return { ...l, activeView: 'preview', previewVisible: true, editorVisible: false, reviewVisible: false, httpVisible: false, editorSplitPreview: false };
    }
    if (view === 'review') {
      return { ...l, activeView: 'review', reviewVisible: true, editorVisible: false, previewVisible: false, httpVisible: false, editorSplitPreview: false };
    }
    if (view === 'http') {
      return { ...l, activeView: 'http', httpVisible: true, editorVisible: false, previewVisible: false, reviewVisible: false, editorSplitPreview: false };
    }
    return { ...l, activeView: view };
  });
}

export function toggleEditorVisible() {
  layout.update((l) => {
    if (l.editorVisible) {
      // Same panel clicked again → close it
      return { ...l, editorVisible: false, editorSplitPreview: false, activeView: 'terminal' };
    }
    // Switch to editor, close any other panel
    return { ...l, editorVisible: true, previewVisible: false, reviewVisible: false, httpVisible: false, editorSplitPreview: false, activeView: 'editor' };
  });
}

export function togglePreviewVisible() {
  layout.update((l) => {
    if (l.previewVisible) {
      return { ...l, previewVisible: false, editorSplitPreview: false, activeView: 'terminal' };
    }
    return { ...l, previewVisible: true, editorVisible: false, reviewVisible: false, httpVisible: false, editorSplitPreview: false, activeView: 'preview' };
  });
}

export function toggleReviewVisible() {
  layout.update((l) => {
    if (l.reviewVisible) {
      return { ...l, reviewVisible: false, activeView: 'terminal' };
    }
    return { ...l, reviewVisible: true, editorVisible: false, previewVisible: false, httpVisible: false, editorSplitPreview: false, activeView: 'review' };
  });
}

export function toggleHttpVisible() {
  layout.update((l) => {
    if (l.httpVisible) {
      return { ...l, httpVisible: false, activeView: 'terminal' };
    }
    return { ...l, httpVisible: true, editorVisible: false, previewVisible: false, reviewVisible: false, editorSplitPreview: false, activeView: 'http' };
  });
}

export function toggleTerminal() {
  layout.update((l) => {
    // If editor or preview or review or HTTP client are visible, hide them to maximize terminal
    if (l.editorVisible || l.previewVisible || l.reviewVisible || l.httpVisible) {
      return {
        ...l,
        editorVisible: false,
        previewVisible: false,
        reviewVisible: false,
        httpVisible: false,
        editorSplitPreview: false,
        activeView: 'terminal'
      };
    }
    // Otherwise, ensure terminal is active
    return { ...l, activeView: 'terminal' };
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
  if (typeof window !== 'undefined') localStorage.removeItem(LAYOUT_KEY);
  layout.set({ ...defaultLayout });
}
