import { writable, get } from 'svelte/store';
import { openPty, type PtySession } from '$lib/services/pty-bridge';
import { terminalShell } from '$lib/stores/settings';
import { showToast } from '$lib/stores/notification';

export type TerminalSessionInfo = {
  id: number;
  projectId: string;
  title: string;
  isRunning: boolean;
  isExecuting?: boolean;
  agentPreset?: string | null;
  lastActivatedAt?: number;
  role?: string | null;
  cwd?: string | null;
  taskSummary?: string | null;
};

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  codex: 'Codex CLI',
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  aider: 'Aider',
  agy: 'AGY',
  opencode: 'OpenCode',
  pi: 'Pi',
  antigravity: 'Antigravity',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
};

export type GridLayout = 'single' | '2h' | '2v' | '3h' | '3v' | '4' | '9';

export const sessions = writable<TerminalSessionInfo[]>([]);
export const activeSessionId = writable<number | null>(null);

export type TerminalInputRequest = {
  sessionId: number;
  text: string;
};

export const terminalInputRequest = writable<TerminalInputRequest | null>(null);

export function requestTerminalInput(sessionId: number, text: string) {
  if (!text || text.trim() === '') return;
  terminalInputRequest.set({ sessionId, text });
}

// Inject text directly into the FloatingPromptBar textarea
export const promptBarInput = writable<string | null>(null);

// Inject an image directly into the FloatingPromptBar as an image chip
export const promptBarImage = writable<{ dataUrl: string; name: string } | null>(null);

// Command history store, persisted in localStorage
export const commandHistory = writable<string[]>(
  typeof window !== 'undefined'
    ? (() => {
        try {
          const parsed = JSON.parse(localStorage.getItem('forge_terminal_history') || '[]');
          return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') ? parsed : [];
        } catch { return []; }
      })()
    : []
);

if (typeof window !== 'undefined') {
  commandHistory.subscribe((history) => {
    localStorage.setItem('forge_terminal_history', JSON.stringify(history));
  });
}

export function addHistoryEntry(cmd: string) {
  if (!cmd || cmd.trim() === '') return;
  if (cmd.length > 4096) return; // skip unusually long inputs (e.g. pasted blobs)
  commandHistory.update((hist) => {
    const filtered = hist.filter((x) => x !== cmd);
    return [cmd, ...filtered].slice(0, 100);
  });
}

// Grid layout: which format is the terminal area in
export const gridLayout = writable<GridLayout>('single');

// Which session IDs occupy each pane slot (null = empty/new terminal slot)
export const paneAssignments = writable<(number | null)[]>([null]);

// Which pane index is focused (receives keyboard)
export const activePaneIndex = writable<number>(0);

type TerminalProjectState = {
  sessions: TerminalSessionInfo[];
  activeSessionId: number | null;
  gridLayout: GridLayout;
  paneAssignments: (number | null)[];
  activePaneIndex: number;
};

function createDefaultProjectState(): TerminalProjectState {
  return {
    sessions: [],
    activeSessionId: null,
    gridLayout: 'single',
    paneAssignments: [null],
    activePaneIndex: 0,
  };
}

function cloneProjectState(state: TerminalProjectState): TerminalProjectState {
  return {
    sessions: state.sessions.map((session) => ({ ...session })),
    activeSessionId: state.activeSessionId,
    gridLayout: state.gridLayout,
    paneAssignments: [...state.paneAssignments],
    activePaneIndex: state.activePaneIndex,
  };
}

const terminalProjectStates = new Map<string, TerminalProjectState>();
const terminalSessionProjects = new Map<number, string>();
let activeTerminalProjectId: string | null = null;

function getProjectState(projectId: string): TerminalProjectState {
  const existing = terminalProjectStates.get(projectId);
  if (existing) return existing;
  const created = createDefaultProjectState();
  terminalProjectStates.set(projectId, created);
  return created;
}

function setVisibleProjectState(state: TerminalProjectState) {
  sessions.set(state.sessions.map((session) => ({ ...session })));
  activeSessionId.set(state.activeSessionId);
  gridLayout.set(state.gridLayout);
  paneAssignments.set([...state.paneAssignments]);
  activePaneIndex.set(state.activePaneIndex);
}

