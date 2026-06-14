/**
 * LSP client management for the code editor.
 *
 * A language server is correct autocomplete: it actually knows the project's
 * types, symbols and imports (unlike word- or AI-based completion which guess).
 * This module owns the bridge to the Rust side:
 *
 *   - `lsp_check_server` tells us whether a server binary is installed.
 *   - `lsp_start` spawns the server behind a localhost WebSocket and hands back
 *     a single-use connection token.
 *
 * We share ONE `LanguageServerClient` per (workspace root, server language) so
 * that all open files of a language talk to a single server process — spawning
 * one rust-analyzer per `.rs` file would re-index the project every time.
 */
import { invoke, Channel } from '@tauri-apps/api/core';
import { writable } from 'svelte/store';
import {
  LanguageServerClient,
  WebSocketTransport,
  languageServerWithTransport,
} from 'codemirror-languageserver';
import type { Extension } from '@codemirror/state';
import { showToast, dismissToast, toasts } from '$lib/stores/notification';
import { get } from 'svelte/store';

/** Soryq language ids (from `detectLanguage`) that we offer LSP for. */
const SUPPORTED = new Set(['typescript', 'javascript', 'rust', 'python', 'go']);

type ServerStatus = {
  language: string;
  supported: boolean;
  available: boolean;
  command: string;
  install_hint: string;
};

type LspConnection = {
  port: number;
  token: string;
  root_uri: string;
};

type ClientEntry = {
  client: LanguageServerClient;
  transport: WebSocketTransport;
  rootUri: string;
  refs: number;
};

export type LspHandle = {
  /** CodeMirror extension wiring this document to the server. */
  extension: Extension;
  /** Detach this document; closes the shared server when the last file closes. */
  dispose: () => void;
};

const clients = new Map<string, ClientEntry>();
const statusCache = new Map<string, ServerStatus>();
/** Languages we've already warned the user about (missing server) this session. */
const warned = new Set<string>();
/** Languages currently being installed, to avoid double-triggering. */
const installing = new Set<string>();

/**
 * Bumped after a successful server install so open editors re-attempt LSP without
 * needing the file to be reopened. CodeEditor's load effect depends on this.
 */
export const lspReload = writable(0);

/**
 * Collapse JS/TS onto a single server: typescript-language-server serves both,
 * so one process per project handles every .ts/.tsx/.js/.jsx file.
 */
function serverLanguage(language: string): string {
  if (language === 'javascript') return 'typescript';
  return language;
}

/** Per-document LSP languageId, derived from the extension (JSX/TSX matter). */
function languageIdForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'tsx':
      return 'typescriptreact';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'jsx':
      return 'javascriptreact';
    case 'rs':
      return 'rust';
    case 'py':
    case 'pyi':
      return 'python';
    case 'go':
      return 'go';
    default:
      return ext;
  }
}

/** Convert an absolute OS path to a `file://` URI matching the Rust side. */
function pathToFileUri(p: string): string {
  let path = p.replace(/\\/g, '/');
  // Windows drive paths need a leading slash: C:/x -> /C:/x
  if (/^[a-zA-Z]:/.test(path)) path = `/${path}`;
  return encodeURI(`file://${path}`);
}

async function checkServer(language: string): Promise<ServerStatus> {
  const cached = statusCache.get(language);
  if (cached) return cached;
  const status = await invoke<ServerStatus>('lsp_check_server', { language });
  statusCache.set(language, status);
  return status;
}

async function getOrCreateClient(
  root: string,
  serverLang: string,
): Promise<ClientEntry> {
  const key = `${root}::${serverLang}`;
  const existing = clients.get(key);
  if (existing) {
    existing.refs += 1;
    return existing;
  }

  const conn = await invoke<LspConnection>('lsp_start', {
    root,
    language: serverLang,
  });
  const uri = `ws://127.0.0.1:${conn.port}/lsp?token=${conn.token}`;
  const transport = new WebSocketTransport(uri);
  const rootName = root.split(/[\\/]/).filter(Boolean).pop() || 'workspace';

  const client = new LanguageServerClient({
    transport,
    rootUri: conn.root_uri,
    workspaceFolders: [{ uri: conn.root_uri, name: rootName }],
    // The client carries base options; the per-document plugin overrides these.
    documentUri: conn.root_uri,
    languageId: serverLang,
    autoClose: false,
    onClose: () => {
      // Server died or socket dropped — drop the entry so the next file reopen
      // reconnects with a fresh process.
      clients.delete(key);
    },
    onError: (err) => console.error(`LSP (${serverLang}) error:`, err),
  });

  const entry: ClientEntry = { client, transport, rootUri: conn.root_uri, refs: 1 };
  clients.set(key, entry);
  return entry;
}

