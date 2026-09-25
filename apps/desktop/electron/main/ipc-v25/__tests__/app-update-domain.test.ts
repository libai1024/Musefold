// appUpdate 域桥行为守护:出参按 contracts zod 复核、偏好写入后同步 UpdaterService 开关、
// 方法表与 V25_METHODS_BY_DOMAIN 机器一致。主进程 update / settings 模块全 mock ——
// 本域只做接线,检查/下载语义在 updater-service 的 FakeUpdater 单测覆盖。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUpdaterService: vi.fn(),
  getUpdatePreferences: vi.fn(),
  setUpdatePreferences: vi.fn(),
}));

vi.mock('../../../update', () => ({ getUpdaterService: mocks.getUpdaterService }));
vi.mock('../../../settings/update-preferences', () => ({
  getUpdatePreferences: mocks.getUpdatePreferences,
  setUpdatePreferences: mocks.setUpdatePreferences,
}));

import { V25_METHODS_BY_DOMAIN } from '@musefold/contracts';
import type { MethodDef } from '../envelope';
import { buildAppUpdateDomainMethods } from '../app-update-domain';

const service = {
  getState: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  setAutoDownload: vi.fn(),
};

const IDLE_STATUS = { state: 'idle', currentVersion: '2.5.0' };
const AVAILABLE_STATUS = { state: 'available', currentVersion: '2.5.0', version: '2.6.0' };
const PREFERENCES = { autoCheckOnStartup: true, autoDownload: true };

function table(): Record<string, MethodDef> {
  return buildAppUpdateDomainMethods();
}

async function call(method: string, payload?: unknown): Promise<unknown> {
  const def = table()[method];
  if (!def) throw new Error(`missing method ${method}`);
  return def.handle(payload);
}

describe('appUpdate domain bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUpdaterService.mockReturnValue(service);
    mocks.getUpdatePreferences.mockReturnValue(PREFERENCES);
    mocks.setUpdatePreferences.mockImplementation((patch: Record<string, unknown>) => ({
      ...PREFERENCES,
      ...patch,
    }));
    service.getState.mockReturnValue(IDLE_STATUS);
    service.check.mockResolvedValue(AVAILABLE_STATUS);
    service.download.mockResolvedValue(AVAILABLE_STATUS);
    service.install.mockResolvedValue(AVAILABLE_STATUS);
  });

  it('registers exactly the contract method set', () => {
    expect(Object.keys(buildAppUpdateDomainMethods()).sort()).toEqual(
      [...V25_METHODS_BY_DOMAIN.appUpdate].sort(),
    );
  });

  it('getState returns a schema-valid status + preferences snapshot', async () => {
    service.getState.mockReturnValueOnce({
      state: 'downloading',
      currentVersion: '2.5.0',
      version: '2.6.0',
      progress: { percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 100 },
    });
    await expect(call('appUpdate.getState', undefined)).resolves.toEqual({
      status: {
        state: 'downloading',
        currentVersion: '2.5.0',
        version: '2.6.0',
        progress: { percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 100 },
      },
      preferences: PREFERENCES,
    });
  });

  it('forwards check/download/install to the updater service', async () => {
    await expect(call('appUpdate.checkForUpdates', undefined)).resolves.toEqual(AVAILABLE_STATUS);
    expect(service.check).toHaveBeenCalledTimes(1);
    await expect(call('appUpdate.downloadUpdate', undefined)).resolves.toEqual(AVAILABLE_STATUS);
    expect(service.download).toHaveBeenCalledTimes(1);
    await expect(call('appUpdate.installUpdate', undefined)).resolves.toEqual(AVAILABLE_STATUS);
    expect(service.install).toHaveBeenCalledTimes(1);
  });

  it('rejects service states that drift from the contract shape', async () => {
    service.check.mockResolvedValueOnce({ state: 'available', currentVersion: '2.5.0' });
    await expect(call('appUpdate.checkForUpdates', undefined)).rejects.toThrow();
  });

  it('updatePreferences persists the patch and applies autoDownload to the running service', async () => {
    await expect(call('appUpdate.updatePreferences', { autoDownload: false })).resolves.toEqual({
      autoCheckOnStartup: true,
      autoDownload: false,
    });
    expect(mocks.setUpdatePreferences).toHaveBeenCalledWith({ autoDownload: false });
    expect(service.setAutoDownload).toHaveBeenCalledWith(false);
  });

  it('accepts an empty patch as a no-op', async () => {
    await expect(call('appUpdate.updatePreferences', {})).resolves.toEqual(PREFERENCES);
    expect(mocks.setUpdatePreferences).toHaveBeenCalledWith({});
    expect(service.setAutoDownload).toHaveBeenCalledWith(true);
  });

  it('rejects out-of-contract patch payloads at the zod boundary', async () => {
    const def = table()['appUpdate.updatePreferences'];
    if (!def) throw new Error('missing appUpdate.updatePreferences');
    expect(def.input.safeParse({ autoDownload: 'yes' }).success).toBe(false);
    // 未知键与 appPreferencesPatch 同语义:strip 剥离,不进 handle。
    const stripped = def.input.safeParse({ surprise: true, autoDownload: false });
    expect(stripped.success).toBe(true);
    expect(stripped.success && stripped.data).toEqual({ autoDownload: false });
    expect(def.input.safeParse({ autoDownload: false }).success).toBe(true);
  });
});
