import { writable, get } from '$lib/stores/storeCompat';
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
import { layout, sanitiseActiveView } from '$lib/stores/layout';
import { currentUrl, targetPort, previewTabs, activePreviewTabId, restorePreviewTabsState, type PreviewTab } from '$lib/stores/preview';
import { useSnapshotStore, type WorkspaceSnapshot } from './zustand/snapshot';

export type { PaneSnapshotInfo, WorkspaceSnapshot } from './zustand/snapshot';

function syncWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  const zustandVal = (useSnapshotStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;
  const store = writable<T>(initial);
  void useSnapshotStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) store.set(next);
  });
  return {
    subscribe: store.subscribe,
    set(value: T) { (useSnapshotStore.getState() as any).__set(key, value); },
    update(fn: (val: T) => T) {
      const current = (useSnapshotStore.getState() as any)[key] as T;
      (useSnapshotStore.getState() as any).__set(key, fn(current));
    },
  };
}

export const snapshots = syncWritable<WorkspaceSnapshot[]>('snapshots', []);

export function saveSnapshot(name: string): WorkspaceSnapshot {
  const allSessions = get(sessions);
  const panes = get(paneAssignments);
  const currentLayout = get(gridLayout);
  const currentLayout_ = get(layout);
  const url = get(currentUrl);
  const port = get(targetPort);
  const tabs = get(previewTabs);
  const activeTabId = get(activePreviewTabId);

  const paneInfo = panes.map((sessionId) => {
    if (sessionId === null) return null;
    const session = allSessions.find((s) => s.id === sessionId);
    if (!session) return null;
    return { role: session.role ?? null, cwd: session.cwd ?? null };
  });

  const snapshot: WorkspaceSnapshot = {
    id: crypto.randomUUID(),
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
  const allSessions = get(sessions);
  await Promise.all(allSessions.map((session) => killSession(session.id)));

  setGridLayout(snapshot.gridLayout);

  for (let i = 0; i < snapshot.panes.length; i++) {
    const pane = snapshot.panes[i];
    if (pane === null) continue;
    const newId = await createTerminalSession(pane.cwd ?? undefined, i);
    if (newId !== null && pane.role) {
      setSessionRole(newId, pane.role);
    }
  }

  const safeView = sanitiseActiveView(snapshot.activeView);
  const safeSidebarWidth = Math.max(100, Math.min(600, snapshot.sidebarWidth ?? 260));
  layout.update((l) => ({
    ...l,
    sidebarWidth: safeSidebarWidth,
    activeView: safeView,
    ...(safeView !== 'terminal' ? { lastAuxView: safeView } : {}),
    editorVisible: safeView === 'editor',
    previewVisible: safeView === 'preview',
    reviewVisible: safeView === 'review',
    httpVisible: safeView === 'http',
    tasksVisible: safeView === 'tasks',
    orchestratorVisible: false,
    editorSplitPreview: false,
  }));

  if (snapshot.previewTabs?.length) {
    restorePreviewTabsState(snapshot.previewTabs, snapshot.activePreviewTabId);
  } else if (snapshot.previewUrl) {
    if (/^\/|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(snapshot.previewUrl)) {
      currentUrl.set(snapshot.previewUrl);
    }
  }
  if (snapshot.targetPort) {
    const safePort = Math.floor(snapshot.targetPort);
    if (safePort >= 1024 && safePort <= 65535) {
      const { setTargetPort } = await import('$lib/stores/preview');
      setTargetPort(safePort);
    }
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
