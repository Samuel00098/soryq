import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { addTask, getProjectTaskPanelLines, tasks } from './tasks';

describe('task panel summaries', () => {
  beforeEach(() => {
    tasks.set([]);
  });

  it('summarizes project tasks in action-oriented order', () => {
    addTask('project-1', 'Write the Docker container switch', 'todo');
    addTask('project-1', 'Wire task panel into orchestrator prompts', 'doing');
    addTask('project-1', 'Clean old docs', 'done');
    addTask('project-2', 'Ignore other project', 'doing');

    expect(getProjectTaskPanelLines('project-1')).toEqual([
      'In progress (1): Wire task panel into orchestrator prompts',
      'To do (1): Write the Docker container switch',
      'Done (1): Clean old docs',
    ]);
  });
});
