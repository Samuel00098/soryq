import { writable, get } from '$lib/stores/storeCompat';
import { attachPty, openPty, type PtySession } from '$lib/services/pty-bridge';
import { terminalShell } from '$lib/stores/settings';
import { showToast } from '$lib/stores/notification';
import { buildAgentCharter } from '$lib/services/orchestrator/agent-charter';
import { agentReadsRulesFile, ensureAgentRulesFiles } from '$lib/services/orchestrator/agent-rules-file';
import { getCustomAgents } from '$lib/stores/customAgents';
import { removeTaskWorktree, type WorktreeInfo } from '$lib/services/orchestrator/worktree-manager';

export type TerminalSessionInfo = {
  id: number;
  projectId: string;
  title: string;
  // Title driven by the agent CLI's OSC escape sequences (what the tool reports
  // it is doing). Shown as the pane's main heading.
  paneTitle?: string | null;
  // Orchestrator-assigned human/assistant name (e.g. "Iris"). Kept separate from
  // paneTitle so the assistant name (a badge) and the live CLI title can coexist.
  agentName?: string | null;
  isRunning: boolean;
  isExecuting?: boolean;
  agentPreset?: string | null;
  briefed?: boolean;
  lastActivatedAt?: number;
  role?: string | null;
  cwd?: string | null;
  taskSummary?: string | null;
  lastExitCode?: number | null;
  // Orchestrator: id of the OrchestratorTask that currently owns this terminal
  // (single-agent lease). null/undefined = unowned / user-controlled.
  ownerTaskId?: string | null;
  // Isolated git worktree this agent runs in, when spawned outside the
  // orchestrator (e.g. the floating prompt bar). Orchestrator-dispatched agents
  // keep their worktree on the OrchestratorTask instead, so this stays unset for
  // them — that ownership split is what decides who cleans the worktree up.
  worktree?: WorktreeInfo | null;
};

// Keyed by the agent's launch command (see AI_AGENT_PRESETS in runs.ts), with a
// few natural-name aliases kept so display names resolve whether code passes the
// command id ("agy") or the spoken name ("antigravity").
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  codex: 'Codex CLI',
  claude: 'Claude Code',
  aider: 'Aider',
  agy: 'Antigravity',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  pi: 'Pi',
  omp: 'Oh My Pi',
  'oh-my-pi': 'Oh My Pi',
  agent: 'Cursor',
  cursor: 'Cursor',
};

export type GridLayout = 'single' | '2h' | '2v' | '3h' | '3v' | '4' | '9';

// A custom mosaic arrangement (columns of stacked cells, with their relative
// widths/heights) built by dragging/splitting panes. This is the source of
// truth for the *visible* terminal layout; `gridLayout` is only the named
// quick-pick label. Persisting the mosaic (not just the preset) lets a custom
// arrangement survive a TerminalPanel remount — e.g. when the workspace ambient
// mode switches (Focus / Split / Canvas / Preview) and React tears the panel
// down and rebuilds it elsewhere in the tree. null = "follow the named preset".
export type MosaicCell = { index: number };
export type MosaicColumn = { cells: MosaicCell[] };
export interface TerminalMosaic {
  columns: MosaicColumn[];
  colWidths: number[];
  cellHeights: number[][];
}

function cloneMosaic(mosaic: TerminalMosaic | null | undefined): TerminalMosaic | null {
  if (!mosaic) return null;
  return {
    columns: mosaic.columns.map((column) => ({ cells: column.cells.map((cell) => ({ ...cell })) })),
    colWidths: [...mosaic.colWidths],
    cellHeights: mosaic.cellHeights.map((heights) => [...heights]),
  };
}

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

// Bumped to request the FloatingPromptBar launch agent voice mode.
export const promptBarVoiceModeRequest = writable(0);
export function launchPromptBarVoiceMode() {
  promptBarVoiceModeRequest.update((n) => n + 1);
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

// The live custom mosaic arrangement for the active project (null = the named
// `gridLayout` preset is in effect). The visible TerminalPanel reads this on
// mount so a hand-built split survives a remount; it writes back here whenever
// the user drags, splits or resizes panes.
export const terminalMosaic = writable<TerminalMosaic | null>(null);

// Which session IDs occupy each pane slot (null = empty/new terminal slot)
export const paneAssignments = writable<(number | null)[]>([null]);

// Which pane index is focused (receives keyboard)
export const activePaneIndex = writable<number>(0);

type TerminalProjectState = {
  sessions: TerminalSessionInfo[];
  activeSessionId: number | null;
  gridLayout: GridLayout;
  mosaic: TerminalMosaic | null;
  paneAssignments: (number | null)[];
  activePaneIndex: number;
};

function createDefaultProjectState(): TerminalProjectState {
  return {
    sessions: [],
    activeSessionId: null,
    gridLayout: 'single',
    mosaic: null,
    paneAssignments: [null],
    activePaneIndex: 0,
  };
}

function cloneProjectState(state: TerminalProjectState): TerminalProjectState {
  return {
    sessions: state.sessions.map((session) => ({ ...session })),
    activeSessionId: state.activeSessionId,
    gridLayout: state.gridLayout,
    mosaic: cloneMosaic(state.mosaic),
    paneAssignments: [...state.paneAssignments],
    activePaneIndex: state.activePaneIndex,
  };
}

const terminalProjectStates = new Map<string, TerminalProjectState>();
const terminalSessionProjects = new Map<number, string>();
// Project id → working-tree root, registered by the workspace store as projects
// open. Lets a session resolve its repo root for the rules-file brief even when
// it was created without an explicit cwd (e.g. a terminal opened with the
// default shell dir, then the user types `claude`/`codex` into it). Injected
// rather than imported to avoid a workspace↔terminal import cycle.
const terminalProjectRoots = new Map<string, string>();
let activeTerminalProjectId: string | null = null;

/** Record a project's working-tree root for rules-file brief resolution. */
export function setTerminalProjectRoot(projectId: string, rootPath: string) {
  if (projectId && rootPath) terminalProjectRoots.set(projectId, rootPath);
}

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
  terminalMosaic.set(cloneMosaic(state.mosaic));
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

// Project-independent exit broadcast. Unlike `exitCallbacks` (registered by the
// visible TerminalPane and torn down when the pane unmounts) and the `sessions`
// store (which only ever reflects the active project), these listeners fire for
// EVERY session exit in EVERY project. The orchestrator uses this so an agent
// that exits while its project is in the background is still reconciled instead
// of being stranded in-progress until the user reopens that project.
export type SessionExitInfo = { sessionId: number; projectId: string; code: number };
const sessionExitListeners = new Set<(info: SessionExitInfo) => void>();
export function onSessionExit(listener: (info: SessionExitInfo) => void): () => void {
  sessionExitListeners.add(listener);
  return () => sessionExitListeners.delete(listener);
}

// Project-independent "agent launched" broadcast. Fires when a manually-typed
// command is recognized as an AI agent CLI — the typed-launch path only, NOT an
// orchestrator/floating-bar spawn (those manage their own bookkeeping). The
// orchestrator listens so it can *adopt* agents it didn't spawn itself:
// surface them in its running-agents list, read their terminal, and route
// follow-ups / close to them. Mirrors the `onSessionExit` channel so background
// projects are covered too.
export type AgentDetectedInfo = { sessionId: number; projectId: string; preset: string };
const agentDetectedListeners = new Set<(info: AgentDetectedInfo) => void>();
export function onAgentDetected(listener: (info: AgentDetectedInfo) => void): () => void {
  agentDetectedListeners.add(listener);
  return () => agentDetectedListeners.delete(listener);
}
const sessionOutputBuffers = new Map<number, string>();
const sessionOutputDecoders = new Map<number, TextDecoder>();
const sessionInputBuffers = new Map<number, string>();
const agentLaunchStartLengths = new Map<number, number>();
const MAX_SESSION_BUFFER_CHARS = 250000;

// Maps a launched executable (the first real token of a command, basename
// only) to the agent preset it represents. Detection keys off the executable
// name — NOT any word appearing in the line — so subcommands/arguments like
// `omp agent ...` aren't misattributed to Cursor's bare `agent` CLI.
const AGENT_COMMAND_EXECUTABLES: Array<{ preset: string; names: string[] }> = [
  { preset: 'codex', names: ['codex'] },
  { preset: 'claude', names: ['claude', 'claude-code'] },
  { preset: 'opencode', names: ['opencode'] },
  { preset: 'oh-my-pi', names: ['omp'] },
  { preset: 'pi', names: ['pi'] },
  { preset: 'antigravity', names: ['agy', 'antigravity'] },
  { preset: 'aider', names: ['aider'] },
  { preset: 'cursor', names: ['cursor-agent', 'cursor', 'agent'] },
];

// Tokens that wrap the real command and should be skipped when locating the
// executable (e.g. `npx claude`, `sudo aider`, `FOO=bar codex`).
const COMMAND_LAUNCHER_PREFIXES = new Set([
  'npx',
  'bunx',
  'pnpx',
  'sudo',
  'command',
  'exec',
  'time',
  'nice',
]);

// Extracts the basename of the executable being launched, stripping a leading
// PowerShell call operator, env-var assignments, launcher prefixes, any path,
// and a Windows executable extension.
function extractExecutable(command: string): string | null {
  const tokens = command
    .trim()
    .replace(/^&\s*/, '')
    .split(/\s+/)
    .filter(Boolean);

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      i++;
      continue;
    }
    if (COMMAND_LAUNCHER_PREFIXES.has(token.toLowerCase())) {
      i++;
      continue;
    }
    break;
  }

  const exe = tokens[i];
  if (!exe) return null;

  const base = exe.split(/[\\/]/).pop() ?? exe;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

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
    // Picking a named preset replaces any hand-built arrangement.
    terminalMosaic.set(null);
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
      mosaic: null,
      paneAssignments: paneAssignments.slice(0, count),
      activePaneIndex: Math.min(state.activePaneIndex, count - 1),
    };
  });
}

