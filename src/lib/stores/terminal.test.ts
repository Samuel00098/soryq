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
  applyOscPaneTitle,
  commandBlocks,
  createTerminalSession,
  finalizeCommandBlockWithExit,
  killAllSessions,
  markSessionAgentPreset,
  normalizeForEchoMatch,
  pasteEchoLanded,
  sessions,
  setActiveTerminalProject,
  setSessionAgentName,
  setSessionOwnerTask,
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
});
