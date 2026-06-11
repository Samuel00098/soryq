import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { EditorFile } from '$lib/types/editor';
import { showToast } from './notification';
import { formatCode } from '$lib/utils/formatter';
import { formatOnSave } from './settings';
import { setActiveView } from './layout';

export const openFiles = writable<string[]>([]);
export const activeFile = writable<string | null>(null);
export const fileCache = writable<Map<string, EditorFile>>(new Map());
export const activeLine = writable<number>(1);
export const activeColumn = writable<number>(1);
export const jumpToLine = writable<{ path: string; line: number } | null>(null);

const IMAGE_EXTENSIONS = new Set([
  'png', 'apng', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'webp', 'bmp', 'ico', 'cur',
  'svg', 'avif', 'tif', 'tiff',
]);

export function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function getImageMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'apng':
      return 'image/apng';
    case 'jpg':
    case 'jpeg':
    case 'jpe':
    case 'jfif':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
    case 'cur':
      return 'image/x-icon';
    case 'svg':
      return 'image/svg+xml';
    case 'avif':
      return 'image/avif';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

function createObjectUrl(bytes: number[], mimeType: string): string {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  return URL.createObjectURL(blob);
}

function revokeEditorAsset(file: EditorFile | undefined) {
  if (file?.kind === 'image' && file.imageSrc?.startsWith('blob:')) {
    URL.revokeObjectURL(file.imageSrc);
  }
}

export function updateCursorPosition(line: number, col: number) {
  activeLine.set(line);
  activeColumn.set(col);
}

// Helper to detect language from file extension
export function detectLanguage(path: string): string {
  if (isImagePath(path)) {
    return 'image';
  }

  const filename = path.split(/[/\\]/).pop()?.toLowerCase() || '';
  const ext = filename.split('.').pop()?.toLowerCase();
  const name = filename.split('.').slice(0, -1).join('.');

  // Shell files without extensions (e.g., "run.sh" -> ext is "sh")
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

  if (currentOpenFiles.includes(path)) {
    activeFile.set(path);
    setActiveView('editor');
    return;
  }

  try {
    let editorFile: EditorFile;

    if (isImagePath(path)) {
      const bytes = await invoke<number[]>('fs_read_binary', { path });
      const mimeType = getImageMimeType(path);
      editorFile = {
        path,
        content: '',
        originalContent: '',
        isDirty: false,
        language: 'image',
        kind: 'image',
        imageSrc: createObjectUrl(bytes, mimeType),
        mimeType,
        size: bytes.length,
      };
    } else {
      const content = await invoke<string>('fs_read_file', { path });
      const language = detectLanguage(path);
      editorFile = {
        path,
        content,
        originalContent: content,
        isDirty: false,
        language,
        kind: 'text',
        imageSrc: null,
        mimeType: null,
        size: content.length,
      };
    }

    fileCache.update((c) => {
      const next = new Map(c);
      next.set(path, editorFile);
      return next;
    });

    openFiles.update((files) => [...files, path]);
    activeFile.set(path);
    setActiveView('editor');
  } catch (err: any) {
    console.error('Failed to open file:', err);
    showToast(`Failed to open file: ${err?.message || err}`, 'error');
  }
}

export function closeFile(path: string) {
  const currentActive = get(activeFile);
  const files = get(openFiles);
  const cachedFile = get(fileCache).get(path);

  const updatedFiles = files.filter((f) => f !== path);
  openFiles.set(updatedFiles);

  fileCache.update((c) => {
    const next = new Map(c);
    next.delete(path);
    return next;
  });

  revokeEditorAsset(cachedFile);

  if (currentActive === path) {
    if (updatedFiles.length > 0) {
      activeFile.set(updatedFiles[updatedFiles.length - 1]);
    } else {
      activeFile.set(null);
    }
  }
}

export function onFileRenamed(oldPath: string, newPath: string) {
  openFiles.update((files) => files.map((f) => (f === oldPath ? newPath : f)));
  activeFile.update((a) => (a === oldPath ? newPath : a));
  fileCache.update((cache) => {
    const existing = cache.get(oldPath);
    if (!existing) return cache;
    const next = new Map(cache);
    next.delete(oldPath);
    next.set(newPath, { ...existing, path: newPath });
    return next;
  });
}

function normalisePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

export function onFileDeleted(path: string) {
  // Close exact file match
  closeFile(path);
  // Close any open files that lived inside a deleted directory
  const deletedPath = normalisePathSeparators(path).replace(/\/+$/, '');
  const dirPrefix = `${deletedPath}/`;
  const children = get(openFiles).filter((f) => normalisePathSeparators(f).startsWith(dirPrefix));
  children.forEach(closeFile);
}

export function updateContent(path: string, newContent: string) {
  fileCache.update((cache) => {
    const next = new Map(cache);
    const file = next.get(path);
    if (file && file.kind === 'text') {
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
  if (!file || file.kind !== 'text') return;

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

/**
 * Restores a set of previously open files from disk without switching the active view.
 * Used on app reopen to silently reload editor tabs.
 */
export async function restoreEditorFiles(filePaths: string[], activeFilePath: string | null) {
  const previousCache = get(fileCache);
  const newCache = new Map<string, EditorFile>();
  const validPaths: string[] = [];

  for (const path of filePaths) {
    try {
      if (isImagePath(path)) {
        const bytes = await invoke<number[]>('fs_read_binary', { path });
        const mimeType = getImageMimeType(path);
        newCache.set(path, {
          path,
          content: '',
          originalContent: '',
          isDirty: false,
          language: 'image',
          kind: 'image',
          imageSrc: createObjectUrl(bytes, mimeType),
          mimeType,
          size: bytes.length,
        });
      } else {
        const content = await invoke<string>('fs_read_file', { path });
        newCache.set(path, {
          path,
          content,
          originalContent: content,
          isDirty: false,
          language: detectLanguage(path),
          kind: 'text',
          imageSrc: null,
          mimeType: null,
          size: content.length,
        });
      }
      validPaths.push(path);
    } catch {
      // File deleted or moved - skip silently
    }
  }

  previousCache.forEach((file, path) => {
    if (!newCache.has(path)) {
      revokeEditorAsset(file);
    }
  });

  fileCache.set(newCache);
  openFiles.set(validPaths);
  const restoredActive = validPaths.includes(activeFilePath ?? '') ? activeFilePath : (validPaths[0] ?? null);
  activeFile.set(restoredActive);
}

export async function formatActiveFile() {
  const active = get(activeFile);
  if (!active) return;
  const cache = get(fileCache);
  const file = cache.get(active);
  if (!file) return;
  if (file.kind !== 'text') {
    showToast('Image files cannot be formatted', 'info');
    return;
  }

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