function releaseClient(root: string, serverLang: string) {
  const key = `${root}::${serverLang}`;
  const entry = clients.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    clients.delete(key);
    try {
      entry.client.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Build an LSP extension for a document, or return null when LSP isn't available
 * (unsupported language, missing server binary, or no project root). When the
 * server isn't installed, the user is told how to install it — once per session.
 */
export async function createLspExtension(
  filePath: string,
  language: string,
  root: string | null | undefined,
): Promise<LspHandle | null> {
  if (!root || !SUPPORTED.has(language)) return null;

  const status = await checkServer(language);
  if (!status.supported) return null;
  if (!status.available) {
    if (!warned.has(language)) {
      warned.add(language);
      showToast(
        `Autocomplete for ${language} needs ${status.command}.`,
        'info',
        8000,
        false,
        { label: 'Install', onClick: () => void installServer(language) },
      );
    }
    return null;
  }

  const serverLang = serverLanguage(language);
  let entry: ClientEntry;
  try {
    entry = await getOrCreateClient(root, serverLang);
  } catch (err: any) {
    console.error('Failed to start language server:', err);
    if (!warned.has(`start:${language}`)) {
      warned.add(`start:${language}`);
      showToast(`Could not start ${status.command}: ${err?.message ?? err}`, 'error');
    }
    return null;
  }

  const extension = languageServerWithTransport({
    client: entry.client,
    transport: entry.transport,
    rootUri: entry.rootUri,
    workspaceFolders: [{ uri: entry.rootUri, name: 'workspace' }],
    documentUri: pathToFileUri(filePath),
    languageId: languageIdForPath(filePath),
    allowHTMLContent: true,
  });

  let disposed = false;
  return {
    extension,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      releaseClient(root, serverLang);
    },
  };
}

/** Whether LSP autocomplete is offered for a given Soryq language id. */
export function lspSupportsLanguage(language: string): boolean {
  return SUPPORTED.has(language);
}

/** Dismiss any active toast whose message exactly matches (our progress toast). */
function dismissByMessage(message: string) {
  for (const t of get(toasts)) {
    if (t.message === message) dismissToast(t.id);
  }
}

/**
 * Install the language server for a language in the background, streaming a
 * progress toast. On success, clears the availability cache and pings open
 * editors (via `lspReload`) so autocomplete activates without reopening the file.
 */
export async function installServer(language: string): Promise<void> {
  if (installing.has(language)) return;

  const status = await checkServer(language);
  if (status.available) {
    showToast(`${status.command} is already installed.`, 'info');
    return;
  }

  installing.add(language);
  const progress = `Installing ${status.command}…`;
  showToast(progress, 'info', 0); // duration 0 = persists until we dismiss it

  const recent: string[] = [];
  const onOutput = new Channel<string>();
  onOutput.onmessage = (line) => {
    recent.push(line);
    if (recent.length > 50) recent.shift();
  };
  const onDone = new Channel<number>();
  const finished = new Promise<number>((resolve) => {
    onDone.onmessage = resolve;
  });

  try {
    await invoke('lsp_install_server', { language, onOutput, onDone });
  } catch (err: any) {
    installing.delete(language);
    dismissByMessage(progress);
    showToast(`Couldn't install ${status.command}: ${err?.message ?? err}`, 'error', 8000);
    return;
  }

  const code = await finished;
  installing.delete(language);
  dismissByMessage(progress);

  if (code === 0) {
    // The just-installed binary changes availability; drop cached "not found"
    // results and let editors retry.
    statusCache.clear();
    warned.clear();
    showToast(`${status.command} installed — autocomplete is now active.`, 'success');
    lspReload.update((n) => n + 1);
  } else {
    const tail = recent.slice(-2).join(' ').slice(0, 200);
    showToast(
      `Install failed (exit ${code}). ${tail || `Try manually: ${status.install_hint}`}`,
      'error',
      10000,
    );
  }
}
