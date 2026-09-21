import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignSchemePackageStaging } from '../package-staging';

const electronMock = vi.hoisted(() => ({
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
  fromWebContents: vi.fn(() => null),
  getPath: vi.fn(() => '/tmp/musefold-package-host'),
}));

vi.mock('electron', () => ({
  app: { getPath: electronMock.getPath },
  BrowserWindow: { fromWebContents: electronMock.fromWebContents },
  dialog: { showOpenDialog: electronMock.showOpenDialog },
  ipcMain: { handle: electronMock.handle },
}));

import {
  cleanupDesignSchemePackageStaging,
  consumeStagedDesignSchemePackage,
  DESIGN_SCHEME_PREPARE_IMPORT_CHANNEL,
  registerDesignSchemePackageHostActions,
  setDesignSchemePackageStagingForTests,
  startDesignSchemePackageStagingMaintenance,
} from '../package-host';

function stagingMock() {
  return {
    stagePickedPackage: vi.fn(),
    consume: vi.fn(),
    cleanupOwner: vi.fn(),
    cleanupAll: vi.fn(),
    collectOrphans: vi.fn(() => ({ scanned: 0, deleted: 0, protected: 0, failed: 0, pending: 0 })),
  };
}

function sender(id = 73) {
  let destroyedListener: (() => void) | undefined;
  const value = {
    id,
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListener = listener;
    }),
  };
  return { value, destroy: () => destroyedListener?.() };
}

function registeredHandler() {
  const handler = electronMock.handle.mock.calls[0]?.[1];
  if (typeof handler !== 'function') throw new Error('package host handler is not registered');
  return handler as (event: unknown, payload: unknown) => Promise<unknown>;
}

