import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  agentReadsRulesFile,
  buildManagedBlock,
  buildStandingBriefBody,
  ensureAgentRulesFiles,
  upsertManagedBlock,
} from './agent-rules-file';

describe('agentReadsRulesFile', () => {
  it('matches the agents that load a native rules file, by command and canonical name', () => {
    for (const id of ['claude', 'codex', 'cursor', 'agent', 'opencode', 'antigravity', 'agy']) {
      expect(agentReadsRulesFile(id)).toBe(true);
    }
  });

  it('is case-insensitive and trims', () => {
    expect(agentReadsRulesFile('  Claude ')).toBe(true);
  });

  it('returns false for agents without an auto-loaded rules file and for empty input', () => {
    for (const id of ['pi', 'omp', 'aider', '', null, undefined]) {
      expect(agentReadsRulesFile(id as string)).toBe(false);
    }
  });
});

describe('buildStandingBriefBody', () => {
  it('carries the four guardrails without the transient "task arrives next" framing', () => {
    const body = buildStandingBriefBody();
    expect(body).toContain('Scope');
    expect(body).toContain('Git (shared tree)');
    expect(body).toContain('Injection safety');
    expect(body).toContain('Execution');
    expect(body).not.toContain('YOUR TASK');
  });
});

describe('upsertManagedBlock', () => {
  const block = buildManagedBlock();

  it('writes just the block (plus newline) into an empty file', () => {
    expect(upsertManagedBlock('', block)).toBe(`${block}\n`);
    expect(upsertManagedBlock('   \n  ', block)).toBe(`${block}\n`);
  });

  it('appends the block below existing user content, preserving it', () => {
    const existing = '# My project\n\nSome house rules.';
    const result = upsertManagedBlock(existing, block);
    expect(result.startsWith('# My project\n\nSome house rules.')).toBe(true);
    expect(result).toContain(block);
  });

  it('replaces a stale managed block in place without touching surrounding content', () => {
    const stale = buildManagedBlock().replace('Scope', 'OUTDATED');
    const existing = `# Header\n\n${stale}\n\n## Footer notes`;
    const result = upsertManagedBlock(existing, block);
    expect(result).toContain('# Header');
    expect(result).toContain('## Footer notes');
    expect(result).toContain(block);
    expect(result).not.toContain('OUTDATED');
  });

  it('is idempotent — re-applying the current block is a no-op', () => {
    const once = upsertManagedBlock('# Header\n', block);
    const twice = upsertManagedBlock(once, block);
    expect(twice).toBe(once);
  });
});

describe('ensureAgentRulesFiles', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('creates CLAUDE.md and AGENTS.md and excludes the newly-created files from git', async () => {
    // fs_read_file rejects (file missing) for the rules files; the git exclude
    // read resolves with empty so the exclude write path runs.
    invokeMock.mockImplementation(async (cmd: string, args: { path: string }) => {
      if (cmd === 'fs_read_file') {
        if (args.path.endsWith('/.git/info/exclude')) return '';
        throw new Error('not found');
      }
      if (cmd === 'fs_write_file') return undefined;
      throw new Error(`unexpected ${cmd}`);
    });

    const ok = await ensureAgentRulesFiles('/repo');
    expect(ok).toBe(true);

    const writes = invokeMock.mock.calls.filter((c) => c[0] === 'fs_write_file');
    const writtenPaths = writes.map((c) => (c[1] as { path: string }).path);
    expect(writtenPaths).toContain('/repo/CLAUDE.md');
    expect(writtenPaths).toContain('/repo/AGENTS.md');
    // Each created file is added to .git/info/exclude.
    expect(writtenPaths.filter((p) => p.endsWith('/.git/info/exclude')).length).toBeGreaterThan(0);
  });

  it('updates an existing tracked rules file in place and does NOT touch git exclude', async () => {
    invokeMock.mockImplementation(async (cmd: string, args: { path: string }) => {
      if (cmd === 'fs_read_file') return '# Existing user rules\n';
      if (cmd === 'fs_write_file') return undefined;
      throw new Error(`unexpected ${cmd}`);
    });

    await ensureAgentRulesFiles('/repo');
    const writtenPaths = invokeMock.mock.calls
      .filter((c) => c[0] === 'fs_write_file')
      .map((c) => (c[1] as { path: string }).path);
    // Pre-existing files are updated but never auto-excluded from git.
    expect(writtenPaths.every((p) => !p.endsWith('/.git/info/exclude'))).toBe(true);
  });

  it('returns false and never writes when the root is empty', async () => {
    expect(await ensureAgentRulesFiles('')).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('trims a trailing slash from the root so paths are well-formed', async () => {
    invokeMock.mockResolvedValue('# existing\n');
    await ensureAgentRulesFiles('/repo/');
    const paths = invokeMock.mock.calls.map((c) => (c[1] as { path: string }).path);
    expect(paths).toContain('/repo/CLAUDE.md');
    expect(paths.some((p) => p.includes('//'))).toBe(false);
  });
});
