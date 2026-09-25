import { app, BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import electronUpdater from 'electron-updater';
import { IPC } from '@musefold/desktop-contracts/ipc';
import { APP_VERSION } from '../system/app-version';
import { getUpdateChannel } from '../settings/update-channel';
import { getUpdatePreferences } from '../settings/update-preferences';
import { resolveUpdateFeedUrl, UpdaterService, type UpdaterAdapter } from './updater-service';
import {
  createElectronSelfReplaceHost,
  downloadedUpdateFilePath,
  isRunningAppBundleAdhocSignedSync,
  performSelfReplaceInstall,
} from './self-replace-installer';
import { scheduleContentUpdateChecks } from './content-updater';

let updaterService: UpdaterService | null = null;

// Do not read electronUpdater.autoUpdater at module load. That getter
// constructs AppUpdater, which throws when unpackaged Linux/Windows report
// version "0.0" (invalid semver). Development/E2E uses a no-op adapter.
const noopAdapter: UpdaterAdapter = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowPrerelease: false,
  setFeedURL() {},
  on() {},
  async checkForUpdates() {
    return {};
  },
  async downloadUpdate() {
    return {};
  },
  quitAndInstall() {},
};

export interface InitializeUpdaterOptions {
  beforeInstall?: () => Promise<void> | void;
}

/** Initialize the production updater once the app and its first window exist. */
export function initializeUpdater(options: InitializeUpdaterOptions = {}): UpdaterService {
  if (updaterService) return updaterService;

  const disabledReason =
    process.env['MUSEFOLD_DISABLE_AUTO_UPDATE'] === '1'
      ? 'disabled-by-environment'
      : !app.isPackaged
        ? 'development'
        : process.platform !== 'darwin' && process.platform !== 'win32'
          ? 'unsupported-platform'
          : undefined;
  const enabled = disabledReason === undefined;
  const channel = getUpdateChannel();

  // macOS ad-hoc 构建:Squirrel.Mac 拒绝安装(签名一致性校验),改走自替换安装,
  // 并固定退出不预装(Squirrel 预取在 ad-hoc 下下载完成即报错,吞掉 downloaded 状态)。
  // 正式 Developer ID 签名与 Windows(NSIS)不受影响,仍走默认安装路径。
  const host = createElectronSelfReplaceHost(app);
  const adhocMacBuild =
    enabled &&
    isRunningAppBundleAdhocSignedSync(host, (command, args) => {
      const result = spawnSync(command, args, { encoding: 'utf8' });
      return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
    });

  updaterService = new UpdaterService({
    adapter: enabled ? (electronUpdater.autoUpdater as unknown as UpdaterAdapter) : noopAdapter,
    currentVersion: APP_VERSION,
    enabled,
    disabledReason,
    channel,
    feedUrl: resolveUpdateFeedUrl(channel),
    autoDownload: getUpdatePreferences().autoDownload,
    autoInstallOnAppQuit: adhocMacBuild ? false : undefined,
    installAction: adhocMacBuild
      ? async () => {
          const zipPath = downloadedUpdateFilePath(electronUpdater.autoUpdater);
          if (!zipPath) throw new Error('更新包尚未就绪,请稍后重试');
          await performSelfReplaceInstall(zipPath, host, host.electronApp);
        }
      : undefined,
    beforeInstall: options.beforeInstall,
    onStateChanged: (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.UPDATER_STATE_CHANGED, status);
      }
    },
  });

  if (enabled) scheduleChecks(updaterService);
  // 内容层检查与外壳 updater 共用初始化点；自身幂等，未打包时才读测试注入变量。
  scheduleContentUpdateChecks();
  return updaterService;
}

export function getUpdaterService(): UpdaterService {
  return updaterService ?? initializeUpdater();
}

function scheduleChecks(service: UpdaterService): void {
  // Give the first window time to finish loading, then keep the about page fresh.
  // 触发时点实时读偏好:autoCheckOnStartup 关闭的运行期里,已排定但未触发的检查直接跳过。
  const firstCheck = setTimeout(() => {
    if (getUpdatePreferences().autoCheckOnStartup) void service.check();
  }, 10_000);
  firstCheck.unref();

  const periodicCheck = setInterval(
    () => {
      if (getUpdatePreferences().autoCheckOnStartup) void service.check();
    },
    6 * 60 * 60 * 1000,
  );
  periodicCheck.unref();
}
