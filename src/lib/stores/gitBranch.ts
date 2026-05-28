import { derived, writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { activeProjectId } from './workspace';

export interface GitBranchInfo {
  current: string;
  local: string[];
  remote: string[];
}

const branchInfoByProject = writable<Record<string, GitBranchInfo>>({});
const branchLoadingByProject = writable<Record<string, boolean>>({});

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
