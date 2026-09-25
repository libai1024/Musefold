import { describe, expect, it, vi } from 'vitest';
import {
  allowsPrereleaseForChannel,
  resolveUpdateFeedUrl,
  UPDATE_FEED_BASE_URL_ENV,
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
    this.emit('download-progress', {
      percent: 42.5,
      transferred: 425,
      total: 1000,
      bytesPerSecond: 100,
    });
    this.emit('update-downloaded', { version: '0.6.0' });
    return ['/tmp/Musefold-0.6.0.dmg'];
  });
  readonly quitAndInstall = vi.fn();
  private readonly listeners = new Map<keyof UpdaterEventMap, (...args: never[]) => void>();

  on<EventName extends keyof UpdaterEventMap>(
    event: EventName,
    listener: UpdaterEventMap[EventName],
  ): void {
    this.listeners.set(event, listener as (...args: never[]) => void);
  }

  emit<EventName extends keyof UpdaterEventMap>(
    event: EventName,
    ...args: Parameters<UpdaterEventMap[EventName]>
  ): void {
    this.listeners.get(event)?.(...(args as never[]));
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
      beforeInstall: async () => {
        prepared = true;
      },
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
    expect(states).toEqual([
      'checking',
      'available',
      'downloading',
      'downloading',
      'downloaded',
      'installing',
    ]);
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

  it('auto-downloads when a check finds an update and autoDownload is enabled', async () => {
    const adapter = new FakeUpdater();
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0',
      enabled: true,
      feedUrl: 'https://updates.example.test/stable/',
      autoDownload: true,
    });

    expect(adapter.autoDownload).toBe(false);
    // 自动下载开启时,退出即安装跟随开启(VS Code/Chrome 基线)。
    expect(adapter.autoInstallOnAppQuit).toBe(true);
    expect(service.getAutoDownload()).toBe(true);

    await service.check();
    // available 不停留:同一次检查后直接进入下载并完成。
    expect(service.getState()).toMatchObject({ state: 'downloaded', version: '0.6.0' });
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not auto-download by default (manual mode unchanged)', async () => {
    const adapter = new FakeUpdater();
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0',
      enabled: true,
      feedUrl: 'https://updates.example.test/stable/',
    });

    expect(adapter.autoInstallOnAppQuit).toBe(false);
    await service.check();
    expect(service.getState()).toMatchObject({ state: 'available', version: '0.6.0' });
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();
  });

  it('setAutoDownload takes effect immediately for a pending available update', async () => {
    const adapter = new FakeUpdater();
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0',
      enabled: true,
      feedUrl: 'https://updates.example.test/stable/',
    });

    await service.check();
    expect(service.getState()).toMatchObject({ state: 'available' });

    service.setAutoDownload(true);
    expect(service.getAutoDownload()).toBe(true);
    expect(adapter.autoInstallOnAppQuit).toBe(true);
    expect(service.getState()).toMatchObject({ state: 'downloaded', version: '0.6.0' });

    // 幂等:重复同值不重复触发下载。
    service.setAutoDownload(true);
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('setAutoDownload(false) keeps a completed download but stops install-on-quit', async () => {
    const adapter = new FakeUpdater();
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0',
      enabled: true,
      feedUrl: 'https://updates.example.test/stable/',
      autoDownload: true,
    });

    await service.check();
    expect(service.getState()).toMatchObject({ state: 'downloaded' });

    service.setAutoDownload(false);
    expect(adapter.autoInstallOnAppQuit).toBe(false);
    // 已完成的下载保留,用户仍可显式 install。
    expect(service.getState()).toMatchObject({ state: 'downloaded', version: '0.6.0' });
    await service.install();
    expect(adapter.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('locks autoInstallOnAppQuit when explicitly disabled (ad-hoc mac builds)', async () => {
    const adapter = new FakeUpdater();
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0',
      enabled: true,
      feedUrl: 'https://updates.example.test/stable/',
      autoDownload: true,
      autoInstallOnAppQuit: false,
    });

    // 显式 false 优先于 autoDownload 跟随:Squirrel 预取在 ad-hoc 下必炸,必须关死。
    expect(adapter.autoInstallOnAppQuit).toBe(false);
    service.setAutoDownload(false);
    service.setAutoDownload(true);
    expect(adapter.autoInstallOnAppQuit).toBe(false);
  });

  it('runs the injected install action instead of Squirrel quitAndInstall', async () => {
    const adapter = new FakeUpdater();
    const installAction = vi.fn(async () => undefined);
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0',
      enabled: true,
      feedUrl: 'https://updates.example.test/stable/',
      installAction,
    });

    await service.check();
    await service.download();

    // 失败先来:安装动作抛错 → error 状态;install 只认 downloaded,恢复路径是重新下载再装。
    installAction.mockRejectedValueOnce(new Error('EPERM'));
    await service.install();
    expect(service.getState()).toMatchObject({ state: 'error', message: 'EPERM' });
    expect(installAction).toHaveBeenCalledTimes(1);

    await service.download();
    expect(service.getState()).toMatchObject({ state: 'downloaded' });
    await service.install();
    expect(installAction).toHaveBeenCalledTimes(2);
    expect(adapter.quitAndInstall).not.toHaveBeenCalled();
  });

  it('auto-download also applies to event-driven update-available transitions', async () => {
    const adapter = new FakeUpdater();
    // electron-updater 真实行为:checkForUpdates 回包前先发 update-available 事件;
    // 回包本身给一个形状合法的占位(状态机此刻已由事件推进,不再消费回包字段)。
    adapter.checkForUpdates.mockImplementationOnce(async () => {
      adapter.emit('checking-for-update');
      adapter.emit('update-available', { version: '0.7.0' });
      return { isUpdateAvailable: true, updateInfo: { version: '0.7.0' } };
    });
    const service = new UpdaterService({
      adapter,
      currentVersion: '0.5.0',
      enabled: true,
      feedUrl: 'https://updates.example.test/stable/',
      autoDownload: true,
    });

    await service.check();
    // FakeUpdater 的 downloadUpdate 事件自带 0.6.0 版本号(覆盖 available 元数据),
    // 这里只断言事件路径同样触发了自动下载并到达 downloaded。
    expect(service.getState()).toMatchObject({ state: 'downloaded' });
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps the historical stable feed URL character-for-character', () => {
    expect(resolveUpdateFeedUrl('stable')).toBe('https://zhaozhaoyue.top/Musefold/updates/stable/');
    expect(resolveUpdateFeedUrl('beta')).toBe('https://zhaozhaoyue.top/Musefold/updates/beta/');
    expect(resolveUpdateFeedUrl('dev')).toBe('https://zhaozhaoyue.top/Musefold/updates/dev/');
  });

  it('overrides the feed base url only for a valid http(s) MUSEFOLD_UPDATE_FEED_BASE_URL', () => {
    const original = process.env[UPDATE_FEED_BASE_URL_ENV];
    try {
      process.env[UPDATE_FEED_BASE_URL_ENV] = 'http://127.0.0.1:8787/local-updates';
      expect(resolveUpdateFeedUrl('stable')).toBe('http://127.0.0.1:8787/local-updates/stable/');

      process.env[UPDATE_FEED_BASE_URL_ENV] = 'ftp://bad.example/updates';
      expect(resolveUpdateFeedUrl('stable')).toBe(
        'https://zhaozhaoyue.top/Musefold/updates/stable/',
      );
    } finally {
      if (original === undefined) {
        delete process.env[UPDATE_FEED_BASE_URL_ENV];
      } else {
        process.env[UPDATE_FEED_BASE_URL_ENV] = original;
      }
    }
  });

  it('enables prerelease only for non-stable channels', () => {
    expect(allowsPrereleaseForChannel('stable')).toBe(false);
    expect(allowsPrereleaseForChannel('beta')).toBe(true);
    expect(allowsPrereleaseForChannel('dev')).toBe(true);

    const stableAdapter = new FakeUpdater();
    new UpdaterService({ adapter: stableAdapter, currentVersion: '0.5.0', enabled: true });
    expect(stableAdapter.allowPrerelease).toBe(false);
    expect(stableAdapter.setFeedURL).toHaveBeenCalledWith(
      'https://zhaozhaoyue.top/Musefold/updates/stable/',
    );

    const betaAdapter = new FakeUpdater();
    new UpdaterService({
      adapter: betaAdapter,
      currentVersion: '0.5.0',
      enabled: true,
      channel: 'beta',
    });
    expect(betaAdapter.allowPrerelease).toBe(true);
    expect(betaAdapter.setFeedURL).toHaveBeenCalledWith(
      'https://zhaozhaoyue.top/Musefold/updates/beta/',
    );
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
    expect(adapter.setFeedURL).toHaveBeenCalledWith(
      'https://zhaozhaoyue.top/Musefold/updates/dev/',
    );
    expect(service.getState()).toEqual({ state: 'idle', currentVersion: '0.5.0' });

    await service.check();
    expect(service.getState()).toMatchObject({ state: 'available', version: '0.6.0' });
  });
});
