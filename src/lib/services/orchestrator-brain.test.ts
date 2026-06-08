import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn(async () => undefined));
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

import { routeOrchestratorRequest } from './orchestrator-brain';

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
      reviewingAgents: [{ name: 'Backend', agent: 'claude', title: 'Refactor the launcher (awaiting review)' }],
    });

    expect(result).toEqual({ reply: 'Sure.', actions: [], viaLLM: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    const call = invoke.mock.calls[0][1] as { systemPrompt: string; userText: string };
    expect(call.userText).toContain('Project: Atlas');
    expect(call.userText).toContain('Tasks awaiting review that can be resumed automatically:');
    expect(call.userText).toContain('- "Backend" [claude] — Refactor the launcher (awaiting review)');
    expect(call.userText).toContain('Recent task activity:');
    expect(call.userText).toContain('- Backend [claude, complete] — dispatch: launched; finished: green');
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
});
