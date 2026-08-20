import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@musefold/desktop-contracts/ipc';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
const settings = vi.hoisted(() => ({
  channel: 'stable' as 'dev' | 'beta' | 'stable',
  lockedByEnv: false,
  setUpdateChannel: vi.fn((channel: 'dev' | 'beta' | 'stable') => {
    settings.channel = channel;
    return channel;
  }),
}));
const service = vi.hoisted(() => ({
  setChannel: vi.fn(),
  check: vi.fn(async () => ({ state: 'idle', currentVersion: '0.5.0' })),
  getState: vi.fn(() => ({ state: 'idle', currentVersion: '0.5.0' })),
}));
const beacon = vi.hoisted(() => ({
  confirm: vi.fn(),
  peek: vi.fn((): { root: string; source: 'builtin' | 'bundle' } | undefined => ({
    root: '/tmp/builtin-renderer',
    source: 'builtin',
  })),
  fromWebContents: vi.fn(),
}));
const content = vi.hoisted(() => ({
  pending: null as string | null,
  knownGood: null as string | null,
  previousGood: null as string | null,
  lastCheck: null as { status: string; reason?: string; at: number } | null,
  checkDeps: { publicKeys: ['test-key'] as readonly string[] },
  runOnce: vi.fn<(...args: unknown[]) => Promise<{ status: string }>>(async () => {
    content.lastCheck = { status: 'trust_anchor_missing', at: 1 };
    return { status: 'trust_anchor_missing' };
  }),
  getBundleDir: (version: string) => `/tmp/content-bundles/${version}`,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
  },
  BrowserWindow: {
    fromWebContents: beacon.fromWebContents,
  },
}));

vi.mock('../../../update', () => ({
  getUpdaterService: () => service,
}));

vi.mock('../../../update/content-bundle-runtime', () => ({
  confirmContentBundleStartup: beacon.confirm,
}));

vi.mock('../../renderer-bundle', () => ({
  peekRendererRootResolution: beacon.peek,
}));

vi.mock('../../../update/content-bundle-store', () => ({
  getPendingVersion: () => content.pending,
  getKnownGoodVersion: () => content.knownGood,
  getPreviousGoodVersion: () => content.previousGood,
  getBundleDir: (version: string) => content.getBundleDir(version),
}));

vi.mock('../../../update/content-updater', () => ({
  runContentUpdateCheckOnce: (deps?: unknown) => content.runOnce(deps),
  getLastContentUpdateCheck: () => content.lastCheck,
  resolveContentUpdateSchedulePlan: () => ({
    disabled: false,
    initialDelayMs: 0,
    checkDeps: content.checkDeps,
  }),
}));

vi.mock('../../../settings/update-channel', async () => {
  const { CHANNELS } = await import('@musefold/update-protocol');
  const channelSet = new Set<string>(CHANNELS);
  return {
    getUpdateChannel: () => settings.channel,
    isUpdateChannelLockedByEnv: () => settings.lockedByEnv,
    isUpdateChannel: (value: unknown): value is 'dev' | 'beta' | 'stable' =>
      typeof value === 'string' && channelSet.has(value),
    setUpdateChannel: settings.setUpdateChannel,
  };
});

import { registerUpdaterHandlers, resetContentCheckInFlightForTests } from '../updater';

function trustedEvent() {
  const mainFrame = { id: 1 };
  const sender = { isDestroyed: () => false, mainFrame };
  beacon.fromWebContents.mockReturnValue({ isDestroyed: () => false });
  return { sender, senderFrame: mainFrame };
}

