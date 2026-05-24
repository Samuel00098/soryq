import { writable, get } from 'svelte/store';
import { openPty, type PtySession } from '$lib/services/pty-bridge';
import { terminalShell } from '$lib/stores/settings';
import { showToast } from '$lib/stores/notification';

export type TerminalSessionInfo = {
  id: number;
  title: string;
  isRunning: boolean;
  isExecuting?: boolean;
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
    activeSessionId.set(panes[paneIdx]);
  }
}

export function setActiveSession(id: number) {
  activeSessionId.set(id);
  // Also ensure the pane showing this session is active
  const panes = get(paneAssignments);
  const idx = panes.indexOf(id);
  if (idx !== -1) activePaneIndex.set(idx);
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
      onExit: () => {
        const session = get(sessions).find((x) => x.id === pty.id);
        sessions.update((s) =>
          s.map((x) => (x.id === pty.id ? { ...x, isRunning: false } : x)),
        );
        showToast(session ? `${session.title} ended` : `Terminal ${pty.id} ended`, 'warning', undefined, true);
      },
    }, cwd, get(terminalShell) || undefined);

    pty = await ptyPromise;
    ptyInstances.set(pty.id, pty);

    const sessionNum = get(sessions).length + 1;
    const info: TerminalSessionInfo = {
      id: pty.id,
      title: `Terminal ${sessionNum}`,
      isRunning: true,
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

export function resizeSession(id: number, rows: number, cols: number) {
  const pty = ptyInstances.get(id);
  if (pty) {
    pty.resize(cols, rows).catch((err) => console.error('Failed to resize terminal:', err));
  }
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
