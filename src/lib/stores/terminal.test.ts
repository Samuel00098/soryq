import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const ptyDataHandlers = vi.hoisted(() => new Map<number, (bytes: Uint8Array) => void>());
const ptyReplayHandlers = vi.hoisted(() => new Map<number, (bytes: Uint8Array) => void>());

vi.mock('$lib/services/pty-bridge', () => {
  let nextId = 1;
  return {
    openPty: vi.fn(async (_cols: number, _rows: number, opts?: { onData?: (bytes: Uint8Array) => void }) => {
      const id = nextId++;
      if (opts?.onData) ptyDataHandlers.set(id, opts.onData);
      return {
        id,
        write: vi.fn(async () => {}),
        resize: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      };
    }),
    attachPty: vi.fn(async (id: number, opts?: { onData?: (bytes: Uint8Array) => void; onReplay?: (bytes: Uint8Array) => void }) => {
      if (opts?.onData) ptyDataHandlers.set(id, opts.onData);
      if (opts?.onReplay) ptyReplayHandlers.set(id, opts.onReplay);
      return {
        id,
        write: vi.fn(async () => {}),
        resize: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      };
    }),
  };
});

/** Simulate the shell/CLI printing to a session's terminal. */
function feedPtyOutput(sessionId: number, text: string) {
  ptyDataHandlers.get(sessionId)?.(new TextEncoder().encode(text));
}

vi.mock('./notification', () => ({
  showToast: vi.fn(),
}));

// Rules-file delivery (CLAUDE.md / AGENTS.md) goes through Tauri's invoke. Most
// tests pass no cwd, so resolveSessionRoot returns null and this is never hit;
// the cwd-aware tests below assert against it.
const invokeMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  appendToCommandBlock,
  applyOscPaneTitle,
  attachTerminalSession,
  commandBlocks,
  createTerminalSession,
  getSessionOutputBuffer,
  registerDataCallback,
  unregisterDataCallback,
  finalizeCommandBlockWithExit,
  killAllSessions,
  markSessionAgentPreset,
  normalizeForEchoMatch,
  pasteEchoLanded,
  sessions,
  setActiveTerminalProject,
  setTerminalProjectRoot,
  setSessionAgentName,
  setSessionOwnerTask,
  setSessionTaskSummary,
  startCommandBlock,
  sendAgentPromptDirect,
  sendPromptToSession,
  spawnAgentPreset,
  relaunchRestoredAgentSession,
  waitForAgentReady,
} from './terminal';
import { openPty } from '$lib/services/pty-bridge';
import { buildAgentCharter } from '$lib/services/orchestrator/agent-charter';

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

  it('shows the assistant name and the agent CLI title side by side on a leased pane', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();

    setSessionOwnerTask(sessionId!, 'task-1');
    setSessionAgentName(sessionId!, 'Iris');
    applyOscPaneTitle(sessionId!, 'Claude Code is ready');

    const session = get(sessions).find((entry) => entry.id === sessionId);
    // The assistant name (badge) and the CLI's OSC title (main heading) live in
    // separate fields, so both stay visible even while the pane is leased.
    expect(session?.agentName).toBe('Iris');
    expect(session?.paneTitle).toBe('Claude Code is ready');
  });
});

