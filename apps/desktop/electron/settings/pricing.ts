// electron/settings/pricing.ts
// Provider 定价存储：仅服务官方账号托管 Provider（managed_by='account'）。
// 中转站(BYOK)不做本地计费——非托管 Provider 一律无价格、估算为 null。
// 存于 electron-store 的 pricing.{providerId} 命名空间，条目只可能由
// ManagedProvisioner.applyImagePrice 写入（服务器价格同步）。

import Store from 'electron-store';
import { STORE_NAME } from '@musefold/core/constants';
import { getDb } from '@musefold/core/db/index';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';
import {
  estimateCostFromPricing,
  parseStoredProviderPricing,
  accountQuotaToPoints,
  type ProviderPricingConfig,
} from '@musefold/core/pricing';

interface ProviderStore {
  keys: Record<string, string>;
  pricing: Record<string, ProviderPricingConfig>;
}

const store = new Store<ProviderStore>({
  name: STORE_NAME,
  defaults: { keys: {}, pricing: {} },
});

function isManagedProvider(providerId: string): boolean {
  const row = getDb().prepare('SELECT managed_by FROM providers WHERE id = ?').get(providerId) as
    | { managed_by: string | null }
    | undefined;
  return row?.managed_by === 'account';
}

/** 仅托管 Provider 有价格；legacy unitCents（quota 口径）懒迁移仅对托管生效。 */
export function getProviderPricing(providerId: string): ProviderPricingConfig | null {
  if (!providerId || typeof providerId !== 'string') return null;
  if (!isManagedProvider(providerId)) return null;
  const stored = store.get(`pricing.${providerId}`);
  const pricing = parseStoredProviderPricing(stored, accountQuotaToPoints);
  if (pricing && stored && !('unitPoints' in (stored as object))) {
    store.set(`pricing.${providerId}`, pricing);
  }
  return pricing;
}

/** 账号价格同步的内部写入（仅托管 Provider 生效，非托管静默忽略）。 */
export function setManagedProviderPricing(providerId: string, unitPoints: number): void {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID 不能为空');
  }
  if (!Number.isFinite(unitPoints) || unitPoints < 0) {
    throw new Error('单价必须是有效的积分数');
  }
  if (!isManagedProvider(providerId)) return;
  store.set(`pricing.${providerId}`, { mode: 'per-image', unitPoints });
}

export function deleteProviderPricing(providerId: string): void {
  if (!providerId || typeof providerId !== 'string') return;
  store.delete(`pricing.${providerId}`);
}

/** 生成成本估算：托管 Provider 按服务器单价估算，其余（中转站/豆包网页）返回 null。 */
export function estimateProviderCost(
  providerId: string,
  req: Pick<GenerateImageRequest, 'n'>,
): number | null {
  return estimateCostFromPricing(getProviderPricing(providerId), req);
}

/** 一次性清扫（幂等）：删除本地中转站计费时代遗留的非托管 pricing 条目。 */
export function sweepUnmanagedProviderPricing(): void {
  const pricing = store.get('pricing');
  if (!pricing || Object.keys(pricing).length === 0) return;
  const rows = getDb()
    .prepare(`SELECT id FROM providers WHERE managed_by = 'account'`)
    .all() as Array<{ id: string }>;
  const managedIds = new Set(rows.map((row) => row.id));
  for (const providerId of Object.keys(pricing)) {
    if (!managedIds.has(providerId)) store.delete(`pricing.${providerId}`);
  }
}
