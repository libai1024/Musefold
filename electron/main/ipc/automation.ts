// 自动化（控制面）IPC —— 设置页「自动化」面板的数据源（V04-SET-01）。

import { ipcMain } from 'electron';
import { IPC } from '@shared/types/ipc';
import {
  getAutomationStatus,
  listAutomationAudit,
  resolveAutomationConfirmation,
  rotateAutomationToken,
  setAutomationEnabledAndApply,
} from '../automation';
import { getAutomationBudget, setAutomationBudgetLimit } from '../../settings/automation';
import { getIntegrationInfo, runIntegrationAction } from '../integration';

export function registerAutomationHandlers(): void {
  ipcMain.handle(IPC.AUTOMATION_STATUS, () => getAutomationStatus());
  ipcMain.handle(IPC.AUTOMATION_SET_ENABLED, (_e, enabled: boolean) =>
    setAutomationEnabledAndApply(Boolean(enabled)),
  );
  ipcMain.handle(IPC.AUTOMATION_ROTATE_TOKEN, () => rotateAutomationToken());
  ipcMain.handle(IPC.AUTOMATION_AUDIT_LIST, (_e, limit?: number) => listAutomationAudit(limit));
  ipcMain.handle(IPC.AUTOMATION_CONFIRM, (_e, confirmationId: string, approved: boolean) => ({
    ok: resolveAutomationConfirmation(String(confirmationId), Boolean(approved)),
  }));
  ipcMain.handle(IPC.AUTOMATION_BUDGET_GET, () => getAutomationBudget());
  ipcMain.handle(IPC.AUTOMATION_BUDGET_SET, (_e, monthlyLimitCents: number) =>
    setAutomationBudgetLimit(Number(monthlyLimitCents)),
  );
  ipcMain.handle(IPC.AUTOMATION_INTEGRATION_INFO, () => getIntegrationInfo());
  ipcMain.handle(IPC.AUTOMATION_INTEGRATION_ACTION, (_e, action: import('@shared/types/ipc').IntegrationAction) =>
    runIntegrationAction(action),
  );
}
