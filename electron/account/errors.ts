// electron/account/errors.ts
// AccountError —— 账号域错误：code 走 shared 契约，跨 IPC 由 preload 反序列化。

import type { AccountErrorCode, AccountErrorPayload, AccountLoginStage } from '@shared/types/account';
import { RelayApiError } from './api-client';

/** IPC 序列化前缀：主进程 throw → preload 解析还原（electron 只保留 Error.message） */
export const ACCOUNT_ERROR_IPC_PREFIX = 'ACCOUNT_ERR::';

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
    readonly stage?: AccountLoginStage,
  ) {
    super(message);
    this.name = 'AccountError';
  }

  toPayload(): AccountErrorPayload {
    return { code: this.code, message: this.message, stage: this.stage };
  }

  /** 供 IPC handler 抛出：message 携带结构化载荷 */
  toIpcError(): Error {
    return new Error(`${ACCOUNT_ERROR_IPC_PREFIX}${JSON.stringify(this.toPayload())}`);
  }
}

/** RelayApiError（网络层）→ AccountError（域层），附加编排阶段标签。 */
export function toAccountError(error: unknown, stage?: AccountLoginStage): AccountError {
  if (error instanceof AccountError) return error;
  if (error instanceof RelayApiError) return new AccountError(error.code, error.message, stage);
  const message = error instanceof Error ? error.message : String(error);
  return new AccountError('ACCOUNT/SERVER', message, stage);
}

/** preload 侧还原（也可用于测试断言） */
export function parseAccountIpcError(raw: string): AccountErrorPayload | null {
  const index = raw.indexOf(ACCOUNT_ERROR_IPC_PREFIX);
  if (index === -1) return null;
  try {
    return JSON.parse(raw.slice(index + ACCOUNT_ERROR_IPC_PREFIX.length)) as AccountErrorPayload;
  } catch {
    return null;
  }
}
