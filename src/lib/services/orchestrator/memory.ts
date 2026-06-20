import { writable, get } from '$lib/stores/storeCompat';
import { invoke } from '@tauri-apps/api/core';
import type { ActivityEvent } from '$lib/services/orchestrator/activity-log';
import type { OrchestratorTask } from '$lib/services/orchestrator/task-lifecycle';

export interface OrchestratorMemoryEntry {
  id: string;
  text: string;
  createdAt: number;
  lastSeenAt: number;
  uses: number;
  taskId?: string | null;
}

const MAX_MEMORY_ENTRIES = 40;
const STALE_MEMORY_MS = 7 * 24 * 60 * 60 * 1000;

export const orchestratorMemory = writable<Record<string, OrchestratorMemoryEntry[]>>({});

function memoryPath(rootPath: string): string {
  return `${rootPath}/.soryq/orchestrator-memory.json`;
}

function compactText(raw: string, maxChars: number): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}...`;
}

function ageLabel(ts: number, now = Date.now()): string {
  const ageMs = Math.max(0, now - ts);
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function lastActivity(task: OrchestratorTask): ActivityEvent | null {
  const activity = task.activity ?? [];
  return activity.length ? activity[activity.length - 1] : null;
}

function summarizeActivity(event: ActivityEvent | null): string {
  if (!event) return '';
  return `${event.kind}: ${compactText(event.text, 120)}`;
}

export function learnFromTask(task: OrchestratorTask): OrchestratorMemoryEntry | null {
  if (task.status === 'todo' || task.status === 'in-progress' || task.status === 'cancelled') return null;

  const title = compactText(task.title || task.goal || 'Untitled task', 90);
  const agent = compactText(task.agentPreset ?? 'agent', 32);
  const activity = summarizeActivity(lastActivity(task));
  const reason = compactText(task.blockedReason ?? task.failureReason ?? '', 140);
  const statusText =
    task.status === 'complete'
      ? `completed with ${agent}`
      : task.status === 'blocked'
        ? `blocked with ${agent}${reason ? `; needs: ${reason}` : ''}`
        : `failed with ${agent}${reason ? `; reason: ${reason}` : ''}`;
  const detail = activity ? ` Last signal: ${activity}.` : '';
  const text = compactText(`Task "${title}" ${statusText}.${detail}`, 260);
  if (!text) return null;

  const now = Date.now();
  return {
    id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt: now,
    lastSeenAt: now,
    uses: 1,
    taskId: task.id,
  };
}

export function mergeMemoryEntry(
  entries: OrchestratorMemoryEntry[],
  entry: OrchestratorMemoryEntry
): OrchestratorMemoryEntry[] {
  const key = normalizeKey(entry.text);
  let merged = false;
  const next = entries.map((existing) => {
    if (normalizeKey(existing.text) !== key) return existing;
    merged = true;
    return {
      ...existing,
      lastSeenAt: entry.lastSeenAt,
      uses: existing.uses + 1,
      taskId: entry.taskId ?? existing.taskId ?? null,
    };
  });
  if (!merged) next.push(entry);
  return next
    .sort((a, b) => (b.lastSeenAt - a.lastSeenAt) || (b.uses - a.uses))
    .slice(0, MAX_MEMORY_ENTRIES);
}

export async function loadProjectMemory(projectId: string, rootPath: string): Promise<void> {
  let entries: OrchestratorMemoryEntry[] = [];
  try {
    const raw = await invoke<string>('fs_read_file', { path: memoryPath(rootPath) });
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      entries = parsed
        .filter((entry): entry is OrchestratorMemoryEntry =>
          entry &&
          typeof entry === 'object' &&
          typeof entry.id === 'string' &&
          typeof entry.text === 'string' &&
          typeof entry.createdAt === 'number' &&
          typeof entry.lastSeenAt === 'number' &&
          typeof entry.uses === 'number'
        )
        .slice(0, MAX_MEMORY_ENTRIES);
    }
  } catch {
    entries = [];
  }
  orchestratorMemory.update((all) => ({ ...all, [projectId]: entries }));
}

export async function flushProjectMemory(projectId: string, rootPath: string): Promise<void> {
  const entries = get(orchestratorMemory)[projectId] ?? [];
  try {
    try { await invoke('fs_create_dir', { path: `${rootPath}/.soryq` }); } catch { /* exists */ }
    await invoke('fs_write_file', { path: memoryPath(rootPath), content: JSON.stringify(entries, null, 2) });
  } catch (err) {
    console.error('Failed to save orchestrator memory:', err);
  }
}

export async function rememberTask(projectId: string, rootPath: string | null | undefined, task: OrchestratorTask): Promise<void> {
  const entry = learnFromTask(task);
  if (!entry) return;
  orchestratorMemory.update((all) => ({
    ...all,
    [projectId]: mergeMemoryEntry(all[projectId] ?? [], entry),
  }));
  if (rootPath) await flushProjectMemory(projectId, rootPath);
}

export function getProjectMemoryLines(projectId: string): string[] {
  const now = Date.now();
  return (get(orchestratorMemory)[projectId] ?? [])
    .slice()
    .sort((a, b) => (b.lastSeenAt - a.lastSeenAt) || (b.uses - a.uses))
    .slice(0, 8)
    .map((entry) => {
      const stale = now - entry.lastSeenAt > STALE_MEMORY_MS;
      const uses = entry.uses > 1 ? `; seen ${entry.uses}x` : '';
      const freshness = `${stale ? 'stale memory' : 'memory'}; last confirmed ${ageLabel(entry.lastSeenAt, now)}${uses}`;
      return `${entry.text} (${freshness})`;
    });
}