describe('reattach history replay', () => {
  const projectId = 'project-reattach-replay';

  beforeEach(() => {
    setActiveTerminalProject(projectId);
  });

  afterEach(async () => {
    await killAllSessions();
    setActiveTerminalProject(null);
  });

  it('parks replayed history in the session buffer without touching live data callbacks', async () => {
    const backendId = 987;
    const sessionId = await attachTerminalSession(backendId, null, undefined, projectId);
    expect(sessionId).toBe(backendId);

    const liveCallback = vi.fn();
    registerDataCallback(backendId, liveCallback);

    // History replayed on reattach contains the agent's past terminal queries
    // (e.g. Codex's OSC 10/11 color probes). It must reach the session buffer
    // (so TerminalPane can write it through the gated path) but must NOT flow
    // through the live data callbacks — that would re-feed the queries to a
    // live xterm, whose re-answers land in Codex's input as `]10;rgb:…` junk.
    const replay = ptyReplayHandlers.get(backendId);
    expect(replay).toBeDefined();
    replay!(new TextEncoder().encode('\x1b]10;?\x07codex history'));

    expect(getSessionOutputBuffer(backendId)).toContain('codex history');
    expect(liveCallback).not.toHaveBeenCalled();

    // Genuinely live output still flows through the callback as before.
    feedPtyOutput(backendId, 'live output');
    expect(liveCallback).toHaveBeenCalledTimes(1);
    expect(getSessionOutputBuffer(backendId)).toContain('live output');

    unregisterDataCallback(backendId);
  });
});

describe('agent prompt paste-echo detection', () => {
  const PROMPT = 'Explain how the auth flow works';

  it('does not fire on ambient TUI redraw before the paste lands', () => {
    const base = '\x1b[2K\x1b[1G> \x1b[7m \x1b[27m';
    // The status bar redrew (spinner/token counter ticked) but the pasted text
    // has not yet been committed to the composer — this is the exact noise that
    // tripped the old length-delta heuristic and submitted an empty composer.
    const afterRedraw = base + '\x1b[2K\x1b[1GOpus 4 (1M context) | [....] | 0% | 0 /';
    expect(pasteEchoLanded(base, afterRedraw, PROMPT)).toBe(false);
  });

  it('fires once the pasted text is echoed into the composer', () => {
    const base = '\x1b[2K\x1b[1G> ';
    // Claude Code redraws the input box with the pasted text, wrapped in ANSI.
    const withEcho =
      base + `\x1b[2K\x1b[1G\x1b[38;5;245m│\x1b[0m > ${PROMPT}\x1b[7m \x1b[27m`;
    expect(pasteEchoLanded(base, withEcho, PROMPT)).toBe(true);
  });

  it('treats a prompt identical to earlier output as newly echoed', () => {
    // The same prompt was sent before (still in scrollback); a fresh echo must
    // still register, so we compare occurrence counts rather than presence.
    const base = `previously: ${PROMPT}\n> `;
    const withEcho = `${base}\x1b[1G> ${PROMPT}`;
    expect(pasteEchoLanded(base, withEcho, PROMPT)).toBe(true);
  });

  it('matches across reflowed whitespace/newlines in the redraw', () => {
    const base = '> ';
    // A line wrap split the echo across rows; normalization collapses it back.
    const wrapped = base + 'Explain how the\r\n  auth flow works';
    expect(pasteEchoLanded(base, wrapped, PROMPT)).toBe(true);
  });

  it('normalizes ANSI and whitespace to the bare text', () => {
    expect(normalizeForEchoMatch('\x1b[1m\x1b[32mhello\x1b[0m   world\r\n')).toBe('hello world');
  });

  it('returns false for empty prompt text', () => {
    expect(pasteEchoLanded('anything', 'anything more', '')).toBe(false);
  });

  it('fires on a collapsed paste placeholder when the text is not echoed literally', () => {
    // Claude Code collapses multi-line pastes — the literal text never appears,
    // only "[Pasted text #N +M lines]". That placeholder must count as the echo.
    const base = '\x1b[2K\x1b[1G> ';
    const withPlaceholder = base + '\x1b[2K\x1b[1G> [Pasted text #1 +6 lines]\x1b[7m \x1b[27m';
    expect(pasteEchoLanded(base, withPlaceholder, 'SORYQ AGENT BRIEF\nline two\nline three')).toBe(true);
  });

  it('does not fire on a placeholder left over from an earlier paste', () => {
    const base = '> [Pasted text #1 +6 lines] sent earlier\n> ';
    const afterRedraw = base + '\x1b[2K\x1b[1GOpus 4 | [....] | 0%';
    expect(pasteEchoLanded(base, afterRedraw, 'A brand new prompt that is not echoed')).toBe(false);
  });
});