function expectRedacted(payload: unknown): void {
  const json = JSON.stringify(payload);
  expect(json).not.toMatch(/https?:\/\//);
  expect(json).not.toContain('/tmp/content-bundles');
  expect(json).not.toContain('/Users/');
  expect(payload).not.toHaveProperty('message');
  expect(payload).not.toHaveProperty('root');
}

describe('updater IPC channel handlers', () => {
  beforeEach(() => {
    handlers.clear();
    settings.channel = 'stable';
    settings.lockedByEnv = false;
    settings.setUpdateChannel.mockClear();
    service.setChannel.mockClear();
    service.check.mockClear();
    beacon.confirm.mockClear();
    beacon.peek.mockClear();
    beacon.peek.mockReturnValue({ root: '/tmp/builtin-renderer', source: 'builtin' });
    beacon.fromWebContents.mockReset();
    content.pending = null;
    content.knownGood = null;
    content.previousGood = null;
    content.lastCheck = null;
    content.checkDeps = { publicKeys: ['test-key'] };
    content.runOnce.mockReset();
    content.runOnce.mockImplementation(async () => {
      content.lastCheck = { status: 'trust_anchor_missing', at: 1 };
      return { status: 'trust_anchor_missing' as const };
    });
    resetContentCheckInFlightForTests();
    registerUpdaterHandlers();
  });

  it('rejects illegal setChannel input without touching storage or the feed', () => {
    const result = handlers.get(IPC.UPDATER_SET_CHANNEL)?.({}, 'nightly');
    expect(result).toEqual({
      ok: false,
      channel: 'stable',
      lockedByEnv: false,
      message: '不支持的更新通道',
    });
    expect(settings.setUpdateChannel).not.toHaveBeenCalled();
    expect(service.setChannel).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(result)).not.toContain('/Users/');
  });

  it('rejects object payloads that try to smuggle a feed URL', () => {
    const result = handlers.get(IPC.UPDATER_SET_CHANNEL)?.({}, {
      channel: 'beta',
      feedUrl: 'https://evil.example/updates/beta/',
    });
    expect(result).toMatchObject({ ok: false, message: '不支持的更新通道' });
    expect(settings.setUpdateChannel).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('evil.example');
  });

  it('refuses to change channel when the environment variable locked it', () => {
    settings.lockedByEnv = true;
    settings.channel = 'dev';
    const result = handlers.get(IPC.UPDATER_SET_CHANNEL)?.({}, 'beta');
    expect(result).toEqual({
      ok: false,
      channel: 'dev',
      lockedByEnv: true,
      message: '更新通道已由环境变量锁定，无法在设置中修改',
    });
    expect(settings.setUpdateChannel).not.toHaveBeenCalled();
    expect(service.setChannel).not.toHaveBeenCalled();
  });

  it('applies a valid channel and re-checks updates', () => {
    const result = handlers.get(IPC.UPDATER_SET_CHANNEL)?.({}, 'beta');
    expect(result).toEqual({ ok: true, channel: 'beta', lockedByEnv: false });
    expect(settings.setUpdateChannel).toHaveBeenCalledWith('beta');
    expect(service.setChannel).toHaveBeenCalledWith('beta');
    expect(service.check).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/zhaozhaoyue/);
  });

  it('returns only the channel id and lock flag from getChannel', () => {
    settings.channel = 'beta';
    settings.lockedByEnv = true;
    const result = handlers.get(IPC.UPDATER_GET_CHANNEL)?.({});
    expect(result).toEqual({ channel: 'beta', lockedByEnv: true });
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\//);
    expect(Object.keys(result as object).sort()).toEqual(['channel', 'lockedByEnv']);
  });

  it('confirms content startup when the beacon comes from our window', () => {
    const mainFrame = { id: 1 };
    const sender = { isDestroyed: () => false, mainFrame };
    beacon.fromWebContents.mockReturnValue({ isDestroyed: () => false });

    handlers.get(IPC.UPDATER_CONTENT_READY)?.({ sender, senderFrame: mainFrame });

    expect(beacon.confirm).toHaveBeenCalledWith({
      root: '/tmp/builtin-renderer',
      source: 'builtin',
    });
  });

  it('ignores content-ready beacons from unknown webContents', () => {
    const sender = { isDestroyed: () => false, mainFrame: { id: 1 } };
    beacon.fromWebContents.mockReturnValue(null);

    handlers.get(IPC.UPDATER_CONTENT_READY)?.({ sender, senderFrame: sender.mainFrame });

    expect(beacon.confirm).not.toHaveBeenCalled();
  });

  it('ignores content-ready beacons from a subframe', () => {
    const mainFrame = { id: 1 };
    const childFrame = { id: 2 };
    const sender = { isDestroyed: () => false, mainFrame };
    beacon.fromWebContents.mockReturnValue({ isDestroyed: () => false });

    handlers.get(IPC.UPDATER_CONTENT_READY)?.({ sender, senderFrame: childFrame });

    expect(beacon.confirm).not.toHaveBeenCalled();
  });
});

