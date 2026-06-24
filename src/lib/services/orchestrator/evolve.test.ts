import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from '$lib/stores/storeCompat';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));

import {
  reflectAndEvolve,
  getProfileLines,
  globalOrchestratorProfile,
  orchestratorProfile,
} from './evolve';

const PROJECT = 'project-1';

function reflectWith(response: string, userMessage = 'keep replies short') {
  return reflectAndEvolve({
    projectId: PROJECT,
    rootPath: '/tmp/proj',
    userMessage,
    reply: 'ok',
    actions: [],
    complete: async () => response,
  });
}

describe('reflectAndEvolve', () => {
  beforeEach(() => {
    globalOrchestratorProfile.set([]);
    orchestratorProfile.set({});
  });

  it('stores global and project insights and surfaces them in profile lines', async () => {
    await reflectWith(
      JSON.stringify([
        { scope: 'global', text: 'Prefers terse replies' },
        { scope: 'project', text: 'API lives in src/api' },
      ]),
    );

    const lines = getProfileLines(PROJECT);
    expect(lines).toContain('[you] Prefers terse replies');
    expect(lines).toContain('[this project] API lives in src/api');
  });

  it('parses JSON even when wrapped in prose / code fences', async () => {
    await reflectWith('Sure! Here is what I learned:\n```json\n[{"scope":"global","text":"Always run tests after edits"}]\n```');
    expect(getProfileLines(PROJECT)).toContain('[you] Always run tests after edits');
  });

  it('reinforces a repeated insight instead of duplicating it', async () => {
    await reflectWith(JSON.stringify([{ scope: 'global', text: 'Prefers terse replies' }]));
    await reflectWith(JSON.stringify([{ scope: 'global', text: 'prefers   terse replies' }]));

    const globals = get(globalOrchestratorProfile);
    const matching = globals.filter((e) => e.text.toLowerCase().includes('terse'));
    expect(matching).toHaveLength(1);
    expect(matching[0].uses).toBe(2);
  });

  it('ignores empty or malformed model output', async () => {
    await reflectWith('[]');
    await reflectWith('not json at all');
    expect(getProfileLines(PROJECT)).toHaveLength(0);
  });

  it('caps how many insights one turn can add', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ scope: 'project', text: `fact number ${i}` }));
    await reflectWith(JSON.stringify(many));
    expect(getProfileLines(PROJECT).length).toBeLessThanOrEqual(12);
  });
});
