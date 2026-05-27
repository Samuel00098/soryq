import { writable } from 'svelte/store';
import { loadJson } from '$lib/utils/storage';

export interface RunEntry {
  id: string;
  command: string;
  sessionId: number;
  sessionRole?: string | null;
  sessionLabel?: string | null;
  agentPreset?: string | null;
  projectId: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  output: string;
}

const STORAGE_KEY = 'soryq_run_history';
const MAX_ENTRIES = 200;

// Redact common secret patterns from command strings before persistence.
// Covers: curl -H "Authorization: Bearer TOKEN", --password VAL, TOKEN=val cmd
function scrubSecrets(cmd: string): string {
  return cmd
    .replace(/(-H\s+["'])([^"']*(?:authorization|x-api-key|x-auth-token|cookie|x-amz-security-token)[^"']*)(["'])/gi,
      (_, pre, _val, close) => {
        const colon = _val.indexOf(':');
        return colon >= 0 ? `${pre}${_val.slice(0, colon + 1)} [redacted]${close}` : `${pre}[redacted]${close}`;
      })
    .replace(/(--(?:password|passwd|token|secret|key|auth|api-key)\s+)\S+/gi, '$1[redacted]')
    .replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|AUTH)[A-Z0-9_]*)=\S+/g, '$1=[redacted]');
}

function load(): RunEntry[] {
  return loadJson(STORAGE_KEY, [] as RunEntry[]);
}

export const runHistory = writable<RunEntry[]>(load());

// Debounced localStorage flush — avoids a serialize+write on every terminal output chunk.
// appendRunOutput is called at terminal-output frequency; we only need durable persistence
// after the run ends, so a 2s flush window is invisible to the user.
let _storageFlushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleStorageFlush(val: RunEntry[]) {
  if (_storageFlushTimer !== null) return;
  _storageFlushTimer = setTimeout(() => {
    _storageFlushTimer = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(val.slice(-MAX_ENTRIES))); } catch {}
  }, 2000);
}

// Immediate flush used for non-frequent events (add, finalize, clear).
function flushNow(val: RunEntry[]) {
  if (_storageFlushTimer !== null) { clearTimeout(_storageFlushTimer); _storageFlushTimer = null; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(val.slice(-MAX_ENTRIES))); } catch {}
}

runHistory.subscribe(scheduleStorageFlush);

// Tracks the most recent run ID per sessionId so TerminalPane can finalize it
export const activeRunIds = new Map<number, string>();

export function addRunEntry(entry: Omit<RunEntry, 'id' | 'output'>): string {
  const id = `rh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  activeRunIds.set(entry.sessionId, id);
  const safeEntry = { ...entry, command: scrubSecrets(entry.command) };
  let latest: RunEntry[] = [];
  runHistory.update((all) => {
    latest = [...all, { ...safeEntry, id, output: '' }].slice(-MAX_ENTRIES);
    return latest;
  });
  flushNow(latest);
  return id;
}

// Batched output buffering — same pattern as appendToCommandBlock in terminal.ts.
// Collects text per run ID and flushes every 300ms to avoid a store.update+map on every chunk.
const _pendingOutput = new Map<string, string>();
let _outputFlushTimer: ReturnType<typeof setTimeout> | null = null;

function _flushOutputAppends() {
  _outputFlushTimer = null;
  if (_pendingOutput.size === 0) return;
  const batch = new Map(_pendingOutput);
  _pendingOutput.clear();
  runHistory.update((all) => {
    let dirty = false;
    const next = all.map((e) => {
      const text = batch.get(e.id);
      if (!text) return e;
      dirty = true;
      return { ...e, output: (e.output + text).slice(-4000) };
    });
    return dirty ? next : all;
  });
}

export function appendRunOutput(id: string, text: string) {
  _pendingOutput.set(id, (_pendingOutput.get(id) ?? '') + text);
  if (_outputFlushTimer === null) {
    _outputFlushTimer = setTimeout(_flushOutputAppends, 300);
  }
}

export function finalizeRunEntry(id: string, exitCode?: number) {
  // Flush any buffered output immediately before marking as done
  if (_pendingOutput.has(id)) {
    const text = _pendingOutput.get(id)!;
    _pendingOutput.delete(id);
    let latest: RunEntry[] = [];
    runHistory.update((all) => {
      latest = all.map((e) =>
        e.id === id ? { ...e, output: (e.output + text).slice(-4000), finishedAt: Date.now(), exitCode } : e
      );
      return latest;
    });
    flushNow(latest);
  } else {
    let latest: RunEntry[] = [];
    runHistory.update((all) => {
      latest = all.map((e) => e.id === id ? { ...e, finishedAt: Date.now(), exitCode } : e);
      return latest;
    });
    flushNow(latest);
  }
}

export function clearRunHistory() {
  runHistory.set([]);
  flushNow([]);
}
