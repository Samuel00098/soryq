import { invoke, Channel } from '@tauri-apps/api/core';

export type PtyHandlers = {
  onData: (bytes: Uint8Array) => void;
  onExit?: (code: number) => void;
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
