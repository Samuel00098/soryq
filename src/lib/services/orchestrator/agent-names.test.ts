import { describe, expect, it } from 'vitest';
import { isGenericAgentName, pickAssistantName } from './agent-names';

describe('isGenericAgentName', () => {
  it('treats blank or numeric-only labels as generic', () => {
    expect(isGenericAgentName(undefined)).toBe(true);
    expect(isGenericAgentName('')).toBe(true);
    expect(isGenericAgentName('   ')).toBe(true);
    expect(isGenericAgentName('2')).toBe(true);
  });

  it('flags labels that collapse to the agent command', () => {
    expect(isGenericAgentName('claude', 'claude')).toBe(true);
    expect(isGenericAgentName('claude-1', 'claude')).toBe(true);
    expect(isGenericAgentName('Claude 2', 'claude')).toBe(true);
    expect(isGenericAgentName('claude_3', 'claude')).toBe(true);
  });

  it('flags labels that collapse to the product display name', () => {
    expect(isGenericAgentName('Claude Code', 'claude', 'Claude Code')).toBe(true);
    expect(isGenericAgentName('Claude Code 2', 'claude', 'Claude Code')).toBe(true);
  });

  it('flags bland generic words regardless of command', () => {
    expect(isGenericAgentName('agent')).toBe(true);
    expect(isGenericAgentName('Agent 1')).toBe(true);
    expect(isGenericAgentName('assistant')).toBe(true);
    expect(isGenericAgentName('bot-3')).toBe(true);
  });

  it('keeps real human names the user would choose', () => {
    expect(isGenericAgentName('Iris', 'claude')).toBe(false);
    expect(isGenericAgentName('Frontend', 'claude')).toBe(false);
    expect(isGenericAgentName('Nova 2', 'claude')).toBe(false);
    expect(isGenericAgentName('claude-reviewer', 'claude')).toBe(false);
  });
});

describe('pickAssistantName', () => {
  it('returns a name not already taken (case-insensitive)', () => {
    const taken = ['ada', 'IRIS', 'leo'];
    const picked = pickAssistantName(taken);
    expect(taken.map((n) => n.toLowerCase())).not.toContain(picked.toLowerCase());
  });

  it('falls back to a numbered variant when every name is in use', () => {
    // Exhaust the pool by passing a huge taken set built from many picks.
    const taken = new Set<string>();
    for (let i = 0; i < 40; i++) taken.add(pickAssistantName(taken));
    const overflow = pickAssistantName(taken);
    expect(overflow).toMatch(/ \d+$/);
  });
});