describe('sendAgentPromptDirect', () => {
  const projectId = 'project-terminal-direct';

  beforeEach(() => {
    setActiveTerminalProject(projectId);
  });

  afterEach(async () => {
    await killAllSessions();
    setActiveTerminalProject(null);
  });
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  it('delivers prompt using bracketed paste for Codex as preset', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();
    markSessionAgentPreset(sessionId!, 'codex', true); // Skip auto-brief

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;

    writeSpy.mockClear();

    const multilinePrompt = 'Line 1\nLine 2\nLine 3';
    const result = await sendAgentPromptDirect(sessionId!, multilinePrompt);

    expect(result).toBe(true);
    // Newlines are converted to \r inside the paste body — that's what a real
    // terminal paste delivers, and what every composer is tested against.
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('\x1b[200~Line 1\rLine 2\rLine 3\x1b[201~'));
  });

  it('delivers Claude charter prompts as one bracketed multi-line paste payload', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();
    markSessionAgentPreset(sessionId!, 'claude', true);

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;
    writeSpy.mockClear();

    const charter = buildAgentCharter('Fix the failing tests', { name: 'Iris' });
    const result = await sendAgentPromptDirect(sessionId!, charter);

    expect(result).toBe(true);
    const pasteWrite = writeSpy.mock.calls.find((call: unknown[]) => typeof call[0] === 'string' && call[0].includes('SORYQ AGENT BRIEF'));
    expect(pasteWrite).toBeDefined();
    const payload = pasteWrite![0] as string;
    expect(payload).toContain('\x1b[200~');
    expect(payload).toContain('\x1b[201~');
    expect(payload).toContain('\r');
    expect(payload).toContain('YOUR TASK (untrusted task text');
    expect(payload).toContain('Fix the failing tests');
  });

  it('uses the same one-payload charter delivery for OpenCode and Antigravity aliases', async () => {
    for (const preset of ['opencode', 'agy', 'antigravity']) {
      const sessionId = await createTerminalSession(undefined, undefined, projectId);
      expect(sessionId).not.toBeNull();
      markSessionAgentPreset(sessionId!, preset, true);

      const callCount = vi.mocked(openPty).mock.results.length;
      const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
      const writeSpy = mockPty.write;
      writeSpy.mockClear();

      await sendAgentPromptDirect(sessionId!, buildAgentCharter('', { name: 'Rex' }));

      const pasteWrite = writeSpy.mock.calls.find((call: unknown[]) => typeof call[0] === 'string' && call[0].includes('SORYQ AGENT BRIEF'));
      expect(pasteWrite?.[0]).toContain('\x1b[200~');
      expect(pasteWrite?.[0]).toContain('\x1b[201~');
      expect(pasteWrite?.[0]).toContain('you are Rex');
    }
  });
});

describe('agent launch failure detection', () => {
  const projectId = 'project-terminal-launch-fail';

  beforeEach(() => {
    setActiveTerminalProject(projectId);
  });

  afterEach(async () => {
    await killAllSessions();
    setActiveTerminalProject(null);
  });

  it('reports launch-failed when the shell does not recognize the agent command', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();
    markSessionAgentPreset(sessionId!, 'opencode', true);

    const readiness = waitForAgentReady(sessionId!);
    // PowerShell rejects the command — wrapped mid-word, as narrow terminals do.
    feedPtyOutput(
      sessionId!,
      "opencode : The term 'opencode' is not recognized as the name of a \r\ncmdlet, function, script file, or operable program.\r\n    + FullyQualifiedErrorId : Co\r\n   mmandNotFoundException\r\n"
    );
    expect(await readiness).toBe('launch-failed');
  });

  it('stays ready when the CLI takes over the terminal normally', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();
    markSessionAgentPreset(sessionId!, 'codex', true);

    const readiness = waitForAgentReady(sessionId!);
    feedPtyOutput(sessionId!, 'codex\r\n\x1b[?1049h welcome to codex');
    expect(await readiness).toBe('ready');
  });

  it('treats an already-rendered agent banner as ready', async () => {
    const sessionId = await spawnAgentPreset('claude', undefined, { skipAutoBrief: true });
    expect(sessionId).not.toBeNull();

    feedPtyOutput(
      sessionId!,
      `Claude Code v2.1.172\nWelcome back samuel!\n${'Fable 5 is here. '.repeat(40)}\n> `
    );

    expect(await waitForAgentReady(sessionId!)).toBe('ready');
  });
});