function updateProjectState(projectId: string, updater: (state: TerminalProjectState) => TerminalProjectState) {
  const next = updater(cloneProjectState(getProjectState(projectId)));
  terminalProjectStates.set(projectId, next);
  if (projectId === activeTerminalProjectId) {
    setVisibleProjectState(next);
  }
}

export function setActiveTerminalProject(projectId: string | null) {
  activeTerminalProjectId = projectId;
  if (!projectId) {
    setVisibleProjectState(createDefaultProjectState());
    return;
  }
  setVisibleProjectState(getProjectState(projectId));
}

export function getTerminalProjectState(projectId: string): TerminalProjectState {
  return cloneProjectState(getProjectState(projectId));
}

export function restoreTerminalProjectState(projectId: string, state: TerminalProjectState) {
  terminalProjectStates.set(projectId, cloneProjectState(state));
  if (activeTerminalProjectId === projectId) {
    setVisibleProjectState(getProjectState(projectId));
  }
}

const ptyInstances = new Map<number, PtySession>();
const dataCallbacks = new Map<number, (data: Uint8Array) => void>();
const exitCallbacks = new Map<number, (code: number) => void>();
const sessionOutputBuffers = new Map<number, string>();
const sessionOutputDecoders = new Map<number, TextDecoder>();
const sessionInputBuffers = new Map<number, string>();
const MAX_SESSION_BUFFER_CHARS = 250000;

const AGENT_COMMAND_PATTERNS: Array<{ preset: string; pattern: RegExp }> = [
  { preset: 'codex', pattern: /(?:^|\s)(?:codex)(?:\s|$)/i },
  { preset: 'claude', pattern: /(?:^|\s)(?:claude|claude-code)(?:\s|$)/i },
  { preset: 'opencode', pattern: /(?:^|\s)(?:opencode)(?:\s|$)/i },
  { preset: 'pi', pattern: /(?:^|\s)(?:pi)(?:\s|$)/i },
  { preset: 'antigravity', pattern: /(?:^|\s)(?:antigravity)(?:\s|$)/i },
  { preset: 'aider', pattern: /(?:^|\s)(?:aider)(?:\s|$)/i },
  { preset: 'gemini', pattern: /(?:^|\s)(?:gemini)(?:\s|$)/i },
  { preset: 'cursor', pattern: /(?:^|\s)(?:cursor|cursor-agent)(?:\s|$)/i },
  { preset: 'copilot', pattern: /(?:^|\s)(?:copilot)(?:\s|$)/i },
];

export function getLayoutPaneCount(layout: GridLayout): number {
  if (layout === 'single') return 1;
  if (layout === '3h' || layout === '3v') return 3;
  if (layout === '4') return 4;
  if (layout === '9') return 9;
  return 2;
}

export function setGridLayout(layout: GridLayout) {
  const projectId = activeTerminalProjectId;
  const count = getLayoutPaneCount(layout);
  if (!projectId) {
    gridLayout.set(layout);
    paneAssignments.update((current) => {
      const updated = [...current];
      while (updated.length < count) updated.push(null);
      return updated.slice(0, count);
    });
    activePaneIndex.update((i) => Math.min(i, count - 1));
    return;
  }

  updateProjectState(projectId, (state) => {
    const paneAssignments = [...state.paneAssignments];
    while (paneAssignments.length < count) paneAssignments.push(null);
    return {
      ...state,
      gridLayout: layout,
      paneAssignments: paneAssignments.slice(0, count),
      activePaneIndex: Math.min(state.activePaneIndex, count - 1),
    };
  });
}

export function assignToPane(paneIdx: number, sessionId: number | null) {
  const projectId = activeTerminalProjectId;
  if (!projectId) {
    paneAssignments.update((p) => {
      const copy = [...p];
      copy[paneIdx] = sessionId;
      return copy;
    });
    return;
  }

  updateProjectState(projectId, (state) => {
    const paneAssignments = [...state.paneAssignments];
    paneAssignments[paneIdx] = sessionId;
    return { ...state, paneAssignments };
  });
}

