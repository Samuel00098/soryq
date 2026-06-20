// Activity log for orchestrator tasks: a durable record of what each agent did.
//
// Two complementary layers:
//   1. A structured event timeline (`ActivityEvent[]`) — the clean, human-facing
//      summary of lifecycle moments the orchestrator observes (dispatched, goal
//      sent, finished, blocked, approved, …).
//   2. A verbatim terminal transcript — the agent's raw PTY output, ANSI-stripped
//      and normalized into readable text, so you can see exactly what it printed.
//
// Both are pure and live here so they can be unit-tested and reused by the store
// and the panel without dragging in terminal dependencies.

export type ActivityKind =
  | 'dispatch'
  | 'goal'
  | 'follow-up'
  | 'finished'
  | 'review'
  | 'blocked'
  | 'approved'
  | 'changes'
  | 'cancelled'
  | 'failed'
  | 'released'
  | 'info';

export interface ActivityEvent {
  id: string;
  ts: number;
  kind: ActivityKind;
  text: string;
}

/** Keep the timeline bounded so persistence stays small. */
export const MAX_ACTIVITY_EVENTS = 80;
/** Cap a stored transcript snapshot (keep the most recent tail). */
export const MAX_TRANSCRIPT_CHARS = 12000;

export function makeActivityEvent(kind: ActivityKind, text: string, ts: number = Date.now()): ActivityEvent {
  return {
    id: `ae_${ts}_${Math.random().toString(36).slice(2, 7)}`,
    ts,
    kind,
    text: text.trim(),
  };
}

/** Append an event to a (possibly undefined) log, returning a new capped array. */
export function appendActivity(
  log: ActivityEvent[] | undefined | null,
  event: ActivityEvent,
  max: number = MAX_ACTIVITY_EVENTS
): ActivityEvent[] {
  const next = [...(log ?? []), event];
  return next.length > max ? next.slice(-max) : next;
}

// ─── Terminal transcript normalization ────────────────────────────────────────

// OSC (operating system command) strings: `ESC ] … (BEL | ESC \)`. Agents use
// these for window/title sequences; drop them entirely.
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// DCS/PM/APC/SOS string sequences: `ESC (P|X|^|_) … ST`.
const ANSI_STRING = /\x1b[PX^_][\s\S]*?(?:\x1b\\|\x07)/g;
// CSI sequences: `ESC [ … final-byte` (colors, cursor moves, erases, …).
const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// Two/three-char escapes like `ESC ( B` (charset) and lone single escapes.
const ANSI_CHARSET = /\x1b[()][0-9A-Za-z]/g;
const ANSI_SINGLE = /\x1b[@-Z\\-_=>]/g;
// Remaining C0 control chars except TAB (09), LF (0a), CR (0d).
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Turn a raw PTY byte-stream (as decoded text) into a readable transcript:
 * strip ANSI/VT control sequences, resolve carriage-return overwrites, and
 * collapse the redraw noise that TUI agents emit, while preserving the text the
 * agent actually printed.
 */
export function stripTerminalOutput(raw: string): string {
  if (!raw) return '';

  let s = raw
    .replace(ANSI_OSC, '')
    .replace(ANSI_STRING, '')
    .replace(ANSI_CSI, '')
    .replace(ANSI_CHARSET, '')
    .replace(ANSI_SINGLE, '');

  // Within a physical line a carriage return moves the cursor back to column 0,
  // so later text overwrites earlier text — keep the content after the last CR.
  const lines = s.split('\n').map((line) => {
    if (line.indexOf('\r') === -1) return line.replace(CONTROL, '');
    const parts = line.split('\r');
    return parts[parts.length - 1].replace(CONTROL, '');
  });

  // Drop trailing whitespace, collapse runs of consecutive identical lines
  // (progress spinners / repeated redraws), and squeeze blank-line runs.
  const cleaned: string[] = [];
  for (const line of lines) {
    const trimmed = line.replace(/[ \t]+$/g, '');
    if (trimmed && cleaned.length > 0 && cleaned[cleaned.length - 1] === trimmed) continue;
    cleaned.push(trimmed);
  }

  return cleaned
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Snapshot a transcript from raw terminal output: normalize, then keep the most
 * recent `maxChars` (the tail is what matters for "what the agent just did"),
 * marking truncation.
 */
export function captureTranscript(raw: string, maxChars: number = MAX_TRANSCRIPT_CHARS): string {
  const text = stripTerminalOutput(raw);
  if (text.length <= maxChars) return text;
  // Slice from a line boundary so we don't start mid-line.
  const tail = text.slice(-maxChars);
  const nl = tail.indexOf('\n');
  const aligned = nl > 0 && nl < 200 ? tail.slice(nl + 1) : tail;
  return `…\n${aligned}`;
}
