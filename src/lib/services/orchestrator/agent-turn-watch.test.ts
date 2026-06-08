import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionOutputBuffer = vi.hoisted(() => vi.fn(() => ''));
vi.mock('$lib/stores/terminal', () => ({ getSessionOutputBuffer }));

import { watchLeasedAgentTurn } from './agent-turn-watch';

describe('watchLeasedAgentTurn', () => {
  let buf = '';
  beforeEach(() => {
    vi.useFakeTimers();
    buf = '';
    getSessionOutputBuffer.mockReset();
    getSessionOutputBuffer.mockImplementation(() => buf);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('finishes when the agent rings the bell after working', async () => {
    const p = watchLeasedAgentTurn(1, { shouldContinue: () => true, pollMs: 10, idleMs: 10_000 });
    buf = 'working on the change...';
    await vi.advanceTimersByTimeAsync(10); // sees activity
    buf += ' done\x07';
    await vi.advanceTimersByTimeAsync(10); // sees new bell
    await expect(p).resolves.toEqual({ kind: 'finished' });
  });

  it('blocks when the agent prints an attention prompt', async () => {
    const p = watchLeasedAgentTurn(1, { shouldContinue: () => true, pollMs: 10, idleMs: 10_000 });
    buf = 'I need to delete the table. Do you want to continue? [y/n]';
    await vi.advanceTimersByTimeAsync(10);
    const outcome = await p;
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind === 'blocked') expect(outcome.reason.toLowerCase()).toContain('do you want to');
  });

  it('finishes via quiescence when output stops growing', async () => {
    const p = watchLeasedAgentTurn(1, { shouldContinue: () => true, pollMs: 10, idleMs: 50 });
    buf = 'streamed some real work '.repeat(20); // well past minWorkChars
    await vi.advanceTimersByTimeAsync(10); // activity, resets idle timer
    await vi.advanceTimersByTimeAsync(80); // no further growth past idleMs
    await expect(p).resolves.toEqual({ kind: 'finished' });
  });

  it('does not idle-finish on a tiny burst that never became real work', async () => {
    // The prompt echo / a cursor-blink redraw nudges the buffer a few chars but
    // the agent never actually started — quiescence must NOT complete the turn.
    const p = watchLeasedAgentTurn(1, { shouldContinue: () => true, pollMs: 10, idleMs: 50 });
    buf = '> hi'; // below minWorkChars (default 200)
    await vi.advanceTimersByTimeAsync(10); // tiny "activity"
    await vi.advanceTimersByTimeAsync(120); // long past idleMs, but under the work floor
    const settled = await Promise.race([p, Promise.resolve('pending')]);
    expect(settled).toBe('pending');
  });

  it('aborts when shouldContinue turns false', async () => {
    let cont = true;
    const p = watchLeasedAgentTurn(1, { shouldContinue: () => cont, pollMs: 10, idleMs: 10_000 });
    cont = false;
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toEqual({ kind: 'aborted' });
  });

  it('does not finish while output keeps growing (still working)', async () => {
    const p = watchLeasedAgentTurn(1, { shouldContinue: () => true, pollMs: 10, idleMs: 40 });
    for (let i = 0; i < 6; i += 1) {
      buf += ` chunk ${i}`; // continuous growth — never idle, no bell
      await vi.advanceTimersByTimeAsync(10);
    }
    const settled = await Promise.race([p, Promise.resolve('pending')]);
    expect(settled).toBe('pending');
  });
});