// Persist a hand-built mosaic arrangement for the active project. The visible
// store keeps the exact object passed in (so the panel's own writes don't
// thrash its local state); the per-project copy is cloned so switching projects
// can't mutate it from under us.
export function setTerminalMosaic(mosaic: TerminalMosaic | null) {
  const projectId = activeTerminalProjectId;
  if (projectId) {
    getProjectState(projectId).mosaic = cloneMosaic(mosaic);
  }
  terminalMosaic.set(mosaic);
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
    if (get(activePaneIndex) !== paneIdx) {
      activePaneIndex.set(paneIdx);
    }
    const panes = get(paneAssignments);
    if (panes[paneIdx] !== null) {
      activateSessionInPane(panes[paneIdx]!);
    }
    // Focusing a pane makes its terminal the prompt-bar target.
    if (get(manualPromptTargetId) !== panes[paneIdx]) {
      manualPromptTargetId.set(panes[paneIdx]);
    }
    return;
  }

  updateProjectState(projectId, (state) => (
    state.activePaneIndex === paneIdx ? state : { ...state, activePaneIndex: paneIdx }
  ));
  const panes = getProjectState(projectId).paneAssignments;
  if (panes[paneIdx] !== null) {
    activateSessionInPane(panes[paneIdx]!);
  }
  // Focusing a pane makes its terminal the prompt-bar target.
  if (get(manualPromptTargetId) !== panes[paneIdx]) {
    manualPromptTargetId.set(panes[paneIdx]);
  }
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
    const nextActivePaneIndex = idx !== -1 ? idx : state.activePaneIndex;
    if (state.activeSessionId === id && state.activePaneIndex === nextActivePaneIndex) {
      return state;
    }
    return {
      ...state,
      activePaneIndex: nextActivePaneIndex,
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
  const executable = extractExecutable(command);
  if (!executable) return null;

  for (const { preset, names } of AGENT_COMMAND_EXECUTABLES) {
    if (names.includes(executable)) return preset;
  }

  // User-defined agents: match on the executable of their stored launch command
  // (so typing `aider` adopts a custom "aider --flag" agent). The preset key is
  // the custom agent's full command, matching what the spawn path records, so
  // display-name and rules-file lookups resolve consistently.
  for (const agent of getCustomAgents()) {
    if (extractExecutable(agent.command) === executable) return agent.command;
  }

  return null;
}

