import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { EditorFile } from '$lib/types/editor';
import { showToast } from './notification';
import { formatCode } from '$lib/utils/formatter';
import { formatOnSave } from './settings';
import { layout } from './layout';

export const openFiles = writable<string[]>([]);
export const activeFile = writable<string | null>(null);
export const fileCache = writable<Map<string, EditorFile>>(new Map());
export const activeLine = writable<number>(1);
export const activeColumn = writable<number>(1);
export const jumpToLine = writable<{ path: string; line: number } | null>(null);

export function updateCursorPosition(line: number, col: number) {
  activeLine.set(line);
  activeColumn.set(col);
}

// Helper to detect language from file extension
export function detectLanguage(path: string): string {
  const filename = path.split(/[/\\]/).pop()?.toLowerCase() || '';
  const ext = filename.split('.').pop()?.toLowerCase();
  const name = filename.split('.').slice(0, -1).join('.');

  // Shell files without extensions (e.g., "run.sh" → ext is "sh")
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh' || (!ext && name === '' && filename !== '')) {
    return 'shell';
  }

  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'sass':
      return 'sass';
    case 'rs':
      return 'rust';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'py':
      return 'python';
    case 'java':
      return 'java';
    case 'c':
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'h':
    case 'hpp':
    case 'hxx':
    case 'cs':
      return 'cpp';
    case 'php':
      return 'php';
    case 'sql':
      return 'sql';
    case 'xml':
    case 'svg':
    case 'plist':
      return 'xml';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'go':
      return 'go';
    case 'swift':
      return 'swift';
    case 'kt':
    case 'kts':
      return 'kotlin';
    default:
      return 'plaintext';
  }
}

export async function openFile(path: string) {
  const currentOpenFiles = get(openFiles);
  const cache = get(fileCache);

  if (currentOpenFiles.includes(path)) {
    activeFile.set(path);
    layout.update((l) => ({ ...l, editorVisible: true, activeView: 'editor' }));
    return;
  }

  try {
    const content = await invoke<string>('fs_read_file', { path });
    const language = detectLanguage(path);

    const editorFile: EditorFile = {
      path,
      content,
      originalContent: content,
      isDirty: false,
      language,
    };

    fileCache.update((c) => {
      const next = new Map(c);
      next.set(path, editorFile);
      return next;
    });

    openFiles.update((files) => [...files, path]);
    activeFile.set(path);
    layout.update((l) => ({ ...l, editorVisible: true, activeView: 'editor' }));
  } catch (err: any) {
    console.error('Failed to open file:', err);
    showToast(`Failed to open file: ${err?.message || err}`, 'error');
  }
}

export function closeFile(path: string) {
  const currentActive = get(activeFile);
  const files = get(openFiles);

  const updatedFiles = files.filter((f) => f !== path);
  openFiles.set(updatedFiles);

  fileCache.update((c) => {
    const next = new Map(c);
    next.delete(path);
    return next;
  });

  if (currentActive === path) {
    if (updatedFiles.length > 0) {
      activeFile.set(updatedFiles[updatedFiles.length - 1]);
    } else {
      activeFile.set(null);
    }
  }
}

export function updateContent(path: string, newContent: string) {
  fileCache.update((cache) => {
    const next = new Map(cache);
    const file = next.get(path);
    if (file) {
      const isDirty = newContent !== file.originalContent;
      next.set(path, {
        ...file,
        content: newContent,
        isDirty,
      });
    }
    return next;
  });
}

export async function saveFile(path: string) {
  const cache = get(fileCache);
  const file = cache.get(path);
  if (!file) return;

  let contentToSave = file.content;

  if (get(formatOnSave)) {
    try {
      const formatted = await formatCode(file.content, path);
      if (formatted !== file.content) {
        contentToSave = formatted;
        fileCache.update((c) => {
          const next = new Map(c);
          next.set(path, {
            ...file,
            content: formatted,
            isDirty: true,
          });
          return next;
        });
      }
    } catch (err: any) {
      console.warn('Formatting failed before save, saving unformatted content:', err);
    }
  }

  try {
    await invoke('fs_write_file', { path, content: contentToSave });
    fileCache.update((c) => {
      const next = new Map(c);
      const currentFile = next.get(path) || file;
      next.set(path, {
        ...currentFile,
        content: contentToSave,
        originalContent: contentToSave,
        isDirty: false,
      });
      return next;
    });
    const filename = path.split(/[/\\]/).pop() || path;
    showToast(`Saved ${filename}`, 'success');
  } catch (err: any) {
    console.error('Failed to save file:', err);
    showToast(`Failed to save file: ${err?.message || err}`, 'error');
  }
}

export async function saveActiveFile() {
  const active = get(activeFile);
  if (active) {
    await saveFile(active);
  }
}

export async function formatActiveFile() {
  const active = get(activeFile);
  if (!active) return;
  const cache = get(fileCache);
  const file = cache.get(active);
  if (!file) return;

  try {
    const formatted = await formatCode(file.content, active);
    if (formatted !== file.content) {
      fileCache.update((c) => {
        const next = new Map(c);
        next.set(active, {
          ...file,
          content: formatted,
          isDirty: formatted !== file.originalContent,
        });
        return next;
      });
      showToast('Formatted document', 'success');
    } else {
      showToast('Document already formatted', 'info');
    }
  } catch (err: any) {
    console.error('Manual formatting failed:', err);
    showToast(`Formatting failed: ${err?.message || err}`, 'error');
  }
}