export function focusPane(paneIdx: number) {
  const projectId = activeTerminalProjectId;
  if (!projectId) {
    activePaneIndex.set(paneIdx);
    const panes = get(paneAssignments);
    if (panes[paneIdx] !== null) {
      activateSessionInPane(panes[paneIdx]!);
    }
    return;
  }

  updateProjectState(projectId, (state) => ({ ...state, activePaneIndex: paneIdx }));
  const panes = getProjectState(projectId).paneAssignments;
  if (panes[paneIdx] !== null) {
    activateSessionInPane(panes[paneIdx]!);
  }
}

export function setActiveSession(id: number) {
  activateSessionInPane(id);
}

export function activateSessionInPane(id: number) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;

  updateProjectState(projectId, (state) => {
    const idx = state.paneAssignments.indexOf(id);
    return {
      ...state,
      activePaneIndex: idx !== -1 ? idx : state.activePaneIndex,
      activeSessionId: id,
      sessions: state.sessions.map((session) => (
        session.id === id
          ? { ...session, lastActivatedAt: Date.now() }
          : session
      )),
    };
  });
}

export function registerDataCallback(id: number, cb: (data: Uint8Array) => void) {
  dataCallbacks.set(id, cb);
}

export function unregisterDataCallback(id: number) {
  dataCallbacks.delete(id);
}

export function registerExitCallback(id: number, cb: (code: number) => void) {
  exitCallbacks.set(id, cb);
}

export function unregisterExitCallback(id: number) {
  exitCallbacks.delete(id);
}

function detectAgentPresetFromCommand(command: string): string | null {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return null;

  for (const { preset, pattern } of AGENT_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) return preset;
  }

  return null;
}

function processSessionInputForAgentDetection(id: number, data: string) {
  let buffer = sessionInputBuffers.get(id) ?? '';
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') {
      const preset = detectAgentPresetFromCommand(buffer);
      if (preset) {
        markSessionAgentPreset(id, preset);
      }
      buffer = '';
      continue;
    }
    if (ch === '\b' || ch === '\u007f') {
      buffer = buffer.slice(0, -1);
      continue;
    }
    if (ch >= ' ') {
      buffer += ch;
      if (buffer.length > 512) {
        buffer = buffer.slice(-512);
      }
    }
  }
  sessionInputBuffers.set(id, buffer);
}

function appendSessionOutputBuffer(id: number, bytes: Uint8Array) {
  const decoder = sessionOutputDecoders.get(id) ?? new TextDecoder();
  sessionOutputDecoders.set(id, decoder);
  const text = decoder.decode(bytes, { stream: true });
  if (!text) return;
  const next = (sessionOutputBuffers.get(id) ?? '') + text;
  sessionOutputBuffers.set(id, next.length > MAX_SESSION_BUFFER_CHARS ? next.slice(-MAX_SESSION_BUFFER_CHARS) : next);
}

export function getSessionOutputBuffer(id: number): string {
  return sessionOutputBuffers.get(id) ?? '';
}

