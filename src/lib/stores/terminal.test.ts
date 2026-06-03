import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/services/pty-bridge', () => {
  let nextId = 1;
  return {
    openPty: vi.fn(async () => ({
      id: nextId++,
      write: vi.fn(async () => {}),
      resize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    })),
  };
});

vi.mock('./notification', () => ({
  showToast: vi.fn(),
}));

import {
  appendToCommandBlock,
  commandBlocks,
  createTerminalSession,
  finalizeCommandBlockWithExit,
  killAllSessions,
  markSessionAgentPreset,
  sessions,
  setActiveTerminalProject,
  setSessionTaskSummary,
  startCommandBlock,
} from './terminal';

describe('terminal task summaries', () => {
  const projectId = 'project-terminal-summary';

  beforeEach(() => {
    setActiveTerminalProject(projectId);
    commandBlocks.set(new Map());
  });

  afterEach(async () => {
    commandBlocks.set(new Map());
    await killAllSessions();
    setActiveTerminalProject(null);
  });

  it('keeps the prompt task summary after Claude finishes', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();

    markSessionAgentPreset(sessionId!, 'claude');
    setSessionTaskSummary(sessionId!, 'Fix the terminal panel title');

    startCommandBlock(sessionId!, 'claude');
    appendToCommandBlock(sessionId!, 'Summary: Updated the implementation details.\n');
    finalizeCommandBlockWithExit(sessionId!, 0);

    const session = get(sessions).find((entry) => entry.id === sessionId);
    expect(session?.taskSummary).toBe('Fix the terminal panel title');
  });
});
