import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { FileEntry, FileNode, ContextMenuState } from '$lib/types/explorer';
import { showHidden } from './settings';
import { activeProject } from './workspace';

export const rootNodes = writable<FileNode[]>([]);
export const projectRootNodes = writable<Map<string, FileNode[]>>(new Map());
export const loadingProjectRoots = writable<Set<string>>(new Set());
export const expandedPaths = writable<Set<string>>(new Set());
export const selectedPath = writable<string | null>(null);
export const isLoading = writable(false);
export const contextMenu = writable<ContextMenuState>({
  visible: false,
  x: 0,
  y: 0,
  path: '',
  isDir: false,
});

export function showContextMenu(e: MouseEvent, path: string, isDir: boolean) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.set({ visible: true, x: e.clientX, y: e.clientY, path, isDir });
}

export function hideContextMenu() {
  contextMenu.set({ visible: false, x: 0, y: 0, path: '', isDir: false });
}

export async function loadDirectory(path: string): Promise<FileEntry[]> {
  try {
    const entries = await invoke<FileEntry[]>('fs_read_dir', { path });
    const $showHidden = get(showHidden);
    if (!$showHidden) {
      return entries.filter((e) => !e.name.startsWith('.'));
    }
    return entries;
  } catch (err) {
    console.error('Failed to read directory:', err);
    return [];
  }
}

async function rebuildNode(entry: FileEntry, depth: number): Promise<FileNode> {
  const isExpanded = get(expandedPaths).has(entry.path);
  const node: FileNode = {
    entry,
    children: entry.is_dir ? [] : null,
    expanded: isExpanded && entry.is_dir,
    loading: false,
    depth,
  };

  if (node.expanded) {
    node.loading = true;
    try {
      const entries = await loadDirectory(entry.path);
      const childNodes = await Promise.all(
        entries.map((e) => rebuildNode(e, depth + 1))
      );
      node.children = childNodes;
    } catch (err) {
      console.error(err);
    } finally {
      node.loading = false;
    }
  }

  return node;
}

export async function refreshTree() {
  const project = get(activeProject);
  if (!project) {
    rootNodes.set([]);
    return;
  }

  await refreshProjectTree(project.root_path);
}

// Auto-refresh the file tree whenever showHidden changes
showHidden.subscribe(() => {
  const paths = Array.from(get(projectRootNodes).keys());
  if (paths.length > 0) {
    paths.forEach((path) => {
      refreshProjectTree(path).catch((err) => {
        console.error('Failed to refresh explorer root:', err);
      });
    });
  }
});

export async function loadRootDirectory(path: string) {
  await refreshProjectTree(path);
}

export async function refreshProjectTree(path: string) {
  const activeRoot = get(activeProject)?.root_path;
  if (path === activeRoot) {
    isLoading.set(true);
  }
  loadingProjectRoots.update((set) => {
    const next = new Set(set);
    next.add(path);
    return next;
  });
  try {
    const entries = await loadDirectory(path);
    const nodes = await Promise.all(
      entries.map((entry) => rebuildNode(entry, 0))
    );
    projectRootNodes.update((map) => {
      const next = new Map(map);
      next.set(path, nodes);
      return next;
    });
    if (path === activeRoot) {
      rootNodes.set(nodes);
    }
  } finally {
    loadingProjectRoots.update((set) => {
      const next = new Set(set);
      next.delete(path);
      return next;
    });
    if (path === activeRoot) {
      isLoading.set(false);
    }
  }
}

export async function toggleNode(node: FileNode) {
  if (!node.entry.is_dir) {
    selectedPath.set(node.entry.path);
    const { openFile } = await import('./editor');
    openFile(node.entry.path);
    return;
  }

  if (node.expanded) {
    node.expanded = false;
    expandedPaths.update((s) => { s.delete(node.entry.path); return s; });
    rootNodes.update((n) => [...n]); // trigger reactivity
    projectRootNodes.update((map) => new Map(map));
    return;
  }

  node.expanded = true;
  node.loading = true;
  expandedPaths.update((s) => { s.add(node.entry.path); return s; });
  rootNodes.update((n) => [...n]);
  projectRootNodes.update((map) => new Map(map));

  try {
    const entries = await loadDirectory(node.entry.path);
    node.children = entries.map((entry) => ({
      entry,
      children: entry.is_dir ? [] : null,
      expanded: false,
      loading: false,
      depth: node.depth + 1,
    }));
  } finally {
    node.loading = false;
    rootNodes.update((n) => [...n]);
    projectRootNodes.update((map) => new Map(map));
  }
}

export async function createFile(path: string) {
  try {
    await invoke('fs_create_file', { path });
    await refreshParent(path);
  } catch (err) {
    console.error('Failed to create file:', err);
  }
}

export async function createDir(path: string) {
  try {
    await invoke('fs_create_dir', { path });
    await refreshParent(path);
  } catch (err) {
    console.error('Failed to create directory:', err);
  }
}

export async function renameFile(from: string, to: string) {
  try {
    await invoke('fs_rename', { from, to });
    await refreshParent(to);
  } catch (err) {
    console.error('Failed to rename:', err);
  }
}

export async function deleteFile(path: string) {
  try {
    await invoke('fs_delete', { path });
    await refreshParent(path);
  } catch (err) {
    console.error('Failed to delete:', err);
  }
}

export async function copyFile(from: string, to: string) {
  try {
    await invoke('fs_copy', { from, to });
    await refreshParent(to);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
}

async function refreshParent(path: string) {
  const parts = path.replace(/\\/g, '/').split('/');
  parts.pop();
  const parentPath = parts.join('/');
  const projectRoot = findProjectRootForPath(path);
  if (!projectRoot) return;

  if (parentPath === projectRoot) {
    await refreshProjectTree(projectRoot);
    return;
  }

  const $expandedPaths = get(expandedPaths);
  if (parentPath && $expandedPaths.has(parentPath)) {
    const rootMap = get(projectRootNodes);
    const projectNodes = rootMap.get(projectRoot) ?? [];
    const entry = findNodeByPath(projectNodes, parentPath);
    if (entry) {
      const entries = await loadDirectory(parentPath);
      entry.children = entries.map((e) => ({
        entry: e,
        children: e.is_dir ? [] : null,
        expanded: false,
        loading: false,
        depth: entry.depth + 1,
        }));
      projectRootNodes.update((map) => new Map(map));
      if (get(activeProject)?.root_path === projectRoot) {
        rootNodes.update((n) => [...n]);
      }
    }
  }
}

function findProjectRootForPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const roots = Array.from(get(projectRootNodes).keys())
    .sort((a, b) => b.length - a.length);
  return roots.find((root) => normalized === root.replace(/\\/g, '/') || normalized.startsWith(`${root.replace(/\\/g, '/')}/`)) ?? null;
}

function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.entry.path === path) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}
