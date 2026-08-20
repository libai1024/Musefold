// Electron 只允许在 app ready 之前调用一次 registerSchemesAsPrivileged。
// media:// 与 app:// 必须在同一次调用里声明，否则后注册的 scheme 会丢失特权。

import { protocol, type CustomScheme } from 'electron';

export const MEDIA_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: 'media',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
  },
};

export const APP_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  },
};

let registered = false;

export function registerPrivilegedSchemes(): void {
  if (registered) return;
  registered = true;
  protocol.registerSchemesAsPrivileged([MEDIA_SCHEME_PRIVILEGES, APP_SCHEME_PRIVILEGES]);
}
