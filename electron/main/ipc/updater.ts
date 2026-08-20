import { ipcMain } from 'electron';
import { IPC } from '@shared/types/ipc';
import type { UpdateChannelResult } from '@shared/types/updater';
import { getUpdaterService } from '../../update';
import {
  getUpdateChannel,
  isUpdateChannel,
  isUpdateChannelLockedByEnv,
  setUpdateChannel,
} from '../../settings/update-channel';

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IPC.UPDATER_GET_STATE, () => getUpdaterService().getState());
  ipcMain.handle(IPC.UPDATER_CHECK, () => getUpdaterService().check());
  ipcMain.handle(IPC.UPDATER_DOWNLOAD, () => getUpdaterService().download());
  ipcMain.handle(IPC.UPDATER_INSTALL, () => getUpdaterService().install());
  ipcMain.handle(IPC.UPDATER_GET_CHANNEL, () => ({
    channel: getUpdateChannel(),
    lockedByEnv: isUpdateChannelLockedByEnv(),
  }));
  ipcMain.handle(IPC.UPDATER_SET_CHANNEL, (_event, raw: unknown): UpdateChannelResult => {
    const lockedByEnv = isUpdateChannelLockedByEnv();
    const current = getUpdateChannel();
    if (lockedByEnv) {
      return {
        ok: false,
        channel: current,
        lockedByEnv: true,
        message: '更新通道已由环境变量锁定，无法在设置中修改',
      };
    }
    if (!isUpdateChannel(raw)) {
      return {
        ok: false,
        channel: current,
        lockedByEnv: false,
        message: '不支持的更新通道',
      };
    }
    try {
      setUpdateChannel(raw);
      getUpdaterService().setChannel(raw);
      void getUpdaterService().check();
      return { ok: true, channel: raw, lockedByEnv: false };
    } catch (error: unknown) {
      return {
        ok: false,
        channel: getUpdateChannel(),
        lockedByEnv: false,
        message: sanitizeChannelError(error),
      };
    }
  });
}

function sanitizeChannelError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/[^\s)]+/gi, '[更新服务器]')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var)\/)[^\s)]+/g, '[本地路径]')
    .trim()
    .slice(0, 300) || '无法切换更新通道';
}
