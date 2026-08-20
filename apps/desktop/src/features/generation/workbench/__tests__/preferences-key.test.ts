import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  historyLoad: vi.fn(),
  appSetView: vi.fn(),
  provider: { id: 'p1', isActive: true, hasKey: true, name: 'Test', model: 'image', type: 'openai-compatible' },
}));

vi.mock('../../../../lib/ipc', () => ({
  default: { image: { generate: vi.fn(), retry: vi.fn(), cancel: vi.fn() } },
}));

vi.mock('../../store', () => ({
  useGenerationStore: { getState: () => ({ providers: [mocks.provider], activeProviderId: 'p1' }) },
}));

vi.mock('../../../../stores/app', () => ({
  useAppStore: { getState: () => ({ setView: mocks.appSetView, defaultProviderId: null }) },
}));

vi.mock('../../../history/store', () => ({
  useHistoryStore: { getState: () => ({ load: mocks.historyLoad }) },
}));

function installLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
  return values;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('workbench preference namespace', () => {
  it('hydrates the single v0.2.2 parameter set', async () => {
    installLocalStorage({
      'musefold:v0.3.0:workbench-preferences-v2': JSON.stringify({
        ratioId: '16:9', quality: 'high', n: 2, background: 'opaque',
      }),
    });

    const { useGenerationWorkbenchStore } = await import('../store');
    expect(useGenerationWorkbenchStore.getState().params).toMatchObject({
      ratioId: '16:9', quality: 'high', n: 2, background: 'opaque',
    });
  });

  it('ignores dual-mode preferences and persists one parameter object', async () => {
    const values = installLocalStorage({
      'musefold:v0.3.0:workbench-preferences': JSON.stringify({
        explore: { n: 2 }, produce: { n: 1 },
      }),
    });

    const { useGenerationWorkbenchStore } = await import('../store');
    expect(useGenerationWorkbenchStore.getState().params.n).toBe(4);
    useGenerationWorkbenchStore.getState().setParams({ n: 6 });
    expect(JSON.parse(values.get('musefold:v0.3.0:workbench-preferences-v2') ?? '{}')).toMatchObject({ n: 6 });
  });
});
