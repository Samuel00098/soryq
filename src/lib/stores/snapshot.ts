import { writable, get } from 'svelte/store';
import type { GridLayout } from '$lib/stores/terminal';
import type { ActiveView } from '$lib/types/layout';
import {
  sessions,
  paneAssignments,
  gridLayout,
  createTerminalSession,
  killSession,
  setSessionRole,
  setGridLayout,
} from '$lib/stores/terminal';
import { layout, setActiveView, setSidebarTab } from '$lib/stores/layout';
import { currentUrl, targetPort, previewTabs, activePreviewTabId, restorePreviewTabsState, type PreviewTab } from '$lib/stores/preview';
import { loadJson } from '$lib/utils/storage';

const STORAGE_KEY = 'soryq_workspace_snapshots';

export type PaneSnapshotInfo = {
  role?: string | null;
  cwd?: string | null;
} | null;

export type WorkspaceSnapshot = {
  id: string;
  name: string;
  savedAt: number;
  gridLayout: GridLayout;
  panes: PaneSnapshotInfo[];
  activeView: ActiveView;
  previewUrl: string;
  targetPort: number;
  previewTabs: PreviewTab[];
  activePreviewTabId: string | null;
  sidebarWidth: number;
};

function loadFromStorage(): WorkspaceSnapshot[] {
  if (typeof window === 'undefined') return [];
  return loadJson(STORAGE_KEY, [] as WorkspaceSnapshot[]);
}

function saveToStorage(list: WorkspaceSnapshot[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export const snapshots = writable<WorkspaceSnapshot[]>(loadFromStorage());

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
snapshots.subscribe((list) => {
  if (_saveTimer !== null) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; saveToStorage(list); }, 500);
});

export function saveSnapshot(name: string): WorkspaceSnapshot {
  const allSessions = get(sessions);
  const panes = get(paneAssignments);
  const currentLayout = get(gridLayout);
  const currentLayout_ = get(layout);
  const url = get(currentUrl);
  const port = get(targetPort);
  const tabs = get(previewTabs);
  const activeTabId = get(activePreviewTabId);

  const paneInfo: PaneSnapshotInfo[] = panes.map((sessionId) => {
    if (sessionId === null) return null;
    const session = allSessions.find((s) => s.id === sessionId);
    if (!session) return null;
    return { role: session.role ?? null, cwd: session.cwd ?? null };
  });

  const snapshot: WorkspaceSnapshot = {
    id: Math.random().toString(36).substring(2, 11),
    name: name.trim() || `Snapshot ${new Date().toLocaleTimeString()}`,
    savedAt: Date.now(),
    gridLayout: currentLayout,
    panes: paneInfo,
    activeView: currentLayout_.activeView,
    previewUrl: url,
    targetPort: port,
    previewTabs: tabs,
    activePreviewTabId: activeTabId,
    sidebarWidth: currentLayout_.sidebarWidth,
  };

  snapshots.update((list) => [snapshot, ...list].slice(0, 20));
  return snapshot;
}

export async function restoreSnapshot(snapshot: WorkspaceSnapshot) {
  // 1. Kill only the active project's sessions
  const allSessions = get(sessions);
  await Promise.all(allSessions.map((session) => killSession(session.id)));

  // 2. Apply grid layout — this sets the pane count
  setGridLayout(snapshot.gridLayout);

  // 3. Create new terminal sessions for each pane that had one
  for (let i = 0; i < snapshot.panes.length; i++) {
    const pane = snapshot.panes[i];
    if (pane === null) continue;
    const newId = await createTerminalSession(pane.cwd ?? undefined, i);
    if (newId !== null && pane.role) {
      setSessionRole(newId, pane.role);
    }
  }

  // 4. Restore layout state
  setActiveView(snapshot.activeView);

  // 5. Restore preview URL and port
  if (snapshot.previewTabs?.length) {
    restorePreviewTabsState(snapshot.previewTabs, snapshot.activePreviewTabId);
  } else if (snapshot.previewUrl) {
    currentUrl.set(snapshot.previewUrl);
  }
  if (snapshot.targetPort) {
    const { setTargetPort } = await import('$lib/stores/preview');
    setTargetPort(snapshot.targetPort);
  }
}

export function deleteSnapshot(id: string) {
  snapshots.update((list) => list.filter((s) => s.id !== id));
}

export function renameSnapshot(id: string, name: string) {
  snapshots.update((list) =>
    list.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s))
  );
}
