import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const invoke = vi.hoisted(() => vi.fn(async () => undefined));
const routeOrchestratorRequest = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const showTerminal = vi.hoisted(() => vi.fn());
const createTaskWorktree = vi.hoisted(() => vi.fn());
const removeTaskWorktree = vi.hoisted(() => vi.fn());
const spawnAgentPreset = vi.hoisted(() => vi.fn(async () => 42));
const setSessionOwnerTask = vi.hoisted(() => vi.fn());
const setSessionTaskSummary = vi.hoisted(() => vi.fn());
const setSessionAgentName = vi.hoisted(() => vi.fn());
const setSessionRole = vi.hoisted(() => vi.fn());
const setActiveSession = vi.hoisted(() => vi.fn());
const sendAgentPromptDirect = vi.hoisted(() => vi.fn());
const getSessionOutputBuffer = vi.hoisted(() => vi.fn(() => ''));
const killSession = vi.hoisted(() => vi.fn(async () => undefined));
const getAgentDisplayName = vi.hoisted(() => vi.fn((id: string) => id));
const promptBarInput = vi.hoisted(() => ({ set: vi.fn() }));
const focusPromptBar = vi.hoisted(() => vi.fn());
const summarizeTerminalTask = vi.hoisted(() => vi.fn((text: string) => text));
const getPresetRuns = vi.hoisted(() => vi.fn(() => []));
const detectAgentAccess = vi.hoisted(() => vi.fn(async () => ({
  ready: true,
  via: 'api-key',
  providerId: 'openrouter',
  message: 'OpenRouter is ready.',
})));
type MockLiveSession = { id: number; isRunning: boolean; ownerTaskId: string | null; lastExitCode?: number | null };
const getTerminalProjectState = vi.hoisted(() =>
  vi.fn((): { sessions: MockLiveSession[] } => ({ sessions: [] }))
);
const sessionSubscribers = vi.hoisted(() => [] as Array<(value: MockLiveSession[]) => void>);
const sessions = vi.hoisted(() => ({
  subscribe: vi.fn((cb: (value: MockLiveSession[]) => void) => {
    sessionSubscribers.push(cb);
    return () => {
      const idx = sessionSubscribers.indexOf(cb);
      if (idx >= 0) sessionSubscribers.splice(idx, 1);
    };
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('$lib/services/orchestrator-brain', () => ({ routeOrchestratorRequest }));
vi.mock('$lib/services/agent-access', () => ({
  detectAgentAccess,
  getAgentAccessBlockedMessage: () => 'To access the agent, add an API key or load a local model into the application.',
}));
vi.mock('$lib/services/orchestrator/worktree-manager', () => ({ createTaskWorktree, removeTaskWorktree }));
vi.mock('$lib/stores/notification', () => ({ showToast }));
vi.mock('$lib/stores/layout', () => ({ showTerminal }));
vi.mock('$lib/stores/runs', () => ({ getPresetRuns }));
vi.mock('$lib/stores/terminal', () => ({
  sessions,
  spawnAgentPreset,
  setSessionOwnerTask,
  setSessionTaskSummary,
  setSessionAgentName,
  setSessionRole,
  setActiveSession,
  sendAgentPromptDirect,
  getSessionOutputBuffer,
  killSession,
  getAgentDisplayName,
  promptBarInput,
  focusPromptBar,
  summarizeTerminalTask,
  getTerminalProjectState,
}));

import { orchestratorTasks, chatMessages, createOrchestratorTask, deleteOrchestratorTask, loadProjectOrchestratorTasks, launchOrchestratorTask, unlinkOrchestratorTask, resendOrchestratorGoal, resumeBlockedOrchestratorTask, renameOrchestratorAgent, sendChatMessage } from './orchestrator';
import { makeActivityEvent } from '$lib/services/orchestrator/activity-log';

function resetMocks() {
  invoke.mockReset();
  routeOrchestratorRequest.mockReset();
  showToast.mockReset();
  showTerminal.mockReset();
  createTaskWorktree.mockReset();
  removeTaskWorktree.mockReset();
  spawnAgentPreset.mockReset();
  spawnAgentPreset.mockResolvedValue(42);
  setSessionOwnerTask.mockReset();
  setSessionTaskSummary.mockReset();
  setSessionAgentName.mockReset();
  setSessionRole.mockReset();
  setActiveSession.mockReset();
  sendAgentPromptDirect.mockReset();
  sendAgentPromptDirect.mockResolvedValue(true);
  getSessionOutputBuffer.mockReset();
  getSessionOutputBuffer.mockReturnValue('');
  killSession.mockReset();
  getAgentDisplayName.mockReset();
  getAgentDisplayName.mockImplementation((id: string) => id);
  promptBarInput.set.mockReset();
  focusPromptBar.mockReset();
  summarizeTerminalTask.mockReset();
  summarizeTerminalTask.mockImplementation((text: string) => text);
  getPresetRuns.mockReset();
  getPresetRuns.mockReturnValue([]);
  detectAgentAccess.mockReset();
  detectAgentAccess.mockResolvedValue({
    ready: true,
    via: 'api-key',
    providerId: 'openrouter',
    message: 'OpenRouter is ready.',
  });
  getTerminalProjectState.mockReset();
  getTerminalProjectState.mockReturnValue({ sessions: [] });
  chatMessages.set({});
  sessions.subscribe.mockReset();
  sessions.subscribe.mockImplementation((cb: (value: MockLiveSession[]) => void) => {
    sessionSubscribers.push(cb);
    return () => {
      const idx = sessionSubscribers.indexOf(cb);
      if (idx >= 0) sessionSubscribers.splice(idx, 1);
    };
  });
  sessionSubscribers.length = 0;
}

describe('orchestrator terminal leasing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    orchestratorTasks.set([]);
    chatMessages.set({});
    resetMocks();
  });

  afterEach(() => {
    orchestratorTasks.set([]);
    chatMessages.set({});
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('leases and activates a direct launch while recording owner and summary', async () => {
    const task = createOrchestratorTask('project-1', 'Explain how the lease boundary works', 'direct', 'claude');

    await launchOrchestratorTask(task.id, 'claude', '/repo', false);

    expect(createTaskWorktree).not.toHaveBeenCalled();
    expect(spawnAgentPreset).toHaveBeenCalledWith('claude', '/repo', { activate: true });
    expect(setSessionOwnerTask).toHaveBeenCalledWith(42, task.id);
    expect(setSessionTaskSummary).toHaveBeenCalledWith(42, task.title);
    // Launching focuses the new agent's pane but must NOT switch the aux view to
    // the terminal — the Agents panel stays open beside the always-visible terminal.
    expect(showTerminal).not.toHaveBeenCalled();
    expect(setActiveSession).toHaveBeenCalledWith(42);
    expect(promptBarInput.set).toHaveBeenCalledWith(task.goal);
    expect(focusPromptBar).toHaveBeenCalledTimes(1);
    expect(get(orchestratorTasks)[0].status).toBe('in-progress');
    expect(get(orchestratorTasks)[0].assignedSessionId).toBe(42);
  });

  it('creates a worktree before leasing a worktree launch', async () => {
    const task = createOrchestratorTask('project-1', 'Fix the orchestrator worktree flow', undefined, 'claude');
    createTaskWorktree.mockResolvedValue({
      id: task.id,
      path: '/repo/.soryq/worktrees/' + task.id,
      branchName: 'soryq/' + task.id,
      baseBranch: 'main',
      baseCommit: 'abc1234',
      createdAt: 123,
    });

    await launchOrchestratorTask(task.id, 'claude', '/repo', false);

    expect(createTaskWorktree.mock.invocationCallOrder[0]).toBeLessThan(spawnAgentPreset.mock.invocationCallOrder[0]);
    expect(spawnAgentPreset).toHaveBeenCalledWith('claude', '/repo/.soryq/worktrees/' + task.id, { activate: true });
    expect(setSessionOwnerTask).toHaveBeenCalledWith(42, task.id);
    expect(setSessionTaskSummary).toHaveBeenCalledWith(42, task.title);
    expect(get(orchestratorTasks)[0].worktree?.path).toBe('/repo/.soryq/worktrees/' + task.id);
  });

  it('marks a launched task as starting until its goal is sent', async () => {
    const task = createOrchestratorTask('project-1', 'Fix the terminal lease flow', 'direct', 'claude');
    getSessionOutputBuffer.mockReturnValueOnce('').mockReturnValue('booted output................................');
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: task.id }] });

    await launchOrchestratorTask(task.id, 'claude', '/repo', true);
    expect(get(orchestratorTasks)[0].promptSentAt).toBeNull();

    await vi.advanceTimersByTimeAsync(1600);
    await Promise.resolve();

    expect(sendAgentPromptDirect).toHaveBeenCalledWith(42, task.goal);
    expect(get(orchestratorTasks)[0].promptSentAt).toBeTypeOf('number');
    expect(showToast).toHaveBeenCalledWith('Sent goal to claude', 'info', 3000);
  });


  it('clears stale persisted lease fields for non-in-progress tasks on load', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'fs_read_file') {
        return JSON.stringify([
          {
            id: 'task-1',
            projectId: 'project-1',
            goal: 'Review the lease cleanup',
            title: 'Review the lease cleanup',
            status: 'todo',
            assignedSessionId: 42,
            startedAt: 111,
            completedAt: 222,
            createdAt: 100,
          },
        ]);
      }
      return undefined;
    });

    await loadProjectOrchestratorTasks({ id: 'project-1', root_path: '/repo' });

    expect(get(orchestratorTasks)).toEqual([
      expect.objectContaining({
        id: 'task-1',
        projectId: 'project-1',
        status: 'todo',
        assignedSessionId: null,
        startedAt: null,
        completedAt: null,
      }),
    ]);

    const writeCall = invoke.mock.calls.find(([command]) => command === 'fs_write_file');
    expect(writeCall).toBeDefined();
    const [, writeArgs] = writeCall as [string, { path: string; content: string }];
    expect(writeArgs.path).toBe('/repo/.soryq/orchestrator.json');
    expect(JSON.parse(writeArgs.content)[0]).toMatchObject({
      id: 'task-1',
      projectId: 'project-1',
      status: 'todo',
      assignedSessionId: null,
      startedAt: null,
      completedAt: null,
    });
  });

  it('flushes normalized persisted fields on load', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'fs_read_file') {
        return JSON.stringify([
          {
            id: 'task-2',
            projectId: 'project-1',
            goal: '  Trim this goal  ',
            title: '',
            status: 'pending',
            createdAt: 100,
          },
        ]);
      }
      return undefined;
    });

    await loadProjectOrchestratorTasks({ id: 'project-1', root_path: '/repo' });

    const writeCall = invoke.mock.calls.find(([command]) => command === 'fs_write_file');
    expect(writeCall).toBeDefined();
    const [, writeArgs] = writeCall as [string, { path: string; content: string }];
    expect(JSON.parse(writeArgs.content)[0]).toMatchObject({
      id: 'task-2',
      projectId: 'project-1',
      goal: 'Trim this goal',
      title: 'Trim this goal',
      status: 'todo',
    });
  });

  it('resets an in-progress task when the live session is owned by another task', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'fs_read_file') {
        return JSON.stringify([
          {
            id: 'task-3',
            projectId: 'project-1',
            goal: 'Check live ownership',
            title: 'Check live ownership',
            status: 'in-progress',
            assignedSessionId: 42,
            startedAt: 111,
            createdAt: 100,
          },
        ]);
      }
      return undefined;
    });
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: 'other-task' }] });

    await loadProjectOrchestratorTasks({ id: 'project-1', root_path: '/repo' });

    expect(get(orchestratorTasks)[0]).toEqual(
      expect.objectContaining({
        id: 'task-3',
        projectId: 'project-1',
        status: 'todo',
        assignedSessionId: null,
        startedAt: null,
        completedAt: null,
      })
    );

    const writeCall = invoke.mock.calls.find(([command]) => command === 'fs_write_file');
    expect(writeCall).toBeDefined();
    const [, writeArgs] = writeCall as [string, { path: string; content: string }];
    expect(JSON.parse(writeArgs.content)[0]).toMatchObject({
      id: 'task-3',
      projectId: 'project-1',
      status: 'todo',
      assignedSessionId: null,
      startedAt: null,
      completedAt: null,
    });
  });
  it('reclaims a loaded todo task from a live owned session', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'fs_read_file') {
        return JSON.stringify([
          {
            id: 'task-4',
            projectId: 'project-1',
            goal: 'Claim live ownership',
            title: 'Claim live ownership',
            status: 'todo',
            createdAt: 100,
          },
        ]);
      }
      return undefined;
    });
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: 'task-4' }] });

    await loadProjectOrchestratorTasks({ id: 'project-1', root_path: '/repo' });

    expect(get(orchestratorTasks)[0]).toEqual(
      expect.objectContaining({
        id: 'task-4',
        projectId: 'project-1',
        status: 'in-progress',
        assignedSessionId: 42,
      })
    );

    const writeCall = invoke.mock.calls.find(([command]) => command === 'fs_write_file');
    expect(writeCall).toBeDefined();
    const [, writeArgs] = writeCall as [string, { path: string; content: string }];
    expect(JSON.parse(writeArgs.content)[0]).toMatchObject({
      id: 'task-4',
      projectId: 'project-1',
      status: 'in-progress',
      assignedSessionId: 42,
    });
  });

  it('deduplicates worktree cleanup when delete races launch finalization', async () => {
    const task = createOrchestratorTask('project-1', 'Keep the lease from leaking', 'worktree', 'claude');
    let resolveWorktree: (worktree: {
      id: string;
      path: string;
      branchName: string;
      baseBranch: string;
      baseCommit: string;
      createdAt: number;
    }) => void = () => {};
    const worktreePromise = new Promise<{
      id: string;
      path: string;
      branchName: string;
      baseBranch: string;
      baseCommit: string;
      createdAt: number;
    }>((resolve) => {
      resolveWorktree = resolve;
    });
    createTaskWorktree.mockReturnValueOnce(worktreePromise);
    let resolveSession: (sessionId: number | null) => void = () => {};
    const leasePromise = new Promise<number | null>((resolve) => {
      resolveSession = resolve;
    });
    spawnAgentPreset.mockReturnValueOnce(leasePromise);

    const launchPromise = launchOrchestratorTask(task.id, 'claude', '/repo', false);
    resolveWorktree({
      id: task.id,
      path: '/repo/.soryq/worktrees/' + task.id,
      branchName: 'soryq/' + task.id,
      baseBranch: 'main',
      baseCommit: 'abc1234',
      createdAt: 123,
    });
    await Promise.resolve();
    deleteOrchestratorTask(task.id);
    resolveSession(42);
    await launchPromise;

    expect(removeTaskWorktree).toHaveBeenCalledTimes(1);
    expect(removeTaskWorktree).toHaveBeenCalledWith({ projectId: 'project-1', taskId: task.id });
    expect(setSessionOwnerTask).toHaveBeenCalledWith(42, task.id);
    expect(setSessionOwnerTask).toHaveBeenCalledWith(42, null);
    expect(setSessionTaskSummary).toHaveBeenCalledWith(42, null);
    expect(get(orchestratorTasks)).toEqual([]);
  });

  it('awaits the flush after clearing a failed worktree launch', async () => {
    const task = createOrchestratorTask('project-1', 'Keep the lease from leaking', 'worktree', 'claude');
    createTaskWorktree.mockResolvedValueOnce({
      id: task.id,
      path: '/repo/.soryq/worktrees/' + task.id,
      branchName: 'soryq/' + task.id,
      baseBranch: 'main',
      baseCommit: 'abc1234',
      createdAt: 123,
    });
    spawnAgentPreset.mockResolvedValueOnce(null);

    let resolveWrite: () => void = () => {};
    const writePromise = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    invoke.mockImplementation(async (command: string) => {
      if (command === 'fs_write_file') {
        return writePromise;
      }
      return undefined;
    });

    let settled = false;
    const launchPromise = launchOrchestratorTask(task.id, 'claude', '/repo', false).then(() => {
      settled = true;
    });
    // Drain microtasks until the launch reaches its `await flush` (worktree
    // create + failed lease are two sequential awaits before cleanup), but stop
    // short of resolving the pending write so we can prove the flush is awaited.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(settled).toBe(false);
    expect(removeTaskWorktree).toHaveBeenCalledTimes(1);
    expect(get(orchestratorTasks)[0]).toEqual(
      expect.objectContaining({
        id: task.id,
        status: 'todo',
        assignedSessionId: null,
        worktree: null,
      })
    );

    const writeCall = invoke.mock.calls.find(([command]) => command === 'fs_write_file');
    expect(writeCall).toBeDefined();
    const [, writeArgs] = writeCall as [string, { path: string; content: string }];
    expect(JSON.parse(writeArgs.content)[0]).toMatchObject({
      id: task.id,
      projectId: 'project-1',
      status: 'todo',
      assignedSessionId: null,
      worktree: null,
    });

    resolveWrite();
    await launchPromise;
    expect(settled).toBe(true);
  });


  it('reclaims an in-progress task from a live owned session when the lease id is missing', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'fs_read_file') {
        return JSON.stringify([
          {
            id: 'task-4',
            projectId: 'project-1',
            goal: 'Claim live ownership',
            title: 'Claim live ownership',
            status: 'in-progress',
            assignedSessionId: null,
            startedAt: 111,
            createdAt: 100,
          },
        ]);
      }
      return undefined;
    });
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: 'task-4' }] });

    await loadProjectOrchestratorTasks({ id: 'project-1', root_path: '/repo' });

    expect(get(orchestratorTasks)[0]).toEqual(
      expect.objectContaining({
        id: 'task-4',
        projectId: 'project-1',
        status: 'in-progress',
        assignedSessionId: 42,
      })
    );

    const writeCall = invoke.mock.calls.find(([command]) => command === 'fs_write_file');
    expect(writeCall).toBeDefined();
    const [, writeArgs] = writeCall as [string, { path: string; content: string }];
    expect(JSON.parse(writeArgs.content)[0]).toMatchObject({
      id: 'task-4',
      projectId: 'project-1',
      status: 'in-progress',
      assignedSessionId: 42,
    });
  });


  it('cancels a pending worktree launch and removes the worktree when the task is deleted', async () => {
    const task = createOrchestratorTask('project-1', 'Keep the lease from leaking', 'worktree', 'claude');
    let resolveWorktree: (worktree: {
      id: string;
      path: string;
      branchName: string;
      baseBranch: string;
      baseCommit: string;
      createdAt: number;
    }) => void = () => {};
    const worktreePromise = new Promise<{
      id: string;
      path: string;
      branchName: string;
      baseBranch: string;
      baseCommit: string;
      createdAt: number;
    }>((resolve) => {
      resolveWorktree = resolve;
    });
    createTaskWorktree.mockReturnValueOnce(worktreePromise);
    let resolveSession: (sessionId: number) => void = () => {};
    const leasePromise = new Promise<number>((resolve) => {
      resolveSession = resolve;
    });
    spawnAgentPreset.mockReturnValueOnce(leasePromise);

    const launchPromise = launchOrchestratorTask(task.id, 'claude', '/repo', false);
    resolveWorktree({
      id: task.id,
      path: '/repo/.soryq/worktrees/' + task.id,
      branchName: 'soryq/' + task.id,
      baseBranch: 'main',
      baseCommit: 'abc1234',
      createdAt: 123,
    });
    await Promise.resolve();
    deleteOrchestratorTask(task.id);
    resolveSession(42);
    await launchPromise;

    expect(removeTaskWorktree).toHaveBeenCalledWith({ projectId: 'project-1', taskId: task.id });
    expect(setSessionOwnerTask).toHaveBeenCalledWith(42, task.id);
    expect(setSessionOwnerTask).toHaveBeenCalledWith(42, null);
    expect(setSessionTaskSummary).toHaveBeenCalledWith(42, null);
    expect(get(orchestratorTasks)).toEqual([]);
  });

  it('clears a created worktree when no terminal can be leased', async () => {
    const task = createOrchestratorTask('project-1', 'Keep the lease from leaking', 'worktree', 'claude');
    let resolveWorktree: (worktree: {
      id: string;
      path: string;
      branchName: string;
      baseBranch: string;
      baseCommit: string;
      createdAt: number;
    }) => void = () => {};
    const worktreePromise = new Promise<{
      id: string;
      path: string;
      branchName: string;
      baseBranch: string;
      baseCommit: string;
      createdAt: number;
    }>((resolve) => {
      resolveWorktree = resolve;
    });
    createTaskWorktree.mockReturnValueOnce(worktreePromise);
    spawnAgentPreset.mockResolvedValueOnce(null);

    const launchPromise = launchOrchestratorTask(task.id, 'claude', '/repo', false);
    resolveWorktree({
      id: task.id,
      path: '/repo/.soryq/worktrees/' + task.id,
      branchName: 'soryq/' + task.id,
      baseBranch: 'main',
      baseCommit: 'abc1234',
      createdAt: 123,
    });
    await Promise.resolve();
    await launchPromise;

    expect(removeTaskWorktree).toHaveBeenCalledWith({ projectId: 'project-1', taskId: task.id });
    expect(get(orchestratorTasks)[0]).toEqual(
      expect.objectContaining({
        id: task.id,
        status: 'todo',
        assignedSessionId: null,
        worktree: null,
      })
    );
  });


  it('aborts auto-send when the leased session stops running before the goal is sent', async () => {
    const task = createOrchestratorTask('project-1', 'Fix the terminal lease flow', 'direct', 'claude');
    getSessionOutputBuffer.mockReturnValueOnce('').mockReturnValue('booted output................................');
    let sessionRunning = true;
    getTerminalProjectState.mockImplementation(() => ({ sessions: [{ id: 42, isRunning: sessionRunning, ownerTaskId: task.id }] }));

    await launchOrchestratorTask(task.id, 'claude', '/repo', true);
    sessionRunning = false;
    await vi.advanceTimersByTimeAsync(1600);
    await Promise.resolve();

    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('releases the lease and returns the task to todo when unlinked', async () => {
    const task = createOrchestratorTask('project-1', 'Explain how the lease boundary works', 'direct', 'claude');

    await launchOrchestratorTask(task.id, 'claude', '/repo', false);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: task.id }] });
    setSessionOwnerTask.mockClear();
    setSessionTaskSummary.mockClear();

    unlinkOrchestratorTask(task.id);

    expect(setSessionOwnerTask).toHaveBeenCalledWith(42, null);
    expect(setSessionTaskSummary).toHaveBeenCalledWith(42, null);
    expect(get(orchestratorTasks)[0].status).toBe('todo');
    expect(get(orchestratorTasks)[0].assignedSessionId).toBeNull();
  });

  it('resends the goal to the leased terminal', async () => {
    const task = createOrchestratorTask('project-1', 'Fix the terminal lease flow', 'direct', 'claude');
    orchestratorTasks.set([{ ...task, status: 'in-progress', assignedSessionId: 42 }]);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: task.id }] });

    resendOrchestratorGoal(task.id);

    expect(sendAgentPromptDirect).toHaveBeenCalledWith(42, task.goal);
    expect(showToast).toHaveBeenCalledWith('Re-sent goal to agent', 'info', 2500);
  });

  it('does not resend to a live session owned by another task', async () => {
    const task = createOrchestratorTask('project-1', 'Fix the terminal lease flow', 'direct', 'claude');
    orchestratorTasks.set([{ ...task, status: 'in-progress', assignedSessionId: 42 }]);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: 'other-task' }] });

    resendOrchestratorGoal(task.id);

    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('moves a finished worktree task to in-review and notifies when the agent rings the bell', async () => {
    const task = createOrchestratorTask('project-1', 'Refactor the launcher', 'worktree', 'claude');
    createTaskWorktree.mockResolvedValue({
      id: task.id,
      path: '/repo/.soryq/worktrees/' + task.id,
      branchName: 'soryq/' + task.id,
      baseBranch: 'main',
      baseCommit: 'abc1234',
      createdAt: 1,
    });
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: task.id }] });
    let buf = '';
    getSessionOutputBuffer.mockImplementation(() => buf);

    await launchOrchestratorTask(task.id, 'claude', '/repo', true);
    buf = 'agent booting....................................'; // > ready delta
    await vi.advanceTimersByTimeAsync(150); // first output → ready
    await vi.advanceTimersByTimeAsync(1600); // settle → goal sent, watcher starts
    buf += ' all done\x07'; // growth + bell in one poll → finished
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();

    expect(sendAgentPromptDirect).toHaveBeenCalledWith(42, task.goal);
    expect(get(orchestratorTasks)[0].status).toBe('in-review');
    expect(setSessionOwnerTask).toHaveBeenCalledWith(42, null);
    expect(showToast).toHaveBeenCalledWith('claude finished — ready to review', 'success', 6000, true);
  });
});

