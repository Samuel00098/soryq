import { writable, get } from 'svelte/store';
import { openPty, type PtySession } from '$lib/services/pty-bridge';
import { terminalShell } from '$lib/stores/settings';
import { showToast } from '$lib/stores/notification';

export type TerminalSessionInfo = {
  id: number;
  projectId: string;
  title: string;
  paneTitle?: string | null;
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
  aider: 'Aider',
  agy: 'AGY',
  opencode: 'OpenCode',
  pi: 'Pi',
  antigravity: 'Antigravity',
  cursor: 'Cursor',
  'oh-my-pi': 'Oh My Pi',
};

export type GridLayout = 'single' | '2h' | '2v' | '3h' | '3v' | '4' | '9';

export const sessions = writable<TerminalSessionInfo[]>([]);
export const activeSessionId = writable<number | null>(null);

// Session the floating prompt bar should target. Set whenever the user focuses a
// terminal pane (click / keyboard) so the bar follows the terminal in view, and
// from the bar's own target picker. null = no explicit target (fall back to auto).
export const manualPromptTargetId = writable<number | null>(null);

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

// Bumped to request the FloatingPromptBar focus its textarea (e.g. when handing
// a session off to the user for manual input).
export const promptBarFocusRequest = writable(0);
export function focusPromptBar() {
  promptBarFocusRequest.update((n) => n + 1);
}

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
  { preset: 'cursor', pattern: /(?:^|\s)(?:agent)(?:\s|$)/i },
  { preset: 'oh-my-pi', pattern: /(?:^|\s)(?:omp)(?:\s|$)/i },
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

export function swapPanes(from: number, to: number) {
  if (from === to) return;
  const projectId = activeTerminalProjectId;
  if (!projectId) {
    paneAssignments.update((p) => {
      const copy = [...p];
      if (from < 0 || to < 0 || from >= copy.length || to >= copy.length) return p;
      [copy[from], copy[to]] = [copy[to], copy[from]];
      return copy;
    });
    return;
  }

  updateProjectState(projectId, (state) => {
    const copy = [...state.paneAssignments];
    if (from < 0 || to < 0 || from >= copy.length || to >= copy.length) return state;
    [copy[from], copy[to]] = [copy[to], copy[from]];
    return { ...state, paneAssignments: copy };
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
    // Focusing a pane makes its terminal the prompt-bar target.
    manualPromptTargetId.set(panes[paneIdx]);
    return;
  }

  updateProjectState(projectId, (state) => ({ ...state, activePaneIndex: paneIdx }));
  const panes = getProjectState(projectId).paneAssignments;
  if (panes[paneIdx] !== null) {
    activateSessionInPane(panes[paneIdx]!);
  }
  // Focusing a pane makes its terminal the prompt-bar target.
  manualPromptTargetId.set(panes[paneIdx]);
}

export function setActiveSession(id: number) {
  activateSessionInPane(id);
  // Explicitly selecting a terminal makes it the prompt-bar target.
  manualPromptTargetId.set(id);
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

// Processes raw input sent to a session (manual keystrokes and programmatic
// writes alike) to (a) auto-detect when an AI agent CLI is launched and
// (b) flag the session as "executing" the moment a non-empty command is
// submitted. The executing flag is cleared by TerminalPane once the command's
// output goes idle, giving us a live "in use" signal for manually-typed
// commands — not just prompt-bar/agent runs.
function processSessionInput(id: number, data: string) {
  let buffer = sessionInputBuffers.get(id) ?? '';
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') {
      const command = buffer.trim();
      if (command) {
        const preset = detectAgentPresetFromCommand(buffer);
        if (preset) {
          markSessionAgentPreset(id, preset);
        }
        // A real command was just submitted — mark the shell busy so agent
        // runs won't target a terminal that's actively running something.
        setSessionExecuting(id, true);
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
      paneTitle: null,
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
          // No empty pane: append a new slot instead of overwriting the active
          // pane. Overwriting would orphan the session living there — it keeps
          // running but is rendered in no pane, so it can't be viewed or closed.
          // TerminalPanel reconciles the visual mosaic to cover the new slot.
          paneAssignments.push(pty.id);
          nextActivePaneIndex = paneAssignments.length - 1;
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
    processSessionInput(id, data);
    pty.write(data).catch((err) => console.error('Failed to write to terminal:', err));
  }
}

/**
 * Submit a standalone Enter to a session once a pending paste has been delivered
 * to its terminal. `requestTerminalInput` hands text to the TerminalPane, which
 * pastes it via xterm; that store value is cleared the moment a pane consumes
 * it. We wait for that clear (with a timeout fallback) before sending the Enter,
 * so a freshly-spawned pane that hasn't mounted yet still gets the keystroke in
 * the right order.
 */
function submitAfterPaste(sessionId: number, settleMs = 140, maxWaitMs = 4000) {
  const start = Date.now();
  const tick = () => {
    const req = get(terminalInputRequest);
    // Delivered once the pending request for this session has been cleared (a
    // mounted pane consumes it synchronously; a freshly-spawned one takes a beat).
    const delivered = req === null || req.sessionId !== sessionId;
    if (delivered || Date.now() - start >= maxWaitMs) {
      setTimeout(() => writeToSession(sessionId, '\r'), settleMs);
    } else {
      setTimeout(tick, 60);
    }
  };
  tick();
}

/**
 * Send a prompt to a session. For agent TUIs (any agent preset) the text is
 * bracketed-pasted first — keeping multi-line prompts intact and preventing the
 * REPL from swallowing the Enter — then submitted with a separate carriage
 * return. Plain shells get the command and its Enter together.
 */
export function sendPromptToSession(sessionId: number, text: string, agentPreset?: string | null) {
  if (!text) return;
  if (agentPreset) {
    requestTerminalInput(sessionId, text);
    submitAfterPaste(sessionId);
    return;
  }
  writeToSession(sessionId, `${text}\r`);
}

export function setSessionExecuting(id: number, executing: boolean) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => (x.id === id ? { ...x, isExecuting: executing } : x)),
  }));
}

