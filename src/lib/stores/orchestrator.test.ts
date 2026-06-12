import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const invoke = vi.hoisted(() => vi.fn(async (..._args: any[]): Promise<any> => undefined));
const routeOrchestratorRequest = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const showTerminal = vi.hoisted(() => vi.fn());
const spawnAgentPreset = vi.hoisted(() => vi.fn(async (): Promise<number | null> => 42));
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
const waitForAgentReady = vi.hoisted(() => vi.fn(async (): Promise<void> => {}));
const getPresetRuns = vi.hoisted(() => vi.fn(() => []));
const detectAgentAccess = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ ready: boolean; via: string; providerId: string | null; message: string }> => ({
      ready: true,
      via: 'api-key',
      providerId: 'openrouter',
      message: 'OpenRouter is ready.',
    })
  )
);
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
type MockSessionExitInfo = { sessionId: number; projectId: string; code: number };
const sessionExitListeners = vi.hoisted(() => [] as Array<(info: MockSessionExitInfo) => void>);
const onSessionExit = vi.hoisted(() =>
  vi.fn((cb: (info: MockSessionExitInfo) => void) => {
    sessionExitListeners.push(cb);
    return () => {
      const idx = sessionExitListeners.indexOf(cb);
      if (idx >= 0) sessionExitListeners.splice(idx, 1);
    };
  })
);

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('$lib/services/orchestrator-brain', () => ({ routeOrchestratorRequest }));
vi.mock('$lib/services/agent-access', () => ({
  detectAgentAccess,
  getAgentAccessBlockedMessage: () => 'To access the agent, add an API key or load a local model into the application.',
}));
vi.mock('$lib/stores/notification', () => ({ showToast }));
vi.mock('$lib/stores/layout', () => ({ showTerminal }));
vi.mock('$lib/stores/runs', () => ({ getPresetRuns }));
vi.mock('$lib/stores/terminal', () => ({
  sessions,
  onSessionExit,
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
  waitForAgentReady,
}));

import { orchestratorTasks, chatMessages, createOrchestratorTask, deleteOrchestratorTask, loadProjectOrchestratorTasks, launchOrchestratorTask, unlinkOrchestratorTask, resendOrchestratorGoal, resumeBlockedOrchestratorTask, renameOrchestratorAgent, sendChatMessage } from './orchestrator';
import { makeActivityEvent } from '$lib/services/orchestrator/activity-log';
import { buildAgentCharter, buildAgentTaskMessage } from '$lib/services/orchestrator/agent-charter';
import { tasks } from '$lib/stores/tasks';

