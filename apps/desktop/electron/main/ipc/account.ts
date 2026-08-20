// electron/main/ipc/account.ts
// v0.5 账号与云通道 IPC（V05-ACC-05）。
// 红线：所有响应只含 AccountStatus 摘要；密码入参不记录、不回显，JWT/refresh/sk- 永不出主进程。

import { ipcMain, type IpcMain } from 'electron';
import { IPC } from '@shared/types/ipc';
import type { AccountCredentialsInput } from '@shared/types/account';
import { getAccountService } from '../../account';
import { AccountError, toAccountError } from '../../account/errors';
import type { AccountService } from '../../account/account-service';

interface AccountIpcTarget {
  handle: IpcMain['handle'];
}

export interface AccountHandlerDependencies {
  target?: AccountIpcTarget;
  service?: AccountService;
}

function throwIpc(error: unknown): never {
  const accountError = error instanceof AccountError ? error : toAccountError(error);
  throw accountError.toIpcError();
}

function credentials(input: unknown): AccountCredentialsInput {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const username = typeof raw.username === 'string' ? raw.username.trim() : '';
  const password = typeof raw.password === 'string' ? raw.password : '';
  if (username.length < 3 || username.length > 12) {
    throw new AccountError('ACCOUNT/CREDENTIALS', '用户名需为 3–12 个字符');
  }
  if (password.length < 8) {
    throw new AccountError('ACCOUNT/CREDENTIALS', '密码长度至少为 8 个字符');
  }
  return { username, password };
}

export function registerAccountHandlers(dependencies: AccountHandlerDependencies = {}): void {
  const target = dependencies.target ?? ipcMain;
  const service = dependencies.service ?? getAccountService();

  target.handle(IPC.ACCOUNT_STATUS, () => service.status());
  target.handle(IPC.ACCOUNT_REGISTER, async (_event, input) => {
    try {
      return await service.register(credentials(input));
    } catch (error) {
      throwIpc(error);
    }
  });
  target.handle(IPC.ACCOUNT_LOGIN, async (_event, input) => {
    try {
      return await service.login(credentials(input));
    } catch (error) {
      throwIpc(error);
    }
  });
  target.handle(IPC.ACCOUNT_LOGOUT, async () => {
    try {
      return await service.logout();
    } catch (error) {
      throwIpc(error);
    }
  });
  target.handle(IPC.ACCOUNT_REDEEM, async (_event, code: unknown) => {
    try {
      return await service.redeem(typeof code === 'string' ? code : '');
    } catch (error) {
      throwIpc(error);
    }
  });
  target.handle(IPC.ACCOUNT_REFRESH_QUOTA, async () => {
    try {
      return await service.refreshQuota();
    } catch (error) {
      throwIpc(error);
    }
  });
  target.handle(IPC.ACCOUNT_SET_SERVER_URL, async (_event, url: unknown) => {
    try {
      return await service.setServerUrl(typeof url === 'string' ? url : '');
    } catch (error) {
      throwIpc(error);
    }
  });
}