// Sessions whose programmatic launch write must NOT re-trigger agent-command
// detection: spawnAgentPreset already records the preset (and the caller's
// explicit briefed flag) itself, so letting its own `writeToSession(command)`
// run through detection would clobber that flag and double-schedule the brief.
const suppressAgentDetection = new Set<number>();

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
        if (preset && !suppressAgentDetection.has(id)) {
          agentLaunchStartLengths.set(id, getSessionOutputBuffer(id).length);
          markSessionAgentPreset(id, preset);
          // Broadcast a genuine typed launch so the orchestrator can adopt it.
          // Skip panes already leased by the orchestrator (it tracks those via
          // its own task model). `suppressAgentDetection` already excludes the
          // programmatic writes spawnAgentPreset makes, so this is user typing.
          const detectedProjectId = terminalSessionProjects.get(id);
          if (detectedProjectId) {
            const detectedSession = getProjectState(detectedProjectId).sessions.find((s) => s.id === id);
            if (!detectedSession?.ownerTaskId) {
              for (const listener of agentDetectedListeners) {
                try { listener({ sessionId: id, projectId: detectedProjectId, preset }); }
                catch (err) { console.error('Agent detected listener failed:', err); }
              }
            }
          }
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

function handlePtyExit(id: number, owningProjectId: string, code: number) {
  const sessionProjectId = terminalSessionProjects.get(id) ?? owningProjectId;
  const state = getProjectState(sessionProjectId);
  const session = state.sessions.find((x) => x.id === id);
  exitCallbacks.get(id)?.(code);
  updateProjectState(sessionProjectId, (current) => ({
    ...current,
    sessions: current.sessions.map((x) => (
      x.id === id ? { ...x, isRunning: false, lastExitCode: code } : x
    )),
  }));
  // Broadcast to project-independent listeners (e.g. the orchestrator's
  // task reconciler) so background-project exits are handled too.
  for (const listener of sessionExitListeners) {
    try { listener({ sessionId: id, projectId: sessionProjectId, code }); }
    catch (err) { console.error('Session exit listener failed:', err); }
  }
  const visibleSessions = sessionProjectId === activeTerminalProjectId ? get(sessions) : state.sessions;
  const label = session ? getSessionLabel(session, visibleSessions) : `Terminal ${id}`;
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
}

function registerPtySession(
  pty: PtySession,
  owningProjectId: string,
  cwd?: string | null,
  targetPaneIndex?: number,
  metadata: RestoredSessionMetadata = {},
  assignPane = true
) {
  ptyInstances.set(pty.id, pty);
  terminalSessionProjects.set(pty.id, owningProjectId);

  const existing = getProjectState(owningProjectId).sessions.find((session) => session.id === pty.id);
  const sessionNum = getProjectState(owningProjectId).sessions.length + 1;
  const agentPreset = metadata.agentPreset ?? existing?.agentPreset ?? null;
  const info: TerminalSessionInfo = {
    id: pty.id,
    projectId: owningProjectId,
    title: metadata.title?.trim() || existing?.title || `Terminal ${sessionNum}`,
    paneTitle: metadata.paneTitle ?? existing?.paneTitle ?? null,
    agentName: metadata.agentName ?? existing?.agentName ?? null,
    isRunning: true,
    isExecuting: false,
    agentPreset,
    briefed: agentPreset ? false : existing?.briefed,
    lastExitCode: null,
    lastActivatedAt: Date.now(),
    role: metadata.role ?? existing?.role ?? (agentPreset ? 'Agent' : null),
    cwd: cwd ?? existing?.cwd ?? null,
    taskSummary: metadata.taskSummary ?? existing?.taskSummary ?? null,
    ownerTaskId: existing?.ownerTaskId ?? null,
  };

  updateProjectState(owningProjectId, (state) => ({
    ...state,
    sessions: existing
      ? state.sessions.map((session) => (session.id === pty.id ? info : session))
      : [...state.sessions, info],
    activeSessionId: pty.id,
  }));

  // Agent rooms (assignPane: false) live in `sessions` but never take a slot in
  // the user's personal terminal mosaic — assigning one would render its cell as
  // an empty "Agent is open as a panel" pane instead of the agent itself.
  if (!assignPane) return;

  updateProjectState(owningProjectId, (state) => {
    const paneAssignments = [...state.paneAssignments];
    let nextActivePaneIndex = state.activePaneIndex;
    if (targetPaneIndex !== undefined && targetPaneIndex >= 0) {
      while (paneAssignments.length <= targetPaneIndex) paneAssignments.push(null);
      paneAssignments[targetPaneIndex] = pty.id;
      nextActivePaneIndex = targetPaneIndex;
    } else if (!paneAssignments.includes(pty.id)) {
      const emptyIdx = paneAssignments.findIndex((p) => p === null);
      if (emptyIdx !== -1) {
        paneAssignments[emptyIdx] = pty.id;
        nextActivePaneIndex = emptyIdx;
      } else {
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
}

// Looks a session up in its OWNING project's state, not just the visible
// `sessions` store (which only reflects the active project). Prompt delivery
// must see the agent preset of a session living in a background project too —
// missing it would silently downgrade a TUI agent to the plain-shell send path.
function findSessionAnyProject(id: number): TerminalSessionInfo | undefined {
  const projectId = terminalSessionProjects.get(id);
  const pool = projectId ? getProjectState(projectId).sessions : get(sessions);
  return pool.find((s) => s.id === id);
}

export async function createTerminalSession(
  cwd?: string,
  targetPaneIndex?: number,
  projectId?: string,
  opts?: { assignPane?: boolean; agentPreset?: string | null }
): Promise<number | null> {
  // Agents run as their own rooms and must never occupy a slot in the user's
  // personal terminal grid — pass assignPane: false to create a session that
  // lives in `sessions` (so it surfaces as an agent room) without touching
  // paneAssignments / the mosaic. Everything else defaults to assigning a pane.
  const assignPane = opts?.assignPane ?? true;
  // Stamp the agent preset at birth (not a beat later via markSessionAgentPreset).
  // Otherwise the session exists momentarily as a plain "shell session", and the
  // TerminalPanel auto-fill reconcile — which runs during the awaited create —
  // grabs that unassigned shell into a leftover empty pane. Marking it an agent
  // afterward then evicts it, leaving an undismissable ghost "Open terminal" cell.
  const agentPreset = opts?.agentPreset ?? null;
  try {
    let pty: PtySession;
    const owningProjectId = projectId ?? activeTerminalProjectId;
    if (!owningProjectId) {
      console.warn('Cannot create terminal session without an active project');
      return null;
    }

    const resolvedCwd = cwd ?? terminalProjectRoots.get(owningProjectId);

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
          sessions: current.sessions.map((x) => (
            x.id === pty.id ? { ...x, isRunning: false, lastExitCode: code } : x
          )),
        }));
        // Broadcast to project-independent listeners (e.g. the orchestrator's
        // task reconciler) so background-project exits are handled too.
        for (const listener of sessionExitListeners) {
          try { listener({ sessionId: pty.id, projectId: sessionProjectId, code }); }
          catch (err) { console.error('Session exit listener failed:', err); }
        }
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
    }, resolvedCwd, get(terminalShell) || undefined);

    pty = await ptyPromise;
    ptyInstances.set(pty.id, pty);
    terminalSessionProjects.set(pty.id, owningProjectId);

    const sessionNum = getProjectState(owningProjectId).sessions.length + 1;
    const info: TerminalSessionInfo = {
      id: pty.id,
      projectId: owningProjectId,
      title: `Terminal ${sessionNum}`,
      paneTitle: null,
      agentName: null,
      isRunning: true,
      agentPreset,
      role: agentPreset ? 'Agent' : null,
      // Remember where this terminal runs so an agent's standing brief can be
      // written to a rules file (CLAUDE.md / AGENTS.md) in the same directory.
      cwd: resolvedCwd ?? null,
      lastExitCode: null,
      lastActivatedAt: Date.now(),
    };

    updateProjectState(owningProjectId, (state) => ({
      ...state,
      sessions: [...state.sessions, info],
      activeSessionId: pty.id,
    }));

    if (assignPane) updateProjectState(owningProjectId, (state) => {
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

export async function attachTerminalSession(
  backendSessionId: number,
  cwd?: string | null,
  targetPaneIndex?: number,
  projectId?: string,
  metadata: RestoredSessionMetadata = {},
  opts?: { assignPane?: boolean }
): Promise<number | null> {
  try {
    const owningProjectId = projectId ?? activeTerminalProjectId;
    if (!owningProjectId || !Number.isInteger(backendSessionId) || backendSessionId <= 0) {
      return null;
    }

    if (ptyInstances.has(backendSessionId)) {
      return backendSessionId;
    }

    let pty: PtySession;
    const ptyPromise = attachPty(backendSessionId, {
      // Pre-attach history goes into the session buffer ONLY — never through
      // dataCallbacks. TerminalPane writes it via its gated reattach path, so
      // xterm's re-answered color/DA queries from the history are dropped
      // instead of reaching the live PTY (where a running agent like Codex
      // would show them as `]10;rgb:…` junk in its input).
      onReplay: (bytes) => {
        appendSessionOutputBuffer(backendSessionId, bytes);
      },
      onData: (bytes) => {
        appendSessionOutputBuffer(backendSessionId, bytes);
        const cb = dataCallbacks.get(backendSessionId);
        cb?.(bytes);
      },
      onExit: (code) => {
        handlePtyExit(backendSessionId, owningProjectId, code);
      },
    });

    pty = await ptyPromise;
    registerPtySession(pty, owningProjectId, cwd ?? null, targetPaneIndex, metadata, opts?.assignPane ?? true);
    return pty.id;
  } catch {
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

export function sendPromptToSession(sessionId: number, text: string, agentPreset?: string | null) {
  if (!text) return;
  if (agentPreset) {
    // Every agent must learn its operating brief the moment it's prompted OR
    // spawned, whichever comes first. If this agent hasn't been briefed yet
    // (e.g. it was launched manually and the user fired off a task before the
    // readiness-gated auto-brief landed), the charter rides with this first
    // prompt — wrapped around the task exactly like an orchestrator dispatch.
    // Subsequent prompts go raw, since `briefed` is set below.
    const session = findSessionAnyProject(sessionId);
    const payload =
      session && !session.briefed
        ? buildAgentCharter(text, { name: session.agentName ?? null })
        : text;
    void deliverPromptRaw(sessionId, payload);
    markSessionBriefed(sessionId, true);
    return;
  }
  writeToSession(sessionId, `${text}\r`);
}

const isTestEnv = typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true');

// Submitting an agent prompt is two steps: paste the text, then send a separate
// Enter. The Enter must not arrive until the agent's TUI has actually committed
// the pasted text to its input composer — Ink/React REPLs (Claude Code) render
// paste input asynchronously, so an Enter sent too early submits an *empty*
// composer (a no-op) and the text then lands typed-but-unsent. We therefore wait
// for the pasted text *itself* to be echoed into the output before submitting.
const PASTE_ECHO_POLL_MS = isTestEnv ? 1 : 40;
const PASTE_ECHO_MIN_WAIT_MS = isTestEnv ? 2 : 60;
// How much of the prompt to match against the echoed composer. A short, early
// slice is enough to confirm the paste landed and stays on one line at any sane
// terminal width (so reflow can't split it mid-word).
const PASTE_ECHO_NEEDLE_CHARS = 48;
const PASTE_SUBMIT_SETTLE_MS = isTestEnv ? 2 : 140;
// Fallback when neither the literal echo nor a paste placeholder is ever seen.
// Generous: an Enter sent before the composer commits the paste lands on an
// empty composer and the prompt sits there typed-but-unsent.
const PASTE_SUBMIT_MAX_WAIT_MS = isTestEnv ? 15 : 6000;
// After pressing Enter we confirm the agent actually *started* — an Enter that
// raced the paste-commit lands on an empty composer (a no-op) and the prompt
// just sits there typed-but-unsent. A submitted prompt makes the TUI redraw
// heavily (spinner, "working", token counter), so a burst of new output is a
// reliable "it took the prompt" signal; the absence of one means re-press Enter.
const SUBMIT_CONFIRM_POLL_MS = isTestEnv ? 2 : 80;
const SUBMIT_CONFIRM_WINDOW_MS = isTestEnv ? 15 : 2500;
// A genuinely accepted prompt makes the TUI repaint a full frame (user message
// + spinner) — hundreds of chars with escapes. Keep this well above what an
// idle status-line tick or a late paste-commit redraw produces: a false
// confirm kills the retry Enters and the prompt sits unsubmitted forever,
// while a false NON-confirm merely sends one extra Enter, which is a harmless
// no-op on an already-emptied composer.
const SUBMIT_CONFIRM_DELTA = 512;
const MAX_SUBMIT_ATTEMPTS = isTestEnv ? 1 : 3;
// After the paste echoes, a TUI keeps repainting while it commits the (possibly
// multi-line) text into its composer. We wait for that repaint to go QUIESCENT
// before pressing Enter: a poll interval with no output growth means the
// composer has settled, so the Enter lands on a committed composer (it actually
// submits, instead of being a mid-repaint no-op) and the start-confirm delta is
// measured from a stable baseline (so the paste's own redraw can't masquerade as
// "the agent started" and falsely end the retry loop). Capped, because agents
// with a perpetual spinner in the composer never fully go quiet.
const PASTE_COMMIT_QUIET_MS = isTestEnv ? 1 : 220;
const PASTE_COMMIT_QUIET_MAX_MS = isTestEnv ? 4 : 1600;
// Strip ANSI/VT escapes and C0 control noise, then collapse whitespace, so the
// literal prompt text can be found in a TUI's escape-laden, reflowed redraw.
const ECHO_ANSI =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][\s\S]*?(?:\x1b\\|\x07)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][0-9A-Za-z]|\x1b[@-Z\\-_=>]/g;
const ECHO_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function normalizeForEchoMatch(raw: string): string {
  if (!raw) return '';
  return raw.replace(ECHO_ANSI, '').replace(ECHO_CONTROL, '').replace(/\s+/g, ' ').trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    count++;
    from = haystack.indexOf(needle, from + needle.length);
  }
  return count;
}

// Some TUI agents don't echo a multi-line paste literally — Claude Code
// collapses it to a placeholder like "[Pasted text #1 +6 lines]". A freshly
// rendered placeholder is equally conclusive evidence the composer committed
// the paste, so the echo wait must accept it too (otherwise it always rides
// out the max wait and the follow-up Enter can race the commit).
const PASTE_PLACEHOLDER_RE = /pasted\s+(?:text|content|\d+\s+lines?)/gi;

function countPastePlaceholders(haystack: string): number {
  return haystack.match(PASTE_PLACEHOLDER_RE)?.length ?? 0;
}

/**
 * True once `current` (the session's full output buffer) shows the pasted `text`
 * echoed into the composer beyond what `base` (the buffer captured the instant
 * before the paste) already contained. We match the literal text — not mere
 * output growth — because TUI agents (Claude Code) redraw their status
 * bar/spinner constantly, so a length delta trips long before the paste is
 * committed. Comparing occurrence counts means a prompt identical to earlier
 * output still registers as newly echoed.
 */
export function pasteEchoLanded(base: string, current: string, text: string): boolean {
  const needle = normalizeForEchoMatch(text).slice(0, PASTE_ECHO_NEEDLE_CHARS);
  if (!needle) return false;
  const normalBase = normalizeForEchoMatch(base);
  const normalNow = normalizeForEchoMatch(current);
  if (countOccurrences(normalNow, needle) > countOccurrences(normalBase, needle)) return true;
  // Literal text never echoed — check for a newly rendered paste placeholder
  // (collapsed multi-line paste, e.g. Claude Code's "[Pasted text #1 +6 lines]").
  return countPastePlaceholders(normalNow) > countPastePlaceholders(normalBase);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Delivery diagnostics: one terse line per pipeline step, so a "prompt never
// arrived at agent X" report can be pinned to ready/paste/echo/submit from the
// devtools console instead of guessed at. Silenced in tests.
function logAgentSend(sessionId: number, event: string, detail?: Record<string, unknown>) {
  if (isTestEnv) return;
  console.info(`[agent-send] #${sessionId} ${event}`, detail ?? '');
}

/**
 * Wait until the pasted `text` is echoed into the agent's composer (so a
 * following Enter can't race the input-state commit), then settle briefly. Falls
 * back to a max wait so a non-echoing agent still proceeds to submit. Returns
 * whether the echo (literal or paste placeholder) was actually observed.
 */
async function waitForPasteEcho(sessionId: number, base: string, text: string): Promise<boolean> {
  const startedAt = Date.now();
  let landed = false;
  for (;;) {
    const elapsed = Date.now() - startedAt;
    landed =
      elapsed >= PASTE_ECHO_MIN_WAIT_MS && pasteEchoLanded(base, getSessionOutputBuffer(sessionId), text);
    if (landed || elapsed >= PASTE_SUBMIT_MAX_WAIT_MS) break;
    await sleep(PASTE_ECHO_POLL_MS);
  }
  await sleep(PASTE_SUBMIT_SETTLE_MS);
  return landed;
}

/**
 * After an Enter, watch for the burst of output an agent emits when it actually
 * accepts a prompt. Returns true once output grows past `baseLen` by the
 * threshold, false if the window elapses (the Enter was a no-op) or the session
 * closes.
 */
async function confirmAgentStarted(sessionId: number, baseLen: number): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    if (!ptyInstances.get(sessionId)) return false;
    if (getSessionOutputBuffer(sessionId).length >= baseLen + SUBMIT_CONFIRM_DELTA) return true;
    if (Date.now() - startedAt >= SUBMIT_CONFIRM_WINDOW_MS) return false;
    await sleep(SUBMIT_CONFIRM_POLL_MS);
  }
}

/**
 * Wait for the composer to stop repainting after a paste, so the following Enter
 * lands on a settled (committed) composer rather than racing the commit. Returns
 * once a full poll window passes with no output growth, or the cap elapses (a
 * never-quiet spinner). This is the difference between an Enter that submits and
 * one that's a mid-repaint no-op leaving the prompt typed-but-unsent.
 */
async function waitForComposerQuiescent(sessionId: number): Promise<void> {
  const startedAt = Date.now();
  let lastLen = getSessionOutputBuffer(sessionId).length;
  for (;;) {
    await sleep(PASTE_COMMIT_QUIET_MS);
    if (!ptyInstances.get(sessionId)) return;
    const len = getSessionOutputBuffer(sessionId).length;
    if (len === lastLen) return; // a quiet window with no growth → composer settled
    lastLen = len;
    if (Date.now() - startedAt >= PASTE_COMMIT_QUIET_MAX_MS) return;
  }
}

/**
 * Deliver a prompt straight to a session's PTY using a bracketed-paste wrapper,
 * then submit it — pressing Enter, confirming the agent actually started, and
 * re-pressing if the first Enter raced the paste-commit and hit an empty
 * composer. Unlike `sendPromptToSession` (which routes through the xterm
 * `term.paste`), this does NOT depend on a TerminalPane being mounted — so it
 * reliably reaches a just-spawned agent the user may not be looking at. Used by
 * the orchestrator to auto-drive agents.
 *
 * Resolves true once the prompt is delivered (pasted and Enter sent). The
 * internal confirm/retry only governs whether further Enters are needed; a
 * delivered-but-unconfirmed prompt still resolves true so the caller can watch
 * the turn (the turn watcher tolerates an agent that never started).
 */
export async function sendAgentPromptDirect(sessionId: number, text: string): Promise<boolean> {
  if (!text) return false;
  return deliverPromptRaw(sessionId, text);
}

/**
 * Paste `text` into a session's PTY (bracketed-paste so multi-line prompts stay
 * intact and the REPL doesn't submit on embedded newlines), then submit it with a
 * separate Enter, confirming the agent actually started and re-pressing if the
 * first Enter raced the paste-commit. Used for prompts delivered straight to a
 * session that may not have a mounted TerminalPane (e.g. the orchestrator).
 */
async function deliverPromptRaw(sessionId: number, text: string): Promise<boolean> {
  const pty = ptyInstances.get(sessionId);
  if (!pty) return false;

  const session = findSessionAnyProject(sessionId);
  const preset = session?.agentPreset;
  const isTui = Boolean(preset);

  if (!isTui) {
    // No agent preset — a plain shell. Collapse the multi-line text (like the
    // charter) into a single line so the shell doesn't execute it line-by-line,
    // and send it directly without bracketed paste.
    const cleanText = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    pty.write(cleanText + '\r').catch((err) => console.error('Failed to submit prompt:', err));
    setSessionExecuting(sessionId, true);
    await sleep(80);
    const success = ptyInstances.has(sessionId);
    if (success) {
      markSessionBriefed(sessionId, true);
    }
    return success;
  }

  const base = getSessionOutputBuffer(sessionId);
  const promptBody = text;
  // Newlines become \r inside the paste body — this is what a REAL terminal
  // paste delivers (xterm.js converts \n to \r on paste), and it's the only
  // form every composer is actually tested against. Raw \n (Ctrl+J) confuses
  // Ink-based CLIs (Claude Code, Cursor), which can treat it as a submit or
  // drop the rest of the paste.
  const pasteBody = promptBody.replace(/\r?\n/g, '\r');
  const pastePayload = `\x1b[200~${pasteBody}\x1b[201~`;
  pty.write(pastePayload).catch((err) => console.error('Failed to paste prompt:', err));
  setSessionExecuting(sessionId, true);
  logAgentSend(sessionId, 'paste-written', { preset, chars: pasteBody.length });

  const echoLanded = await waitForPasteEcho(sessionId, base, promptBody);
  logAgentSend(sessionId, echoLanded ? 'echo-confirmed' : 'echo-timeout');

  // Let the composer finish committing the paste before submitting. Without this,
  // the first Enter can land mid-repaint on a not-yet-committed composer (a no-op
  // that leaves the prompt typed-but-unsent), and the repaint's own output can
  // falsely satisfy the start-confirm below and stop the retry loop early.
  await waitForComposerQuiescent(sessionId);
  logAgentSend(sessionId, 'composer-settled');

  // Press Enter, then verify the agent took it. An Enter on an empty composer is
  // a harmless no-op, so re-pressing is safe — the prompt stays in the composer
  // until one Enter lands after the commit and the agent starts working.
  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt += 1) {
    if (!ptyInstances.get(sessionId)) return false;
    const lenBeforeEnter = getSessionOutputBuffer(sessionId).length;
    pty.write('\r').catch((err) => console.error('Failed to submit prompt:', err));
    const confirmed = await confirmAgentStarted(sessionId, lenBeforeEnter);
    logAgentSend(sessionId, 'enter', {
      attempt: attempt + 1,
      confirmed,
      growth: getSessionOutputBuffer(sessionId).length - lenBeforeEnter,
    });
    if (confirmed) {
      markSessionBriefed(sessionId, true);
      return true;
    }
  }
  // Delivered but never confirmed starting (quiet/stuck agent). Still report
  // success: the prompt is in the composer and the caller's turn watcher won't
  // false-finish a turn that produced no real output.
  const success = ptyInstances.has(sessionId);
  logAgentSend(sessionId, 'submit-unconfirmed', { sessionAlive: success });
  if (success) {
    markSessionBriefed(sessionId, true);
  }
  return success;
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

/** The orchestrator-assigned assistant name (shown as the pane badge). Distinct
 * from `paneTitle`, which the agent CLI drives via OSC, so both can show at once. */
export function setSessionAgentName(id: number, agentName: string | null) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) =>
      x.id === id ? { ...x, agentName } : x
    ),
  }));
}

