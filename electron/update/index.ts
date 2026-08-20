import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import { IPC } from '@shared/types/ipc';
import { APP_VERSION } from '../system/app-version';
import { getUpdateChannel } from '../settings/update-channel';
import {
  resolveUpdateFeedUrl,
  UpdaterService,
  type UpdaterAdapter,
} from './updater-service';

let updaterService: UpdaterService | null = null;

// electron-updater is CommonJS and defines autoUpdater through a getter, so a
// named ESM import works in TypeScript but fails when Electron loads the bundle.
const { autoUpdater } = electronUpdater;

export interface InitializeUpdaterOptions {
  beforeInstall?: () => Promise<void> | void;
}

/** Initialize the production updater once the app and its first window exist. */
export function initializeUpdater(options: InitializeUpdaterOptions = {}): UpdaterService {
  if (updaterService) return updaterService;

  const disabledReason = process.env['MUSEFOLD_DISABLE_AUTO_UPDATE'] === '1'
    ? 'disabled-by-environment'
    : !app.isPackaged
      ? 'development'
      : process.platform !== 'darwin' && process.platform !== 'win32'
        ? 'unsupported-platform'
        : undefined;
  const enabled = disabledReason === undefined;
  const channel = getUpdateChannel();

  updaterService = new UpdaterService({
    adapter: autoUpdater as unknown as UpdaterAdapter,
    currentVersion: APP_VERSION,
    enabled,
    disabledReason,
    channel,
    feedUrl: resolveUpdateFeedUrl(channel),
    beforeInstall: options.beforeInstall,
    onStateChanged: (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.UPDATER_STATE_CHANGED, status);
      }
    },
  });

  if (enabled) scheduleChecks(updaterService);
  return updaterService;
}

export function getUpdaterService(): UpdaterService {
  return updaterService ?? initializeUpdater();
}

function scheduleChecks(service: UpdaterService): void {
  // Give the first window time to finish loading, then keep the about page fresh.
  const firstCheck = setTimeout(() => { void service.check(); }, 10_000);
  firstCheck.unref();

  const periodicCheck = setInterval(() => { void service.check(); }, 6 * 60 * 60 * 1000);
  periodicCheck.unref();
}
