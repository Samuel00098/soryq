import { writable, get, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  projectId: string;
  createdAt: number;
}

// In-memory store — all currently loaded project tasks
export const tasks = writable<Task[]>([]);

// Tracks projectId → root_path so flush functions can write without needing the full project object
const projectPaths = new Map<string, string>();

export function getTasksPath(rootPath: string): string {
  return `${rootPath}/.soryq/tasks.json`;
}

export async function loadProjectTasks(project: { id: string; root_path: string }): Promise<void> {
  projectPaths.set(project.id, project.root_path);
  const path = getTasksPath(project.root_path);
  let loaded: Task[] = [];
  try {
    const raw = await invoke<string>('fs_read_file', { path });
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) loaded = parsed;
  } catch {
    // file doesn't exist yet — start with empty board
  }
  tasks.update(all => [
    ...all.filter(t => t.projectId !== project.id),
    ...loaded,
  ]);
}

async function flushProjectTasks(projectId: string): Promise<void> {
  const rootPath = projectPaths.get(projectId);
  if (!rootPath) return;
  const dir = `${rootPath}/.soryq`;
  const path = getTasksPath(rootPath);
  const projectTasks = get(tasks).filter(t => t.projectId === projectId);
  try {
    try { await invoke('fs_create_dir', { path: dir }); } catch { /* already exists */ }
    await invoke('fs_write_file', { path, content: JSON.stringify(projectTasks, null, 2) });
  } catch (err) {
    console.error('Failed to save tasks:', err);
  }
}

export function addTask(projectId: string, title: string, status: TaskStatus = 'todo'): Task {
  const task: Task = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim(),
    status,
    projectId,
    createdAt: Date.now(),
  };
  tasks.update(all => [...all, task]);
  void flushProjectTasks(projectId);
  return task;
}

export function updateTaskStatus(id: string, status: TaskStatus) {
  let projectId = '';
  tasks.update(all => all.map(t => {
    if (t.id !== id) return t;
    projectId = t.projectId;
    return { ...t, status };
  }));
  if (projectId) void flushProjectTasks(projectId);
}

export function updateTaskTitle(id: string, title: string) {
  let projectId = '';
  tasks.update(all => all.map(t => {
    if (t.id !== id) return t;
    projectId = t.projectId;
    return { ...t, title: title.trim() };
  }));
  if (projectId) void flushProjectTasks(projectId);
}

export function deleteTask(id: string) {
  let projectId = '';
  tasks.update(all => {
    const task = all.find(t => t.id === id);
    if (task) projectId = task.projectId;
    return all.filter(t => t.id !== id);
  });
  if (projectId) void flushProjectTasks(projectId);
}

export function getProjectTasks(projectId: string) {
  return derived(tasks, $tasks => $tasks.filter(t => t.projectId === projectId));
}
