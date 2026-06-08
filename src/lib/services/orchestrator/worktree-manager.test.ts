import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import * as worktreeManager from './worktree-manager';

describe('worktree-manager', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('maps snake_case worktree metadata to the shared camelCase shape', async () => {
    invoke.mockResolvedValue({
      id: 'ot_123',
      path: '/repo/.soryq/worktrees/ot_123',
      branch_name: 'soryq/ot_123-fix-review-flow',
      base_branch: 'main',
      base_commit: 'abc1234',
      created_at: 1710000000000,
    });

    const result = await worktreeManager.createTaskWorktree({
      projectId: 'project-1',
      taskId: 'ot_123',
      title: 'Fix review flow',
    });

    expect(invoke).toHaveBeenCalledWith('workspace_git_worktree_create', {
      projectId: 'project-1',
      taskId: 'ot_123',
      title: 'Fix review flow',
    });
    expect(result).toEqual({
      id: 'ot_123',
      path: '/repo/.soryq/worktrees/ot_123',
      branchName: 'soryq/ot_123-fix-review-flow',
      baseBranch: 'main',
      baseCommit: 'abc1234',
      createdAt: 1710000000000,
      changedFilesCount: null,
    });
  });

  it('rejects malformed worktree metadata payloads', async () => {
    invoke.mockResolvedValue({ id: 'ot_123', path: '/repo/.soryq/worktrees/ot_123' });

    await expect(
      worktreeManager.createTaskWorktree({
        projectId: 'project-1',
        taskId: 'ot_123',
        title: 'Fix review flow',
      })
    ).rejects.toThrow('Invalid worktree response');
  });

  it('surfaces backend create failures', async () => {
    invoke.mockRejectedValue(new Error('boom'));

    await expect(
      worktreeManager.createTaskWorktree({
        projectId: 'project-1',
        taskId: 'ot_123',
        title: 'Fix review flow',
      })
    ).rejects.toThrow('boom');
  });

  it('surfaces backend remove failures', async () => {
    invoke.mockRejectedValue(new Error('remove failed'));

    await expect(
      worktreeManager.removeTaskWorktree({
        projectId: 'project-1',
        taskId: 'ot_123',
      })
    ).rejects.toThrow('remove failed');
  });

  it('defaults remove force to false', async () => {
    invoke.mockResolvedValue('Removed worktree for ot_123');

    await worktreeManager.removeTaskWorktree({
      projectId: 'project-1',
      taskId: 'ot_123',
    });

    expect(invoke).toHaveBeenCalledWith('workspace_git_worktree_remove', {
      projectId: 'project-1',
      taskId: 'ot_123',
      force: false,
    });
  });

  it('forwards explicit remove force true', async () => {
    invoke.mockResolvedValue('Removed worktree for ot_123');

    await worktreeManager.removeTaskWorktree({
      projectId: 'project-1',
      taskId: 'ot_123',
      force: true,
    });

    expect(invoke).toHaveBeenCalledWith('workspace_git_worktree_remove', {
      projectId: 'project-1',
      taskId: 'ot_123',
      force: true,
    });
  });
});
