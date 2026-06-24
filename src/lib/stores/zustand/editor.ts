import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { EditorFile } from '$lib/types/editor';
import { useNotificationStore } from './notification';
import { useSettingsStore } from './settings';
import { useLayoutStore } from './layout';
import { formatCode } from '$lib/utils/formatter';

export interface OpenFileEntry {
  path: string;
  pinned: boolean;
}

interface EditorState {
  openFiles: string[];
  activeFile: string | null;
  fileCache: Map<string, EditorFile>;
  activeLine: number;
  activeColumn: number;
  jumpToLine: { path: string; line: number } | null;
  selectedText: string;
  openFileHistory: string[];
  /** Paths currently shown in markdown preview mode. Persists per-file so the
   *  preview stays open across tab switches until explicitly toggled off. */
  markdownPreviewPaths: Set<string>;

  saveActiveFile: () => Promise<void>;
  setMarkdownPreview: (path: string, on: boolean) => void;
  formatActiveFile: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  setActiveLine: (line: number) => void;
  setActiveColumn: (column: number) => void;
  setJumpToLine: (val: { path: string; line: number } | null) => void;
  setSelectedText: (text: string) => void;
  addOpenFile: (path: string) => void;
  removeOpenFile: (path: string) => void;
}

export const useEditorStore = create<EditorState>((set, getState) => ({
  openFiles: [],
  activeFile: null,
  fileCache: new Map(),
  activeLine: 1,
  activeColumn: 1,
  jumpToLine: null,
  selectedText: '',
  openFileHistory: [],
  markdownPreviewPaths: new Set(),

  setMarkdownPreview: (path: string, on: boolean) => {
    set((s) => {
      const next = new Set(s.markdownPreviewPaths);
      if (on) next.add(path);
      else next.delete(path);
      return { markdownPreviewPaths: next };
    });
  },

  saveActiveFile: async () => {
    const { activeFile: file, activeLine } = getState();
    if (!file) return;
    try {
      await invoke('editor_save', { path: file, cursorLine: activeLine });
    } catch (err: any) {
      useNotificationStore.getState().showToast(`Failed to save: ${err?.message || err}`, 'error');
    }
  },

  formatActiveFile: async () => {
    const { activeFile: file, fileCache } = getState();
    if (!file) return;
    const entry = fileCache.get(file);
    if (!entry || entry.kind !== 'text') return;
    const formatOnSave = useSettingsStore.getState().formatOnSave;
    if (!formatOnSave) return;
    try {
      const formatted = await formatCode(entry.content, entry.language);
      if (formatted !== null && formatted !== entry.content) {
        const updated: EditorFile = { ...entry, content: formatted };
        const nextCache = new Map(fileCache);
        nextCache.set(file, updated);
        set({ fileCache: nextCache });
      }
    } catch (err: any) {
      console.error('Format failed:', err);
    }
  },

  openFile: async (path: string) => {
    const { fileCache, openFileHistory } = getState();
    if (fileCache.has(path)) {
      set({ activeFile: path, jumpToLine: null });
      useLayoutStore.getState().setActiveView('editor');
      return;
    }
    try {
      const file: EditorFile = await invoke('file_open', { path });
      const nextCache = new Map(fileCache);
      nextCache.set(path, file);
      const nextOpen = getState().openFiles.includes(path)
        ? getState().openFiles
        : [...getState().openFiles, path];
      const nextHistory = [path, ...openFileHistory.filter((p) => p !== path)].slice(0, 50);
      set({
        activeFile: path,
        fileCache: nextCache,
        openFiles: nextOpen,
        openFileHistory: nextHistory,
        jumpToLine: null,
      });
      useLayoutStore.getState().setActiveView('editor');
    } catch (err: any) {
      useNotificationStore.getState().showToast(`Failed to open file: ${err?.message || err}`, 'error');
    }
  },

  closeFile: (path: string) => {
    const { openFiles, activeFile } = getState();
    const nextOpen = openFiles.filter((p) => p !== path);
    let nextActive = activeFile;
    if (activeFile === path) {
      const idx = openFiles.indexOf(path);
      nextActive = nextOpen[Math.min(idx, nextOpen.length - 1)] ?? null;
    }
    const nextPreview = new Set(getState().markdownPreviewPaths);
    nextPreview.delete(path);
    set({ openFiles: nextOpen, activeFile: nextActive, markdownPreviewPaths: nextPreview });
  },

  setActiveFile: (path: string | null) => {
    set({ activeFile: path });
    if (path) useLayoutStore.getState().setActiveView('editor');
  },

  setActiveLine: (line: number) => set({ activeLine: line }),
  setActiveColumn: (column: number) => set({ activeColumn: column }),
  setJumpToLine: (val) => set({ jumpToLine: val }),
  setSelectedText: (text: string) => set({ selectedText: text }),
  addOpenFile: (path: string) => {
    set((s) => ({
      openFiles: s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path],
    }));
  },
  removeOpenFile: (path: string) => {
    set((s) => ({
      openFiles: s.openFiles.filter((p) => p !== path),
    }));
  },
}));
