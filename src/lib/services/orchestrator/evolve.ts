import { writable, get } from '$lib/stores/storeCompat';
import { invoke } from '@tauri-apps/api/core';
import { loadJson } from '$lib/utils/storage';
import type { OrchestratorAction } from '$lib/services/orchestrator-brain';

// ─── The evolving brain ─────────────────────────────────────────────────────
// A self-curating "profile" the orchestrator reads on every turn and refines
// after every meaningful turn. This is the feasible form of learning in a
// client app — no weight fine-tuning, but an ever-improving playbook of how the
// user likes to work (global) and what's true about each project (per-project).

export type ProfileScope = 'global' | 'project';

export interface ProfileEntry {
  id: string;
  text: string;
  scope: ProfileScope;
  createdAt: number;
  lastSeenAt: number;
  uses: number;
}

const MAX_GLOBAL_ENTRIES = 40;
const MAX_PROJECT_ENTRIES = 40;
const MAX_PROMPT_LINES = 12;
const MAX_ENTRY_CHARS = 240;
const MAX_NEW_PER_TURN = 6;
const GLOBAL_KEY = 'soryq_orchestrator_profile';

export const globalOrchestratorProfile = writable<ProfileEntry[]>([]);
export const orchestratorProfile = writable<Record<string, ProfileEntry[]>>({});

function profilePath(rootPath: string): string {
  return `${rootPath}/.soryq/orchestrator-profile.json`;
}

function compact(raw: string, max = MAX_ENTRY_CHARS): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isProfileEntry(value: unknown): value is ProfileEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ProfileEntry).id === 'string' &&
    typeof (value as ProfileEntry).text === 'string' &&
    typeof (value as ProfileEntry).createdAt === 'number' &&
    typeof (value as ProfileEntry).lastSeenAt === 'number' &&
    typeof (value as ProfileEntry).uses === 'number'
  );
}

/** Merge a new insight into a list: reinforce a matching one, else append; cap + sort. */
function mergeEntry(entries: ProfileEntry[], entry: ProfileEntry, cap: number): ProfileEntry[] {
  const key = normalizeKey(entry.text);
  let merged = false;
  const next = entries.map((existing) => {
    if (normalizeKey(existing.text) !== key) return existing;
    merged = true;
    return { ...existing, text: entry.text, lastSeenAt: entry.lastSeenAt, uses: existing.uses + 1 };
  });
  if (!merged) next.push(entry);
  return next.sort((a, b) => (b.lastSeenAt - a.lastSeenAt) || (b.uses - a.uses)).slice(0, cap);
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export function loadGlobalProfile(): void {
  const entries = loadJson<unknown[]>(GLOBAL_KEY, []).filter(isProfileEntry).slice(0, MAX_GLOBAL_ENTRIES);
  globalOrchestratorProfile.set(entries);
}

function flushGlobalProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(get(globalOrchestratorProfile)));
  } catch {
    /* quota — best effort */
  }
}

export async function loadProjectProfile(projectId: string, rootPath: string): Promise<void> {
  let entries: ProfileEntry[] = [];
  try {
    const raw = await invoke<string>('fs_read_file', { path: profilePath(rootPath) });
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) entries = parsed.filter(isProfileEntry).slice(0, MAX_PROJECT_ENTRIES);
  } catch {
    entries = [];
  }
  orchestratorProfile.update((all) => ({ ...all, [projectId]: entries }));
}

async function flushProjectProfile(projectId: string, rootPath: string): Promise<void> {
  const entries = get(orchestratorProfile)[projectId] ?? [];
  try {
    try { await invoke('fs_create_dir', { path: `${rootPath}/.soryq` }); } catch { /* exists */ }
    await invoke('fs_write_file', { path: profilePath(rootPath), content: JSON.stringify(entries, null, 2) });
  } catch (err) {
    console.error('Failed to save orchestrator profile:', err);
  }
}

// ─── Read (for the brain) ───────────────────────────────────────────────────

/** Compact profile lines (global + project), recency/uses-sorted, for the prompt. */
export function getProfileLines(projectId: string): string[] {
  const globals = get(globalOrchestratorProfile).map((e) => ({ ...e, label: 'you' }));
  const projectEntries = (get(orchestratorProfile)[projectId] ?? []).map((e) => ({ ...e, label: 'this project' }));
  return [...globals, ...projectEntries]
    .sort((a, b) => (b.lastSeenAt - a.lastSeenAt) || (b.uses - a.uses))
    .slice(0, MAX_PROMPT_LINES)
    .map((e) => `[${e.label}] ${e.text}`);
}

