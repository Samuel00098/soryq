import { writable, get } from '$lib/stores/storeCompat';
import { invoke } from '@tauri-apps/api/core';
import type { FileEntry, FileNode, ContextMenuState } from '$lib/types/explorer';
import { showHidden } from './settings';
import { activeProject } from './workspace';
import { showToast } from './notification';
import { useExplorerStore } from './zustand/explorer';

export type { FileNode, ContextMenuState } from '$lib/types/explorer';

function syncWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  const zustandVal = (useExplorerStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;
  const store = writable<T>(initial);
  void useExplorerStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) store.set(next);
  });
  return {
    subscribe: store.subscribe,
    set(value: T) { (useExplorerStore.getState() as any).__set(key, value); },
    update(fn: (val: T) => T) {
      const current = (useExplorerStore.getState() as any)[key] as T;
      (useExplorerStore.getState() as any).__set(key, fn(current));
    },
  };
}

export const rootNodes = syncWritable<FileNode[]>('rootNodes', []);
export const projectRootNodes = syncWritable<Map<string, FileNode[]>>('projectRootNodes', new Map());
export const loadingProjectRoots = syncWritable<Set<string>>('loadingProjectRoots', new Set());
export const expandedPaths = syncWritable<Set<string>>('expandedPaths', new Set());
export const selectedPath = syncWritable<string | null>('selectedPath', null);
// Multi-selection: the full set of selected paths. `selectedPath` stays the
// "active" item (last clicked) — it's what gets persisted and what anchors a
// shift-range. Highlighting in the tree is driven by this set.
export const selectedPaths = syncWritable<Set<string>>('selectedPaths', new Set());
// Fixed end of a shift-range selection. Module-local; not persisted.
let selectionAnchor: string | null = null;
export const isLoading = syncWritable<boolean>('isLoading', false);
export const contextMenu = syncWritable<ContextMenuState>('contextMenu', {
  visible: false,
  x: 0,
  y: 0,
  path: '',
  isDir: false,
});

// ── Inline rename state ───────────────────────────────────────────────────
export const renamingPath = syncWritable<string | null>('renamingPath', null);
export const renamingValue = syncWritable<string>('renamingValue', '');

// ── Inline create state ───────────────────────────────────────────────────
// `creatingPath` holds the *parent* directory the new entry will be created in.
export const creatingPath = syncWritable<string | null>('creatingPath', null);
export const creatingType = syncWritable<'file' | 'dir'>('creatingType', 'file');
export const creatingValue = syncWritable<string>('creatingValue', '');

export function startCreate(parentPath: string, type: 'file' | 'dir') {
  creatingPath.set(parentPath);
  creatingType.set(type);
  creatingValue.set('');
  // Make sure the target folder is expanded so the input is visible underneath it.
  const root = get(activeProject)?.root_path;
  if (parentPath && parentPath !== root) {
    expandedPaths.update((s) => { s.add(parentPath); return s; });
    updateProjectTreeNode(parentPath, (current) => ({ ...current, expanded: true }));
  }
}

export function cancelCreate() {
  creatingPath.set(null);
  creatingValue.set('');
}

export async function confirmCreate() {
  const parent = get(creatingPath);
  if (parent === null) return;
  const type = get(creatingType);
  const val = get(creatingValue).trim();
  cancelCreate();
  if (!val) return;

  // A name must be a single path segment — no separators or null bytes.
  if (/[/\\\0]/.test(val)) {
    showToast('Name cannot contain slashes or null bytes', 'error');
    return;
  }
  if (val.length > 255) {
    showToast('Name is too long (max 255 characters)', 'error');
    return;
  }

  const newPath = parent.replace(/[\\\/]+$/, '') + '/' + val;
  if (type === 'file') {
    await createFile(newPath);
  } else {
    await createDir(newPath);
  }
}

export function startRename(path: string) {
  renamingPath.set(path);
  renamingValue.set(path.split(/[\\\/]/).pop() || '');
}

export function cancelRename() {
  renamingPath.set(null);
  renamingValue.set('');
}

export async function confirmRename() {
  const oldPath = get(renamingPath);
  if (!oldPath) return;
  const val = get(renamingValue).trim();
  cancelRename();
  if (!val) return;

  // Reject path separators and null bytes — a filename must be a single segment
  if (/[/\\\0]/.test(val)) {
    showToast('File name cannot contain slashes or null bytes', 'error');
    return;
  }
  // Cap at POSIX max filename length
  if (val.length > 255) {
    showToast('File name is too long (max 255 characters)', 'error');
    return;
  }

  const parts = oldPath.split(/[\\\/]/);
  parts.pop();
  const newPath = parts.join('/') + '/' + val;
  if (newPath !== oldPath) {
    await renameFile(oldPath, newPath);
  }
}

