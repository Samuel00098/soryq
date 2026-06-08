import { describe, expect, it } from 'vitest';
import {
  approveTask,
  cancelTask,
  createTaskRecord,
  inferExecutionMode,
  requestTaskChanges,
  transitionTask,
} from './task-lifecycle';

describe('inferExecutionMode', () => {
  it('defaults non-read-only goals to worktree', () => {
    expect(inferExecutionMode('Fix the failing auth tests')).toBe('worktree');
    expect(inferExecutionMode('Make the auth flow easier to use')).toBe('worktree');
  });

  it('keeps read-only investigation direct', () => {
    expect(inferExecutionMode('Explain how the auth flow works')).toBe('direct');
    expect(inferExecutionMode('Create a summary of the failing logs')).toBe('direct');
  });

  it('prefers worktree when a request includes a concrete code change', () => {
    expect(inferExecutionMode('Inspect the flaky test and fix the timeout')).toBe('worktree');
    expect(inferExecutionMode('Edit the auth flow')).toBe('worktree');
  });
});

describe('task lifecycle transitions', () => {
  const seed = createTaskRecord('project-1', 'Fix orchestrator review flow', 'worktree', 'claude');

  it('allows todo -> in-progress -> in-review -> complete', () => {
    const started = transitionTask(seed, 'in-progress');
    const review = transitionTask(started, 'in-review');
    const done = approveTask(review);

    expect(done.status).toBe('complete');
    expect(done.completedAt).toBeTypeOf('number');
    expect(done.review?.decision).toBe('approved');
  });

  it('allows in-progress tasks to complete on terminal exit', () => {
    const started = transitionTask(seed, 'in-progress');
    const done = transitionTask(started, 'complete');

    expect(done.status).toBe('complete');
    expect(done.completedAt).toBeTypeOf('number');
  });

  it('rejects invalid complete -> in-progress transitions', () => {
    const done = approveTask(transitionTask(transitionTask(seed, 'in-progress'), 'in-review'));

    expect(() => transitionTask(done, 'in-progress')).toThrow(/invalid orchestrator transition/i);
  });

  it('returns request-changes tasks to todo while preserving worktree metadata and resetting run timing', () => {
    const started = transitionTask(seed, 'in-progress');
    const review = transitionTask(
      {
        ...started,
        completedAt: 123,
        worktree: {
          id: 'wt-1',
          path: '/tmp/wt-1',
          branchName: 'soryq/ot_1',
          baseBranch: 'main',
          baseCommit: 'abc1234',
          createdAt: 1700000000000,
        },
      },
      'in-review'
    );

    const todoAgain = requestTaskChanges(review, 'Need better error states');

    expect(started.startedAt).toBeTypeOf('number');
    expect(todoAgain.status).toBe('todo');
    expect(todoAgain.startedAt).toBeNull();
    expect(todoAgain.completedAt).toBeNull();
    expect(todoAgain.worktree?.path).toBe('/tmp/wt-1');
    expect(todoAgain.review?.decision).toBe('changes-requested');
    expect(todoAgain.review?.note).toBe('Need better error states');
  });

  it('returns an already-cancelled task unchanged', () => {
    const alreadyCancelled = {
      ...seed,
      status: 'cancelled',
      completedAt: 1700000000000,
      review: {
        requestedAt: 1699999999000,
        decision: 'cancelled',
        note: 'Keep the existing note',
      },
    };

    const result = cancelTask(alreadyCancelled);

    expect(result).toBe(alreadyCancelled);
  });

  it('marks cancellation explicitly and preserves existing review note when no new note is provided', () => {
    const reviewed = {
      ...seed,
      status: 'in-review',
      review: {
        requestedAt: 1699999999000,
        decision: 'pending',
        note: 'Keep the existing note',
      },
    };

    const cancelled = cancelTask(reviewed);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.completedAt).toBeTypeOf('number');
    expect(cancelled.review).toEqual({
      requestedAt: 1699999999000,
      decision: 'cancelled',
      note: 'Keep the existing note',
    });
  });
  it('marks cancellation explicitly', () => {
    const cancelled = cancelTask(seed, 'User rejected the task');

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.completedAt).toBeTypeOf('number');
    expect(cancelled.review?.decision).toBe('cancelled');
    expect(cancelled.review?.note).toBe('User rejected the task');
  });
});
