import { describe, expect, it, vi } from 'vitest';
import { get } from '$lib/stores/storeCompat';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { fontSize, resetSettingsToDefault } from './settings';

describe('settings resetSettingsToDefault', () => {
  it('resets font size to 14', () => {
    fontSize.set(20);
    expect(get(fontSize)).toBe(20);
    resetSettingsToDefault();
    expect(get(fontSize)).toBe(14);
  });
});
