import { describe, expect, it, vi } from 'vitest';
import {
  allowsPrereleaseForChannel,
  resolveUpdateFeedUrl,
  UpdaterService,
  type UpdaterAdapter,
  type UpdaterEventMap,
} from './updater-service';

class FakeUpdater implements UpdaterAdapter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  readonly setFeedURL = vi.fn();
  readonly checkForUpdates = vi.fn(async () => {
    this.emit('checking-for-update');
    this.emit('update-available', { version: '0.6.0', releaseDate: '2026-08-14T00:00:00Z' });
    return { isUpdateAvailable: true, updateInfo: { version: '0.6.0' } };
  });
  readonly downloadUpdate = vi.fn(async () => {
    this.emit('download-progress', { percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 100 });
    this.emit('update-downloaded', { version: '0.6.0' });
    return ['/tmp/Musefold-0.6.0.dmg'];
  });
  readonly quitAndInstall = vi.fn();
  private readonly listeners = new Map<keyof UpdaterEventMap, (...args: never[]) => void>();

  on<EventName extends keyof UpdaterEventMap>(event: EventName, listener: UpdaterEventMap[EventName]): void {
    this.listeners.set(event, listener as (...args: never[]) => void);
  }

  emit<EventName extends keyof UpdaterEventMap>(event: EventName, ...args: Parameters<UpdaterEventMap[EventName]>): void {
    this.listeners.get(event)?.(...args as never[]);
  }
}

describe('UpdaterService', () => {
  it('protects development builds from update network calls', async () => {
    const adapter = new FakeUpdater();
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0-dev',
      enabled: false,
      disabledReason: 'development',
    });

    expect(service.getState()).toEqual({
      state: 'disabled',
      currentVersion: '0.5.0-dev',
      reason: 'development',
    });
    await expect(service.check()).resolves.toEqual(service.getState());
    expect(adapter.checkForUpdates).not.toHaveBeenCalled();
    expect(adapter.setFeedURL).not.toHaveBeenCalled();
  });

  it('checks, downloads and installs through explicit user actions', async () => {
    const adapter = new FakeUpdater();
    const states: string[] = [];
    let prepared = false;
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0',
      enabled: true,
      feedUrl: 'https://updates.example.test/stable/',
      beforeInstall: async () => { prepared = true; },
      onStateChanged: (state) => states.push(state.state),
    });

    expect(adapter.autoDownload).toBe(false);
    expect(adapter.autoInstallOnAppQuit).toBe(false);
    expect(adapter.allowPrerelease).toBe(false);
    expect(adapter.setFeedURL).toHaveBeenCalledWith('https://updates.example.test/stable/');

    await service.check();
    expect(service.getState()).toMatchObject({ state: 'available', version: '0.6.0' });
    await service.download();
    expect(service.getState()).toMatchObject({
      state: 'downloaded',
      version: '0.6.0',
    });
    await service.install();
    expect(prepared).toBe(true);
    expect(service.getState()).toMatchObject({ state: 'installing', version: '0.6.0' });
    expect(adapter.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(states).toEqual(['checking', 'available', 'downloading', 'downloading', 'downloaded', 'installing']);
  });

  it('turns updater errors into a renderer-safe status', async () => {
    const adapter = new FakeUpdater();
    adapter.checkForUpdates.mockRejectedValueOnce(new Error('signature verification failed'));
    const service = new UpdaterService({ adapter, currentVersion: '0.5.0', enabled: true });

    await service.check();
    expect(service.getState()).toEqual({
      state: 'error',
      currentVersion: '0.5.0',
      message: 'signature verification failed',
    });
  });

  it('keeps the historical stable feed URL character-for-character', () => {
    expect(resolveUpdateFeedUrl('stable')).toBe('https://zhaozhaoyue.top/Musefold/updates/stable/');
    expect(resolveUpdateFeedUrl('beta')).toBe('https://zhaozhaoyue.top/Musefold/updates/beta/');
    expect(resolveUpdateFeedUrl('dev')).toBe('https://zhaozhaoyue.top/Musefold/updates/dev/');
  });

  it('enables prerelease only for non-stable channels', () => {
    expect(allowsPrereleaseForChannel('stable')).toBe(false);
    expect(allowsPrereleaseForChannel('beta')).toBe(true);
    expect(allowsPrereleaseForChannel('dev')).toBe(true);

    const stableAdapter = new FakeUpdater();
    new UpdaterService({ adapter: stableAdapter, currentVersion: '0.5.0', enabled: true });
    expect(stableAdapter.allowPrerelease).toBe(false);
    expect(stableAdapter.setFeedURL).toHaveBeenCalledWith('https://zhaozhaoyue.top/Musefold/updates/stable/');

    const betaAdapter = new FakeUpdater();
    new UpdaterService({
      adapter: betaAdapter,
      currentVersion: '0.5.0',
      enabled: true,
      channel: 'beta',
    });
    expect(betaAdapter.allowPrerelease).toBe(true);
    expect(betaAdapter.setFeedURL).toHaveBeenCalledWith('https://zhaozhaoyue.top/Musefold/updates/beta/');
  });

  it('switches the feed URL at runtime and resets to a re-checkable idle state', async () => {
    const adapter = new FakeUpdater();
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0',
      enabled: true,
      feedUrl: 'https://updates.example.test/stable/',
    });

    await service.check();
    expect(service.getState()).toMatchObject({ state: 'available', version: '0.6.0' });

    service.setChannel('dev');
    expect(adapter.allowPrerelease).toBe(true);
    expect(adapter.setFeedURL).toHaveBeenCalledWith('https://zhaozhaoyue.top/Musefold/updates/dev/');
    expect(service.getState()).toEqual({ state: 'idle', currentVersion: '0.5.0' });

    await service.check();
    expect(service.getState()).toMatchObject({ state: 'available', version: '0.6.0' });
  });
});
