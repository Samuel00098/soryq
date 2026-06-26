import { invoke, Channel } from '@tauri-apps/api/core';

export type PtyHandlers = {
  onData: (bytes: Uint8Array) => void;
  onExit?: (code: number) => void;
  // Buffered history returned by terminal_attach. Delivered separately from
  // onData because it must NOT be written to a live xterm pane outside the
  // gated replay path: the history contains the child's past color/DA queries,
  // and xterm's re-answers would land in the running child's input as literal
  // `]10;rgb:…` text (the Codex reload bug).
  onReplay?: (bytes: Uint8Array) => void;
};

export type PtySession = {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
};

export type ShellInfo = {
  program: string;
  args: string[];
};

export async function getAvailableShells(): Promise<ShellInfo[]> {
  try {
    return await invoke<ShellInfo[]>('terminal_list_shells');
  } catch {
    return [];
  }
}

export async function openPty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
  shellProgram?: string,
  env?: Record<string, string>,
): Promise<PtySession> {
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();

  let released = false;
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = () => {};
    onExit.onmessage = () => {};
  };

  // When the child exits on its own (e.g. the user types `exit`), the backend
  // PtyManager + rate-limiter entries are NOT freed by the exit itself — only an
  // explicit `terminal_close` does that. Without this, dead sessions accumulate
  // for the app's lifetime. We free the backend exactly once, whether the exit is
  // the trigger or an explicit close() is.
  let closed = false;
  let backendId: number | null = null;
  let exited = false;
  const freeBackend = () => {
    if (closed || backendId === null) return;
    closed = true;
    // The process is already gone; close()'s kill is a harmless no-op.
    void invoke('terminal_close', { id: backendId }).catch(() => {});
  };

  onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
  onExit.onmessage = (code) => {
    exited = true;
    handlers.onExit?.(code);
    releaseHandlers();
    freeBackend();
  };

  const id = await invoke<number>('terminal_create', {
    cols,
    rows,
    cwd: cwd ?? null,
    shellProgram: shellProgram ?? null,
    onData,
    onExit,
    env: env ?? null,
  });
  backendId = id;
  // If the child exited during creation (before the id resolved), free it now
  // that we finally have the id to address.
  if (exited) freeBackend();

  return {
    id,
    write: (data) => invoke('terminal_write', { id, data }),
    resize: (c, r) => invoke('terminal_resize', { id, cols: c, rows: r }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke('terminal_close', { id });
      } finally {
        releaseHandlers();
      }
    },
  };
}

export async function attachPty(
  id: number,
  handlers: PtyHandlers,
): Promise<PtySession> {
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();

  let released = false;
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = () => {};
    onExit.onmessage = () => {};
  };

  let closed = false;
  const freeBackend = () => {
    if (closed) return;
    closed = true;
    void invoke('terminal_close', { id }).catch(() => {});
  };

  // Live chunks can be delivered on the channel before the attach invoke
  // resolves with the history buffer. Queue them until the replay has been
  // handed off so the consumer always sees history first, then live output.
  let pendingLive: Uint8Array[] | null = [];
  onData.onmessage = (buf) => {
    const bytes = new Uint8Array(buf);
    if (pendingLive) pendingLive.push(bytes);
    else handlers.onData(bytes);
  };
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
    freeBackend();
  };

  const replayBuf = await invoke<ArrayBuffer>('terminal_attach', {
    id,
    onData,
    onExit,
  });
  const replay = new Uint8Array(replayBuf);
  if (replay.length > 0) handlers.onReplay?.(replay);
  const queued = pendingLive;
  pendingLive = null;
  for (const bytes of queued) handlers.onData(bytes);

  return {
    id,
    write: (data) => invoke('terminal_write', { id, data }),
    resize: (c, r) => invoke('terminal_resize', { id, cols: c, rows: r }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke('terminal_close', { id });
      } finally {
        releaseHandlers();
      }
    },
  };
}
