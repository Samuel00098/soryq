import { writable, get } from '$lib/stores/storeCompat';
import { activeWorkspaceId, activeProjectId, openWorkspace, switchToProject } from './workspace';
import { layout, setActiveView } from './layout';
import { activeFile, openFile } from './editor';
import type { ActiveView } from '$lib/types/layout';
import { useNavigationStore } from './zustand/navigation';

function syncWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  const zustandVal = (useNavigationStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;
  const store = writable<T>(initial);
  void useNavigationStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) store.set(next);
  });
  return {
    subscribe: store.subscribe,
    set(value: T) { (useNavigationStore.getState() as any).__set(key, value); },
    update(fn: (val: T) => T) {
      const current = (useNavigationStore.getState() as any)[key] as T;
      (useNavigationStore.getState() as any).__set(key, fn(current));
    },
  };
}

interface NavState {
  workspaceId: string | null;
  projectId: string | null;
  activeView: ActiveView;
  activeFile: string | null;
}

let history: NavState[] = [];
let currentIndex = -1;
let isNavigatingHistory = false;

// Stores for UI state
export const canGoBack = syncWritable<boolean>('canGoBack', false);
export const canGoForward = syncWritable<boolean>('canGoForward', false);

function updateCanNav() {
  canGoBack.set(currentIndex > 0);
  canGoForward.set(currentIndex < history.length - 1);
}

export function recordNavigation(state: NavState) {
  if (isNavigatingHistory) return;

  const current = history[currentIndex];
  if (current && 
      current.workspaceId === state.workspaceId && 
      current.projectId === state.projectId && 
      current.activeView === state.activeView && 
      current.activeFile === state.activeFile) {
    return;
  }

  // Clear any forward history since we are branching
  history = history.slice(0, currentIndex + 1);
  history.push(state);
  currentIndex = history.length - 1;
  updateCanNav();
}

async function applyState(state: NavState) {
  isNavigatingHistory = true;
  try {
    // 1. Restore Workspace
    if (get(activeWorkspaceId) !== state.workspaceId) {
      if (state.workspaceId) {
        await openWorkspace(state.workspaceId);
      } else {
        activeWorkspaceId.set(null);
      }
    }

    // 2. Restore Project/Folder
    if (get(activeProjectId) !== state.projectId) {
      if (state.projectId) {
        switchToProject(state.projectId);
      } else {
        activeProjectId.set(null);
      }
    }

    // 3. Restore View
    if (get(layout).activeView !== state.activeView) {
      setActiveView(state.activeView);
    }

    // 4. Restore File
    if (get(activeFile) !== state.activeFile) {
      if (state.activeFile) {
        await openFile(state.activeFile);
      } else {
        activeFile.set(null);
      }
    }
  } catch (e) {
    console.error('Failed to apply navigation state:', e);
  } finally {
    isNavigatingHistory = false;
  }
}

export async function navigateBack() {
  if (currentIndex > 0) {
    currentIndex--;
    await applyState(history[currentIndex]);
    updateCanNav();
  }
}

export async function navigateForward() {
  if (currentIndex < history.length - 1) {
    currentIndex++;
    await applyState(history[currentIndex]);
    updateCanNav();
  }
}

// Automatically subscribe to active stores
export function initNavigationHistory() {
  if (typeof window === 'undefined') return;

  setTimeout(() => {
    let lastWorkspaceId = get(activeWorkspaceId);
    let lastProjectId = get(activeProjectId);
    let lastView = get(layout).activeView;
    let lastFile = get(activeFile);

    // Record initial state
    recordNavigation({
      workspaceId: lastWorkspaceId,
      projectId: lastProjectId,
      activeView: lastView,
      activeFile: lastFile
    });

    activeWorkspaceId.subscribe((wsId) => {
      if (wsId !== lastWorkspaceId) {
        lastWorkspaceId = wsId;
        triggerRecord();
      }
    });

    activeProjectId.subscribe((pId) => {
      if (pId !== lastProjectId) {
        lastProjectId = pId;
        triggerRecord();
      }
    });

    layout.subscribe((l) => {
      if (l.activeView !== lastView) {
        lastView = l.activeView;
        triggerRecord();
      }
    });

    activeFile.subscribe((file) => {
      if (file !== lastFile) {
        lastFile = file;
        triggerRecord();
      }
    });

    function triggerRecord() {
      recordNavigation({
        workspaceId: lastWorkspaceId,
        projectId: lastProjectId,
        activeView: lastView,
        activeFile: lastFile
      });
    }
  }, 100);
}
