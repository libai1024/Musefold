// electron/account/api-client.ts
// 桌面账号 HTTP 面：委托 @musefold/new-api-client；错误形状保持 RelayApiError。
// 不触碰 keychain / electron-store / 数据库；设备令牌编排在 account-service。
//
// 凭据红线：本模块的返回值只在主进程内存流转；调用方负责入 keychain。
// 日志纪律（FR-ERR-04）：本模块不打日志——message 原文由上层脱敏后决定去向。

import type { AccountErrorCode } from '@musefold/desktop-contracts/account';
import {
  createNewApiClient as createSharedNewApiClient,
  noticeId,
  type NewApiClient,
  type NewApiErrorCode,
  type RelayApiToken,
  type RelayAuthSession,
  type RelayModelPricing,
  type RelayNotice,
  type RelayPricing,
  type RelayUser,
} from '@musefold/new-api-client';

export class RelayApiError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'RelayApiError';
  }
}

export type {
  NewApiClient,
  RelayApiToken,
  RelayAuthSession,
  RelayModelPricing,
  RelayNotice,
  RelayPricing,
  RelayUser,
};
export { noticeId };

export interface NewApiClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const ERROR_CODE_MAP = {
  credentials: 'ACCOUNT/CREDENTIALS',
  conflict: 'ACCOUNT/CONFLICT',
  auth: 'ACCOUNT/AUTH',
  redeem: 'ACCOUNT/REDEEM_INVALID',
  network: 'ACCOUNT/NETWORK',
  server: 'ACCOUNT/SERVER',
} as const satisfies Record<NewApiErrorCode, AccountErrorCode>;

/** 桌面 setServerUrl 的用户可见文案；包内 normalizeNewApiUrl 对 web-api 配置校验保持原句。 */
export function normalizeAccountServerUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new RelayApiError('ACCOUNT/SERVER', '服务器地址不是有效 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RelayApiError('ACCOUNT/SERVER', '服务器地址只支持 http 或 https');
  }
  if (url.username || url.password) throw new RelayApiError('ACCOUNT/SERVER', '服务器地址不能包含用户名或密码');
  if (url.search || url.hash) throw new RelayApiError('ACCOUNT/SERVER', '服务器地址不能包含查询参数或片段');
  url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function createNewApiClient(serverUrl: string, options: NewApiClientOptions = {}): NewApiClient {
  const base = normalizeAccountServerUrl(serverUrl);
  return createSharedNewApiClient(base, {
    ...options,
    createError(code, message, httpStatus) {
      return new RelayApiError(ERROR_CODE_MAP[code], message, httpStatus);
    },
  });
}