export function applyOscPaneTitle(id: number, paneTitle: string): void {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;

  // The agent CLI's reported title flows into `paneTitle` even for orchestrator-
  // leased panes — the assistant name lives in `agentName`, so there's no clash.
  setSessionPaneTitle(id, paneTitle);
}

export type RestoredSessionMetadata = {
  title?: string | null;
  paneTitle?: string | null;
  agentName?: string | null;
  agentPreset?: string | null;
  role?: string | null;
  taskSummary?: string | null;
};

export function applyRestoredSessionMetadata(id: number, metadata: RestoredSessionMetadata) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => {
      if (x.id !== id) return x;
      const agentPreset = metadata.agentPreset ?? x.agentPreset ?? null;
      const role = metadata.role ?? (agentPreset ? x.role ?? 'Agent' : x.role ?? null);
      return {
        ...x,
        title: metadata.title?.trim() || x.title,
        paneTitle: metadata.paneTitle ?? x.paneTitle ?? null,
        agentName: metadata.agentName ?? x.agentName ?? null,
        agentPreset,
        role,
        taskSummary: metadata.taskSummary ?? x.taskSummary ?? null,
        briefed: agentPreset ? false : x.briefed,
        isExecuting: false,
        lastExitCode: null,
      };
    }),
  }));
}

