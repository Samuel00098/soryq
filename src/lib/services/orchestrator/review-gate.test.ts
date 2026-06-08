import { describe, expect, it } from 'vitest';
import { classifyTaskAfterExecution } from './review-gate';
import { createTaskRecord, transitionTask } from './task-lifecycle';

function started(goal: string, mode: 'direct' | 'worktree') {
  return transitionTask(createTaskRecord('project-1', goal, mode, 'claude'), 'in-progress');
}

describe('classifyTaskAfterExecution', () => {
  it('sends worktree tasks to in-review instead of complete', () => {
    const task = started('Fix auth bug', 'worktree');
    const next = classifyTaskAfterExecution(task, { exitCode: 0 });
    expect(next.status).toBe('in-review');
    expect(next.review?.decision).toBe('pending');
    expect(next.assignedSessionId).toBeNull();
  });

  it('completes direct read-only tasks on clean exit', () => {
    const task = started('Explain the auth flow', 'direct');
    const next = classifyTaskAfterExecution(task, { exitCode: 0 });
    expect(next.status).toBe('complete');
    expect(next.completedAt).toBeTypeOf('number');
  });

  it('marks blocked when human input is required', () => {
    const task = started('Fix auth bug', 'worktree');
    const next = classifyTaskAfterExecution(task, { exitCode: 0, needsHumanInput: true, note: 'Need API key' });
    expect(next.status).toBe('blocked');
    expect(next.blockedReason).toContain('API key');
    expect(next.assignedSessionId).toBeNull();
  });

  it('marks failed on a non-zero exit code', () => {
    const task = started('Fix auth bug', 'worktree');
    const next = classifyTaskAfterExecution(task, { exitCode: 1 });
    expect(next.status).toBe('failed');
    expect(next.failureReason).toContain('1');
  });
});