describe('unified agent briefing', () => {
  const projectId = 'project-terminal-briefing';
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    setActiveTerminalProject(projectId);
  });

  afterEach(async () => {
    await killAllSessions();
    setActiveTerminalProject(null);
  });

  it('automatically briefs manually launched agents', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;
    writeSpy.mockClear();

    // Set preset without briefed flag — triggers auto-brief
    markSessionAgentPreset(sessionId!, 'claude');

    // Wait for auto-brief async task to finish (timeout is short in test env)
    await sleep(350);

    // Verify it sent the brief to the PTY
    expect(writeSpy).toHaveBeenCalled();
    const pastedText = writeSpy.mock.calls.find((call: unknown[]) => typeof call[0] === 'string' && call[0].includes('SORYQ AGENT BRIEF'));
    expect(pastedText).toBeDefined();

    const session = get(sessions).find(s => s.id === sessionId);
    expect(session?.briefed).toBe(true);
  });

  it('skips auto-briefing if skipAutoBrief is true', async () => {
    const sessionId = await spawnAgentPreset('claude', undefined, { skipAutoBrief: true });
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;
    writeSpy.mockClear();

    // Wait to make sure no auto-brief fires
    await sleep(350);

    const calls = writeSpy.mock.calls.map((c: unknown[]) => c[0]);
    const hasBrief = calls.some((c: unknown) => typeof c === 'string' && c.includes('SORYQ AGENT BRIEF'));
    expect(hasBrief).toBe(false);

    const session = get(sessions).find(s => s.id === sessionId);
    expect(session?.briefed).toBe(true);
  });

  it('re-briefs an agent relaunched in a previously-briefed pane', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;
    writeSpy.mockClear();

    markSessionAgentPreset(sessionId!, 'claude');
    await sleep(350);
    expect(writeSpy.mock.calls.some((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SORYQ AGENT BRIEF'))).toBe(true);

    // The agent exits and the user launches it again in the same pane — input
    // detection re-marks the preset, which must reset `briefed` and send the
    // charter to the new process too.
    writeSpy.mockClear();
    markSessionAgentPreset(sessionId!, 'claude');
    await sleep(350);
    expect(writeSpy.mock.calls.some((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SORYQ AGENT BRIEF'))).toBe(true);

    const session = get(sessions).find(s => s.id === sessionId);
    expect(session?.briefed).toBe(true);
  });

  it('briefs a plain spawnAgentPreset exactly once', async () => {
    const sessionId = await spawnAgentPreset('claude', undefined);
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;

    await sleep(350);

    // The spawn's own `claude\r` launch write must not re-trigger detection and
    // double-deliver the charter.
    const briefWrites = writeSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('SORYQ AGENT BRIEF')
    );
    expect(briefWrites).toHaveLength(1);

    const session = get(sessions).find(s => s.id === sessionId);
    expect(session?.briefed).toBe(true);
  });

  it('includes the assigned assistant name in the auto-brief charter', async () => {
    const sessionId = await spawnAgentPreset('claude', undefined);
    expect(sessionId).not.toBeNull();
    // Name applied right after spawn (as the floating-bar "+" does) — the brief
    // is built at send time, so the charter must open with the name.
    setSessionAgentName(sessionId!, 'Iris');

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;

    await sleep(350);

    const brief = writeSpy.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SORYQ AGENT BRIEF')
    );
    expect(brief).toBeDefined();
    expect(brief![0]).toContain('you are Iris');
  });

  it('rides the charter along with the first prompt to a not-yet-briefed agent', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();

    // Lease the pane purely to suppress the readiness-gated auto-brief, so this
    // test isolates the prompt path: an agent the user drives before any brief
    // has landed (briefed === false). The lease doesn't affect sendPromptToSession.
    setSessionOwnerTask(sessionId!, 'lease-suppress-autobrief');
    markSessionAgentPreset(sessionId!, 'claude');
    setSessionAgentName(sessionId!, 'Iris');
    await sleep(100);

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;
    writeSpy.mockClear();

    // First prompt: the brief must ride along, wrapped around the task.
    sendPromptToSession(sessionId!, 'Fix the failing tests', 'claude');
    await sleep(100);

    const firstPaste = writeSpy.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SORYQ AGENT BRIEF')
    );
    expect(firstPaste).toBeDefined();
    expect(firstPaste![0]).toContain('you are Iris');
    expect(firstPaste![0]).toContain('Fix the failing tests');
    expect(get(sessions).find((s) => s.id === sessionId)?.briefed).toBe(true);

    // Second prompt: already briefed, so it goes raw — no charter re-injected.
    writeSpy.mockClear();
    sendPromptToSession(sessionId!, 'Now add a test', 'claude');
    await sleep(100);

    const reBriefed = writeSpy.mock.calls.some(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SORYQ AGENT BRIEF')
    );
    expect(reBriefed).toBe(false);
    const secondPaste = writeSpy.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Now add a test')
    );
    expect(secondPaste).toBeDefined();
  });

  it('skips auto-briefing if session is leased by orchestrator task', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;
    writeSpy.mockClear();

    // Mark as preset and lease it immediately before the auto-brief ready timeout completes
    markSessionAgentPreset(sessionId!, 'claude');
    setSessionOwnerTask(sessionId!, 'task-123');

    await sleep(350);

    const calls = writeSpy.mock.calls.map((c: unknown[]) => c[0]);
    const hasBrief = calls.some((c: unknown) => typeof c === 'string' && c.includes('SORYQ AGENT BRIEF'));
    expect(hasBrief).toBe(false);

    const session = get(sessions).find(s => s.id === sessionId);
    expect(session?.briefed).toBeFalsy();
  });
});

