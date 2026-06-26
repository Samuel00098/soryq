import { invoke } from '@tauri-apps/api/core';

/**
 * Per-agent git worktree isolation.
 *
 * Each orchestrator agent runs in its own git worktree on a dedicated branch
 * (forked from the project's current HEAD), so several agents can edit the same
 * repository at once without colliding. Worktrees live in a sibling
 * `.soryq-worktrees/<repo>` directory managed by the Rust backend, keeping the
 * user's main working tree untouched. This module owns deriving branch names and
 * driving the backend create / remove / status commands.
 */

export interface WorktreeInfo {
  /** Absolute path to the agent's isolated checkout. */
  path: string;
  /** The task branch created for the agent (e.g. `soryq/backend-a1b2c3`). */
  branch: string;
  /** Branch the worktree was forked from. */
  baseBranch: string;
  /** Commit the worktree was forked from. */
  baseCommit: string;
  /** When the worktree was created (epoch ms). */
  createdAt: number;
}

export interface WorktreeStatus {
  /** Count of changed files (staged + unstaged + untracked). */
  changedFiles: number;
  branch: string;
}

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'agent'
  );
}

/**
 * Derive a stable, human-readable branch name for a task: `soryq/<slug>-<short>`.
 * The trailing short id keeps it unique even when two agents share a label.
 */
export function deriveTaskBranch(taskId: string, label?: string | null): string {
  const short = taskId.replace(/[^a-z0-9]/gi, '').slice(-6) || Math.random().toString(36).slice(2, 8);
  const slug = label && label.trim() ? slugify(label) : 'agent';
  return `soryq/${slug}-${short}`;
}

/**
 * Create an isolated worktree for an agent. Returns null when isolation isn't
 * possible (not a git repo, no commits yet, backend failure) — the caller then
 * falls back to running the agent in the project root.
 */
export async function createTaskWorktree(args: {
  projectId: string;
  taskId: string;
  label?: string | null;
}): Promise<WorktreeInfo | null> {
  const branch = deriveTaskBranch(args.taskId, args.label);
  try {
    const raw = await invoke<{
      path: string;
      branch: string;
      base_branch: string;
      base_commit: string;
    }>('workspace_git_create_worktree', {
      projectId: args.projectId,
      branch,
    });
    return {
      path: raw.path,
      branch: raw.branch,
      baseBranch: raw.base_branch,
      baseCommit: raw.base_commit,
      createdAt: Date.now(),
    };
  } catch (err) {
    const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
    // Not a git repo / empty repo — isolation is skipped, not fatal.
    if (msg.includes('not a Git repository') || msg.includes('no commits yet') || msg.includes('Not a git worktree')) {
      console.warn('Worktree isolation skipped; running agent in project root:', msg);
    } else {
      // Git unavailable, permission denied, or other unexpected failure.
      // Log at error level so it's visible in devtools even during production
      // builds — helps diagnose "worktree badge not showing" reports.
      console.error('Worktree isolation failed (unexpected); running agent in project root:', msg);
    }
    return null;
  }
}

/** Remove an agent worktree (best-effort). Optionally also delete its branch. */
export async function removeTaskWorktree(
  projectId: string,
  worktree: WorktreeInfo,
  deleteBranch = false
): Promise<void> {
  try {
    await invoke('workspace_git_remove_worktree', {
      projectId,
      worktreePath: worktree.path,
      deleteBranch,
      branch: worktree.branch,
    });
  } catch (err) {
    console.warn('Worktree removal failed:', err);
  }
}

/** Live changed-files / branch status for a worktree, or null if unavailable. */
export async function getWorktreeStatus(worktree: WorktreeInfo): Promise<WorktreeStatus | null> {
  try {
    const raw = await invoke<{ changed_files: number; branch: string }>('workspace_git_worktree_status', {
      worktreePath: worktree.path,
    });
    return { changedFiles: raw.changed_files, branch: raw.branch };
  } catch {
    return null;
  }
}
