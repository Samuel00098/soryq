import { writable, get } from 'svelte/store';
import { openPty, type PtySession } from '$lib/services/pty-bridge';
import { terminalShell } from '$lib/stores/settings';
import { showToast } from '$lib/stores/notification';

export type TerminalSessionInfo = {
  id: number;
  title: string;
  isRunning: boolean;
  isExecuting?: boolean;
  agentPreset?: string | null;
  lastActivatedAt?: number;
  role?: string | null;
  cwd?: string | null;
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

// Command history store, persisted in localStorage
export const commandHistory = writable<string[]>(
  typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('forge_terminal_history') || '[]')
    : []
);

if (typeof window !== 'undefined') {
  commandHistory.subscribe((history) => {
    localStorage.setItem('forge_terminal_history', JSON.stringify(history));
  });
}

export function addHistoryEntry(cmd: string) {
  if (!cmd || cmd.trim() === '') return;
  commandHistory.update((hist) => {
    const filtered = hist.filter((x) => x !== cmd);
    return [cmd, ...filtered].slice(0, 100); // Keep last 100 entries
  });
}

// Grid layout: which format is the terminal area in
export const gridLayout = writable<GridLayout>('single');

// Which session IDs occupy each pane slot (null = empty/new terminal slot)
export const paneAssignments = writable<(number | null)[]>([null]);

// Which pane index is focused (receives keyboard)
export const activePaneIndex = writable<number>(0);

const ptyInstances = new Map<number, PtySession>();
const dataCallbacks = new Map<number, (data: Uint8Array) => void>();

export function getLayoutPaneCount(layout: GridLayout): number {
  if (layout === 'single') return 1;
  if (layout === '3h' || layout === '3v') return 3;
  if (layout === '4') return 4;
  if (layout === '9') return 9;
  return 2;
}

export function setGridLayout(layout: GridLayout) {
  gridLayout.set(layout);
  const count = getLayoutPaneCount(layout);
  paneAssignments.update((current) => {
    const updated = [...current];
    // Trim or extend
    while (updated.length < count) updated.push(null);
    return updated.slice(0, count);
  });
  activePaneIndex.update((i) => Math.min(i, count - 1));
}

export function assignToPane(paneIdx: number, sessionId: number | null) {
  paneAssignments.update((p) => {
    const copy = [...p];
    copy[paneIdx] = sessionId;
    return copy;
  });
}

export function focusPane(paneIdx: number) {
  activePaneIndex.set(paneIdx);
  const panes = get(paneAssignments);
  if (panes[paneIdx] !== null) {
    activateSessionInPane(panes[paneIdx]!);
  }
}

export function setActiveSession(id: number) {
  activateSessionInPane(id);
}

export function activateSessionInPane(id: number) {
  const panes = get(paneAssignments);
  const idx = panes.indexOf(id);
  if (idx !== -1) {
    activePaneIndex.set(idx);
  }
  activeSessionId.set(id);
  sessions.update((all) =>
    all.map((session) => (
      session.id === id
        ? { ...session, lastActivatedAt: Date.now() }
        : session
    ))
  );
}

export function registerDataCallback(id: number, cb: (data: Uint8Array) => void) {
  dataCallbacks.set(id, cb);
}

export function unregisterDataCallback(id: number) {
  dataCallbacks.delete(id);
}

export async function createTerminalSession(cwd?: string, targetPaneIndex?: number): Promise<number | null> {
  try {
    let pty: PtySession;

    const ptyPromise = openPty(80, 24, {
      onData: (bytes) => {
        const cb = dataCallbacks.get(pty.id);
        cb?.(bytes);
      },
      onExit: (code) => {
        const session = get(sessions).find((x) => x.id === pty.id);
        sessions.update((s) =>
          s.map((x) => (x.id === pty.id ? { ...x, isRunning: false } : x)),
        );
        const label = session
          ? getSessionLabel(session, get(sessions))
          : `Terminal ${pty.id}`;
        const isAgent = Boolean(session?.agentPreset);
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

    const sessionNum = get(sessions).length + 1;
    const info: TerminalSessionInfo = {
      id: pty.id,
      title: `Terminal ${sessionNum}`,
      isRunning: true,
      lastActivatedAt: Date.now(),
    };

    sessions.update((s) => [...s, info]);
    activeSessionId.set(pty.id);

    // Assign to target index if specified, otherwise first empty pane, or add to a pane if all full
    paneAssignments.update((panes) => {
      const copy = [...panes];
      if (targetPaneIndex !== undefined && targetPaneIndex >= 0 && targetPaneIndex < copy.length) {
        copy[targetPaneIndex] = pty.id;
        activePaneIndex.set(targetPaneIndex);
        return copy;
      }
      const emptyIdx = copy.findIndex((p) => p === null);
      if (emptyIdx !== -1) {
        copy[emptyIdx] = pty.id;
        activePaneIndex.set(emptyIdx);
        return copy;
      }
      // All panes full — assign to the currently active pane
      const activeIdx = get(activePaneIndex);
      copy[activeIdx] = pty.id;
      return copy;
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
    pty.write(data).catch((err) => console.error('Failed to write to terminal:', err));
  }
}

export function setSessionExecuting(id: number, executing: boolean) {
  sessions.update((s) =>
    s.map((x) => (x.id === id ? { ...x, isExecuting: executing } : x))
  );
}

export function markSessionAgentPreset(id: number, agentPreset: string | null) {
  sessions.update((s) =>
    s.map((x) => {
      if (x.id !== id) return x;
      if (!agentPreset) {
        // Clear agent: also remove the auto-assigned 'Agent' role if nothing custom was set
        return { ...x, agentPreset: null, role: x.role === 'Agent' ? null : x.role };
      }
      // Auto-assign 'Agent' role if the pane doesn't already have a custom role
      return { ...x, agentPreset, role: x.role ?? 'Agent' };
    })
  );
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
  sessions.update((s) =>
    s.map((x) => (x.id === id ? { ...x, role } : x))
  );
}

export function setSessionCwd(id: number, cwd: string | null) {
  sessions.update((s) =>
    s.map((x) => (x.id === id ? { ...x, cwd } : x))
  );
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
  commandBlocks.update((map) => {
    const list = map.get(sessionId);
    if (!list || list.length === 0) return map;
    const last = list[list.length - 1];
    if (last.endTime !== undefined) return map;
    const copy = new Map(map);
    const updated = [...list.slice(0, -1), { ...last, endTime: Date.now(), collapsed: true }];
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
    if (session?.isRunning && !session.agentPreset) {
      return { paneIdx, sessionId };
    }
  }

  const activeSessionId = panes[activeIdx];
  if (activeSessionId === null) {
    return { paneIdx: activeIdx, sessionId: null as number | null };
  }

  const activeSession = allSessions.find((entry) => entry.id === activeSessionId);
  if (activeSession?.isRunning && !activeSession.agentPreset) {
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
  const pty = ptyInstances.get(id);
  if (pty) {
    await pty.close().catch((err) => console.error('Failed to close terminal:', err));
    ptyInstances.delete(id);
  }
  dataCallbacks.delete(id);
  sessions.update((s) => s.filter((x) => x.id !== id));

  // Remove from pane assignments
  paneAssignments.update((panes) => panes.map((p) => (p === id ? null : p)));

  // Update active session
  activeSessionId.update((active) => {
    if (active !== id) return active;
    const $sessions = get(sessions);
    return $sessions.length > 0 ? $sessions[$sessions.length - 1].id : null;
  });
}
