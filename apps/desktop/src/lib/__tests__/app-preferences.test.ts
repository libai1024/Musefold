import { describe, expect, it, vi } from 'vitest';
import { migrateAppPreferences, sanitizeAppPreferences } from '../app-preferences';
import { createMigratingJSONStorage, persistStateOf } from '../zustand-persist';

describe('app preference sanitizers', () => {
  it('drops unknown enum values instead of hydrating them', () => {
    expect(sanitizeAppPreferences({
      themeSource: 'sepia',
      reducedMotion: 'maybe',
      density: 'tiny',
      defaultProviderId: 12,
      schemePriorityMode: 'random',
    })).toEqual({
      themeSource: 'system',
      reducedMotion: 'system',
      density: 'comfortable',
      defaultProviderId: null,
      schemePriorityMode: 'scheme_first',
    });
  });

  it('keeps versioned persist payloads after migrate', () => {
    const next = migrateAppPreferences({
      themeSource: 'light',
      reducedMotion: 'off',
      density: 'compact',
      defaultProviderId: 'p1',
      schemePriorityMode: 'user_first',
    }, 0);
    expect(next.themeSource).toBe('light');
    expect(next.defaultProviderId).toBe('p1');
  });
});

describe('persistStateOf', () => {
  it('reads zustand persist JSON wrappers', () => {
    expect(persistStateOf<{ onboarded: boolean }>(JSON.stringify({ state: { onboarded: true }, version: 1 }))).toEqual({
      onboarded: true,
    });
    expect(persistStateOf('not-json')).toBeNull();
  });
});

describe('migrating json storage', () => {
  it('falls back to legacy state then clears it on write', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
    });
    const storage = createMigratingJSONStorage<{ onboarded: boolean }>({
      readLegacy: () => ({ onboarded: true }),
      clearLegacy: () => values.delete('legacy'),
    });
    values.set('legacy', '1');
    const loaded = storage.getItem('musefold:onboarding');
    expect(loaded).toEqual({ state: { onboarded: true }, version: 0 });
    storage.setItem('musefold:onboarding', { state: { onboarded: true }, version: 1 });
    expect(values.has('legacy')).toBe(false);
    expect(values.get('musefold:onboarding')).toContain('"onboarded":true');
  });
});
