import { create } from 'zustand';
import { loadJson } from '$lib/utils/storage';

const STORAGE_KEY = 'soryq_workspace_snapshots';

export type PaneSnapshotInfo = {
  role?: string | null;
  cwd?: string | null;
} | null;

export type PreviewTab = any;

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  savedAt: number;
  gridLayout: any;
  panes: PaneSnapshotInfo[];
  activeView: any;
  previewUrl: string;
  targetPort: number;
  previewTabs: PreviewTab[];
  activePreviewTabId: string | null;
  sidebarWidth: number;
}

function loadPersisted(): WorkspaceSnapshot[] {
  if (typeof window === 'undefined') return [];
  return loadJson(STORAGE_KEY, [] as WorkspaceSnapshot[]);
}

function persist(value: WorkspaceSnapshot[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

interface SnapshotState {
  snapshots: WorkspaceSnapshot[];
  __set: (key: string, value: unknown) => void;
}

export const useSnapshotStore = create<SnapshotState>((set) => ({
  snapshots: loadPersisted(),
  __set: (key, value) => {
    set({ [key]: value } as any);
    if (key === 'snapshots') persist(value as WorkspaceSnapshot[]);
  },
}));