export function relaunchRestoredAgentSession(
  id: number,
  agentPreset: string,
  metadata: RestoredSessionMetadata = {}
): boolean {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId || !agentPreset.trim()) return false;

  const displayName = getAgentDisplayName(agentPreset) ?? agentPreset;
  applyRestoredSessionMetadata(id, {
    ...metadata,
    title: metadata.title?.trim() || displayName,
    agentPreset,
    role: metadata.role ?? 'Agent',
  });

  agentLaunchStartLengths.set(id, getSessionOutputBuffer(id).length);
  suppressAgentDetection.add(id);
  try {
    writeToSession(id, `${agentPreset}\r`);
  } finally {
    suppressAgentDetection.delete(id);
  }
  return true;
}

export function markSessionBriefed(id: number, briefed: boolean) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) =>
      x.id === id ? { ...x, briefed } : x
    ),
  }));
}

const READY_OUTPUT_DELTA = 16;
const READY_POLL_MS = isTestEnv ? 2 : 50;
// Phase-1 cap: how long to wait for ANY output growth. Kept shorter than the
// overall cap so a prompt to an already-idle agent (follow-up/resend — which
// produces no fresh output to wait on) isn't held for the full startup window.
const READY_NO_OUTPUT_WAIT_MS = isTestEnv ? 40 : 9000;
// Overall cap. Generous because a cold Node/Python agent CLI on Windows can
// take well over 10s to boot — pasting before it is up sends the prompt to the
// shell instead of the agent, which is worse than waiting.
const READY_MAX_WAIT_MS = isTestEnv ? 40 : 20000;
const READY_BANNER_DELTA = 32;
const READY_MIN_STARTUP_MS = isTestEnv ? 10 : 4000;
const READY_QUIET_MS = isTestEnv ? 5 : 400;
// VT sequences a TUI agent emits as it takes over the terminal: enable
// bracketed paste (?2004h) / switch to the alternate screen (?1049h). Seeing
// one of these AFTER the launch command is a precise "the agent CLI is running
// and reading input" signal. Output-quiescence alone cannot distinguish an idle
// agent from the silent gap while a cold CLI is still booting — during which
// the shell's command echo has already satisfied the growth checks, so a paste
// would land in the shell. The shell itself can't false-trigger this: it only
// re-enables bracketed paste when it prints its next prompt, i.e. after the
// agent exits.
const READY_TUI_MARKERS = ['\x1b[?2004h', '\x1b[?1049h'];
// Once the takeover marker is visible, how long to let the banner keep painting
// before declaring ready anyway. Some TUIs (status spinners) never go quiet, so
// without this they would always ride out the full max wait.
const READY_MARKER_SETTLE_MS = isTestEnv ? 5 : 1200;
// First boot of a known agent CLI: how long to hold out for the TUI takeover
// marker before giving up and pasting anyway. Longer than READY_MAX_WAIT_MS —
// a cold npm-shim CLI on Windows can sit silent well past 10s, and pasting
// while the shell still owns the terminal loses the prompt outright (TUIs
// drain pending stdin when they start).
const READY_BOOT_MARKER_WAIT_MS = isTestEnv ? 40 : 30000;
// First-boot fallback for agent CLIs that never emit a takeover marker (Ink
// apps like Claude Code don't switch to the alternate screen): a banner burst
// this large is conclusive — the shell's own command echo and a "command not
// found" error stay far below it, so the silent boot gap can't false-trigger.
const READY_BOOT_BANNER_DELTA = 512;

