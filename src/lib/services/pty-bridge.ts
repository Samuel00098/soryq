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

  onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
  };

  const id = await invoke<number>('terminal_create', {
    cols,
    rows,
    cwd: cwd ?? null,
    shellProgram: shellProgram ?? null,
    onData,
    onExit,
  });

  let closed = false;

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
