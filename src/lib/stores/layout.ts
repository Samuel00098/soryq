import { writable } from 'svelte/store';
import type { LayoutState, ActiveView, SidebarTab } from '$lib/types/layout';

export const layout = writable<LayoutState>({
  sidebarVisible: true,
  sidebarWidth: 220,
  activeView: 'terminal',
  editorSplitPreview: false,
  sidebarTab: 'files',
  editorVisible: false,
  previewVisible: false,
  reviewVisible: false,
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
    let next = { ...l, activeView: view };
    if (view === 'editor') {
      next.editorVisible = true;
    } else if (view === 'preview') {
      next.previewVisible = true;
    } else if (view === 'review') {
      next.reviewVisible = true;
    }
    return next;
  });
}

export function toggleEditorVisible() {
  layout.update((l) => {
    const nextVisible = !l.editorVisible;
    let nextView = l.activeView;
    if (nextVisible) {
      nextView = 'editor';
    } else if (l.activeView === 'editor') {
      nextView = l.previewVisible ? 'preview' : 'terminal';
    }
    const bothVisible = nextVisible && l.previewVisible;
    return { ...l, editorVisible: nextVisible, activeView: nextView, editorSplitPreview: bothVisible };
  });
}

export function togglePreviewVisible() {
  layout.update((l) => {
    const nextVisible = !l.previewVisible;
    let nextView = l.activeView;
    if (nextVisible) {
      nextView = 'preview';
    } else if (l.activeView === 'preview') {
      nextView = l.editorVisible ? 'editor' : (l.reviewVisible ? 'review' : 'terminal');
    }
    const bothVisible = l.editorVisible && nextVisible;
    return { ...l, previewVisible: nextVisible, activeView: nextView, editorSplitPreview: bothVisible };
  });
}

export function toggleReviewVisible() {
  layout.update((l) => {
    const nextVisible = !l.reviewVisible;
    let nextView = l.activeView;
    if (nextVisible) {
      nextView = 'review';
    } else if (l.activeView === 'review') {
      nextView = l.editorVisible ? 'editor' : (l.previewVisible ? 'preview' : 'terminal');
    }
    return { ...l, reviewVisible: nextVisible, activeView: nextView };
  });
}

export function toggleTerminal() {
  layout.update((l) => {
    // If editor or preview or review are visible, hide them to maximize terminal
    if (l.editorVisible || l.previewVisible || l.reviewVisible) {
      return {
        ...l,
        editorVisible: false,
        previewVisible: false,
        reviewVisible: false,
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
      activeView: nextSplit ? 'preview' : 'editor'
    };
  });
}

export function setSidebarWidth(width: number) {
  layout.update((l) => ({ ...l, sidebarWidth: Math.max(100, Math.min(600, width)) }));
}

export function resetLayoutToDefault() {
  layout.set({
    sidebarVisible: true,
    sidebarWidth: 220,
    activeView: 'terminal',
    editorSplitPreview: false,
    sidebarTab: 'files',
    editorVisible: false,
    previewVisible: false,
    reviewVisible: false,
  });
}