export async function createTerminalSession(cwd?: string, targetPaneIndex?: number, projectId?: string): Promise<number | null> {
  try {
    let pty: PtySession;
    const owningProjectId = projectId ?? activeTerminalProjectId;
    if (!owningProjectId) {
      console.warn('Cannot create terminal session without an active project');
      return null;
    }

    const ptyPromise = openPty(80, 24, {
      onData: (bytes) => {
        appendSessionOutputBuffer(pty.id, bytes);
        const cb = dataCallbacks.get(pty.id);
        cb?.(bytes);
      },
      onExit: (code) => {
        const sessionProjectId = terminalSessionProjects.get(pty.id) ?? owningProjectId;
        const state = getProjectState(sessionProjectId);
        const session = state.sessions.find((x) => x.id === pty.id);
        exitCallbacks.get(pty.id)?.(code);
        updateProjectState(sessionProjectId, (current) => ({
          ...current,
          sessions: current.sessions.map((x) => (x.id === pty.id ? { ...x, isRunning: false } : x)),
        }));
        const visibleSessions = sessionProjectId === activeTerminalProjectId ? get(sessions) : state.sessions;
        const label = session ? getSessionLabel(session, visibleSessions) : `Terminal ${pty.id}`;
        const isAgent = isAgentSession(session);
        const clean = code === 0;

        if (isAgent) {
          if (clean) {
            showToast(`${label} finished its work`, 'success', 6000, true);
          } else {
            showToast(`${label} exited with errors (code ${code})`, 'error', 8000, true);
          }
        } else if (!clean) {
          showToast(`${label} process died (exit ${code})`, 'error', 6000, true);
        } else {
          showToast(`${label} closed`, 'info', 3000, true);
        }
      },
    }, cwd, get(terminalShell) || undefined);

    pty = await ptyPromise;
    ptyInstances.set(pty.id, pty);
    terminalSessionProjects.set(pty.id, owningProjectId);

    const sessionNum = getProjectState(owningProjectId).sessions.length + 1;
    const info: TerminalSessionInfo = {
      id: pty.id,
      projectId: owningProjectId,
      title: `Terminal ${sessionNum}`,
      isRunning: true,
      lastActivatedAt: Date.now(),
    };

    updateProjectState(owningProjectId, (state) => ({
      ...state,
      sessions: [...state.sessions, info],
      activeSessionId: pty.id,
    }));

    updateProjectState(owningProjectId, (state) => {
      const paneAssignments = [...state.paneAssignments];
      let nextActivePaneIndex = state.activePaneIndex;
      if (targetPaneIndex !== undefined && targetPaneIndex >= 0) {
        while (paneAssignments.length <= targetPaneIndex) paneAssignments.push(null);
        paneAssignments[targetPaneIndex] = pty.id;
        nextActivePaneIndex = targetPaneIndex;
      } else {
        const emptyIdx = paneAssignments.findIndex((p) => p === null);
        if (emptyIdx !== -1) {
          paneAssignments[emptyIdx] = pty.id;
          nextActivePaneIndex = emptyIdx;
        } else {
          const activeIdx = Math.min(state.activePaneIndex, paneAssignments.length - 1);
          paneAssignments[activeIdx] = pty.id;
          nextActivePaneIndex = activeIdx;
        }
      }
      return {
        ...state,
        paneAssignments,
        activePaneIndex: nextActivePaneIndex,
      };
    });

    return pty.id;
  } catch (err) {
    console.error('Failed to create terminal session:', err);
    return null;
  }
}

export function writeToSession(id: number, data: string) {
  const pty = ptyInstances.get(id);
  if (pty) {
    processSessionInputForAgentDetection(id, data);
    pty.write(data).catch((err) => console.error('Failed to write to terminal:', err));
  }
}

export function setSessionExecuting(id: number, executing: boolean) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => (x.id === id ? { ...x, isExecuting: executing } : x)),
  }));
}

export function markSessionAgentPreset(id: number, agentPreset: string | null) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => {
      if (x.id !== id) return x;
      if (!agentPreset) {
        // Clear agent: also remove the auto-assigned 'Agent' role if nothing custom was set
        return { ...x, agentPreset: null, role: x.role === 'Agent' ? null : x.role };
      }
      // Auto-assign 'Agent' role if the pane doesn't already have a custom role
      return { ...x, agentPreset, role: x.role ?? 'Agent' };
    }),
  }));
}

/**
 * Returns the display label for a session. When multiple sessions share the same
 * role (e.g. two "Agent" panes) they are numbered: "Agent 1", "Agent 2", etc.
 * Falls back to session.title when no role is set.
 */
export function getSessionLabel(session: TerminalSessionInfo, allSessions: TerminalSessionInfo[]): string {
  const role = session.role;
  if (!role) return session.title;
  const sameRole = allSessions.filter((s) => s.role === role);
  if (sameRole.length <= 1) return role;
  const idx = sameRole.findIndex((s) => s.id === session.id);
  return idx === -1 ? role : `${role} ${idx + 1}`;
}

export function setSessionRole(id: number, role: string | null) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => (x.id === id ? { ...x, role } : x)),
  }));
}

export function setSessionCwd(id: number, cwd: string | null) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => (x.id === id ? { ...x, cwd } : x)),
  }));
}

export function summarizeTerminalTask(text: string): string {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .trim();
  if (!normalized) return '';
  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] || normalized;
  const summary = firstSentence.trim();
  return summary.length > 72 ? `${summary.slice(0, 69)}...` : summary;
}

export function getAgentDisplayName(agentPreset: string | null | undefined): string | null {
  if (!agentPreset) return null;
  return AGENT_DISPLAY_NAMES[agentPreset] ?? agentPreset;
}

