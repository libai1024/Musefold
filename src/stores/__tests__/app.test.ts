import { beforeEach, describe, expect, it, vi } from 'vitest';

const MOTION_KEY = 'musefold:reduced-motion';
const DENSITY_KEY = 'musefold:density';

function installLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  return values;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('appearance preferences', () => {
  it('falls back when persisted values are invalid', async () => {
    installLocalStorage({ [MOTION_KEY]: 'broken', [DENSITY_KEY]: 'tiny' });
    const { useAppStore } = await import('../app');

    expect(useAppStore.getState().reducedMotion).toBe('system');
    expect(useAppStore.getState().density).toBe('comfortable');
  });

  it('hydrates valid values and persists updates', async () => {
    const values = installLocalStorage({ [MOTION_KEY]: 'on', [DENSITY_KEY]: 'compact' });
    const { useAppStore } = await import('../app');

    expect(useAppStore.getState().reducedMotion).toBe('on');
    expect(useAppStore.getState().density).toBe('compact');

    useAppStore.getState().setReducedMotion('off');
    useAppStore.getState().setDensity('comfortable');
    expect(values.get(MOTION_KEY)).toBe('off');
    expect(values.get(DENSITY_KEY)).toBe('comfortable');
  });
});

describe('shell preferences', () => {
  it('tracks sidebar collapse state for narrow shells', async () => {
    installLocalStorage();
    const { useAppStore } = await import('../app');

    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    useAppStore.getState().setSidebarCollapsed(false);
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });
});
