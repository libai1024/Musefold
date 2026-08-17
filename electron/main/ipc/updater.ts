import { ipcMain } from 'electron';
import { IPC } from '@shared/types/ipc';
import { getUpdaterService } from '../../update';

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IPC.UPDATER_GET_STATE, () => getUpdaterService().getState());
  ipcMain.handle(IPC.UPDATER_CHECK, () => getUpdaterService().check());
  ipcMain.handle(IPC.UPDATER_DOWNLOAD, () => getUpdaterService().download());
  ipcMain.handle(IPC.UPDATER_INSTALL, () => getUpdaterService().install());
}
