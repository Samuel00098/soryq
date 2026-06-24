import { create } from 'zustand';

export interface GitBranchInfo {
  current: string;
  local: string[];
  remote: string[];
  upstream: string | null;
  ahead: number;
  behind: number;
  has_remote: boolean;
}

interface GitBranchState {
  branchInfoByProject: Record<string, GitBranchInfo>;
  branchLoadingByProject: Record<string, boolean>;
  __set: (key: string, value: unknown) => void;
}

export const useGitBranchStore = create<GitBranchState>((set) => ({
  branchInfoByProject: {},
  branchLoadingByProject: {},
  __set: (key, value) => set({ [key]: value } as any),
}));
