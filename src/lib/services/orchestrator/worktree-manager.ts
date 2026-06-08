import { invoke } from '@tauri-apps/api/core';
import type { OrchestratorWorktree } from './task-lifecycle';

interface CreateTaskWorktreeArgs {
  projectId: string;
  taskId: string;
  title: string;
}

interface RemoveTaskWorktreeArgs {
  projectId: string;
  taskId: string;
  force?: boolean;
}

export interface RawWorktreeInfo {
  id: string;
  path: string;
  branch_name: string;
  base_branch: string;
  base_commit: string;
  created_at: number;
}

function decodeWorktreeInfo(raw: unknown): OrchestratorWorktree {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid worktree response: expected object');
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string') throw new Error('Invalid worktree response: missing id');
  if (typeof record.path !== 'string') throw new Error('Invalid worktree response: missing path');
  if (typeof record.branch_name !== 'string') throw new Error('Invalid worktree response: missing branch_name');
  if (typeof record.base_branch !== 'string') throw new Error('Invalid worktree response: missing base_branch');
  if (typeof record.base_commit !== 'string') throw new Error('Invalid worktree response: missing base_commit');
  if (typeof record.created_at !== 'number') throw new Error('Invalid worktree response: missing created_at');

  return {
    id: record.id,
    path: record.path,
    branchName: record.branch_name,
    baseBranch: record.base_branch,
    baseCommit: record.base_commit,
    createdAt: record.created_at,
    changedFilesCount: null,
  };
}

export function normalizeWorktreeInfo(raw: unknown): OrchestratorWorktree {
  return decodeWorktreeInfo(raw);
}

export async function createTaskWorktree(args: CreateTaskWorktreeArgs): Promise<OrchestratorWorktree> {
  const raw = await invoke<unknown>('workspace_git_worktree_create', {
    projectId: args.projectId,
    taskId: args.taskId,
    title: args.title,
  });
  return decodeWorktreeInfo(raw);
}

export async function removeTaskWorktree(args: RemoveTaskWorktreeArgs): Promise<string> {
  return await invoke<string>('workspace_git_worktree_remove', {
    projectId: args.projectId,
    taskId: args.taskId,
    force: args.force ?? false,
  });
}

export const worktreeManagerBridge = {
  normalizeWorktreeInfo,
  createTaskWorktree,
  removeTaskWorktree,
};
