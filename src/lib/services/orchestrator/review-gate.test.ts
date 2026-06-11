import { describe, expect, it } from 'vitest';
import { classifyTaskAfterExecution } from './review-gate';
import { createTaskRecord, transitionTask } from './task-lifecycle';

function started(goal: string) {
  return transitionTask(createTaskRecord('project-1', goal, 'claude'), 'in-progress');
}

describe('classifyTaskAfterExecution', () => {
  it('completes tasks on clean exit', () => {
    const task = started('Fix auth bug');
    const next = classifyTaskAfterExecution(task, { exitCode: 0 });
    expect(next.status).toBe('complete');
    expect(next.completedAt).toBeTypeOf('number');
  });

  it('marks blocked when human input is required', () => {
    const task = started('Fix auth bug');
    const next = classifyTaskAfterExecution(task, { exitCode: 0, needsHumanInput: true, note: 'Need API key' });
    expect(next.status).toBe('blocked');
    expect(next.blockedReason).toContain('API key');
    expect(next.assignedSessionId).toBeNull();
  });

  it('marks failed on a non-zero exit code', () => {
    const task = started('Fix auth bug');
    const next = classifyTaskAfterExecution(task, { exitCode: 1 });
    expect(next.status).toBe('failed');
    expect(next.failureReason).toContain('1');
  });
});
