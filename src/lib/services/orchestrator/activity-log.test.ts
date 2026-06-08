import { describe, it, expect } from 'vitest';
import {
  makeActivityEvent,
  appendActivity,
  stripTerminalOutput,
  captureTranscript,
  MAX_ACTIVITY_EVENTS,
  type ActivityEvent,
} from './activity-log';

describe('activity event log', () => {
  it('creates trimmed events with a stable shape', () => {
    const ev = makeActivityEvent('goal', '  do the thing  ', 1000);
    expect(ev.kind).toBe('goal');
    expect(ev.text).toBe('do the thing');
    expect(ev.ts).toBe(1000);
    expect(ev.id).toContain('ae_1000_');
  });

  it('appends onto an undefined log', () => {
    const log = appendActivity(undefined, makeActivityEvent('dispatch', 'launched'));
    expect(log).toHaveLength(1);
    expect(log[0].text).toBe('launched');
  });

  it('caps the log to the most recent events', () => {
    let log: ActivityEvent[] = [];
    for (let i = 0; i < MAX_ACTIVITY_EVENTS + 10; i += 1) {
      log = appendActivity(log, makeActivityEvent('info', `event ${i}`, i));
    }
    expect(log).toHaveLength(MAX_ACTIVITY_EVENTS);
    expect(log[0].text).toBe('event 10');
    expect(log[log.length - 1].text).toBe(`event ${MAX_ACTIVITY_EVENTS + 9}`);
  });
});

describe('stripTerminalOutput', () => {
  it('removes SGR color codes but keeps the text', () => {
    expect(stripTerminalOutput('\x1b[31mError:\x1b[0m boom')).toBe('Error: boom');
  });

  it('drops cursor-move and erase sequences', () => {
    expect(stripTerminalOutput('a\x1b[2Kb\x1b[1;5Hc')).toBe('abc');
  });

  it('drops OSC title sequences (BEL- and ST-terminated)', () => {
    expect(stripTerminalOutput('\x1b]0;my title\x07hello')).toBe('hello');
    expect(stripTerminalOutput('\x1b]0;my title\x1b\\hello')).toBe('hello');
  });

  it('resolves carriage-return overwrites within a line', () => {
    expect(stripTerminalOutput('loading...\rdone      ')).toBe('done');
  });

  it('collapses consecutive duplicate redraw lines', () => {
    const spinner = 'working\nworking\nworking\ndone';
    expect(stripTerminalOutput(spinner)).toBe('working\ndone');
  });

  it('squeezes runs of blank lines and trims', () => {
    expect(stripTerminalOutput('\n\n\na\n\n\n\nb\n\n\n')).toBe('a\n\nb');
  });

  it('strips the terminal bell', () => {
    expect(stripTerminalOutput('done\x07')).toBe('done');
  });

  it('returns empty for empty input', () => {
    expect(stripTerminalOutput('')).toBe('');
  });
});

describe('captureTranscript', () => {
  it('returns the full transcript when under the cap', () => {
    expect(captureTranscript('short output', 100)).toBe('short output');
  });

  it('keeps the tail and marks truncation when over the cap', () => {
    const raw = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const out = captureTranscript(raw, 40);
    expect(out.startsWith('…')).toBe(true);
    expect(out).toContain('line 49');
    expect(out).not.toContain('line 0\n');
  });
});
