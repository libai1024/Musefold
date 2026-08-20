import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/types/ipc';

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

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
  },
}));

vi.mock('../../../update', () => ({
  getUpdaterService: () => service,
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

import { registerUpdaterHandlers } from '../updater';

describe('updater IPC channel handlers', () => {
  beforeEach(() => {
    handlers.clear();
    settings.channel = 'stable';
    settings.lockedByEnv = false;
    settings.setUpdateChannel.mockClear();
    service.setChannel.mockClear();
    service.check.mockClear();
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
});
