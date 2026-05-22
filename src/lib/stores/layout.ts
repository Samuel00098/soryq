import { writable } from 'svelte/store';
import type { LayoutState, ActiveView, SidebarTab } from '$lib/types/layout';

export const layout = writable<LayoutState>({
  sidebarVisible: true,
  sidebarWidth: 260,
  activeView: 'editor',
  editorSplitPreview: false,
  sidebarTab: 'files',
});

// Settings modal open state (separate from view navigation)
export const settingsOpen = writable(false);

export function openSettings() { settingsOpen.set(true); }
export function closeSettings() { settingsOpen.set(false); }

export function toggleSidebar() {
  layout.update((l) => ({ ...l, sidebarVisible: !l.sidebarVisible }));
}

export function setActiveView(view: ActiveView) {
  layout.update((l) => ({ ...l, activeView: view }));
}

export function setSidebarTab(tab: SidebarTab) {
  layout.update((l) => ({ ...l, sidebarTab: tab }));
}

export function toggleEditorSplitPreview() {
  layout.update((l) => ({ ...l, editorSplitPreview: !l.editorSplitPreview }));
}

export function setSidebarWidth(width: number) {
  layout.update((l) => ({ ...l, sidebarWidth: Math.max(150, Math.min(600, width)) }));
}

export function resetLayoutToDefault() {
  layout.set({
    sidebarVisible: true,
    sidebarWidth: 260,
    activeView: 'editor',
    editorSplitPreview: false,
    sidebarTab: 'files',
  });
}
