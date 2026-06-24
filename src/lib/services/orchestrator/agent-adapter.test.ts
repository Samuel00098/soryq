import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const waitForAgentReady = vi.hoisted(() => vi.fn(async (): Promise<'ready' | 'launch-failed'> => 'ready'));
const sendAgentPromptDirect = vi.hoisted(() => vi.fn(async (): Promise<boolean> => true));
const writeToSession = vi.hoisted(() => vi.fn());
const bufferState = vi.hoisted(() => ({ value: '' }));
const getSessionOutputBuffer = vi.hoisted(() => vi.fn(() => bufferState.value));
const onSessionExit = vi.hoisted(() => vi.fn(() => () => {}));
const captureTranscript = vi.hoisted(() => vi.fn((raw: string) => `clean:${raw}`));
const watchLeasedAgentTurn = vi.hoisted(() => vi.fn(async () => ({ kind: 'finished' as const })));

vi.mock('$lib/stores/terminal', () => ({
  waitForAgentReady,
  sendAgentPromptDirect,
  writeToSession,
  getSessionOutputBuffer,
  onSessionExit,
}));
vi.mock('$lib/services/orchestrator/activity-log', () => ({ captureTranscript }));
vi.mock('$lib/services/orchestrator/agent-turn-watch', () => ({ watchLeasedAgentTurn }));

import { AgentAdapter, getAgentAdapter } from './agent-adapter';

describe('AgentAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitForAgentReady.mockResolvedValue('ready');
    sendAgentPromptDirect.mockResolvedValue(true);
    bufferState.value = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('send / input', () => {
    it('waits for readiness then delivers the message', async () => {
      const ok = await new AgentAdapter(7).sendGoal('do the thing');
      expect(ok).toBe(true);
      expect(waitForAgentReady).toHaveBeenCalledWith(7);
      expect(sendAgentPromptDirect).toHaveBeenCalledWith(7, 'do the thing');
    });

    it('does not send when the agent launch failed', async () => {
      waitForAgentReady.mockResolvedValue('launch-failed');
      const ok = await new AgentAdapter(7).sendGoal('do the thing');
      expect(ok).toBe(false);
      expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    });

    it('ignores an empty message without touching the terminal', async () => {
      const ok = await new AgentAdapter(7).sendGoal('   ');
      expect(ok).toBe(false);
      expect(waitForAgentReady).not.toHaveBeenCalled();
      expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    });

    it('aborts before sending when shouldContinue returns false', async () => {
      const ok = await new AgentAdapter(7).sendGoal('go', { shouldContinue: () => false });
      expect(ok).toBe(false);
      expect(sendAgentPromptDirect).not.toHaveBeenCalled();
    });

    it('resend skips the readiness gate', () => {
      new AgentAdapter(3).resend('again');
      expect(waitForAgentReady).not.toHaveBeenCalled();
      expect(sendAgentPromptDirect).toHaveBeenCalledWith(3, 'again');
    });

    it('writeRaw writes straight to the PTY', () => {
      new AgentAdapter(9).writeRaw('\x03');
      expect(writeToSession).toHaveBeenCalledWith(9, '\x03');
    });
  });

  describe('receive / output', () => {
    it('readOutput reads the rolling buffer through captureTranscript', () => {
      bufferState.value = 'raw output';
      const out = new AgentAdapter(5).readOutput();
      expect(getSessionOutputBuffer).toHaveBeenCalledWith(5);
      expect(out).toBe('clean:raw output');
    });

    it('subscribeOutput emits only the newly-grown tail and stops after unsubscribe', () => {
      vi.useFakeTimers();
      bufferState.value = 'abc';
      const chunks: string[] = [];
      const stop = new AgentAdapter(1).subscribeOutput((c) => chunks.push(c), 100);

      bufferState.value = 'abcdef';
      vi.advanceTimersByTime(100);
      bufferState.value = 'abcdefghi';
      vi.advanceTimersByTime(100);
      stop();
      bufferState.value = 'abcdefghiXYZ';
      vi.advanceTimersByTime(100);

      expect(chunks).toEqual(['def', 'ghi']);
    });
  });

  describe('lifecycle', () => {
    it('watchTurn delegates to the turn watcher', async () => {
      const outcome = await new AgentAdapter(2).watchTurn({ shouldContinue: () => true });
      expect(watchLeasedAgentTurn).toHaveBeenCalledWith(2, { shouldContinue: expect.any(Function) });
      expect(outcome).toEqual({ kind: 'finished' });
    });
  });

  describe('getAgentAdapter', () => {
    it('returns one memoized instance per session', () => {
      expect(getAgentAdapter(11)).toBe(getAgentAdapter(11));
      expect(getAgentAdapter(11)).not.toBe(getAgentAdapter(12));
    });
  });
});
