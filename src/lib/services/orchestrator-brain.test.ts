import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn(async (..._args: any[]): Promise<any> => undefined));
const getProviderApiKeyLocal = vi.hoisted(() => vi.fn(() => 'secret'));
const getProviderDef = vi.hoisted(() => vi.fn(() => ({ models: [{ id: 'gpt-4.1' }, { id: 'gpt-4o-mini' }] })));
const isLocalProvider = vi.hoisted(() => vi.fn(() => false));
const getProviderBaseUrl = vi.hoisted(() => vi.fn(() => ''));
const aiProvider = vi.hoisted(() => {
  let value = 'openrouter';
  return {
    subscribe(run: (value: string) => void) {
      run(value);
      return () => {};
    },
    set(next: string) {
      value = next;
    },
  };
});
const currentAiModel = vi.hoisted(() => {
  let value = 'gpt-4.1';
  return {
    subscribe(run: (value: string) => void) {
      run(value);
      return () => {};
    },
    set(next: string) {
      value = next;
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('$lib/services/ai-keychain', () => ({ getProviderApiKeyLocal }));
vi.mock('$lib/stores/settings', () => ({
  aiProvider,
  currentAiModel,
  getProviderDef,
  isLocalProvider,
  getProviderBaseUrl,
}));

import { routeOrchestratorRequest, resolveAgentCommand } from './orchestrator-brain';

const ALL_AGENTS = [
  { command: 'codex', name: 'Codex CLI' },
  { command: 'claude', name: 'Claude Code' },
  { command: 'agy', name: 'Antigravity' },
  { command: 'opencode', name: 'OpenCode' },
  { command: 'pi', name: 'Pi AI Agent' },
  { command: 'omp', name: 'Oh My Pi' },
  { command: 'agent', name: 'Cursor' },
];

describe('routeOrchestratorRequest', () => {
  beforeEach(() => {
    invoke.mockReset();
    getProviderApiKeyLocal.mockReset().mockReturnValue('secret');
    getProviderDef.mockClear();
    isLocalProvider.mockClear();
    getProviderBaseUrl.mockClear();
    aiProvider.set('openrouter');
    currentAiModel.set('gpt-4.1');
  });

  it('includes durable task memory and only recent user messages in the prompt context', async () => {
    invoke.mockResolvedValueOnce('{"reply":"Sure.","actions":[]}');

    const result = await routeOrchestratorRequest('Ship it now', [{ command: 'claude', name: 'Claude' }], {
      projectName: 'Atlas',
      recentUserMessages: ['Need docs', 'Make it fast'],
      taskMemory: ['Backend [claude, complete] — dispatch: launched; finished: green'],
      taskPanel: ['In progress (1): Finish agent memory', 'To do (2): Add Docker switch; Improve canvas colors'],
      reviewingAgents: [{ name: 'Backend', agent: 'claude', title: 'Refactor the launcher (awaiting review)' }],
    });

    expect(result).toEqual({ reply: 'Sure.', actions: [], viaLLM: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    const call = invoke.mock.calls[0][1] as { systemPrompt: string; userText: string };
    expect(call.userText).toContain('Project: Atlas');
    expect(call.userText).toContain('Tasks awaiting review that can be resumed automatically:');
    expect(call.userText).toContain('- "Backend" [claude] — Refactor the launcher (awaiting review)');
    expect(call.userText).toContain('Project memory and recent task activity:');
    expect(call.userText).toContain('- Backend [claude, complete] — dispatch: launched; finished: green');
    expect(call.userText).toContain('Task panel board:');
    expect(call.userText).toContain('- In progress (1): Finish agent memory');
    expect(call.userText).toContain('- To do (2): Add Docker switch; Improve canvas colors');
    expect(call.userText).toContain('Recent user messages:');
    expect(call.userText).toContain('- Need docs');
    expect(call.userText).toContain('- Make it fast');
    expect(call.userText).toContain('New user message: Ship it now');
    expect(call.userText).not.toContain('Orchestrator:');
  });

  it('parses a close action from the model', async () => {
    invoke.mockResolvedValueOnce('{"reply":"Closing Iris.","actions":[{"kind":"close","target":"Iris"}]}');

    const result = await routeOrchestratorRequest('close iris', [{ command: 'claude', name: 'Claude' }]);

    expect(result.viaLLM).toBe(true);
    expect(result.actions).toEqual([{ kind: 'close', target: 'Iris' }]);
  });

  it('can use an explicit llm config for voice conversations', async () => {
    invoke.mockResolvedValueOnce('{"reply":"Sure.","actions":[]}');

    await routeOrchestratorRequest('talk to the agent', [{ command: 'claude', name: 'Claude' }], {
      llmConfig: {
        provider: 'google',
        model: 'gemini-2.5-flash',
        apiKey: 'google-secret',
        baseUrl: '',
      },
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    const call = invoke.mock.calls[0][1] as { provider: string; model: string; apiKey: string };
    expect(call.provider).toBe('google');
    expect(call.model).toBe('gemini-2.5-flash');
    expect(call.apiKey).toBe('google-secret');
  });

  it('heuristically closes the running agent when no provider is configured', async () => {
    getProviderApiKeyLocal.mockReturnValue(''); // no key → heuristic fallback, no invoke

    const result = await routeOrchestratorRequest('close it', [{ command: 'claude', name: 'Claude' }], {
      runningAgents: [{ name: 'Iris', agent: 'claude', title: 'doing stuff' }],
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.viaLLM).toBe(false);
    expect(result.actions).toEqual([{ kind: 'close', target: 'last' }]);
  });

  it('heuristically targets a named agent and supports "close all"', async () => {
    getProviderApiKeyLocal.mockReturnValue('');
    const running = [
      { name: 'Iris', agent: 'claude', title: 'a' },
      { name: 'Atlas', agent: 'claude', title: 'b' },
    ];

    const named = await routeOrchestratorRequest('shut down atlas', [{ command: 'claude', name: 'Claude' }], {
      runningAgents: running,
    });
    expect(named.actions).toEqual([{ kind: 'close', target: 'Atlas' }]);

    const all = await routeOrchestratorRequest('close everything', [{ command: 'claude', name: 'Claude' }], {
      runningAgents: running,
    });
    expect(all.actions).toEqual([{ kind: 'close', target: 'all' }]);
  });

  it('does not treat a task that merely mentions "stop" as a close', async () => {
    getProviderApiKeyLocal.mockReturnValue('');

    const result = await routeOrchestratorRequest(
      'fix the bug that stops the build from finishing',
      [{ command: 'claude', name: 'Claude' }],
      { runningAgents: [{ name: 'Iris', agent: 'claude', title: 'x' }] }
    );

    expect(result.actions).toEqual([{ kind: 'spawn', agent: 'claude', prompt: 'fix the bug that stops the build from finishing' }]);
  });

  it('heuristically surfaces running agent output in conversational mode', async () => {
    getProviderApiKeyLocal.mockReturnValue('');

    const result = await routeOrchestratorRequest(
      "how's the agent doing",
      [{ command: 'claude', name: 'Claude' }],
      {
        conversational: true,
        runningAgents: [
          { name: 'Iris', agent: 'claude', title: 'Refactoring the router', recentOutput: 'npx tsc --noEmit\nFound 3 errors\n  > src/router.ts:42' },
        ],
      }
    );

    expect(result.actions).toEqual([]);
    expect(result.viaLLM).toBe(false);
    expect(result.reply).toContain('still in progress');
    expect(result.reply).toContain('Iris');
    expect(result.reply).toContain('Refactoring the router');
    expect(result.reply).toContain('router.ts');
  });

  it('answers status questions from recent task output without invoking the LLM', async () => {
    const result = await routeOrchestratorRequest(
      'is it done?',
      [{ command: 'claude', name: 'Claude' }],
      {
        taskOutputs: [
          {
            name: 'Iris',
            agent: 'claude',
            title: 'Fix the login bug',
            status: 'complete',
            recentOutput: 'npm test\nTest Files 4 passed\nDone in 12s',
          },
        ],
      }
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(result.actions).toEqual([]);
    expect(result.reply).toContain('Iris is done');
    expect(result.reply).toContain('Fix the login bug');
    expect(result.reply).toContain('Done in 12s');
  });

  it('summarizes terminal output conversationally in voice mode', async () => {
    const result = await routeOrchestratorRequest(
      'summarize what the terminal said',
      [{ command: 'claude', name: 'Claude' }],
      {
        conversational: true,
        taskOutputs: [
          {
            name: 'Backend',
            agent: 'claude',
            title: 'Add OpenRouter STT',
            status: 'blocked',
            reason: 'OpenRouter requires balance for audio.',
            recentOutput: 'OpenRouter audio chat transcription failed (402 Payment Required)\nNeed to switch to Web Speech or local STT.',
          },
        ],
      }
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(result.actions).toEqual([]);
    expect(result.reply).toContain('Backend is waiting for input');
    expect(result.reply).toContain('latest terminal output');
    expect(result.reply).toContain('402 Payment Required');
    expect(result.reply).not.toContain('```');
  });

  it('answers prioritization questions from the task panel without invoking the LLM', async () => {
    const result = await routeOrchestratorRequest(
      'what should we do next?',
      [{ command: 'claude', name: 'Claude' }],
      {
        taskPanel: [
          'In progress (1): Wire task panel into orchestrator prompts',
          'To do (2): Add Docker switch; Improve canvas colors',
        ],
      }
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(result.actions).toEqual([]);
    expect(result.reply).toContain('In progress');
    expect(result.reply).toContain('To do');
  });

  describe('resolveAgentCommand', () => {
    it('maps command ids, display names, and aliases to the command', () => {
      expect(resolveAgentCommand('open codex', ALL_AGENTS)).toBe('codex');
      expect(resolveAgentCommand('use Codex CLI to fix it', ALL_AGENTS)).toBe('codex');
      expect(resolveAgentCommand('spawn antigravity', ALL_AGENTS)).toBe('agy');
      expect(resolveAgentCommand('launch oh my pi', ALL_AGENTS)).toBe('omp');
      expect(resolveAgentCommand('use cursor', ALL_AGENTS)).toBe('agent');
      expect(resolveAgentCommand('fire up opencode', ALL_AGENTS)).toBe('opencode');
    });

    it('returns null when no agent is named, and ignores the generic word "agent"', () => {
      expect(resolveAgentCommand('fix the login bug', ALL_AGENTS)).toBeNull();
      // "agent" alone must not resolve to Cursor (whose command happens to be "agent").
      expect(resolveAgentCommand('open an agent for me', ALL_AGENTS)).toBeNull();
    });
  });

  it('heuristically brings out the NAMED agent, not the default', async () => {
    getProviderApiKeyLocal.mockReturnValue(''); // no key → heuristic fallback

    const open = await routeOrchestratorRequest('open codex', ALL_AGENTS);
    expect(open.viaLLM).toBe(false);
    expect(open.actions).toEqual([{ kind: 'spawn', agent: 'codex', prompt: null }]);
    expect(open.reply).toContain('Codex CLI');

    const work = await routeOrchestratorRequest('use Codex CLI to fix the login bug', ALL_AGENTS);
    expect(work.actions).toEqual([
      { kind: 'spawn', agent: 'codex', prompt: 'use Codex CLI to fix the login bug' },
    ]);

    const idle = await routeOrchestratorRequest('spawn antigravity', ALL_AGENTS);
    expect(idle.actions).toEqual([{ kind: 'spawn', agent: 'agy', prompt: null }]);
  });

  it('still defaults to claude when no specific agent is named', async () => {
    getProviderApiKeyLocal.mockReturnValue('');

    const result = await routeOrchestratorRequest('refactor the router for clarity', ALL_AGENTS);
    expect(result.actions).toEqual([
      { kind: 'spawn', agent: 'claude', prompt: 'refactor the router for clarity' },
    ]);
  });

  it('resolves a display name the model returned to its command id (LLM path)', async () => {
    invoke.mockResolvedValueOnce(
      '{"reply":"On it.","actions":[{"kind":"spawn","agent":"Codex CLI","prompt":"do x","name":null}]}'
    );

    const result = await routeOrchestratorRequest('have codex do x', ALL_AGENTS);
    expect(result.viaLLM).toBe(true);
    expect(result.actions).toEqual([{ kind: 'spawn', agent: 'codex', prompt: 'do x', name: null }]);
  });

  it('reverts to canned reply in conversational mode when no agents are running', async () => {
    getProviderApiKeyLocal.mockReturnValue('');

    const result = await routeOrchestratorRequest(
      'hello there',
      [{ command: 'claude', name: 'Claude' }],
      { conversational: true }
    );

    expect(result.actions).toEqual([]);
    expect(result.viaLLM).toBe(false);
    expect(result.reply).toContain('Say the word');
  });
});