describe('rules-file brief delivery', () => {
  const projectId = 'project-terminal-rules-file';
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    setActiveTerminalProject(projectId);
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await killAllSessions();
    setActiveTerminalProject(null);
  });

  it('briefs a rules-file agent via CLAUDE.md/AGENTS.md and skips the REPL paste', async () => {
    const sessionId = await spawnAgentPreset('claude', '/repo');
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;

    await sleep(350);

    // The standing brief was written to rules files, not pasted into the REPL.
    const writtenPaths = invokeMock.mock.calls
      .filter((c: unknown[]) => c[0] === 'fs_write_file')
      .map((c: unknown[]) => (c[1] as { path: string }).path);
    expect(writtenPaths).toContain('/repo/CLAUDE.md');
    expect(writtenPaths).toContain('/repo/AGENTS.md');

    const pasted = writeSpy.mock.calls.some(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SORYQ AGENT BRIEF')
    );
    expect(pasted).toBe(false);

    const session = get(sessions).find((s) => s.id === sessionId);
    expect(session?.briefed).toBe(true);
  });

  it('sends the first prompt raw (no charter wrap) once briefed via rules file', async () => {
    const sessionId = await spawnAgentPreset('claude', '/repo');
    expect(sessionId).not.toBeNull();
    await sleep(50);

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;
    writeSpy.mockClear();

    sendPromptToSession(sessionId!, 'Fix the failing tests', 'claude');
    await sleep(50);

    const pasted = writeSpy.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('Fix the failing tests')
    );
    expect(pasted).toBeDefined();
    // The brief lives in the rules file now, so the prompt is not re-wrapped.
    expect(pasted![0] as string).not.toContain('SORYQ AGENT BRIEF');
  });

  it('briefs a typed-launch agent via the registered project root when it has no explicit cwd', async () => {
    // Mirrors the user typing `claude` into a shell opened without a cwd: the
    // session has no cwd, but the project root was registered when the project
    // opened, so the rules file still resolves and the paste is skipped. Uses a
    // dedicated project id so the registered root can't leak into other tests.
    const typedProjectId = 'project-terminal-rules-typed';
    setActiveTerminalProject(typedProjectId);
    setTerminalProjectRoot(typedProjectId, '/repo-typed');
    const sessionId = await createTerminalSession(undefined, undefined, typedProjectId);
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;
    writeSpy.mockClear();

    markSessionAgentPreset(sessionId!, 'claude');
    await sleep(350);

    const writtenPaths = invokeMock.mock.calls
      .filter((c: unknown[]) => c[0] === 'fs_write_file')
      .map((c: unknown[]) => (c[1] as { path: string }).path);
    expect(writtenPaths).toContain('/repo-typed/CLAUDE.md');
    expect(writtenPaths).toContain('/repo-typed/AGENTS.md');

    const pasted = writeSpy.mock.calls.some(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SORYQ AGENT BRIEF')
    );
    expect(pasted).toBe(false);

    const session = get(sessions).find((s) => s.id === sessionId);
    expect(session?.briefed).toBe(true);
  });

  it('falls back to the paste brief for rules-file agents launched without a cwd', async () => {
    const sessionId = await spawnAgentPreset('claude', undefined);
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;

    await sleep(350);

    // No cwd → no rules file written → the legacy paste path delivers the brief.
    expect(invokeMock).not.toHaveBeenCalledWith('fs_write_file', expect.anything());
    const pasted = writeSpy.mock.calls.some(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SORYQ AGENT BRIEF')
    );
    expect(pasted).toBe(true);
  });

  it('still pastes the brief for non-rules agents (Pi) even with a cwd', async () => {
    const sessionId = await spawnAgentPreset('pi', '/repo');
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;

    await sleep(350);

    // Pi doesn't auto-load a rules file, so it keeps the paste delivery.
    const pasted = writeSpy.mock.calls.some(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SORYQ AGENT BRIEF')
    );
    expect(pasted).toBe(true);
    const session = get(sessions).find((s) => s.id === sessionId);
    expect(session?.briefed).toBe(true);
  });
});

