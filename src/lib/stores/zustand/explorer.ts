import { create } from 'zustand';
import type { FileNode, ContextMenuState } from '$lib/types/explorer';

export type { FileNode, ContextMenuState } from '$lib/types/explorer';

interface ExplorerState {
  rootNodes: FileNode[];
  projectRootNodes: Map<string, FileNode[]>;
  loadingProjectRoots: Set<string>;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  selectedPaths: Set<string>;
  isLoading: boolean;
  contextMenu: ContextMenuState;
  renamingPath: string | null;
  renamingValue: string;
  creatingPath: string | null;
  creatingType: 'file' | 'dir';
  creatingValue: string;
  __set: (key: string, value: unknown) => void;
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  rootNodes: [],
  projectRootNodes: new Map(),
  loadingProjectRoots: new Set(),
  expandedPaths: new Set(),
  selectedPath: null,
  selectedPaths: new Set(),
  isLoading: false,
  contextMenu: {
    visible: false,
    x: 0,
    y: 0,
    path: '',
    isDir: false,
  },
  renamingPath: null,
  renamingValue: '',
  creatingPath: null,
  creatingType: 'file',
  creatingValue: '',
  __set: (key, value) => set({ [key]: value } as any),
}));
