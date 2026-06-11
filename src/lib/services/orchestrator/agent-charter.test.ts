import { describe, expect, it } from 'vitest';
import { buildAgentCharter } from './agent-charter';

describe('buildAgentCharter', () => {
  it('embeds the task goal verbatim', () => {
    const charter = buildAgentCharter('Add a logout button to the navbar');
    expect(charter).toContain('YOUR TASK: Add a logout button to the navbar');
  });

  it('uses the agent name when provided', () => {
    const charter = buildAgentCharter('Fix the build', { name: 'Iris' });
    expect(charter).toContain('you are Iris.');
  });

  it('falls back to a neutral lead when no name is given', () => {
    const charter = buildAgentCharter('Fix the build');
    expect(charter).toContain('read, then start');
  });

  it('always states the core guardrails', () => {
    const charter = buildAgentCharter('anything', { name: 'Atlas' });
    // Scope discipline
    expect(charter).toMatch(/SCOPE/);
    expect(charter).toMatch(/Do ONLY the task/);
    // Git discipline — the worktree-isolation replacement
    expect(charter).toMatch(/reset --hard/);
    expect(charter).toMatch(/force-push/);
    expect(charter).toMatch(/Commit only the files you changed/);
    // Don't stall waiting for permission
    expect(charter).toMatch(/Begin immediately/);
  });

  it('renders an "arrives next message" brief when spawned without a goal', () => {
    const charter = buildAgentCharter('', { name: 'Echo' });
    expect(charter).toContain('arrives in your next message');
    // Still carries the full guardrails even without a concrete task.
    expect(charter).toMatch(/reset --hard/);
    expect(charter).toMatch(/SCOPE/);
  });

  it('stays compact for reliable pasting (no box-drawing, few lines)', () => {
    const charter = buildAgentCharter('do the thing', { name: 'Echo' });
    expect(charter).not.toContain('═');
    expect(charter).not.toContain('▌');
    // A handful of lines, not dozens — long decorated prompts truncate in Ink REPLs.
    expect(charter.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('is deterministic for the same input', () => {
    const a = buildAgentCharter('do the thing', { name: 'Sage' });
    const b = buildAgentCharter('do the thing', { name: 'Sage' });
    expect(a).toBe(b);
  });
});