export function isAgentSession(session: TerminalSessionInfo | null | undefined): boolean {
  if (!session) return false;
  return Boolean(session.agentPreset);
}

function trimSummaryLine(line: string): string {
  const cleaned = line
    .replace(/^[\-*•]\s+/, '')
    .replace(/^[0-9]+\.\s+/, '')
    .replace(/^(summary|done|completed|result|final answer|answer|update)\s*:\s*/i, '')
    .trim();
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

export function summarizeAgentResponse(output: string, command?: string, agentPreset?: string | null): string {
  const clean = output
    .replace(/\x1b\[[0-9;]*[mGKHFABCDJrsu]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\r/g, '')
    .trim();
  if (!clean) return '';

  const lines = clean
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const shellNoise = /^(PS [A-Z]:\\|[A-Z]:\\.*>|[$#>])|^(warning|error):?\s*$/i;
  const promptEcho = command?.trim();
  const provider = (agentPreset ?? '').toLowerCase();

  const labeledSummaryPatterns =
    provider === 'claude'
      ? [/^summary\s*:/i, /^done\s*:/i, /^completed\s*:/i, /^result\s*:/i]
      : provider === 'codex'
        ? [/^summary\s*:/i, /^final answer\s*:/i, /^result\s*:/i, /^done\s*:/i]
        : provider === 'opencode'
          ? [/^summary\s*:/i, /^update\s*:/i, /^done\s*:/i, /^completed\s*:/i]
          : [/^summary\s*:/i, /^done\s*:/i, /^completed\s*:/i, /^result\s*:/i, /^final answer\s*:/i];

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (labeledSummaryPatterns.some((pattern) => pattern.test(line))) {
      return trimSummaryLine(line);
    }
  }

  if (provider === 'claude') {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (/^(here('| i)s|i('| a)m|implemented|updated|fixed|added|removed|changed)\b/i.test(line)) {
        return trimSummaryLine(line);
      }
    }
  }

  if (provider === 'codex') {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (/^(implemented|fixed|updated|added|removed|wired|moved|changed|done)\b/i.test(line)) {
        return trimSummaryLine(line);
      }
    }
  }

  if (provider === 'opencode') {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (/^(updated|implemented|completed|finished|created|refactored)\b/i.test(line)) {
        return trimSummaryLine(line);
      }
    }
  }

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let line = lines[i];
    if (!line) continue;
    if (promptEcho && line === promptEcho) continue;
    if (shellNoise.test(line)) continue;
    line = trimSummaryLine(line);
    if (line.length < 6) continue;
    return line;
  }

  const fallback = lines[lines.length - 1] ?? '';
  return trimSummaryLine(fallback);
}

export function setSessionTaskSummary(id: number, taskSummary: string | null) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => (x.id === id ? { ...x, taskSummary } : x)),
  }));
}

// ── Command Output Blocks ──────────────────────────────────────────────────

export type CommandBlock = {
  id: string;
  sessionId: number;
  command: string;
  startTime: number;
  endTime?: number;
  output: string;
  exitCode?: number;
  collapsed: boolean;
};

export const commandBlocks = writable<Map<number, CommandBlock[]>>(new Map());

export function startCommandBlock(sessionId: number, command: string) {
  const block: CommandBlock = {
    id: Math.random().toString(36).substring(2, 9),
    sessionId,
    command: command.trim(),
    startTime: Date.now(),
    output: '',
    collapsed: false,
  };
  commandBlocks.update((map) => {
    const copy = new Map(map);
    const list = copy.get(sessionId) ?? [];
    copy.set(sessionId, [...list, block].slice(-10));
    return copy;
  });
}

const _pendingBlockText = new Map<number, string>();
let _blockFlushTimer: ReturnType<typeof setTimeout> | null = null;

function _flushCommandBlockAppends() {
  _blockFlushTimer = null;
  if (_pendingBlockText.size === 0) return;
  const batch = new Map(_pendingBlockText);
  _pendingBlockText.clear();
  commandBlocks.update((map) => {
    let dirty = false;
    const copy = new Map(map);
    for (const [id, text] of batch) {
      const list = copy.get(id);
      if (!list || list.length === 0) continue;
      const last = list[list.length - 1];
      if (last.endTime !== undefined) continue;
      copy.set(id, [...list.slice(0, -1), { ...last, output: (last.output + text).slice(-4000) }]);
      dirty = true;
    }
    return dirty ? copy : map;
  });
}

