// electron/account/index.ts
// 主进程账号服务单例。application.whenReady → initDb 后由 IPC 注册首次构造。

import { BrowserWindow } from 'electron';
import { IPC } from '@shared/types/ipc';
import { ElectronAiSecretKeychain } from '../security/ai-keychain';
import { AccountService } from './account-service';
import { AccountStore } from './account-store';
import { createManagedProvisioner } from './managed-provisioner';

let singleton: AccountService | null = null;

export function getAccountService(): AccountService {
  singleton ??= new AccountService({
    store: new AccountStore(),
    secrets: new ElectronAiSecretKeychain(),
    provisioner: createManagedProvisioner(),
    onChanged(status) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC.ACCOUNT_CHANGED, status);
      }
    },
  });
  return singleton;
}

/** 测试/应用退出用；当前不清持久化状态。 */
export function disposeAccountService(): void {
  singleton = null;
}
