import { flushSync } from 'react-dom';
import { writable, type Writable } from '$lib/stores/storeCompat';
import type { LayoutState, ActiveView, SidebarTab } from '$lib/types/layout';
import { useLayoutStore } from './zustand/layout';

export type { ActiveView, SidebarTab };

export { sanitiseActiveView, sanitiseSidebarTab, RIGHT_DRAWER_TOOLS } from './zustand/layout';
export type { RightDrawerTool } from './zustand/layout';

function withTransition(fn: () => void) {
  const startViewTransition = (document as any).startViewTransition;
  if (
    startViewTransition &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !(window as any).__soryq_transitioning
  ) {
    (window as any).__soryq_transitioning = true;
    try {
      const transition = startViewTransition.call(document, () => {
        flushSync(fn);
      });
      transition.finished?.finally(() => {
        (window as any).__soryq_transitioning = false;
      }).catch(() => {
        (window as any).__soryq_transitioning = false;
      });
      setTimeout(() => {
        (window as any).__soryq_transitioning = false;
      }, 1000);
    } catch (e) {
      (window as any).__soryq_transitioning = false;
      fn();
    }
  } else {
    fn();
  }
}

// A TWO-WAY binding onto the Zustand layout store. Reading reflects the live
// store; `set`/`update` write back into Zustand (via applyLayoutState) so the
// React UI — which reads `useLayoutStore` directly — actually re-renders. This
// is what makes project-switch restore (workspace.ts) and snapshots
// (snapshot.ts) drive the visible layout. A plain mirror writable would swallow
// those writes silently.
export const layout: Writable<LayoutState> = {
  subscribe(run) {
    run(useLayoutStore.getState());
    return useLayoutStore.subscribe((state) => run(state));
  },
  set(value) {
    useLayoutStore.getState().applyLayoutState(value);
  },
  update(fn) {
    useLayoutStore.getState().applyLayoutState(fn(useLayoutStore.getState()));
  },
};

export const settingsOpen = writable(false);
export const quickCaptureOpen = writable(false);
export const envManagerOpen = writable(false);
export const terminalRoomOpen = writable(false);

// Mirror the modal flags out of Zustand for non-React (writable) consumers.
useLayoutStore.subscribe((state) => {
  settingsOpen.set(state.settingsOpen);
  quickCaptureOpen.set(state.quickCaptureOpen);
  envManagerOpen.set(state.envManagerOpen);
});

// Settings open/close intentionally skips the page-wide view transition. The
// transition snapshots the entire app (terminals, editors, …) before the modal
// can show, which made opening Settings feel laggy. The modal animates itself
// in via the `settingsScaleUp` CSS animation, so it appears instantly and still
// looks smooth.
export function openSettings() { useLayoutStore.getState().openSettings(); }
export function closeSettings() { useLayoutStore.getState().closeSettings(); }
export function openQuickCapture() { withTransition(() => { useLayoutStore.getState().openQuickCapture(); }); }
export function closeQuickCapture() { withTransition(() => { useLayoutStore.getState().closeQuickCapture(); }); }
export function openEnvManager() { withTransition(() => { useLayoutStore.getState().openEnvManager(); }); }
export function closeEnvManager() { withTransition(() => { useLayoutStore.getState().closeEnvManager(); }); }
export function toggleSidebar() { withTransition(() => { useLayoutStore.getState().toggleSidebar(); }); }
export function setSidebarVisible(visible: boolean) { withTransition(() => { useLayoutStore.getState().setSidebarVisible(visible); }); }
export function setActiveView(view: ActiveView) { withTransition(() => { useLayoutStore.getState().setActiveView(view); }); }
export function showTerminal() { withTransition(() => { useLayoutStore.getState().showTerminal(); }); }
export function toggleEditorVisible() { withTransition(() => { useLayoutStore.getState().toggleEditorVisible(); }); }
export function togglePreviewVisible() { withTransition(() => { useLayoutStore.getState().togglePreviewVisible(); }); }
export function toggleReviewVisible() { withTransition(() => { useLayoutStore.getState().toggleReviewVisible(); }); }
export function toggleHttpVisible() { withTransition(() => { useLayoutStore.getState().toggleHttpVisible(); }); }
export function toggleTasksVisible() { withTransition(() => { useLayoutStore.getState().toggleTasksVisible(); }); }
export function toggleDbVisible() { withTransition(() => { useLayoutStore.getState().toggleDbVisible(); }); }
export function toggleContainersVisible() { withTransition(() => { useLayoutStore.getState().toggleContainersVisible(); }); }
export function toggleToolboxVisible() { withTransition(() => { useLayoutStore.getState().toggleToolboxVisible(); }); }
export function setRightDrawerTool(tool: import('./zustand/layout').RightDrawerTool | null) { withTransition(() => { useLayoutStore.getState().setRightDrawerTool(tool); }); }
export function setRightDrawerWidth(width: number) { useLayoutStore.getState().setRightDrawerWidth(width); }
export function toggleYoutubeVisible() { withTransition(() => { useLayoutStore.getState().toggleYoutubeVisible(); }); }
export function toggleOrchestratorVisible() { withTransition(() => { useLayoutStore.getState().toggleOrchestratorVisible(); }); }
export function toggleTerminal() { withTransition(() => { useLayoutStore.getState().toggleTerminal(); }); }
export function setSidebarTab(tab: SidebarTab) { withTransition(() => { useLayoutStore.getState().setSidebarTab(tab); }); }
export function toggleSidebarTab(tab: SidebarTab) { withTransition(() => { useLayoutStore.getState().toggleSidebarTab(tab); }); }
export function toggleEditorSplitPreview() { withTransition(() => { useLayoutStore.getState().toggleEditorSplitPreview(); }); }
export function setSidebarWidth(width: number) { useLayoutStore.getState().setSidebarWidth(width); }
export function resetLayoutToDefault() { withTransition(() => { useLayoutStore.getState().resetLayoutToDefault(); }); }