export function showContextMenu(e: MouseEvent, path: string, isDir: boolean) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.set({ visible: true, x: e.clientX, y: e.clientY, path, isDir });
}

export function hideContextMenu() {
  contextMenu.set({ visible: false, x: 0, y: 0, path: '', isDir: false });
}

// ── Selection ──────────────────────────────────────────────────────────────

/** Replace the selection with a single path (plain click). */
export function selectSingle(path: string) {
  selectedPaths.set(new Set([path]));
  selectedPath.set(path);
  selectionAnchor = path;
}

/** Add/remove a single path from the selection (Ctrl/Cmd+click). */
export function toggleSelection(path: string) {
  selectedPaths.update((set) => {
    const next = new Set(set);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  selectionAnchor = path;
  const set = get(selectedPaths);
  // Keep `selectedPath` on a member of the selection (or null when empty).
  selectedPath.set(set.has(path) ? path : (set.size > 0 ? Array.from(set)[set.size - 1] : null));
}

function flattenVisible(nodes: FileNode[], out: string[]) {
  for (const node of nodes) {
    out.push(node.entry.path);
    if (node.entry.is_dir && node.expanded && node.children) {
      flattenVisible(node.children, out);
    }
  }
}

/** Visible tree rows in render order — the basis for range selection. */
function getVisibleOrder(): string[] {
  const root = get(activeProject)?.root_path;
  if (!root) return [];
  const out: string[] = [];
  flattenVisible(get(projectRootNodes).get(root) ?? [], out);
  return out;
}

/** Select every visible row between the anchor and `path` (Shift+click). */
export function selectRangeTo(path: string) {
  const anchor = selectionAnchor ?? get(selectedPath);
  if (!anchor) { selectSingle(path); return; }
  const order = getVisibleOrder();
  const a = order.indexOf(anchor);
  const b = order.indexOf(path);
  if (a === -1 || b === -1) { selectSingle(path); return; }
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  selectedPaths.set(new Set(order.slice(lo, hi + 1)));
  // The active item follows the click; the anchor stays put for further ranges.
  selectedPath.set(path);
}

export function clearSelection() {
  selectedPaths.set(new Set());
  selectedPath.set(null);
  selectionAnchor = null;
}

/**
 * Delete every path in `paths`. Any path nested inside another selected path is
 * dropped first — deleting the ancestor already removes it, and deleting it
 * again afterwards would error. Each affected parent folder is refreshed once.
 */
export async function deletePaths(paths: string[]) {
  const unique = Array.from(new Set(paths));
  const top = unique.filter((p) => {
    const np = normalizePath(p);
    return !unique.some((other) => {
      if (other === p) return false;
      return np.startsWith(`${normalizePath(other)}/`);
    });
  });
  if (top.length === 0) return;

  const { onFileDeleted } = await import('./editor');
  let failures = 0;
  for (const path of top) {
    try {
      await invoke('fs_delete', { path });
      onFileDeleted(path);
    } catch (err: any) {
      failures += 1;
      showToast(`Delete failed for "${path.split(/[\\\/]/).pop()}": ${err?.message ?? String(err)}`, 'error');
    }
  }

  // Refresh each unique parent folder once.
  const refreshed = new Set<string>();
  for (const path of top) {
    const np = normalizePath(path);
    const slash = np.lastIndexOf('/');
    const parentKey = slash >= 0 ? np.slice(0, slash) : np;
    if (refreshed.has(parentKey)) continue;
    refreshed.add(parentKey);
    await refreshParent(path);
  }

  clearSelection();
  const deleted = top.length - failures;
  if (deleted === 1) {
    showToast(`Deleted "${top[0].split(/[\\\/]/).pop()}"`, 'success');
  } else if (deleted > 1) {
    showToast(`Deleted ${deleted} items`, 'success');
  }
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

function updateTreeNode(nodes: FileNode[], targetPath: string, mutate: (node: FileNode) => FileNode): FileNode[] | null {
  let changed = false;

  const next = nodes.map((node) => {
    if (node.entry.path === targetPath) {
      changed = true;
      return mutate({
        ...node,
        children: node.children ? [...node.children] : node.children,
      });
    }

    if (node.children) {
      const updatedChildren = updateTreeNode(node.children, targetPath, mutate);
      if (updatedChildren) {
        changed = true;
        return { ...node, children: updatedChildren };
      }
    }

    return node;
  });

  return changed ? next : null;
}

function updateProjectTreeNode(path: string, mutate: (node: FileNode) => FileNode) {
  const projectRoot = findProjectRootForPath(path);
  if (!projectRoot) return;

  projectRootNodes.update((map) => {
    const current = map.get(projectRoot) ?? [];
    const updated = updateTreeNode(current, path, mutate);
    if (!updated) return map;

    const next = new Map(map);
    next.set(projectRoot, updated);

    if (get(activeProject)?.root_path === projectRoot) {
      rootNodes.set(updated);
    }

    return next;
  });
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
    expandedPaths.update((s) => { s.delete(node.entry.path); return s; });
    updateProjectTreeNode(node.entry.path, (current) => ({
      ...current,
      expanded: false,
      loading: false,
    }));
    return;
  }

  expandedPaths.update((s) => { s.add(node.entry.path); return s; });

  // If children are already cached, show them instantly without hitting disk
  if (node.children && node.children.length > 0) {
    updateProjectTreeNode(node.entry.path, (current) => ({
      ...current,
      expanded: true,
      loading: false,
    }));
    return;
  }

  updateProjectTreeNode(node.entry.path, (current) => ({
    ...current,
    expanded: true,
    loading: true,
  }));

  try {
    const entries = await loadDirectory(node.entry.path);
    const children = entries.map((entry) => ({
      entry,
      children: entry.is_dir ? [] : null,
      expanded: false,
      loading: false,
      depth: node.depth + 1,
    }));
    updateProjectTreeNode(node.entry.path, (current) => ({
      ...current,
      expanded: true,
      loading: false,
      children,
    }));
  } finally {
    updateProjectTreeNode(node.entry.path, (current) => ({
      ...current,
      loading: false,
    }));
  }
}

export async function createFile(path: string) {
  try {
    await invoke('fs_create_file', { path });
    await refreshParent(path);
    showToast(`Created "${path.split(/[\\\/]/).pop()}"`, 'success');
  } catch (err: any) {
    showToast(`Create failed: ${err?.message ?? String(err)}`, 'error');
  }
}

export async function createDir(path: string) {
  try {
    await invoke('fs_create_dir', { path });
    await refreshParent(path);
    showToast(`Created "${path.split(/[\\\/]/).pop()}"`, 'success');
  } catch (err: any) {
    showToast(`Create failed: ${err?.message ?? String(err)}`, 'error');
  }
}

export async function renameFile(from: string, to: string) {
  try {
    await invoke('fs_rename', { from, to });
    const { onFileRenamed } = await import('./editor');
    onFileRenamed(from, to);
    await refreshParent(to);
    showToast(`Renamed to "${to.split(/[\\\/]/).pop()}"`, 'success');
  } catch (err: any) {
    showToast(`Rename failed: ${err?.message ?? String(err)}`, 'error');
  }
}

export async function deleteFile(path: string) {
  try {
    await invoke('fs_delete', { path });
    const { onFileDeleted } = await import('./editor');
    onFileDeleted(path);
    await refreshParent(path);
    showToast(`Deleted "${path.split(/[\\\/]/).pop()}"`, 'success');
  } catch (err: any) {
    showToast(`Delete failed: ${err?.message ?? String(err)}`, 'error');
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

// Strip trailing separators and normalize to forward slashes so paths can be
// compared regardless of the OS separator (Windows hands us backslashes, but
// freshly-built paths use forward slashes).
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

async function refreshParent(path: string) {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  const parentPath = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
  const projectRoot = findProjectRootForPath(path);
  if (!projectRoot) return;

  // Creating/removing directly under a workspace root: rebuild the whole root.
  if (parentPath === normalizePath(projectRoot)) {
    await refreshProjectTree(projectRoot);
    return;
  }

  // Otherwise re-read just the parent folder and splice its children back in,
  // preserving the expansion state of any nested folders via rebuildNode.
  const rootMap = get(projectRootNodes);
  const projectNodes = rootMap.get(projectRoot) ?? [];
  const parentNode = findNodeByPath(projectNodes, parentPath);
  if (!parentNode) return;

  const entries = await loadDirectory(parentNode.entry.path);
  const children = await Promise.all(
    entries.map((e) => rebuildNode(e, parentNode.depth + 1))
  );
  updateProjectTreeNode(parentNode.entry.path, (current) => ({
    ...current,
    expanded: true,
    children,
    loading: false,
  }));
}

function findProjectRootForPath(path: string): string | null {
  const normalized = normalizePath(path);
  const roots = Array.from(get(projectRootNodes).keys())
    .sort((a, b) => b.length - a.length);
  return roots.find((root) => {
    const r = normalizePath(root);
    return normalized === r || normalized.startsWith(`${r}/`);
  }) ?? null;
}

function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  const target = normalizePath(path);
  for (const node of nodes) {
    if (normalizePath(node.entry.path) === target) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}
