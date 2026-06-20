import { derived, writable } from '$lib/stores/storeCompat';
import { invoke } from '@tauri-apps/api/core';
import { activeProjectId } from './workspace';
import { useGitBranchStore, type GitBranchInfo } from './zustand/gitBranch';

function syncWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  const zustandVal = (useGitBranchStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;
  const store = writable<T>(initial);
  void useGitBranchStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) store.set(next);
  });
  return {
    subscribe: store.subscribe,
    set(value: T) { (useGitBranchStore.getState() as any).__set(key, value); },
    update(fn: (val: T) => T) {
      const current = (useGitBranchStore.getState() as any)[key] as T;
      (useGitBranchStore.getState() as any).__set(key, fn(current));
    },
  };
}

const branchInfoByProject = syncWritable<Record<string, GitBranchInfo>>('branchInfoByProject', {});
const branchLoadingByProject = syncWritable<Record<string, boolean>>('branchLoadingByProject', {});

export const branchInfo = derived([branchInfoByProject, activeProjectId], ([$branchInfoByProject, $activeProjectId]) =>
  $activeProjectId ? $branchInfoByProject[$activeProjectId] ?? null : null
);
export const branchLoading = derived([branchLoadingByProject, activeProjectId], ([$branchLoadingByProject, $activeProjectId]) =>
  $activeProjectId ? $branchLoadingByProject[$activeProjectId] ?? false : false
);
let branchRequestGeneration = 0;

export async function refreshBranches(projectId: string) {
  if (!projectId) return;
  const generation = ++branchRequestGeneration;
  branchLoadingByProject.update((state) => ({ ...state, [projectId]: true }));
  try {
    const info = await invoke<GitBranchInfo>('workspace_git_branches', { projectId });
    if (generation !== branchRequestGeneration) return;
    branchInfoByProject.update((state) => ({ ...state, [projectId]: info }));
  } catch {
    if (generation !== branchRequestGeneration) return;
    branchInfoByProject.update((state) => {
      const next = { ...state };
      delete next[projectId];
      return next;
    });
  } finally {
    if (generation === branchRequestGeneration) {
      branchLoadingByProject.update((state) => ({ ...state, [projectId]: false }));
    }
  }
}

export async function checkoutBranch(projectId: string, branch: string): Promise<string> {
  const result = await invoke<string>('workspace_git_checkout', { projectId, branch });
  await refreshBranches(projectId);
  return result;
}

export async function createBranch(projectId: string, name: string, from?: string): Promise<string> {
  const result = await invoke<string>('workspace_git_branch_create', { projectId, name, from });
  await refreshBranches(projectId);
  return result;
}

export async function deleteBranch(projectId: string, name: string, force = false): Promise<string> {
  const result = await invoke<string>('workspace_git_branch_delete', { projectId, name, force });
  await refreshBranches(projectId);
  return result;
}
