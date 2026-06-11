import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('./notification', () => ({
  showToast: vi.fn(),
}));

import { activeFile, fileCache, onFileDeleted, openFiles } from './editor';
import type { EditorFile } from '$lib/types/editor';

function textFile(path: string): EditorFile {
  return {
    path,
    content: '',
    originalContent: '',
    isDirty: false,
    language: 'plaintext',
    kind: 'text',
    imageSrc: null,
    mimeType: null,
    size: 0,
  };
}

describe('editor file deletion handling', () => {
  beforeEach(() => {
    openFiles.set([]);
    activeFile.set(null);
    fileCache.set(new Map());
  });

  it('closes child tabs when a Windows-style folder path is deleted', () => {
    const deletedDir = 'C:\\repo\\src';
    const childWin = 'C:\\repo\\src\\main.ts';
    const childForward = 'C:/repo/src/utils.ts';
    const sibling = 'C:\\repo\\src-other\\main.ts';
    const files = [childWin, childForward, sibling];

    openFiles.set(files);
    activeFile.set(childForward);
    fileCache.set(new Map(files.map((path) => [path, textFile(path)])));

    onFileDeleted(deletedDir);

    expect(get(openFiles)).toEqual([sibling]);
    expect(get(activeFile)).toBe(sibling);
    expect([...get(fileCache).keys()]).toEqual([sibling]);
  });
});
