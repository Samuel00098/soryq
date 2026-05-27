import { writable, derived } from 'svelte/store';

export interface QuickRun {
  id: string;
  name: string;
  command: string;
  projectId: string;
  isPreset?: boolean;
}

const STORAGE_KEY = 'devdock_runs';

function load(): QuickRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const quickRuns = writable<QuickRun[]>(load());

const AI_AGENT_PRESETS: Omit<QuickRun, 'id' | 'projectId'>[] = [
  { name: 'Codex CLI', command: 'codex', isPreset: true },
  { name: 'Claude Code', command: 'claude', isPreset: true },
  { name: 'Gemini CLI', command: 'gemini', isPreset: true },
  { name: 'Aider', command: 'aider', isPreset: true },
  { name: 'Antigravity', command: 'agy', isPreset: true },
  { name: 'OpenCode', command: 'opencode', isPreset: true },
  { name: 'Pi AI Agent', command: 'pi', isPreset: true },
  { name: 'Dev Server', command: 'npm run dev', isPreset: true },
  { name: 'GitHub Copilot', command: 'copilot', isPreset: true },
  { name: 'Cursor', command: 'agent', isPreset: true },
];

export function getPresetRuns(projectId: string): QuickRun[] {
  if (!projectId) return [];
  return AI_AGENT_PRESETS.map((preset) => ({
    id: `preset:${projectId}:${preset.command}`,
    projectId,
    name: preset.name,
    command: preset.command,
    isPreset: true,
  }));
}

quickRuns.subscribe((val) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
  } catch {}
});

export function addQuickRun(projectId: string, name: string, command: string) {
  const run: QuickRun = {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    command: command.trim(),
    projectId,
  };
  quickRuns.update((all) => [...all, run]);
  return run;
}

export function deleteQuickRun(id: string) {
  quickRuns.update((all) => all.filter((r) => r.id !== id));
}

export function updateQuickRun(id: string, name: string, command: string) {
  quickRuns.update((all) =>
    all.map((r) => (r.id === id ? { ...r, name: name.trim(), command: command.trim() } : r))
  );
}

export function getProjectRuns(projectId: string) {
  return derived(quickRuns, ($runs) => {
    const projectPresets = getPresetRuns(projectId);
    const userRuns = $runs.filter((r) => r.projectId === projectId);
    return [...projectPresets, ...userRuns];
  });
}
