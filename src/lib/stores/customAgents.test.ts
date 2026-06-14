import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  customAgents,
  addCustomAgent,
  updateCustomAgent,
  deleteCustomAgent,
  getCustomAgents,
} from './customAgents';

describe('customAgents store', () => {
  beforeEach(() => {
    customAgents.set([]);
  });

  it('adds an agent with trimmed fields', () => {
    const created = addCustomAgent({ name: '  Aider ', command: ' aider --foo ', readsRulesFile: true });
    expect(created).not.toBeNull();
    expect(created!.name).toBe('Aider');
    expect(created!.command).toBe('aider --foo');
    expect(created!.readsRulesFile).toBe(true);
    expect(getCustomAgents()).toHaveLength(1);
  });

  it('rejects empty name or command', () => {
    expect(addCustomAgent({ name: '', command: 'x' })).toBeNull();
    expect(addCustomAgent({ name: 'x', command: '   ' })).toBeNull();
    expect(get(customAgents)).toHaveLength(0);
  });

  it('rejects a duplicate launch command (case-insensitive)', () => {
    expect(addCustomAgent({ name: 'A', command: 'aider' })).not.toBeNull();
    expect(addCustomAgent({ name: 'B', command: 'AIDER' })).toBeNull();
    expect(get(customAgents)).toHaveLength(1);
  });

  it('defaults readsRulesFile to false when omitted', () => {
    const created = addCustomAgent({ name: 'Plain', command: 'plain-cli' });
    expect(created!.readsRulesFile).toBe(false);
  });

  it('updates fields and toggles rules-file flag', () => {
    const a = addCustomAgent({ name: 'A', command: 'a', readsRulesFile: false })!;
    updateCustomAgent(a.id, { name: 'Renamed', readsRulesFile: true });
    const updated = getCustomAgents()[0];
    expect(updated.name).toBe('Renamed');
    expect(updated.readsRulesFile).toBe(true);
    expect(updated.command).toBe('a');
  });

  it('ignores blank update values, keeping the prior value', () => {
    const a = addCustomAgent({ name: 'Keep', command: 'keep-cmd' })!;
    updateCustomAgent(a.id, { name: '   ', command: '' });
    const updated = getCustomAgents()[0];
    expect(updated.name).toBe('Keep');
    expect(updated.command).toBe('keep-cmd');
  });

  it('deletes by id', () => {
    const a = addCustomAgent({ name: 'A', command: 'a' })!;
    addCustomAgent({ name: 'B', command: 'b' });
    deleteCustomAgent(a.id);
    const remaining = getCustomAgents();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].command).toBe('b');
  });
});
