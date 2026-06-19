import { writable, get } from '$lib/stores/storeCompat';
import { loadJson } from '$lib/utils/storage';

/**
 * A coding CLI agent the user added themselves — anything that runs as a
 * terminal command and behaves like the built-in agents (Claude Code, Codex,
 * …). Once added, a custom agent is a first-class citizen: it shows up in the
 * spawn picker, its panes resolve to its display name, typing its command in a
 * plain shell is detected/adopted as an agent, and (when it reads a rules file)
 * it receives the standing brief via CLAUDE.md / AGENTS.md just like the
 * built-ins.
 *
 * Kept deliberately dependency-light (storage util only) so the terminal and
 * runs stores can import it without an import cycle.
 */
export interface CustomAgent {
  /** Stable local id. */
  id: string;
  /** Display name shown on the pane and in the picker, e.g. "Aider". */
  name: string;
  /** Launch command typed into the shell, e.g. `aider --no-auto-commits`. */
  command: string;
  /**
   * True when the CLI reads a rules file (CLAUDE.md / AGENTS.md) at startup, so
   * the standing brief is delivered by writing that file rather than pasting it
   * into the REPL. Leave off for agents that don't, and the brief falls back to
   * the paste channel.
   */
  readsRulesFile: boolean;
}

const STORAGE_KEY = 'soryq_custom_agents';

export const customAgents = writable<CustomAgent[]>(loadJson<CustomAgent[]>(STORAGE_KEY, []));

customAgents.subscribe((val) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
  } catch {}
});

/** Non-reactive snapshot for synchronous consumers (detection, name lookup). */
export function getCustomAgents(): CustomAgent[] {
  return get(customAgents);
}

function genId(): string {
  return `ca_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Add a custom agent. Returns the created agent, or null when the name/command
 * is empty or a custom agent with the same command already exists (so the
 * picker never shows duplicates).
 */
export function addCustomAgent(input: {
  name: string;
  command: string;
  readsRulesFile?: boolean;
}): CustomAgent | null {
  const name = input.name.trim();
  const command = input.command.trim();
  if (!name || !command) return null;

  const existing = get(customAgents);
  if (existing.some((a) => a.command.toLowerCase() === command.toLowerCase())) {
    return null;
  }

  const agent: CustomAgent = {
    id: genId(),
    name,
    command,
    readsRulesFile: Boolean(input.readsRulesFile),
  };
  customAgents.update((all) => [...all, agent]);
  return agent;
}

export function updateCustomAgent(
  id: string,
  patch: { name?: string; command?: string; readsRulesFile?: boolean }
): void {
  customAgents.update((all) =>
    all.map((a) =>
      a.id === id
        ? {
            ...a,
            name: patch.name !== undefined ? patch.name.trim() || a.name : a.name,
            command: patch.command !== undefined ? patch.command.trim() || a.command : a.command,
            readsRulesFile:
              patch.readsRulesFile !== undefined ? patch.readsRulesFile : a.readsRulesFile,
          }
        : a
    )
  );
}

export function deleteCustomAgent(id: string): void {
  customAgents.update((all) => all.filter((a) => a.id !== id));
}

const REMOVED_PRESETS_KEY = 'soryq_removed_preset_agents';

export const removedPresetAgents = writable<string[]>(loadJson<string[]>(REMOVED_PRESETS_KEY, []));

removedPresetAgents.subscribe((val) => {
  try {
    localStorage.setItem(REMOVED_PRESETS_KEY, JSON.stringify(val));
  } catch {}
});

export function getRemovedPresetAgents(): string[] {
  return get(removedPresetAgents);
}

export function removePresetAgent(command: string): void {
  removedPresetAgents.update((all) => {
    if (all.includes(command)) return all;
    return [...all, command];
  });
}

export function restorePresetAgent(command: string): void {
  removedPresetAgents.update((all) => all.filter((cmd) => cmd !== command));
}

