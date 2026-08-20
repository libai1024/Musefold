// electron/main/ipc/settings.ts
// 设置类 IPC：目前承载 Provider 单价配置。

import { ipcMain } from 'electron';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type { ProviderPricingSetRequest } from '@musefold/desktop-contracts/models';
import { getDb } from '@musefold/core/db/index';
import {
  deleteProviderPricing,
  getProviderPricing,
  setProviderPricing,
} from '../../settings/pricing';

function assertProviderExists(providerId: string): void {
  const db = getDb();
  const row = db.prepare('SELECT id FROM providers WHERE id = ?').get(providerId);
  if (!row) throw new Error('Provider 不存在');
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_PRICING_GET, (_e, providerId: string) => {
    assertProviderExists(providerId);
    return getProviderPricing(providerId);
  });

  ipcMain.handle(IPC.SETTINGS_PRICING_SET, (_e, req: ProviderPricingSetRequest) => {
    assertProviderExists(req.providerId);
    return { ok: true as const, pricing: setProviderPricing(req) };
  });

  ipcMain.handle(IPC.SETTINGS_PRICING_DELETE, (_e, providerId: string) => {
    assertProviderExists(providerId);
    deleteProviderPricing(providerId);
    return { ok: true as const };
  });
}