// Shell "command not found" signatures — the launch command itself failed, the
// agent CLI is NOT coming up, and anything pasted now executes in the shell.
// Matched against ANSI-stripped output with ALL whitespace removed, because
// terminal line-wrap splits words mid-token ("Co\n   mmandNotFound...").
const LAUNCH_FAILURE_SIGNATURES = [
  'isnotrecognized', // PowerShell: "is not recognized as the name of a cmdlet" / cmd.exe variant
  'commandnotfound', // bash/zsh "command not found" + PowerShell's CommandNotFoundException
];

function launchFailedSince(sessionId: number, startLen: number): boolean {
  const grown = getSessionOutputBuffer(sessionId).slice(startLen);
  if (!grown) return false;
  const compact = normalizeForEchoMatch(grown).replace(/\s+/g, '').toLowerCase();
  return LAUNCH_FAILURE_SIGNATURES.some((sig) => compact.includes(sig));
}

export type AgentReadiness = 'ready' | 'launch-failed';

export async function waitForAgentReady(sessionId: number): Promise<AgentReadiness> {
  const startedAt = Date.now();
  const initialBuffer = getSessionOutputBuffer(sessionId);
  const startLen = initialBuffer.length;
  const launchStartLen = agentLaunchStartLengths.get(sessionId);
  const sinceLaunch = launchStartLen != null ? initialBuffer.slice(launchStartLen) : initialBuffer;
  const tuiMarkerSeen = () => {
    const grown = getSessionOutputBuffer(sessionId).slice(startLen);
    return READY_TUI_MARKERS.some((marker) => grown.includes(marker));
  };

  // First boot of a known agent CLI (preset set, no takeover marker in the
  // buffer yet): the marker is the ONLY trustworthy ready signal — quiet-time
  // heuristics fire during the silent boot gap and the paste lands in the
  // shell. When the marker is already in the buffer the agent is (or was)
  // running and this is a follow-up send, so the quick heuristic path applies.
  const session = findSessionAnyProject(sessionId);
  const markerAlreadyVisible = READY_TUI_MARKERS.some((marker) => sinceLaunch.includes(marker));
  const bannerAlreadyVisible =
    launchStartLen != null && initialBuffer.length >= launchStartLen + READY_BOOT_BANNER_DELTA;
  const mustSeeMarker = Boolean(session?.agentPreset) && !markerAlreadyVisible && !bannerAlreadyVisible;
  const maxWaitMs = mustSeeMarker ? READY_BOOT_MARKER_WAIT_MS : READY_MAX_WAIT_MS;
  const launchFailureStartLen = launchStartLen ?? startLen;
  const display = getAgentDisplayName(session?.agentPreset) ?? session?.agentPreset ?? 'The agent CLI';

  // First boot only: the shell rejecting the launch command means the agent is
  // never coming up — abort instead of riding out the wait and pasting the
  // prompt into the shell (where it would execute line-by-line as commands).
  const launchFailed = () => {
    if (!mustSeeMarker || tuiMarkerSeen() || !launchFailedSince(sessionId, launchFailureStartLen)) return false;
    logAgentSend(sessionId, 'launch-failed', { preset: session?.agentPreset ?? null });
    showToast(
      `${display} isn't installed — the shell doesn't recognize the command. Install it (or fix PATH), then relaunch.`,
      'error',
      9000
    );
    return true;
  };

  if (Boolean(session?.agentPreset) && !markerAlreadyVisible && launchFailedSince(sessionId, launchFailureStartLen)) {
    logAgentSend(sessionId, 'launch-failed', { preset: session?.agentPreset ?? null, beforeReadyWait: true });
    showToast(
      `${display} isn't installed â€” the shell doesn't recognize the command. Install it (or fix PATH), then relaunch.`,
      'error',
      9000
    );
    return 'launch-failed';
  }

  if (bannerAlreadyVisible) {
    logAgentSend(sessionId, 'ready-existing-banner', {
      preset: session?.agentPreset ?? null,
      grownChars: initialBuffer.length - (launchStartLen ?? startLen),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, READY_QUIET_MS));
    return 'ready';
  }

  // 1. Wait for command execution to start (output grows past command echo threshold)
  let initiallyGrown = false;
  while (Date.now() - startedAt < (mustSeeMarker ? maxWaitMs : READY_NO_OUTPUT_WAIT_MS)) {
    if (launchFailed()) return 'launch-failed';
    if (getSessionOutputBuffer(sessionId).length > startLen + READY_OUTPUT_DELTA || tuiMarkerSeen()) {
      initiallyGrown = true;
      break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  if (!initiallyGrown) {
    logAgentSend(sessionId, 'ready-silent', {
      preset: session?.agentPreset ?? null,
      mustSeeMarker,
      waitedMs: Date.now() - startedAt,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, READY_QUIET_MS));
    return 'ready';
  }

  // 2. Wait until the agent CLI starts printing its banner/welcome output.
  // A TUI takeover marker is conclusive; otherwise break once the buffer grows
  // significantly, or fall back to minimum elapsed time. On a first boot the
  // small-growth/time fallbacks are disabled — the shell's command echo also
  // grows the buffer — but a large banner burst still counts (Ink CLIs like
  // Claude Code never emit a takeover marker, only their banner).
  while (Date.now() - startedAt < maxWaitMs) {
    if (launchFailed()) return 'launch-failed';
    if (tuiMarkerSeen()) break;
    const currentLen = getSessionOutputBuffer(sessionId).length;
    if (mustSeeMarker) {
      if (currentLen >= startLen + READY_BOOT_BANNER_DELTA) break;
    } else if (currentLen >= startLen + READY_BANNER_DELTA || Date.now() - startedAt >= READY_MIN_STARTUP_MS) {
      break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  // 3. Wait for the agent to be genuinely ready for input:
  //    - takeover marker seen + output quiet (banner finished), or
  //    - takeover marker visible for the settle window (TUIs that never go
  //      quiet — their input handling is live the moment the marker appears), or
  //    - no marker (line-oriented CLI): output quiet after the minimum startup
  //      time, so the silent gap of a still-booting TUI isn't mistaken for idle.
  //      (Disabled on first boot — there quiet-without-marker means still booting.)
  let markerAt: number | null = tuiMarkerSeen() ? Date.now() : null;
  let lastLen = getSessionOutputBuffer(sessionId).length;
  let lastChangeAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, READY_POLL_MS));
    if (markerAt === null && launchFailed()) return 'launch-failed';
    if (markerAt === null && tuiMarkerSeen()) markerAt = Date.now();
    const currentLen = getSessionOutputBuffer(sessionId).length;
    if (currentLen !== lastLen) {
      lastLen = currentLen;
      lastChangeAt = Date.now();
    } else if (Date.now() - lastChangeAt >= READY_QUIET_MS) {
      if (markerAt !== null) break;
      const bannerGrown = lastLen >= startLen + READY_BOOT_BANNER_DELTA;
      // No marker: quiet alone is only trustworthy past the minimum startup
      // time, and on first boot additionally only after a real banner burst
      // (quiet without one is the silent gap of a still-booting CLI).
      if ((!mustSeeMarker || bannerGrown) && Date.now() - startedAt >= READY_MIN_STARTUP_MS) break;
    }
    if (markerAt !== null && Date.now() - markerAt >= READY_MARKER_SETTLE_MS) break;
  }

  logAgentSend(sessionId, 'ready', {
    preset: session?.agentPreset ?? null,
    mustSeeMarker,
    marker: markerAt !== null,
    grownChars: getSessionOutputBuffer(sessionId).length - startLen,
    elapsedMs: Date.now() - startedAt,
  });
  return 'ready';
}

// The working-tree directory a session runs in — where a rules-file brief is
// written so the agent CLI (which searches cwd and up for CLAUDE.md / AGENTS.md)
// loads it. Prefers the session's explicit cwd; for a terminal opened without
// one (the common case when the user just types `claude`/`codex` into a shell)
// it falls back to the session's project root. Null only when neither is known,
// in which case the caller falls back to the paste brief.
function resolveSessionRoot(id: number): string | null {
  const explicit = findSessionAnyProject(id)?.cwd;
  if (explicit) return explicit;
  const projectId = terminalSessionProjects.get(id);
  return (projectId ? terminalProjectRoots.get(projectId) : null) ?? null;
}

// One auto-brief in flight per session at a time: a relaunch detected while a
// previous brief is still waiting for agent readiness must not produce two
// charter pastes racing into the same composer.
const autoBriefInFlight = new Set<number>();

async function autoBriefSession(id: number, preset: string) {
  // Cheap pre-checks before claiming the in-flight slot, so a stale schedule
  // (e.g. for a preset that was re-marked since) never blocks the live one.
  const current = get(sessions).find((s) => s.id === id);
  if (!current || !current.isRunning || current.agentPreset !== preset || current.briefed || current.ownerTaskId) {
    return;
  }
  if (autoBriefInFlight.has(id)) return;
  autoBriefInFlight.add(id);

  try {
    // Preferred channel: agents that read a rules file (Claude Code, Codex,
    // Cursor, OpenCode, Antigravity) get the standing brief from CLAUDE.md /
    // AGENTS.md natively. We write those files and skip the fragile REPL paste
    // entirely — no readiness wait, no paste race, no first-run trust screen to
    // swallow it. Falls through to the paste path only if we can't write them.
    if (agentReadsRulesFile(preset)) {
      const root = resolveSessionRoot(id);
      if (root && (await ensureAgentRulesFiles(root))) {
        logAgentSend(id, 'briefed-via-rules-file', { preset, root });
        markSessionBriefed(id, true);
        return;
      }
      logAgentSend(id, 'rules-file-unavailable', { preset, root });
    }

    if ((await waitForAgentReady(id)) === 'launch-failed') {
      // The CLI never started (command not found) — the pane is a plain shell,
      // so delivering the brief would execute it as shell commands.
      return;
    }

    const session = get(sessions).find((s) => s.id === id);
    if (!session || !session.isRunning || session.agentPreset !== preset || session.briefed) {
      return;
    }

    // If the orchestrator has leased this session in the meantime, do not auto-brief it
    if (session.ownerTaskId) {
      return;
    }

    const name = session.agentName || null;
    const brief = buildAgentCharter('', { name });
    const success = await sendAgentPromptDirect(id, brief);
    if (success) {
      markSessionBriefed(id, true);
    }
  } finally {
    autoBriefInFlight.delete(id);
  }
}

export function markSessionAgentPreset(id: number, agentPreset: string | null, briefed?: boolean) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => {
      if (x.id !== id) return x;
      if (!agentPreset) {
        // Clear agent: also remove the auto-assigned 'Agent' role if nothing custom was set
        return { ...x, agentPreset: null, role: x.role === 'Agent' ? null : x.role, briefed: false };
      }
      // Auto-assign 'Agent' role if the pane doesn't already have a custom role.
      // Without an explicit `briefed` flag this is a fresh agent launch (typed or
      // spawned), so reset `briefed` even when the pane ran the same preset
      // before — every newly-started agent process must receive the charter,
      // including relaunches in a previously-briefed pane.
      const nextBriefed = briefed !== undefined ? briefed : false;
      return { ...x, agentPreset, role: x.role ?? 'Agent', briefed: nextBriefed };
    }),
  }));

  // Trigger auto-brief if setting a preset and not already briefed/orchestrator-owned
  if (agentPreset) {
    // Run after store updates are committed
    setTimeout(() => {
      const session = get(sessions).find((s) => s.id === id);
      if (session && !session.briefed && !session.ownerTaskId) {
        void autoBriefSession(id, agentPreset);
      }
    }, 50);
  }
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
  // The assistant name (set on every spawn — orchestrator dispatch and the
  // floating bar's "+" alike) is the primary handle for an agent. Fall back to
  // the CLI product name only for sessions that never got one.
  const assistantName = session.agentName?.trim();
  if (assistantName) return assistantName;
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

