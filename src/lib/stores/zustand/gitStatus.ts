import { create } from 'zustand';

export interface GitStatusData {
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  conflicted?: string[];
}

export interface GitLogEntry {
  graph: string;
  hash: string | null;
  author: string | null;
  date: string | null;
  refs: string | null;
  subject: string | null;
}

interface GitStatusCacheState {
  statusByProject: Record<string, GitStatusData>;
  historyByProject: Record<string, GitLogEntry[]>;
  setStatus: (projectId: string, status: GitStatusData) => void;
  setHistory: (projectId: string, history: GitLogEntry[]) => void;
}

// Persisted, per-project cache of git status + log so the Source Control panel
// can show its last-known state the instant it's reopened — mirroring the
// VS Code / Cursor "it's already loaded" feel — instead of remounting cold,
// flashing a skeleton, and re-running git every time the sidebar tab changes.
export const useGitStatusCache = create<GitStatusCacheState>((set) => ({
  statusByProject: {},
  historyByProject: {},
  setStatus: (projectId, status) =>
    set((s) => ({ statusByProject: { ...s.statusByProject, [projectId]: status } })),
  setHistory: (projectId, history) =>
    set((s) => ({ historyByProject: { ...s.historyByProject, [projectId]: history } })),
}));