export function updateSessionTitle(id: number, title: string) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) =>
      x.id === id ? { ...x, title } : x
    ),
  }));
}

export function setSessionPaneTitle(id: number, paneTitle: string | null) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) =>
      x.id === id ? { ...x, paneTitle } : x
    ),
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

export function getSessionPaneDisplayTitle(session: TerminalSessionInfo, allSessions: TerminalSessionInfo[]): string {
  const paneTitle = session.paneTitle?.trim();
  if (paneTitle) return paneTitle;

  const taskSummary = session.taskSummary?.trim();
  if (taskSummary) return taskSummary;

  return session.role ? getSessionLabel(session, allSessions) : session.title;
}

export function getSessionPaneSecondaryTitle(session: TerminalSessionInfo): string {
  const paneTitle = session.paneTitle?.trim();
  const taskSummary = session.taskSummary?.trim();
  if (!paneTitle || !taskSummary || paneTitle === taskSummary) return '';
  return taskSummary;
}

export function getSessionDisplayName(session: TerminalSessionInfo, allSessions: TerminalSessionInfo[]): string {
  const title = getSessionPaneDisplayTitle(session, allSessions);
  const agentName = getAgentDisplayName(session.agentPreset);
  if (!agentName) return title;
  return title.toLowerCase() === agentName.toLowerCase() ? title : `${agentName} · ${title}`;
}