/** Record the isolated worktree a (non-orchestrator) agent runs in, so its pane
 *  can show the branch badge and its worktree is torn down when the pane closes. */
export function setSessionWorktree(id: number, worktree: WorktreeInfo | null) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => (x.id === id ? { ...x, worktree } : x)),
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
  if (AGENT_DISPLAY_NAMES[agentPreset]) return AGENT_DISPLAY_NAMES[agentPreset];
  // User-defined agents store their full launch command as the preset key.
  const custom = getCustomAgents().find((a) => a.command === agentPreset);
  return custom?.name ?? agentPreset;
}

export function isAgentSession(session: TerminalSessionInfo | null | undefined): boolean {
  if (!session) return false;
  return Boolean(session.agentPreset);
}

// Roles the app auto-assigns when it detects a long-lived foreground process in
// a pane (a dev server, or a build/watch). A pane carrying one is considered
// occupied so we never launch an agent on top of it — even once its output has
// gone quiet and the transient `isExecuting` flag has cleared.
const RUNNING_PROCESS_ROLES = new Set(['server', 'build']);

export function sessionHasRunningProcess(session: TerminalSessionInfo | null | undefined): boolean {
  if (!session || !session.isRunning) return false;
  const role = session.role?.trim().toLowerCase();
  return !!role && RUNNING_PROCESS_ROLES.has(role);
}

/**
 * Find an idle, non-agent terminal that already exists for this project and
 * return its id, or create a fresh one if nothing is available. Never reuses
 * a pane that is an agent, busy, or running a detected long-lived process
 * (dev server / build) — running a command there would clobber it.
 */
