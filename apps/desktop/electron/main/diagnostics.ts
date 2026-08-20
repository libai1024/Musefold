import { app, BrowserWindow, clipboard, dialog } from 'electron';
import {
  createDiagnosticReport,
  formatDiagnosticReport,
  type DiagnosticReport,
  type DiagnosticSource,
} from '@musefold/desktop-contracts/diagnostics';
import { IPC } from '@musefold/desktop-contracts/ipc';
import { APP_VERSION } from '../system/app-version';
import { createLogger } from '../system/logger';

const logger = createLogger('diagnostics');

export interface MainDiagnosticOptions {
  source?: DiagnosticSource;
  operation?: string;
  context?: Record<string, unknown>;
  forceNative?: boolean;
}

export function reportMainDiagnostic(
  error: unknown,
  options: MainDiagnosticOptions = {},
): DiagnosticReport {
  const report = createDiagnosticReport(error, {
    process: 'main',
    source: options.source ?? 'main-process',
    operation: options.operation,
    context: options.context,
    appVersion: APP_VERSION,
    platform: process.platform,
  });
  logger.error(
    '未捕获异常',
    `id=${report.id}`,
    `source=${report.source}`,
    report.error.name,
    report.error.message,
    report.error.stack ?? '',
  );

  const delivered = !options.forceNative && sendToRenderer(report);
  if (!delivered && !options.forceNative) void showNativeDiagnostic(report);
  return report;
}

export function sendToRenderer(report: DiagnosticReport): boolean {
  let delivered = false;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    try {
      win.webContents.send(IPC.DIAGNOSTICS_ERROR, report);
      delivered = true;
    } catch {
      // A renderer may disappear between the checks and send().
    }
  }
  return delivered;
}

export async function showNativeDiagnostic(report: DiagnosticReport): Promise<void> {
  try {
    if (!app.isReady()) await app.whenReady();
    const text = formatDiagnosticReport(report);
    const result = await dialog.showMessageBox({
      type: 'error',
      title: 'Musefold 发生错误',
      message: '应用捕获到一个未预期错误。',
      detail: text,
      buttons: ['复制错误信息', '关闭'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) clipboard.writeText(text);
  } catch {
    // There is no further UI fallback when Electron itself cannot show a dialog.
  }
}
