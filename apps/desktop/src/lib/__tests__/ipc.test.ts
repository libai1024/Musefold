import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '@musefold/desktop-contracts/ipc';

describe('renderer ipc accessor', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws a clear diagnostic when window.api is missing', async () => {
    vi.stubGlobal('window', {});
    const { api } = await import('../ipc');

    expect(() => api.provider.list()).toThrow(/IPC 桥不可用：window\.api 未注入/);
  });

  it('uses an injected bridge when one is available', async () => {
    const injected = {
      provider: {
        list: vi.fn().mockResolvedValue([]),
      },
    } as unknown as Api;
    vi.stubGlobal('window', { api: injected });
    const { api } = await import('../ipc');

    expect(api).toBe(injected);
    await expect(api.provider.list()).resolves.toEqual([]);
  });
});