describe('orchestrator chat actions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    orchestratorTasks.set([]);
    resetMocks();
  });

  afterEach(() => {
    orchestratorTasks.set([]);
    chatMessages.set({});
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('responds with a setup message when no API key or local model is available', async () => {
    detectAgentAccess.mockResolvedValue({
      ready: false,
      via: 'none',
      providerId: null,
      message: 'To access the agent, add an API key or load a local model into the application.',
    });

    await sendChatMessage('project-1', '/repo', 'Open an agent for me');

    expect(routeOrchestratorRequest).not.toHaveBeenCalled();
    expect(get(chatMessages)['project-1']).toEqual([
      expect.objectContaining({ role: 'user', text: 'Open an agent for me' }),
      expect.objectContaining({
        role: 'assistant',
        text: 'To access the agent, add an API key or load a local model into the application.',
      }),
    ]);
  });

  it('forwards only user messages and a compact task memory while keeping assistant chat visible', async () => {
    const seed = createOrchestratorTask('project-1', 'Inspect the login flow', 'direct', 'claude', 'Backend');
    orchestratorTasks.set([
      {
        ...seed,
        status: 'complete',
        completedAt: 20,
        activity: [
          makeActivityEvent('dispatch', 'Launched Backend', 10),
          makeActivityEvent('finished', 'Tests green', 20),
        ],
      },
    ]);
    chatMessages.set({
      'project-1': [
        { id: 'u1', role: 'user', text: 'Please keep going', ts: 1 },
        { id: 'a1', role: 'assistant', text: 'I can handle that.', ts: 2 },
        { id: 'u2', role: 'user', text: 'Use the same branch', ts: 3 },
      ],
    });
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Done.',
      actions: [],
      viaLLM: true,
    });

    await sendChatMessage('project-1', '/repo', 'Please finish it', { projectName: 'Atlas' });

    expect(routeOrchestratorRequest).toHaveBeenCalledTimes(1);
    const [, , ctx] = routeOrchestratorRequest.mock.calls[0];
    expect(ctx.projectName).toBe('Atlas');
    expect(ctx.recentUserMessages).toEqual(['Please keep going', 'Use the same branch']);
    expect(ctx.recentUserMessages).not.toContain('I can handle that.');
    expect(ctx.taskMemory).toHaveLength(1);
    expect(ctx.taskMemory?.[0]).toContain('Backend [claude, complete]');
    expect(ctx.taskMemory?.[0]).toContain('dispatch: Launched Backend');
    expect(ctx.taskMemory?.[0]).toContain('finished: Tests green');

    const transcript = get(chatMessages)['project-1'];
    expect(transcript[transcript.length - 1]).toMatchObject({ role: 'assistant', text: 'Done.', pending: false });
  });

  it('spawns multiple idle agents from one message', async () => {
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Opening two agents.',
      actions: [
        { kind: 'spawn', agent: 'claude', prompt: null, name: null },
        { kind: 'spawn', agent: 'claude', prompt: null, name: null },
      ],
      viaLLM: true,
    });

    await sendChatMessage('project-1', '/repo', 'open two claude agents');

    expect(spawnAgentPreset).toHaveBeenCalledTimes(2);
    // Only the primary agent takes focus; the rest spawn in the background so the
    // primary terminal stays stationary.
    expect(spawnAgentPreset).toHaveBeenNthCalledWith(1, 'claude', '/repo', { activate: true });
    expect(spawnAgentPreset).toHaveBeenNthCalledWith(2, 'claude', '/repo', { activate: false });
    // Idle spawns send no prompt and never create a worktree.
    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    expect(createTaskWorktree).not.toHaveBeenCalled();
    const tasks = get(orchestratorTasks);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === 'in-progress')).toBe(true);
    // Each unnamed spawn is given a distinct human assistant name.
    expect(tasks[0].name).toBeTruthy();
    expect(tasks[1].name).toBeTruthy();
    expect(tasks[0].name).not.toBe(tasks[1].name);
  });

  it('spawns a named agent direct (persistent, no worktree, no auto-send)', async () => {
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Opening Backend.',
      actions: [{ kind: 'spawn', agent: 'claude', prompt: null, name: 'Backend' }],
      viaLLM: true,
    });

    await sendChatMessage('project-1', '/repo', 'open a claude agent called Backend');

    expect(spawnAgentPreset).toHaveBeenCalledWith('claude', '/repo', { activate: true });
    expect(createTaskWorktree).not.toHaveBeenCalled();
    const task = get(orchestratorTasks)[0];
    expect(task.name).toBe('Backend');
    expect(task.executionMode).toBe('direct');
    expect(task.status).toBe('in-progress');
  });

  it('sends a follow-up to a running named agent without spawning a new one once the lease is ready', async () => {
    const seed = createOrchestratorTask('project-1', 'Original goal', 'direct', 'claude', 'Backend');
    orchestratorTasks.set([{ ...seed, status: 'in-progress', assignedSessionId: 42, startedAt: 1 }]);
    let buffer = '';
    getSessionOutputBuffer.mockImplementation(() => buffer);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: seed.id }] });
    spawnAgentPreset.mockClear();
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Sent to Backend.',
      actions: [{ kind: 'send', target: 'Backend', prompt: 'run the tests' }],
      viaLLM: true,
    });

    const sendPromise = sendChatMessage('project-1', '/repo', 'Backend, run the tests');
    await vi.advanceTimersByTimeAsync(150);
    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    buffer = 'booted output................................';
    await vi.advanceTimersByTimeAsync(150);
    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    await sendPromise;

    expect(sendAgentPromptDirect).toHaveBeenCalledWith(42, 'run the tests');
    expect(spawnAgentPreset).not.toHaveBeenCalled();
    expect(get(orchestratorTasks)).toHaveLength(1);
  });
  it('resumes a reviewed worktree task and sends the follow-up automatically', async () => {
    const seed = createOrchestratorTask('project-1', 'Refactor the launcher', 'worktree', 'claude', 'Backend');
    orchestratorTasks.set([
      {
        ...seed,
        status: 'in-review',
        assignedSessionId: null,
        worktree: {
          id: seed.id,
          path: '/repo/.soryq/worktrees/' + seed.id,
          branchName: 'soryq/' + seed.id,
          baseBranch: 'main',
          baseCommit: 'abc1234',
          createdAt: 1,
        },
        review: { requestedAt: 1, decision: 'pending', note: null },
        completedAt: 2,
        startedAt: 1,
        activity: [makeActivityEvent('finished', 'Ready for another pass', 2)],
      },
    ]);
    let buffer = '';
    getSessionOutputBuffer.mockImplementation(() => buffer);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 99, isRunning: true, ownerTaskId: seed.id }] });
    spawnAgentPreset.mockResolvedValueOnce(99);
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Back to Backend.',
      actions: [{ kind: 'send', target: 'Backend', prompt: 'run the tests again' }],
      viaLLM: true,
    });

    const sendPromise = sendChatMessage('project-1', '/repo', 'Backend, run the tests again');
    await vi.advanceTimersByTimeAsync(150);
    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    buffer = 'booted output................................';
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(1600);
    await sendPromise;

    expect(spawnAgentPreset).toHaveBeenCalledWith('claude', '/repo/.soryq/worktrees/' + seed.id, { activate: true });
    expect(sendAgentPromptDirect).toHaveBeenCalledWith(99, 'run the tests again');
    const task = get(orchestratorTasks)[0];
    expect(task.status).toBe('in-progress');
    expect(task.assignedSessionId).toBe(99);
  });

  it('resumes a blocked task directly and sends the reply automatically', async () => {
    const seed = createOrchestratorTask('project-1', 'Finish the migration', 'direct', 'claude', 'Backend');
    orchestratorTasks.set([
      {
        ...seed,
        status: 'blocked',
        assignedSessionId: null,
        blockedReason: 'Need the API key before continuing.',
        startedAt: 1,
        completedAt: 2,
        activity: [makeActivityEvent('blocked', 'Need the API key before continuing.', 2)],
      },
    ]);
    let buffer = '';
    getSessionOutputBuffer.mockImplementation(() => buffer);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 77, isRunning: true, ownerTaskId: seed.id }] });
    spawnAgentPreset.mockResolvedValueOnce(77);

    const resumePromise = resumeBlockedOrchestratorTask(seed.id, 'API key is set. Please continue.', '/repo');
    await vi.advanceTimersByTimeAsync(150);
    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    buffer = 'booted output................................';
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(1600);
    await resumePromise;

    expect(spawnAgentPreset).toHaveBeenCalledWith('claude', '/repo', { activate: true });
    expect(sendAgentPromptDirect).toHaveBeenCalledWith(77, 'API key is set. Please continue.');
    const task = get(orchestratorTasks)[0];
    expect(task.status).toBe('in-progress');
    expect(task.assignedSessionId).toBe(77);
    expect(task.blockedReason).toBeNull();
    expect(task.promptSentAt).toBeTypeOf('number');
  });

  it('classifies a non-zero leased process exit as failed instead of finished', async () => {
    vi.resetModules();
    const g = globalThis as typeof globalThis & { window?: unknown; localStorage?: unknown };
    const previousWindow = g.window;
    const previousLocalStorage = g.localStorage;
    g.window = {};
    // Re-importing the module graph re-runs settings.ts, which only touches
    // localStorage once window is defined — give it a no-op store so it doesn't
    // ReferenceError in the node env.
    g.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    sessions.subscribe.mockClear();
    sessionSubscribers.length = 0;
    const mod = await import('./orchestrator');
    const task = mod.createOrchestratorTask('project-1', 'Handle failing exits', 'direct', 'claude');
    mod.orchestratorTasks.set([{ ...task, status: 'in-progress', assignedSessionId: 42, startedAt: 1, promptSentAt: 2 }]);

    expect(sessionSubscribers).toHaveLength(1);
    sessionSubscribers[0]([{ id: 42, isRunning: false, ownerTaskId: task.id, lastExitCode: 17 }]);

    const updated = get(mod.orchestratorTasks)[0];
    expect(updated.status).toBe('failed');
    expect(updated.failureReason).toContain('17');
    expect(updated.assignedSessionId).toBeNull();

    if (previousWindow === undefined) delete g.window;
    else g.window = previousWindow;
    if (previousLocalStorage === undefined) delete g.localStorage;
    else g.localStorage = previousLocalStorage;
  });


  it('warns when no running agent matches a send target', async () => {
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Hmm.',
      actions: [{ kind: 'send', target: 'Ghost', prompt: 'do something' }],
      viaLLM: true,
    });

    await sendChatMessage('project-1', '/repo', 'Ghost, do something');

    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('No running agent named "Ghost"', 'warning', 4000);
  });

  it('names a running agent via a name action', async () => {
    const seed = createOrchestratorTask('project-1', 'Some goal', 'direct', 'claude');
    orchestratorTasks.set([{ ...seed, status: 'in-progress', assignedSessionId: 42, startedAt: 1 }]);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: seed.id }] });
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Named it Frontend.',
      actions: [{ kind: 'name', target: 'last', name: 'Frontend' }],
      viaLLM: true,
    });

    await sendChatMessage('project-1', '/repo', 'call that one Frontend');

    expect(get(orchestratorTasks)[0].name).toBe('Frontend');
    // The name is reflected on the leased terminal pane (as its badge).
    expect(setSessionAgentName).toHaveBeenCalledWith(42, 'Frontend');
  });

  it('closes a running agent via a close action — kills the terminal and cancels the task', async () => {
    const seed = createOrchestratorTask('project-1', 'Some goal', 'direct', 'claude', 'Iris');
    orchestratorTasks.set([{ ...seed, status: 'in-progress', assignedSessionId: 42, startedAt: 1 }]);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: seed.id }] });
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Closing Iris.',
      actions: [{ kind: 'close', target: 'Iris' }],
      viaLLM: true,
    });

    await sendChatMessage('project-1', '/repo', 'close iris');

    expect(killSession).toHaveBeenCalledWith(42);
    const task = get(orchestratorTasks)[0];
    expect(task.status).toBe('cancelled');
    expect(task.assignedSessionId).toBeNull();
  });

  it('warns when no running agent matches a close target', async () => {
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Hmm.',
      actions: [{ kind: 'close', target: 'Ghost' }],
      viaLLM: true,
    });

    await sendChatMessage('project-1', '/repo', 'close ghost');

    expect(killSession).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('No running agent named "Ghost"', 'warning', 4000);
  });

  it('renames an agent directly and reflects it on the terminal pane', () => {
    const seed = createOrchestratorTask('project-1', 'Some goal', 'direct', 'claude', 'Backend');
    orchestratorTasks.set([{ ...seed, status: 'in-progress', assignedSessionId: 42 }]);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: seed.id }] });

    renameOrchestratorAgent(seed.id, '  API  ');

    expect(get(orchestratorTasks)[0].name).toBe('API');
    expect(setSessionAgentName).toHaveBeenCalledWith(42, 'API');
    // The tab label (role) reflects the name too.
    expect(setSessionRole).toHaveBeenCalledWith(42, 'API');

    renameOrchestratorAgent(seed.id, '   ');
    expect(get(orchestratorTasks)[0].name).toBeNull();
    // Clearing the name removes the badge and resets the tab to the default role.
    expect(setSessionAgentName).toHaveBeenCalledWith(42, null);
    expect(setSessionRole).toHaveBeenCalledWith(42, 'Agent');
  });
});
