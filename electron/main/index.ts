// electron/main/index.ts
// Minimal bootstrap: configure test isolation first, then load the application.

import { app } from 'electron';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { LOGS_DIR_NAME } from '@shared/constants';
import { writeConsoleLine } from '../system/console-output';
import { registerMediaScheme } from './media-protocol';
import { reportMainDiagnostic, showNativeDiagnostic } from './diagnostics';

const e2eUserData = process.env['MUSEFOLD_E2E_USER_DATA_DIR'];

// v0.4 workspaces：根包更名为 musefold-app（npm 包名 musefold 让给 CLI，D9）。
// Electron 开发态的 userData 默认按包名派生，这里显式钉回历史路径
// `.../musefold`，保证改名不搬家。打包态由 productName（Musefold）决定，不受影响。
// E2E 的隔离目录在下方覆盖，优先级更高。
if (!app.isPackaged) {
  app.setName('musefold');
  app.setPath('userData', join(app.getPath('appData'), 'musefold'));
}

// Packaged smoke tests run alongside the user's development instance. Isolate
// their profile before any application module reads Electron's standard paths.
if (process.env['MUSEFOLD_E2E'] === '1') {
  if (e2eUserData) {
    const isolatedUserData = resolve(e2eUserData);
    mkdirSync(isolatedUserData, { recursive: true });
    app.setPath('userData', isolatedUserData);
  }

  const debuggingPort = process.env['MUSEFOLD_E2E_REMOTE_DEBUGGING_PORT'];
  if (debuggingPort && /^\d{2,5}$/.test(debuggingPort)) {
    app.commandLine.appendSwitch('remote-debugging-port', debuggingPort);
  }

  // Unsigned automation builds do not have a stable Keychain identity. Keep
  // safeStorage coverage deterministic without touching the user's Keychain.
  app.commandLine.appendSwitch('use-mock-keychain');
}

// Privileged schemes must be declared synchronously before Electron becomes ready.
registerMediaScheme();

process.on('uncaughtException', (error: unknown) => {
  const report = reportMainDiagnostic(error, {
    source: 'main-process',
    operation: 'process.uncaughtException',
    forceNative: true,
  });
  void showNativeDiagnostic(report).then(() => app.exit(1));
});

process.on('unhandledRejection', (reason: unknown) => {
  reportMainDiagnostic(reason, {
    source: 'unhandled-rejection',
    operation: 'process.unhandledRejection',
  });
});

void import('./application').catch((error: unknown) => {
  const message = formatStartupError(error);
  const logPath = startupErrorLogPath();

  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${new Date().toISOString()}\n${message}\n\n`, 'utf8');
  } catch {
    // stderr remains available when even the application data path is unusable.
  }

  writeConsoleLine('error', `[Musefold] Main process failed to start: ${message}`);

  if (process.env['MUSEFOLD_E2E'] === '1') {
    app.exit(1);
    return;
  }

  const report = reportMainDiagnostic(error, {
    source: 'main-process',
    operation: 'application.bootstrap',
    context: { startupLogPath: logPath },
    forceNative: true,
  });
  void showNativeDiagnostic(report).then(() => app.exit(1));
});

function startupErrorLogPath(): string {
  const userData = e2eUserData ? resolve(e2eUserData) : app.getPath('userData');
  return join(userData, LOGS_DIR_NAME, 'startup-error.log');
}

function formatStartupError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}
