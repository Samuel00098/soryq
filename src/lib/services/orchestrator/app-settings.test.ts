import { describe, it, expect, beforeEach } from 'vitest';
import { get } from '$lib/stores/storeCompat';
import {
  applyAgentSetting,
  getAgentSettingsSnapshot,
  listThemeNames,
} from './app-settings';
import { fontSize, wordWrap, appearance, uiZoom } from '$lib/stores/settings';
import { activeTheme } from '$lib/stores/theme';

describe('app-settings (agent settings control)', () => {
  beforeEach(() => {
    fontSize.set(14);
    wordWrap.set(false);
    appearance.set('system');
    uiZoom.set(100);
  });

  it('lists preset theme names the agent can switch to', () => {
    const names = listThemeNames();
    expect(names).toContain('Dusk');
    expect(names).toContain('Moss');
  });

  it('snapshots current settings values', () => {
    fontSize.set(18);
    const snap = getAgentSettingsSnapshot();
    expect(snap.values.fontSize).toBe(18);
    expect(snap.values.wordWrap).toBe(false);
    expect(snap.availableThemes).toContain('Dusk');
  });

  it('coerces truthy words to booleans', async () => {
    const res = await applyAgentSetting('wordWrap', 'on');
    expect(res.ok).toBe(true);
    expect(get(wordWrap)).toBe(true);
  });

  it('clamps numbers to the allowed range', async () => {
    const res = await applyAgentSetting('fontSize', 999);
    expect(res.ok).toBe(true);
    expect(get(fontSize)).toBe(32);

    await applyAgentSetting('uiZoom', 10);
    expect(get(uiZoom)).toBe(50);
  });

  it('accepts a case-insensitive setting name', async () => {
    const res = await applyAgentSetting('fontsize', '20');
    expect(res.ok).toBe(true);
    expect(get(fontSize)).toBe(20);
  });

  it('validates enum settings', async () => {
    const ok = await applyAgentSetting('appearance', 'dark');
    expect(ok.ok).toBe(true);
    expect(get(appearance)).toBe('dark');

    const bad = await applyAgentSetting('appearance', 'neon');
    expect(bad.ok).toBe(false);
    expect(get(appearance)).toBe('dark');
  });

  it('switches to a preset theme by name', async () => {
    const res = await applyAgentSetting('theme', 'Dusk');
    expect(res.ok).toBe(true);
    expect(get(activeTheme)?.name).toBe('Dusk');
  });

  it('rejects an unknown theme and an unknown setting', async () => {
    const badTheme = await applyAgentSetting('theme', 'NotARealTheme');
    expect(badTheme.ok).toBe(false);

    const badSetting = await applyAgentSetting('rocketFuel', 'on');
    expect(badSetting.ok).toBe(false);
  });
});
