// electron/settings/pricing.ts
// Provider 单价配置：存于 electron-store 的 pricing.{providerId} 命名空间。

import Store from 'electron-store';
import { STORE_NAME } from '@musefold/core/constants';
import { getDb } from '@musefold/core/db/index';
import type {
  ProviderPricingConfig,
  ProviderPricingSetRequest,
} from '@shared/types/models';
import type { GenerateImageRequest } from '@shared/types/providers';
import {
  estimateCostFromPricing,
  normalizeProviderPricing,
  parseStoredProviderPricing,
  accountQuotaToPoints,
} from '@musefold/core/pricing';

interface ProviderStore {
  keys: Record<string, string>;
  pricing: Record<string, ProviderPricingConfig>;
}

const store = new Store<ProviderStore>({
  name: STORE_NAME,
  defaults: { keys: {}, pricing: {} },
});

function assertProviderId(providerId: string): void {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID 不能为空');
  }
}

export function getProviderPricing(providerId: string): ProviderPricingConfig | null {
  assertProviderId(providerId);
  const stored = store.get(`pricing.${providerId}`);
  const managed = getDb().prepare('SELECT managed_by FROM providers WHERE id = ?').get(providerId) as
    | { managed_by: string | null }
    | undefined;
  const pricing = parseStoredProviderPricing(
    stored,
    managed?.managed_by === 'account' ? accountQuotaToPoints : undefined,
  );
  if (pricing && stored && !('unitPoints' in (stored as object))) {
    store.set(`pricing.${providerId}`, pricing);
  }
  return pricing;
}

export function setProviderPricing(req: ProviderPricingSetRequest): ProviderPricingConfig {
  assertProviderId(req.providerId);
  const pricing = normalizeProviderPricing(req);
  store.set(`pricing.${req.providerId}`, pricing);
  return pricing;
}

export function deleteProviderPricing(providerId: string): void {
  assertProviderId(providerId);
  store.delete(`pricing.${providerId}`);
}

export function estimateProviderCost(
  providerId: string,
  req: Pick<GenerateImageRequest, 'n'>,
  usageTokens?: number | null,
): number | null {
  return estimateCostFromPricing(getProviderPricing(providerId), req, usageTokens);
}
