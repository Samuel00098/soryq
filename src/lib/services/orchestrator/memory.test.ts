import { describe, expect, it } from 'vitest';
import { learnFromTask, mergeMemoryEntry, type OrchestratorMemoryEntry } from './memory';
import { createTaskRecord } from './task-lifecycle';
import { makeActivityEvent } from './activity-log';

describe('orchestrator memory', () => {
  it('creates compact lessons from completed tasks', () => {
    const task = {
      ...createTaskRecord('project-1', 'Fix the sketch canvas layering bug', 'claude', 'Iris'),
      status: 'complete' as const,
      title: 'Fix sketch layering',
      activity: [
        makeActivityEvent('goal', 'Implement drawing over existing shapes', 10),
        makeActivityEvent('finished', 'Verified with npm test', 20),
      ],
    };

    const memory = learnFromTask(task);

    expect(memory?.text).toContain('Fix sketch layering');
    expect(memory?.text).toContain('completed with claude');
    expect(memory?.text).toContain('finished: Verified with npm test');
  });

  it('dedupes repeated lessons and keeps the most recent timestamp', () => {
    const first: OrchestratorMemoryEntry = {
      id: 'a',
      text: 'Task "Build UI" completed with claude.',
      createdAt: 1,
      lastSeenAt: 1,
      uses: 1,
      taskId: 'task-a',
    };
    const repeated: OrchestratorMemoryEntry = {
      id: 'b',
      text: 'Task "Build UI" completed with claude.',
      createdAt: 2,
      lastSeenAt: 20,
      uses: 1,
      taskId: 'task-b',
    };

    const merged = mergeMemoryEntry([first], repeated);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'a', uses: 2, lastSeenAt: 20, taskId: 'task-b' });
  });
});