export async function ensureIdleOrCreateTerminal(rootPath: string, projectId: string): Promise<number | null> {
  const sessions = getTerminalProjectState(projectId).sessions;
  const reusable = sessions.filter(
    (s) => s.isRunning && !s.agentPreset && !s.ownerTaskId && !sessionHasRunningProcess(s)
  );
  const shell = reusable.find((s) => !s.isExecuting) ?? reusable[0];
  if (shell) return shell.id;
  return await createTerminalSession(rootPath || undefined, undefined, projectId);
}


export function setSessionTaskSummary(id: number, taskSummary: string | null) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => (x.id === id ? { ...x, taskSummary } : x)),
  }));
}

// Orchestrator lease: mark which task owns this terminal. Setting null releases
// the lease (the terminal stays alive but is no longer tied to a task).
export function setSessionOwnerTask(id: number, ownerTaskId: string | null) {
  const projectId = terminalSessionProjects.get(id);
  if (!projectId) return;
  updateProjectState(projectId, (state) => ({
    ...state,
    sessions: state.sessions.map((x) => (x.id === id ? { ...x, ownerTaskId } : x)),
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
  //
  // `isExecuting` alone is not enough: it's an output-quiescence flag that the
  // pane clears after ~800ms of silence, so a long-running process that has gone
  // quiet (a dev server watching for changes, a finished-printing build/watch)
  // would read as "idle" and get an agent launched on top of it. The app already
  // detects those and tags the session with a 'Server'/'Build' role, so treat
  // any pane carrying a running-process role as occupied and never reuse it.
  const isIdleShell = (sessionId: number | null): boolean => {
    if (sessionId === null) return false;
    const session = allSessions.find((entry) => entry.id === sessionId);
    if (!session) return false;
    if (sessionHasRunningProcess(session)) return false;
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
// The visual mosaic (columns / widths / heights) is managed by TerminalPane components.
// It registers a grow function here so spawning agents can add exactly one
// tiled pane at a time, instead of jumping to a fixed grid layout that would
// leave empty filler panes. Returns the new pane index.
let mosaicGrowFn: (() => number) | null = null;

export function registerMosaicGrow(fn: (() => number) | null) {
  mosaicGrowFn = fn;
}

// Counterpart to mosaicGrowFn: called by killSession when a terminal is killed
// outside the normal closePane flow (e.g. orchestrator teardown), so the pane
// cell is removed from the mosaic and neighbors resize to fill the space.
let mosaicClosePaneFn: ((paneIndex: number) => void) | null = null;

export function registerMosaicClose(fn: ((paneIndex: number) => void) | null) {
  mosaicClosePaneFn = fn;
}

export async function spawnAgentPreset(
  command: string,
  cwd?: string,
  opts?: { activate?: boolean; skipAutoBrief?: boolean }
): Promise<number | null> {
  const activate = opts?.activate ?? true;
  // Agents are their own rooms — they never occupy the user's personal terminal
  // grid. Remember what's focused there so creating the agent session (which sets
  // activeSessionId) doesn't yank the personal terminal's active tab out from
  // under the user; we restore it below unless this agent is being focused.
  const projectForFocus = activeTerminalProjectId;
  const priorActive = projectForFocus
    ? {
        sessionId: getProjectState(projectForFocus).activeSessionId,
        paneIndex: getProjectState(projectForFocus).activePaneIndex,
      }
    : null;

  // Create a standalone session: it lives in `sessions` (so it surfaces as an
  // agent room) but is NOT assigned to any pane in the personal terminal mosaic.
  // Pass the preset so the session is born an agent — never a transient shell the
  // pane auto-fill could grab (which would leave a ghost empty pane behind).
  const sessionId = await createTerminalSession(cwd, undefined, undefined, { assignPane: false, agentPreset: command });
  if (sessionId === null || sessionId === undefined) return null;

  // Agents that read a rules file get the standing brief from CLAUDE.md /
  // AGENTS.md natively — write those before the CLI boots so it loads the brief
  // itself, and mark the session briefed so neither the auto-brief paste nor the
  // first prompt's charter-wrap is needed. Best-effort: if the write fails we
  // leave `briefed` untouched and the paste path takes over as before.
  let rulesBriefed = false;
  if (agentReadsRulesFile(command)) {
    const root = cwd ?? resolveSessionRoot(sessionId);
    if (root) {
      try { rulesBriefed = await ensureAgentRulesFiles(root); }
      catch (err) { console.error('Failed to ensure agent rules files:', err); }
    }
  }
  markSessionAgentPreset(sessionId, command, opts?.skipAutoBrief || rulesBriefed || undefined);
  const displayName = getAgentDisplayName(command) ?? command;
  updateSessionTitle(sessionId, displayName);
  agentLaunchStartLengths.set(sessionId, getSessionOutputBuffer(sessionId).length);
  // Suppress agent-command detection for our own launch write: the preset (and
  // the caller's briefed flag) was just recorded above, and re-detection would
  // reset `briefed` — double-briefing plain spawns and breaking skipAutoBrief
  // for orchestrator dispatch (which delivers its own charter-wrapped goal).
  suppressAgentDetection.add(sessionId);
  try {
    writeToSession(sessionId, command + '\r');
  } finally {
    suppressAgentDetection.delete(sessionId);
  }

  // The standing operating brief is delivered automatically: orchestrator
  // dispatch (skipAutoBrief) wraps it around the goal itself; every other spawn
  // is briefed by autoBriefSession via the readiness-gated agent-charter path.

  // createTerminalSession set the new agent as the active session. When this
  // agent isn't being focused (a background/secondary spawn), restore the
  // personal terminal's prior active tab so it stays put.
  if (!activate && projectForFocus && priorActive?.sessionId != null && priorActive.sessionId !== sessionId) {
    updateProjectState(projectForFocus, (state) => ({
      ...state,
      activeSessionId: priorActive.sessionId,
    }));
  }

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
  dataCallbacks.clear();
  exitCallbacks.clear();
  sessionOutputBuffers.clear();
  sessionOutputDecoders.clear();
  sessionInputBuffers.clear();
  agentLaunchStartLengths.clear();
  terminalSessionProjects.clear();
  suppressAgentDetection.clear();
  autoBriefInFlight.clear();
}

export async function killSession(id: number) {
  const projectId = terminalSessionProjects.get(id);

  // Capture which pane the session occupies BEFORE the state update nulls the
  // assignment. When killSession is called from outside closePane (e.g. the
  // orchestrator), we use this to remove the mosaic cell so neighbors resize.
  // When called from closePane (which removes the cell first then calls us),
  // the cell is already gone so mosaicClosePaneFn becomes a no-op there.
  const paneIndexForMosaicClose = projectId
    ? getProjectState(projectId).paneAssignments.indexOf(id)
    : get(paneAssignments).indexOf(id);

  // Tear down a session-owned worktree (floating-bar agents) when its pane is
  // closed. Orchestrator agents carry no session worktree — theirs lives on the
  // task and is cleaned up on task deletion — so this never touches those. The
  // branch is kept so any committed work remains recoverable.
  if (projectId) {
    const closing = getProjectState(projectId).sessions.find((s) => s.id === id);
    if (closing?.worktree) void removeTaskWorktree(projectId, closing.worktree, false);
  }

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
  agentLaunchStartLengths.delete(id);
  terminalSessionProjects.delete(id);

  // Close the mosaic cell so surrounding terminals reclaim the freed space.
  // No-op when: called from closePane (cell already removed before killSession),
  // the session was orphaned (paneIndex === -1), or TerminalPanel isn't mounted.
  if (paneIndexForMosaicClose !== -1 && mosaicClosePaneFn) {
    mosaicClosePaneFn(paneIndexForMosaicClose);
  }

  // Tear the pty down in the background; state no longer depends on it.
  const pty = ptyInstances.get(id);
  if (pty) {
    ptyInstances.delete(id);
    await pty.close().catch((err) => console.error('Failed to close terminal:', err));
  }
}

