import { defaultAppPreferences } from '@musefold/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { createWebGateway, PREFERENCES_STORAGE_KEY } from '../web-gateway.js';

describe('web settings gateway', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('falls back to defaults when storage is empty or corrupted', async () => {
    const gateway = createWebGateway('https://api.test');
    expect(await gateway.settings.getPreferences()).toEqual(defaultAppPreferences);

    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, '{invalid json');
    expect(await gateway.settings.getPreferences()).toEqual(defaultAppPreferences);
  });

  it('persists patches to localStorage and merges with existing values', async () => {
    const gateway = createWebGateway('https://api.test');
    const updated = await gateway.settings.updatePreferences({ theme: 'dark' });
    expect(updated.theme).toBe('dark');
    expect(updated.language).toBe(defaultAppPreferences.language);

    const stored = JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}');
    expect(stored.theme).toBe('dark');

    const roundTrip = await gateway.settings.getPreferences();
    expect(roundTrip.theme).toBe('dark');
  });

  it('rejects unknown stored shapes back to defaults', async () => {
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ theme: 'neon', language: 'zh-CN', reducedMotion: false }),
    );
    const gateway = createWebGateway('https://api.test');
    expect((await gateway.settings.getPreferences()).theme).toBe('system');
  });
});
