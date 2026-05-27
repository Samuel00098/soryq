import { writable, derived } from 'svelte/store';
import { loadJson } from '$lib/utils/storage';

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  projectId: string;
  createdAt: number;
}

const STORAGE_KEY = 'soryq_tasks';

function loadTasks(): Task[] {
  return loadJson(STORAGE_KEY, [] as Task[]);
}

function saveTasks(tasks: Task[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {}
}

export const tasks = writable<Task[]>(loadTasks());

tasks.subscribe(saveTasks);

export function addTask(projectId: string, title: string, status: TaskStatus = 'todo') {
  const task: Task = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim(),
    status,
    projectId,
    createdAt: Date.now(),
  };
  tasks.update((all) => [...all, task]);
  return task;
}

export function updateTaskStatus(id: string, status: TaskStatus) {
  tasks.update((all) => all.map((t) => (t.id === id ? { ...t, status } : t)));
}

export function updateTaskTitle(id: string, title: string) {
  tasks.update((all) => all.map((t) => (t.id === id ? { ...t, title: title.trim() } : t)));
}

export function deleteTask(id: string) {
  tasks.update((all) => all.filter((t) => t.id !== id));
}

export function getProjectTasks(projectId: string) {
  return derived(tasks, ($tasks) => $tasks.filter((t) => t.projectId === projectId));
}