describe('restored agent sessions', () => {
  const projectId = 'project-terminal-restore';
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    setActiveTerminalProject(projectId);
  });

  afterEach(async () => {
    await killAllSessions();
    setActiveTerminalProject(null);
  });

  it('relaunches a remembered agent without auto-sending the standing brief', async () => {
    const sessionId = await createTerminalSession(undefined, undefined, projectId);
    expect(sessionId).not.toBeNull();

    const callCount = vi.mocked(openPty).mock.results.length;
    const mockPty = await vi.mocked(openPty).mock.results[callCount - 1].value;
    const writeSpy = mockPty.write;
    writeSpy.mockClear();

    const relaunched = relaunchRestoredAgentSession(sessionId!, 'claude', {
      agentName: 'Iris',
      taskSummary: 'Continue the saved workspace session',
    });

    expect(relaunched).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith('claude\r');

    await sleep(100);

    const calls = writeSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls.some((c: unknown) => typeof c === 'string' && c.includes('SORYQ AGENT BRIEF'))).toBe(false);

    const session = get(sessions).find((s) => s.id === sessionId);
    expect(session?.agentPreset).toBe('claude');
    expect(session?.agentName).toBe('Iris');
    expect(session?.taskSummary).toBe('Continue the saved workspace session');
    expect(session?.briefed).toBe(false);
  });
});