// ─── Reflection (the evolving step) ─────────────────────────────────────────

function parseInsights(raw: string): Array<{ scope: ProfileScope; text: string }> {
  // Strip code fences / prose and isolate the first JSON array.
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const insights: Array<{ scope: ProfileScope; text: string }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const text = compact(typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : '');
    const scope = (item as { scope?: unknown }).scope === 'global' ? 'global' : 'project';
    if (text) insights.push({ scope, text });
    if (insights.length >= MAX_NEW_PER_TURN) break;
  }
  return insights;
}

const REFLECTION_SYSTEM_PROMPT = [
  'You maintain a long-term profile of how a developer likes their in-app coding assistant to behave, and durable facts about their project.',
  'Given the assistant\'s CURRENT profile and the latest exchange, extract only NEW, durable, reusable insights worth remembering for future turns.',
  'Good insights: stable user preferences ("prefers terse replies", "always run tests after edits", "dislikes spawning multiple agents"), and durable project facts ("API lives in src/api", "uses pnpm").',
  'Do NOT record one-off task details, transient state, or anything already implied by the current profile. If nothing durable was learned, return an empty array.',
  `Respond with ONLY a JSON array (no prose, no code fences) of at most ${MAX_NEW_PER_TURN} objects:`,
  '[{"scope": "global" | "project", "text": "<one concise insight>"}]',
  'Use "global" for insights about the user that apply across projects; "project" for facts specific to this project.',
].join('\n');

export interface ReflectArgs {
  projectId: string;
  rootPath?: string | null;
  userMessage: string;
  reply: string;
  actions: OrchestratorAction[];
  /** Injected LLM call (same shape recon uses), so this module stays provider-agnostic. */
  complete: (systemPrompt: string, userText: string) => Promise<string>;
}

/**
 * After a turn, ask the model what durable thing (if any) it just learned about
 * the user or project, then fold it into the profile. Fire-and-forget: never
 * blocks the reply, and silently no-ops on any failure.
 */
export async function reflectAndEvolve(args: ReflectArgs): Promise<void> {
  const { projectId, rootPath, userMessage, reply, actions, complete } = args;
  if (!projectId || !userMessage.trim()) return;

  const currentProfile = getProfileLines(projectId);
  const actionsSummary = actions.length
    ? actions.map((a) => a.kind).join(', ')
    : '(no actions — conversation/answer only)';
  const userText = [
    'CURRENT PROFILE:',
    currentProfile.length ? currentProfile.map((l) => `- ${l}`).join('\n') : '(empty)',
    '',
    'LATEST EXCHANGE:',
    `User: ${compact(userMessage, 600)}`,
    `Assistant reply: ${compact(reply, 400)}`,
    `Actions taken: ${actionsSummary}`,
  ].join('\n');

  let response: string;
  try {
    response = await complete(REFLECTION_SYSTEM_PROMPT, userText);
  } catch {
    return; // reflection is best-effort; never surface errors to the user
  }

  const insights = parseInsights(response);
  if (!insights.length) return;

  const now = Date.now();
  let globalChanged = false;
  let projectChanged = false;

  for (const insight of insights) {
    const entry: ProfileEntry = {
      id: `prof_${now}_${Math.random().toString(36).slice(2, 8)}`,
      text: insight.text,
      scope: insight.scope,
      createdAt: now,
      lastSeenAt: now,
      uses: 1,
    };
    if (insight.scope === 'global') {
      globalOrchestratorProfile.update((entries) => mergeEntry(entries, entry, MAX_GLOBAL_ENTRIES));
      globalChanged = true;
    } else {
      orchestratorProfile.update((all) => ({
        ...all,
        [projectId]: mergeEntry(all[projectId] ?? [], entry, MAX_PROJECT_ENTRIES),
      }));
      projectChanged = true;
    }
  }

  if (globalChanged) flushGlobalProfile();
  if (projectChanged && rootPath) await flushProjectProfile(projectId, rootPath);
}

// Load the global profile once at startup.
if (typeof window !== 'undefined') {
  loadGlobalProfile();
}