describe('Design Scheme package host actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupDesignSchemePackageStaging();
  });

  afterEach(() => {
    cleanupDesignSchemePackageStaging();
  });

  it('continues full recovery batches promptly, backs off when drained, and stops on shutdown', async () => {
    vi.useFakeTimers();
    const staging = stagingMock();
    staging.collectOrphans.mockReturnValueOnce({
      scanned: 20,
      deleted: 19,
      protected: 0,
      failed: 0,
      pending: 0,
    });
    setDesignSchemePackageStagingForTests(staging as unknown as DesignSchemePackageStaging);
    try {
      startDesignSchemePackageStagingMaintenance();
      startDesignSchemePackageStagingMaintenance();
      expect(staging.collectOrphans).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(staging.collectOrphans).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(staging.collectOrphans).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(staging.collectOrphans).toHaveBeenCalledTimes(3);
      cleanupDesignSchemePackageStaging();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(staging.collectOrphans).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('registers the dedicated host lifecycle channel', () => {
    registerDesignSchemePackageHostActions();
    expect(electronMock.handle).toHaveBeenCalledWith(
      DESIGN_SCHEME_PREPARE_IMPORT_CHANNEL,
      expect.any(Function),
    );
  });

  it('rejects invalid options before opening a dialog', async () => {
    registerDesignSchemePackageHostActions();
    const currentSender = sender();

    await expect(
      registeredHandler()({ sender: currentSender.value }, { acceptedFormatVersions: [2, 2] }),
    ).resolves.toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
      message: '导入分享包选项无效',
    });
    expect(electronMock.showOpenDialog).not.toHaveBeenCalled();
  });

  it('returns cancellation without staging when the picker is cancelled', async () => {
    const staging = stagingMock();
    setDesignSchemePackageStagingForTests(staging as unknown as DesignSchemePackageStaging);
    electronMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    registerDesignSchemePackageHostActions();
    const currentSender = sender();

    await expect(
      registeredHandler()({ sender: currentSender.value }, { acceptedFormatVersions: [1, 2] }),
    ).resolves.toEqual({ ok: true, data: { status: 'cancelled' } });
    expect(staging.stagePickedPackage).not.toHaveBeenCalled();
    expect(staging.cleanupOwner).toHaveBeenCalledWith(73);
  });

  it('uses MUSEFOLD_E2E_DESIGN_IMPORT_PATH without opening a dialog', async () => {
    const staging = stagingMock();
    const staged = {
      status: 'staged' as const,
      stagedPackageId: 'stage_e2e',
      packageHash: 'b'.repeat(64),
      sizeBytes: 8,
      formatVersion: 2 as const,
    };
    staging.stagePickedPackage.mockResolvedValueOnce(staged);
    setDesignSchemePackageStagingForTests(staging as unknown as DesignSchemePackageStaging);
    registerDesignSchemePackageHostActions();
    process.env['MUSEFOLD_E2E'] = '1';
    process.env['MUSEFOLD_E2E_DESIGN_IMPORT_PATH'] = '/tmp/e2e.musefold.design';
    const currentSender = sender();

    await expect(
      registeredHandler()({ sender: currentSender.value }, { acceptedFormatVersions: [2] }),
    ).resolves.toEqual({ ok: true, data: staged });
    expect(electronMock.showOpenDialog).not.toHaveBeenCalled();
    expect(staging.stagePickedPackage).toHaveBeenCalledWith(73, '/tmp/e2e.musefold.design', {
      acceptedFormatVersions: [2],
    });
    delete process.env['MUSEFOLD_E2E'];
    delete process.env['MUSEFOLD_E2E_DESIGN_IMPORT_PATH'];
  });

  it('stages a selected package under the invoking sender owner', async () => {
    const staging = stagingMock();
    const staged = {
      status: 'staged' as const,
      stagedPackageId: 'stage_1',
      packageHash: 'a'.repeat(64),
      sizeBytes: 42,
      formatVersion: 2 as const,
    };
    staging.stagePickedPackage.mockResolvedValueOnce(staged);
    setDesignSchemePackageStagingForTests(staging as unknown as DesignSchemePackageStaging);
    electronMock.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/picked/package.musefold.design'],
    });
    registerDesignSchemePackageHostActions();
    const currentSender = sender();

    await expect(
      registeredHandler()({ sender: currentSender.value }, { acceptedFormatVersions: [2] }),
    ).resolves.toEqual({ ok: true, data: staged });
    expect(staging.stagePickedPackage).toHaveBeenCalledWith(73, '/picked/package.musefold.design', {
      acceptedFormatVersions: [2],
    });
    expect(currentSender.value.once).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });

  it('cleans and cancels when the sender is destroyed during the picker or staging', async () => {
    const staging = stagingMock();
    staging.stagePickedPackage.mockResolvedValue({
      status: 'staged',
      stagedPackageId: 'stage_1',
      packageHash: 'a'.repeat(64),
      sizeBytes: 42,
      formatVersion: 2,
    });
    setDesignSchemePackageStagingForTests(staging as unknown as DesignSchemePackageStaging);
    electronMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/picked/package.musefold.design'],
    });
    registerDesignSchemePackageHostActions();

    const destroyedInDialog = sender(81);
    destroyedInDialog.value.isDestroyed.mockReturnValue(true);
    await expect(
      registeredHandler()({ sender: destroyedInDialog.value }, { acceptedFormatVersions: [2] }),
    ).resolves.toEqual({ ok: true, data: { status: 'cancelled' } });
    expect(staging.stagePickedPackage).not.toHaveBeenCalled();

    const destroyedAfterStage = sender(82);
    destroyedAfterStage.value.isDestroyed.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await expect(
      registeredHandler()({ sender: destroyedAfterStage.value }, { acceptedFormatVersions: [2] }),
    ).resolves.toEqual({ ok: true, data: { status: 'cancelled' } });
    expect(staging.stagePickedPackage).toHaveBeenCalledWith(82, '/picked/package.musefold.design', {
      acceptedFormatVersions: [2],
    });
    expect(staging.cleanupOwner).toHaveBeenCalledWith(82);
  });

  it('delegates one-shot consumption and does not resurrect staging after shutdown', async () => {
    const staging = stagingMock();
    staging.consume.mockResolvedValueOnce('imported');
    setDesignSchemePackageStagingForTests(staging as unknown as DesignSchemePackageStaging);
    electronMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    registerDesignSchemePackageHostActions();
    const currentSender = sender(91);
    await registeredHandler()({ sender: currentSender.value }, { acceptedFormatVersions: [2] });
    const consume = vi.fn();
    const input = {
      stagedPackageId: 'stage_1',
      packageHash: 'a'.repeat(64),
      formatVersion: 2 as const,
    };

    await expect(consumeStagedDesignSchemePackage(91, input, consume)).resolves.toBe('imported');
    expect(staging.consume).toHaveBeenCalledWith(91, input, consume);

    cleanupDesignSchemePackageStaging();
    expect(staging.cleanupAll).toHaveBeenCalledOnce();
    electronMock.getPath.mockClear();
    currentSender.destroy();
    expect(electronMock.getPath).not.toHaveBeenCalled();
  });
});
