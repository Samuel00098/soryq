import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface GitBranchInfo {
  current: string;
  local: string[];
  remote: string[];
}

export const branchInfo = writable<GitBranchInfo | null>(null);
export const branchLoading = writable(false);

export async function refreshBranches(projectId: string) {
  if (!projectId) { branchInfo.set(null); return; }
  branchLoading.set(true);
  try {
    const info = await invoke<GitBranchInfo>('workspace_git_branches', { projectId });
    branchInfo.set(info);
  } catch {
    branchInfo.set(null);
  } finally {
    branchLoading.set(false);
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
