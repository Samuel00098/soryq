import { describe, expect, it } from 'vitest';
import {
  cancelTask,
  createTaskRecord,
  transitionTask,
} from './task-lifecycle';
import type { OrchestratorTask } from './task-lifecycle';

describe('task lifecycle transitions', () => {
  const seed = createTaskRecord('project-1', 'Fix orchestrator flow', 'claude');

  it('allows in-progress tasks to complete on terminal exit', () => {
    const started = transitionTask(seed, 'in-progress');
    const done = transitionTask(started, 'complete');

    expect(done.status).toBe('complete');
    expect(done.completedAt).toBeTypeOf('number');
  });

  it('rejects invalid complete -> in-progress transitions', () => {
    const done = transitionTask(transitionTask(seed, 'in-progress'), 'complete');

    expect(() => transitionTask(done, 'in-progress')).toThrow(/invalid orchestrator transition/i);
  });

  it('returns an already-cancelled task unchanged', () => {
    const alreadyCancelled: OrchestratorTask = {
      ...seed,
      status: 'cancelled',
      completedAt: 1700000000000,
    };

    const result = cancelTask(alreadyCancelled);

    expect(result).toBe(alreadyCancelled);
  });

  it('marks cancellation explicitly', () => {
    const cancelled = cancelTask(seed, 'User rejected the task');

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.completedAt).toBeTypeOf('number');
  });
});