export function appendToCommandBlock(sessionId: number, text: string) {
  _pendingBlockText.set(sessionId, (_pendingBlockText.get(sessionId) ?? '') + text);
  if (_blockFlushTimer === null) {
    _blockFlushTimer = setTimeout(_flushCommandBlockAppends, 300);
  }
}

export function finalizeCommandBlock(sessionId: number) {
  finalizeCommandBlockWithExit(sessionId);
}

export function finalizeCommandBlockWithExit(sessionId: number, exitCode?: number) {
  commandBlocks.update((map) => {
    const list = map.get(sessionId);
    if (!list || list.length === 0) return map;
    const last = list[list.length - 1];
    if (last.endTime !== undefined) return map;
    const copy = new Map(map);
    const updated = [...list.slice(0, -1), { ...last, endTime: Date.now(), exitCode, collapsed: true }];
    copy.set(sessionId, updated);
    return copy;
  });
}

export function toggleCommandBlockCollapse(sessionId: number, blockId: string) {
  commandBlocks.update((map) => {
    const list = map.get(sessionId);
    if (!list) return map;
    const copy = new Map(map);
    copy.set(sessionId, list.map((b) => b.id === blockId ? { ...b, collapsed: !b.collapsed } : b));
    return copy;
  });
}

export function findAvailablePaneForAgentRun() {
  const panes = get(paneAssignments);
  const activeIdx = get(activePaneIndex);
  const allSessions = get(sessions);

  for (let paneIdx = 0; paneIdx < panes.length; paneIdx += 1) {
    if (paneIdx === activeIdx) continue;
    const sessionId = panes[paneIdx];
    if (sessionId === null) return { paneIdx, sessionId: null as number | null };
    const session = allSessions.find((entry) => entry.id === sessionId);
    if (session?.isRunning && !isAgentSession(session)) {
      return { paneIdx, sessionId };
    }
  }

  const activeSessionId = panes[activeIdx];
  if (activeSessionId === null) {
    return { paneIdx: activeIdx, sessionId: null as number | null };
  }

  const activeSession = allSessions.find((entry) => entry.id === activeSessionId);
  if (activeSession?.isRunning && !isAgentSession(activeSession)) {
    return { paneIdx: activeIdx, sessionId: activeSessionId };
  }

  return null;
}

export function resizeSession(id: number, rows: number, cols: number) {
  const pty = ptyInstances.get(id);
  if (pty) {
    pty.resize(cols, rows).catch((err) => console.error('Failed to resize terminal:', err));
  }
}

export async function killAllSessions() {
  const ids = Array.from(ptyInstances.keys());
  await Promise.all(ids.map((id) => killSession(id)));
}

export async function killSession(id: number) {
  const projectId = terminalSessionProjects.get(id);
  const pty = ptyInstances.get(id);
  if (pty) {
    await pty.close().catch((err) => console.error('Failed to close terminal:', err));
    ptyInstances.delete(id);
  }
  dataCallbacks.delete(id);
  exitCallbacks.delete(id);
  sessionOutputBuffers.delete(id);
  sessionOutputDecoders.delete(id);
  sessionInputBuffers.delete(id);
  terminalSessionProjects.delete(id);

  if (projectId) {
    updateProjectState(projectId, (state) => {
      const sessions = state.sessions.filter((x) => x.id !== id);
      const paneAssignments = state.paneAssignments.map((p) => (p === id ? null : p));
      const activeSessionId = state.activeSessionId === id
        ? (sessions.length > 0 ? sessions[sessions.length - 1].id : null)
        : state.activeSessionId;
      return {
        ...state,
        sessions,
        paneAssignments,
        activeSessionId,
      };
    });
  } else {
    sessions.update((s) => s.filter((x) => x.id !== id));
    paneAssignments.update((panes) => panes.map((p) => (p === id ? null : p)));
    activeSessionId.update((active) => {
      if (active !== id) return active;
      const $sessions = get(sessions);
      return $sessions.length > 0 ? $sessions[$sessions.length - 1].id : null;
    });
  }
}