describe('updater content-layer IPC', () => {
  beforeEach(() => {
    handlers.clear();
    beacon.confirm.mockClear();
    beacon.peek.mockReset();
    beacon.peek.mockReturnValue({ root: '/tmp/builtin-renderer', source: 'builtin' });
    beacon.fromWebContents.mockReset();
    content.pending = null;
    content.knownGood = null;
    content.previousGood = null;
    content.lastCheck = null;
    content.checkDeps = { publicKeys: ['test-key'] };
    content.runOnce.mockReset();
    content.runOnce.mockImplementation(async () => {
      content.lastCheck = { status: 'trust_anchor_missing', at: 1 };
      return { status: 'trust_anchor_missing' as const };
    });
    resetContentCheckInFlightForTests();
    registerUpdaterHandlers();
  });

  it('resolves activeBundleVersion from the pending pointer directory', () => {
    content.pending = '1.2.1-dev.10';
    content.knownGood = '1.2.1-dev.9';
    beacon.peek.mockReturnValue({
      root: '/tmp/content-bundles/1.2.1-dev.10',
      source: 'bundle',
    });

    const result = handlers.get(IPC.UPDATER_GET_CONTENT_STATE)?.(trustedEvent());
    expect(result).toEqual({
      activeSource: 'bundle',
      activeBundleVersion: '1.2.1-dev.10',
      pendingVersion: '1.2.1-dev.10',
      knownGoodVersion: '1.2.1-dev.9',
      lastCheck: null,
    });
    expectRedacted(result);
  });

  it('resolves activeBundleVersion from the knownGood pointer directory', () => {
    content.pending = '1.2.1-dev.11';
    content.knownGood = '1.2.1-dev.9';
    beacon.peek.mockReturnValue({
      root: '/tmp/content-bundles/1.2.1-dev.9',
      source: 'bundle',
    });

    const result = handlers.get(IPC.UPDATER_GET_CONTENT_STATE)?.(trustedEvent());
    expect(result).toMatchObject({
      activeSource: 'bundle',
      activeBundleVersion: '1.2.1-dev.9',
      pendingVersion: '1.2.1-dev.11',
      knownGoodVersion: '1.2.1-dev.9',
    });
    expectRedacted(result);
  });

  it('resolves activeBundleVersion from the previousGood pointer directory', () => {
    content.knownGood = '1.2.1-dev.9';
    content.previousGood = '1.2.1-dev.8';
    beacon.peek.mockReturnValue({
      root: '/tmp/content-bundles/1.2.1-dev.8',
      source: 'bundle',
    });

    const result = handlers.get(IPC.UPDATER_GET_CONTENT_STATE)?.(trustedEvent());
    expect(result).toMatchObject({
      activeSource: 'bundle',
      activeBundleVersion: '1.2.1-dev.8',
      knownGoodVersion: '1.2.1-dev.9',
    });
    expectRedacted(result);
  });

  it('reports builtin when the frozen source is the packaged renderer', () => {
    content.pending = '1.2.1-dev.10';
    beacon.peek.mockReturnValue({ root: '/tmp/builtin-renderer', source: 'builtin' });

    const result = handlers.get(IPC.UPDATER_GET_CONTENT_STATE)?.(trustedEvent());
    expect(result).toMatchObject({
      activeSource: 'builtin',
      activeBundleVersion: null,
      pendingVersion: '1.2.1-dev.10',
    });
    expectRedacted(result);
  });

  it('reports builtin when renderer root is still unfrozen', () => {
    content.knownGood = '1.2.1-dev.9';
    beacon.peek.mockReturnValue(undefined);

    const result = handlers.get(IPC.UPDATER_GET_CONTENT_STATE)?.(trustedEvent());
    expect(result).toEqual({
      activeSource: 'builtin',
      activeBundleVersion: null,
      pendingVersion: null,
      knownGoodVersion: '1.2.1-dev.9',
      lastCheck: null,
    });
    expectRedacted(result);
  });

  it('returns lastCheck without message or internal fields', () => {
    content.lastCheck = {
      status: 'manifest_invalid',
      reason: 'invalid_signature',
      at: 42,
    };

    const result = handlers.get(IPC.UPDATER_GET_CONTENT_STATE)?.(trustedEvent()) as {
      lastCheck: unknown;
    };
    expect(result.lastCheck).toEqual({
      status: 'manifest_invalid',
      reason: 'invalid_signature',
      at: 42,
    });
    expectRedacted(result);
  });

  it('coalesces overlapping checkContentNow invokes onto one in-flight promise', async () => {
    let release!: () => void;
    content.runOnce.mockImplementation(
      () =>
        new Promise<{ status: string }>((resolve) => {
          release = () => {
            content.lastCheck = { status: 'not_in_rollout', at: 99 };
            resolve({ status: 'not_in_rollout' });
          };
        }),
    );

    const event = trustedEvent();
    const first = handlers.get(IPC.UPDATER_CHECK_CONTENT_NOW)?.(event) as Promise<unknown>;
    const second = handlers.get(IPC.UPDATER_CHECK_CONTENT_NOW)?.(event) as Promise<unknown>;
    expect(content.runOnce).toHaveBeenCalledTimes(1);
    expect(content.runOnce).toHaveBeenCalledWith(content.checkDeps);

    release();
    await expect(first).resolves.toEqual({ status: 'not_in_rollout', at: 99 });
    await expect(second).resolves.toEqual({ status: 'not_in_rollout', at: 99 });
    expect(content.runOnce).toHaveBeenCalledTimes(1);
    expectRedacted(await first);
  });

  it('does not start a content check from a subframe', async () => {
    const mainFrame = { id: 1 };
    const childFrame = { id: 2 };
    const sender = { isDestroyed: () => false, mainFrame };
    beacon.fromWebContents.mockReturnValue({ isDestroyed: () => false });

    await handlers.get(IPC.UPDATER_CHECK_CONTENT_NOW)?.({ sender, senderFrame: childFrame });
    expect(content.runOnce).not.toHaveBeenCalled();
  });
});