function resetMocks() {
  invoke.mockReset();
  routeOrchestratorRequest.mockReset();
  showToast.mockReset();
  showTerminal.mockReset();
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
  waitForAgentReady.mockReset();
  waitForAgentReady.mockResolvedValue(undefined);
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
  tasks.set([]);
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
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: 'pending' }] });
    const task = createOrchestratorTask('project-1', 'Explain how the lease boundary works', 'claude');
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: task.id }] });

    await launchOrchestratorTask(task.id, 'claude', '/repo', false);

    expect(spawnAgentPreset).toHaveBeenCalledWith('claude', '/repo', { activate: true, skipAutoBrief: true });
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

    // claude reads a rules file, so its standing brief is written to CLAUDE.md /
    // AGENTS.md when the CLI boots — it is never pasted into the REPL. A manual
    // (no-goal) launch therefore sends nothing live; the goal just goes to the
    // prompt bar for the user to send.
    getSessionOutputBuffer.mockReturnValue('booted output................................');
    await vi.advanceTimersByTimeAsync(9300);
    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
  });

  it('marks a launched task as starting until its goal is sent', async () => {
    const task = createOrchestratorTask('project-1', 'Fix the terminal lease flow', 'claude');
    getSessionOutputBuffer.mockReturnValueOnce('').mockReturnValue('booted output................................');
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: task.id }] });

    await launchOrchestratorTask(task.id, 'claude', '/repo', true);
    expect(get(orchestratorTasks)[0].promptSentAt).toBeNull();

    await vi.advanceTimersByTimeAsync(1600);
    await Promise.resolve();

    // claude reads a rules file, so it already holds the standing brief — only the
    // task goes live (no charter wrap pasted into the REPL).
    expect(sendAgentPromptDirect).toHaveBeenCalledWith(42, buildAgentTaskMessage(task.goal, { name: null }));
    expect(get(orchestratorTasks)[0].promptSentAt).toBeTypeOf('number');
    expect(showToast).toHaveBeenCalledWith('Sent goal to claude', 'info', 3000);
  });

  it('pastes the full charter for agents that do NOT read a rules file', async () => {
    // pi has no native rules file, so the only way it gets the standing brief is
    // the legacy REPL paste — the charter wrapped around the goal.
    const task = createOrchestratorTask('project-1', 'Fix the terminal lease flow', 'pi');
    getSessionOutputBuffer.mockReturnValueOnce('').mockReturnValue('booted output................................');
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: task.id }] });

    await launchOrchestratorTask(task.id, 'pi', '/repo', true);
    await vi.advanceTimersByTimeAsync(1600);
    await Promise.resolve();

    expect(sendAgentPromptDirect).toHaveBeenCalledWith(42, buildAgentCharter(task.goal, { name: null }));
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

  it('aborts auto-send when the leased session stops running before the goal is sent', async () => {
    const task = createOrchestratorTask('project-1', 'Fix the terminal lease flow', 'claude');
    // Keep the agent "starting up" long enough for the session to die first.
    waitForAgentReady.mockImplementationOnce(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
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
    const task = createOrchestratorTask('project-1', 'Explain how the lease boundary works', 'claude');

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
    const task = createOrchestratorTask('project-1', 'Fix the terminal lease flow', 'claude');
    orchestratorTasks.set([{ ...task, status: 'in-progress', assignedSessionId: 42 }]);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: task.id }] });

    resendOrchestratorGoal(task.id);

    // A resend re-delivers the goal; claude holds the brief via its rules file, so
    // only the task is re-sent (no charter wrap).
    expect(sendAgentPromptDirect).toHaveBeenCalledWith(42, buildAgentTaskMessage(task.goal, { name: null }));
    expect(showToast).toHaveBeenCalledWith('Re-sent goal to agent', 'info', 2500);
  });

  it('does not resend to a live session owned by another task', async () => {
    const task = createOrchestratorTask('project-1', 'Fix the terminal lease flow', 'claude');
    orchestratorTasks.set([{ ...task, status: 'in-progress', assignedSessionId: 42 }]);
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: true, ownerTaskId: 'other-task' }] });

    resendOrchestratorGoal(task.id);

    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
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
    const seed = createOrchestratorTask('project-1', 'Inspect the login flow', 'claude', 'Backend');
    orchestratorTasks.set([
      {
        ...seed,
        status: 'complete',
        completedAt: 20,
        activity: [
          makeActivityEvent('dispatch', 'Launched Backend', 10),
          makeActivityEvent('finished', 'Tests green', 20),
        ],
        transcript: 'npm test\nTest Files 2 passed\nAll green',
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
    expect(ctx.taskOutputs).toHaveLength(1);
    expect(ctx.taskOutputs?.[0]).toMatchObject({
      name: 'Backend',
      agent: 'claude',
      status: 'complete',
      recentOutput: expect.stringContaining('All green'),
    });

    const transcript = get(chatMessages)['project-1'];
    expect(transcript[transcript.length - 1]).toMatchObject({ role: 'assistant', text: 'Done.', pending: false });
  });

  it('spawns multiple idle agents from one message and briefs every one', async () => {
    // Distinct session ids per spawn so each agent's lease is tracked separately.
    spawnAgentPreset.mockReset();
    spawnAgentPreset.mockResolvedValueOnce(42).mockResolvedValueOnce(43);
    // Both panes report running + owned by their task, so the readiness-gated brief
    // send is allowed to proceed (leasedSessionLive stays true for each).
    getTerminalProjectState.mockImplementation(() => ({
      sessions: get(orchestratorTasks).map((t, i) => ({
        id: 42 + i,
        isRunning: true,
        ownerTaskId: t.id,
      })),
    }));
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
    expect(spawnAgentPreset).toHaveBeenNthCalledWith(1, 'claude', '/repo', { activate: true, skipAutoBrief: true });
    expect(spawnAgentPreset).toHaveBeenNthCalledWith(2, 'claude', '/repo', { activate: false, skipAutoBrief: true });

    const tasks = get(orchestratorTasks);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === 'in-progress')).toBe(true);
    // Each unnamed spawn is given a distinct human assistant name.
    expect(tasks[0].name).toBeTruthy();
    expect(tasks[1].name).toBeTruthy();
    expect(tasks[0].name).not.toBe(tasks[1].name);

    // Drive the readiness-gated brief sends to completion (output grows past the
    // ready threshold, then the settle + max-wait windows elapse).
    getSessionOutputBuffer.mockReturnValue('booted output................................');
    await vi.advanceTimersByTimeAsync(9300);

    // claude reads a rules file: every spawned CLI is briefed via CLAUDE.md /
    // AGENTS.md on boot, so NONE of them get the brief pasted into the REPL.
    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
  });

  it('spawns a named agent persistent (no auto-send)', async () => {
    routeOrchestratorRequest.mockResolvedValue({
      reply: 'Opening Backend.',
      actions: [{ kind: 'spawn', agent: 'claude', prompt: null, name: 'Backend' }],
      viaLLM: true,
    });

    await sendChatMessage('project-1', '/repo', 'open a claude agent called Backend');

    expect(spawnAgentPreset).toHaveBeenCalledWith('claude', '/repo', { activate: true, skipAutoBrief: true });
    const task = get(orchestratorTasks)[0];
    expect(task.name).toBe('Backend');
    expect(task.status).toBe('in-progress');
  });

  it('sends a follow-up to a running named agent without spawning a new one once the lease is ready', async () => {
    const seed = createOrchestratorTask('project-1', 'Original goal', 'claude', 'Backend');
    orchestratorTasks.set([{ ...seed, status: 'in-progress', assignedSessionId: 42, startedAt: 1 }]);
    // The follow-up must wait for agent readiness before it is delivered.
    waitForAgentReady.mockImplementationOnce(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
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
    await vi.advanceTimersByTimeAsync(1600);
    await sendPromise;

    expect(sendAgentPromptDirect).toHaveBeenCalledWith(42, 'run the tests');
    expect(spawnAgentPreset).not.toHaveBeenCalled();
    expect(get(orchestratorTasks)).toHaveLength(1);
  });

  it('resumes a blocked task directly and sends the reply automatically', async () => {
    const seed = createOrchestratorTask('project-1', 'Finish the migration', 'claude', 'Backend');
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
    // The relaunched CLI must be ready before the resume prompt is delivered.
    waitForAgentReady.mockImplementationOnce(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 77, isRunning: true, ownerTaskId: seed.id }] });
    spawnAgentPreset.mockResolvedValueOnce(77);

    const resumePromise = resumeBlockedOrchestratorTask(seed.id, 'API key is set. Please continue.', '/repo');
    await vi.advanceTimersByTimeAsync(150);
    expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    await resumePromise;

    expect(spawnAgentPreset).toHaveBeenCalledWith('claude', '/repo', { activate: true, skipAutoBrief: true });
    // Resuming a blocked task spawns a fresh CLI; claude re-reads its rules file on
    // boot, so only the resume prompt is sent (no charter wrap).
    expect(sendAgentPromptDirect).toHaveBeenCalledWith(
      77,
      buildAgentTaskMessage('API key is set. Please continue.', { name: 'Backend' })
    );
    const task = get(orchestratorTasks)[0];
    expect(task.status).toBe('in-progress');
    expect(task.assignedSessionId).toBe(77);
    expect(task.blockedReason).toBeNull();
    expect(task.promptSentAt).toBeTypeOf('number');
  });

  it('classifies a non-zero leased process exit as failed instead of finished', async () => {
    vi.resetModules();
    const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
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
    sessionExitListeners.length = 0;
    const mod = await import('./orchestrator');
    const task = mod.createOrchestratorTask('project-1', 'Handle failing exits', 'claude');
    mod.orchestratorTasks.set([{ ...task, status: 'in-progress', assignedSessionId: 42, startedAt: 1, promptSentAt: 2 }]);

    // A natural (non-deliberate) exit leaves the session in project state flagged
    // isRunning:false — the reconciler only completes when the session is still
    // present (a deliberate close removes it first).
    getTerminalProjectState.mockReturnValue({ sessions: [{ id: 42, isRunning: false, ownerTaskId: task.id, lastExitCode: 17 }] });

    expect(sessionExitListeners).toHaveLength(1);
    sessionExitListeners[0]({ sessionId: 42, projectId: 'project-1', code: 17 });

    const updated = get(mod.orchestratorTasks)[0];
    expect(updated.status).toBe('failed');
    expect(updated.failureReason).toContain('17');
    expect(updated.assignedSessionId).toBeNull();

    if (previousWindow === undefined) delete g.window;
    else g.window = previousWindow;
    if (previousLocalStorage === undefined) delete g.localStorage;
    else g.localStorage = previousLocalStorage;
  });

  it('ignores a session-exit for a deliberately closed session (no session in state)', async () => {
    vi.resetModules();
    const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
    const previousWindow = g.window;
    const previousLocalStorage = g.localStorage;
    g.window = {};
    g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    sessionExitListeners.length = 0;
    const mod = await import('./orchestrator');
    const task = mod.createOrchestratorTask('project-1', 'Closed deliberately', 'claude');
    mod.orchestratorTasks.set([{ ...task, status: 'in-progress', assignedSessionId: 42, startedAt: 1, promptSentAt: 2 }]);

    // killSession removes the session from project state before the async pty exit
    // fires, so the reconciler must treat this exit as an intentional close and
    // leave the (already in-progress) task untouched rather than marking it done.
    getTerminalProjectState.mockReturnValue({ sessions: [] });

    expect(sessionExitListeners).toHaveLength(1);
    sessionExitListeners[0]({ sessionId: 42, projectId: 'project-1', code: 0 });

    const updated = get(mod.orchestratorTasks)[0];
    expect(updated.status).toBe('in-progress');
    expect(updated.assignedSessionId).toBe(42);

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
    const seed = createOrchestratorTask('project-1', 'Some goal', 'claude');
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
    const seed = createOrchestratorTask('project-1', 'Some goal', 'claude', 'Iris');
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
    const seed = createOrchestratorTask('project-1', 'Some goal', 'claude', 'Backend');
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
