import { writable, get, derived } from '$lib/stores/storeCompat';
import { invoke } from '@tauri-apps/api/core';

export interface ShellSnippet {
  id: string;
  name: string;
  command: string;
  description: string;
  projectId?: string; // If undefined, it is a global snippet
}

// In-memory store
export const snippets = writable<ShellSnippet[]>([]);

const projectPaths = new Map<string, string>();

export function getSnippetsPath(rootPath: string): string {
  return `${rootPath}/.soryq/snippets.json`;
}

// Load global snippets
export function loadGlobalSnippets() {
  let loaded: ShellSnippet[] = [];
  try {
    const raw = localStorage.getItem('soryq_global_snippets');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) loaded = parsed;
    }
  } catch (err) {
    console.error('Failed to load global snippets:', err);
  }
  snippets.update(all => [
    ...all.filter(s => s.projectId !== undefined), // keep project snippets
    ...loaded
  ]);
}

// Save global snippets
function saveGlobalSnippets() {
  const globals = get(snippets).filter(s => s.projectId === undefined);
  localStorage.setItem('soryq_global_snippets', JSON.stringify(globals));
}

// Load project-specific snippets
export async function loadProjectSnippets(project: { id: string; root_path: string }): Promise<void> {
  projectPaths.set(project.id, project.root_path);
  const path = getSnippetsPath(project.root_path);
  let loaded: ShellSnippet[] = [];
  try {
    const raw = await invoke<string>('fs_read_file', { path });
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      loaded = parsed.map(s => ({ ...s, projectId: project.id }));
    }
  } catch {
    // file doesn't exist yet — start with empty project snippets
  }
  snippets.update(all => [
    ...all.filter(s => s.projectId !== project.id), // keep other projects and global snippets
    ...loaded,
  ]);
}

// Save project-specific snippets
async function flushProjectSnippets(projectId: string): Promise<void> {
  const rootPath = projectPaths.get(projectId);
  if (!rootPath) return;
  const dir = `${rootPath}/.soryq`;
  const path = getSnippetsPath(rootPath);
  const projectSnippets = get(snippets).filter(s => s.projectId === projectId);
  // Strip the projectId field before saving to file so it's clean and portable
  const cleanSnippets = projectSnippets.map(({ id, name, command, description }) => ({
    id, name, command, description
  }));
  try {
    try { await invoke('fs_create_dir', { path: dir }); } catch { /* already exists */ }
    await invoke('fs_write_file', { path, content: JSON.stringify(cleanSnippets, null, 2) });
  } catch (err) {
    console.error('Failed to save project snippets:', err);
  }
}

// Add a snippet
export function addSnippet(name: string, command: string, description: string, projectId?: string): ShellSnippet {
  const snippet: ShellSnippet = {
    id: `sn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    command: command.trim(),
    description: description.trim(),
    projectId
  };
  snippets.update(all => [...all, snippet]);
  if (projectId) {
    void flushProjectSnippets(projectId);
  } else {
    saveGlobalSnippets();
  }
  return snippet;
}

// Update a snippet
export function updateSnippet(id: string, name: string, command: string, description: string) {
  let projectId: string | undefined = undefined;
  let isGlobal = false;
  snippets.update(all => all.map(s => {
    if (s.id !== id) return s;
    projectId = s.projectId;
    if (projectId === undefined) isGlobal = true;
    return { ...s, name: name.trim(), command: command.trim(), description: description.trim() };
  }));
  
  if (isGlobal) {
    saveGlobalSnippets();
  } else if (projectId) {
    void flushProjectSnippets(projectId);
  }
}

// Delete a snippet
export function deleteSnippet(id: string) {
  let projectId: string | undefined = undefined;
  let isGlobal = false;
  snippets.update(all => {
    const target = all.find(s => s.id === id);
    if (target) {
      projectId = target.projectId;
      if (projectId === undefined) isGlobal = true;
    }
    return all.filter(s => s.id !== id);
  });
  
  if (isGlobal) {
    saveGlobalSnippets();
  } else if (projectId) {
    void flushProjectSnippets(projectId);
  }
}

export function getProjectSnippets(projectId: string) {
  return derived(snippets, $snippets => $snippets.filter(s => s.projectId === projectId));
}

export function getGlobalSnippets() {
  return derived(snippets, $snippets => $snippets.filter(s => s.projectId === undefined));
}