export function getSessionPromptTargetLabel(session: TerminalSessionInfo, allSessions: TerminalSessionInfo[]): string {
  const agentName = getAgentDisplayName(session.agentPreset);
  if (!agentName) return getSessionLabel(session, allSessions);

  const sameAgentSessions = allSessions.filter(
    (entry) => entry.isRunning && entry.agentPreset === session.agentPreset
  );
  if (sameAgentSessions.length <= 1) return agentName;

  const idx = sameAgentSessions.findIndex((entry) => entry.id === session.id);
  return idx === -1 ? agentName : `${agentName} ${idx + 1}`;
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

function _flushCommandBlockAppendBatch(batch: Map<number, string>) {
  if (batch.size === 0) return;
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

function _flushCommandBlockAppends() {
  _blockFlushTimer = null;
  if (_pendingBlockText.size === 0) return;
  const batch = new Map(_pendingBlockText);
  _pendingBlockText.clear();
  _flushCommandBlockAppendBatch(batch);
}

function _flushCommandBlockAppendsForSession(sessionId: number) {
  const text = _pendingBlockText.get(sessionId);
  if (!text) return;
  _pendingBlockText.delete(sessionId);
  _flushCommandBlockAppendBatch(new Map([[sessionId, text]]));
  if (_pendingBlockText.size === 0 && _blockFlushTimer !== null) {
    clearTimeout(_blockFlushTimer);
    _blockFlushTimer = null;
  }
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
  _flushCommandBlockAppendsForSession(sessionId);

  commandBlocks.update((map) => {
    const list = map.get(sessionId);
    if (!list || list.length === 0) return map;
    const last = list[list.length - 1];
    if (last.endTime !== undefined) return map;
    const copy = new Map(map);
    const finalizedBlock = { ...last, endTime: Date.now(), exitCode, collapsed: true };
    const updated = [...list.slice(0, -1), finalizedBlock];
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

/**
 * Picks a terminal pane to launch an agent into. Prefers panes that are NOT
 * the active/focused one and that are NOT in use — a pane is "in use" when its
 * session is already running an agent or is busy executing a command. An idle
 * shell (alive, not an agent, not executing) or an empty pane is fair game.
 *
 * Returns `{ paneIdx, sessionId }` where `sessionId === null` means the caller
 * should spawn a fresh session in that pane. Returns `null` when every pane is
 * occupied/busy, signalling the caller to open a brand-new terminal instead of
 * hijacking one that is in use.
 */
export function findAvailablePaneForAgentRun() {
  const panes = get(paneAssignments);
  const activeIdx = get(activePaneIndex);
  const allSessions = get(sessions);

  // A pane is reusable if its session is a live, non-agent shell that is not
  // currently executing a command (i.e. genuinely idle and not in use).
  const isIdleShell = (sessionId: number | null): boolean => {
    if (sessionId === null) return false;
    const session = allSessions.find((entry) => entry.id === sessionId);
    if (!session) return false;
    return Boolean(session.isRunning) && !isAgentSession(session) && !session.isExecuting;
  };

  // 1. A non-active empty pane → cleanest target (fresh, dedicated terminal).
  for (let paneIdx = 0; paneIdx < panes.length; paneIdx += 1) {
    if (paneIdx === activeIdx) continue;
    if (panes[paneIdx] === null) return { paneIdx, sessionId: null as number | null };
  }

  // 2. A non-active, idle (not in use) shell → reuse it.
  for (let paneIdx = 0; paneIdx < panes.length; paneIdx += 1) {
    if (paneIdx === activeIdx) continue;
    if (isIdleShell(panes[paneIdx])) return { paneIdx, sessionId: panes[paneIdx] };
  }

  // 3. Only fall back to the active pane if it is empty or idle.
  if (panes[activeIdx] === null) {
    return { paneIdx: activeIdx, sessionId: null as number | null };
  }
  if (isIdleShell(panes[activeIdx])) {
    return { paneIdx: activeIdx, sessionId: panes[activeIdx] };
  }

  // Everything is busy or already running an agent.
  return null;
}

function getNextGridLayout(current: GridLayout): GridLayout | null {
  const count = getLayoutPaneCount(current);
  if (count < 2) return '2h';
  if (count < 4) return '4';
  if (count < 9) return '9';
  return null;
}

// ── Mosaic growth hook ──────────────────────────────────────────────────────
// The visual mosaic (columns / widths / heights) lives in TerminalPanel.svelte.
// It registers a grow function here so spawning agents can add exactly one
// tiled pane at a time, instead of jumping to a fixed grid layout that would
// leave empty filler panes. Returns the new pane index.
let mosaicGrowFn: (() => number) | null = null;

export function registerMosaicGrow(fn: (() => number) | null) {
  mosaicGrowFn = fn;
}

export async function spawnAgentPreset(command: string, cwd?: string): Promise<number | null> {
  let target = findAvailablePaneForAgentRun();

  if (!target) {
    if (mosaicGrowFn) {
      // Preferred path: grow the mosaic by a single tiled pane (no filler panes).
      const paneIdx = mosaicGrowFn();
      target = { paneIdx, sessionId: null as number | null };
    } else {
      // Fallback: bump to the next fixed grid layout.
      const next = getNextGridLayout(get(gridLayout));
      if (!next) return null;
      setGridLayout(next);
      target = findAvailablePaneForAgentRun();
      if (!target) return null;
    }
  }

  let sessionId = target.sessionId;
  if (sessionId === null) {
    sessionId = await createTerminalSession(cwd, target.paneIdx);
  }
  if (sessionId === null || sessionId === undefined) return null;

  markSessionAgentPreset(sessionId, command);
  const displayName = getAgentDisplayName(command) ?? command;
  updateSessionTitle(sessionId, displayName);
  writeToSession(sessionId, command + '\r');
  return sessionId;
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

  // Update the authoritative state *synchronously* — before the async pty
  // teardown below. closePane() in TerminalPanel mutates the local mosaic
  // (columns) and the paneAssignments store together the moment you close a
  // pane. If this project-state update waited on `await pty.close()`, the later
  // setVisibleProjectState() would re-broadcast a stale assignments array (one
  // that still references panes other in-flight closes already removed), and the
  // add-only mosaic reconcile would resurrect ghost "Open terminal" placeholders
  // that can never be dismissed. Doing it now keeps overlapping closes (closing
  // several terminals in quick succession) consistent.
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

  dataCallbacks.delete(id);
  exitCallbacks.delete(id);
  sessionOutputBuffers.delete(id);
  sessionOutputDecoders.delete(id);
  sessionInputBuffers.delete(id);
  terminalSessionProjects.delete(id);

  // Tear the pty down in the background; state no longer depends on it.
  const pty = ptyInstances.get(id);
  if (pty) {
    ptyInstances.delete(id);
    await pty.close().catch((err) => console.error('Failed to close terminal:', err));
  }
}

