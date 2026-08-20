// Provider 单价配置与成本估算的纯逻辑（主进程 IPC / Provider / 单测共用）。
// 归入 core：运行时纯函数，但类型面是桌面 SQLite/IPC 行模型，domain 不能依赖 desktop-contracts。

import type {
  ProviderPricingConfig,
  ProviderPricingMode,
} from '@shared/types/models';
import type { GenerateImageRequest } from '@shared/types/providers';
import { ACCOUNT_QUOTA_PER_POINT } from '@musefold/contracts/billing.js';

/** 唯一成本口径：1 积分 = ¥0.1 = 50,000 服务端原始配额。 */
export const CNY_CENTS_PER_POINT = 10;

export function roundPoints(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function cnyCentsToPoints(cents: number): number {
  return roundPoints(cents / CNY_CENTS_PER_POINT);
}

export function accountQuotaToPoints(quota: number): number {
  return roundPoints(quota / ACCOUNT_QUOTA_PER_POINT);
}

export const PROVIDER_PRICING_MODES: ProviderPricingMode[] = ['per-image', 'per-1k-token'];

export function isProviderPricingMode(value: unknown): value is ProviderPricingMode {
  return value === 'per-image' || value === 'per-1k-token';
}

export function normalizeProviderPricing(input: unknown): ProviderPricingConfig {
  const raw = input as Partial<ProviderPricingConfig> | null | undefined;
  if (!raw || !isProviderPricingMode(raw.mode)) {
    throw new Error('计费方式无效');
  }
  const unitPoints = raw.unitPoints;
  if (typeof unitPoints !== 'number' || !Number.isFinite(unitPoints)) {
    throw new Error('单价必须是有效积分数');
  }
  if (unitPoints < 0) {
    throw new Error('单价不能为负数');
  }
  return { mode: raw.mode, unitPoints: roundPoints(unitPoints) };
}

export function parseStoredProviderPricing(
  input: unknown,
  legacyCentsConverter: (value: number) => number = cnyCentsToPoints,
): ProviderPricingConfig | null {
  try {
    const raw = input as { mode?: unknown; unitPoints?: unknown; unitCents?: unknown } | null;
    if (raw?.unitPoints == null && typeof raw?.unitCents === 'number') {
      return normalizeProviderPricing({ mode: raw.mode, unitPoints: legacyCentsConverter(raw.unitCents) });
    }
    return normalizeProviderPricing(raw);
  } catch {
    return null;
  }
}

export function estimateCostFromPricing(
  pricing: ProviderPricingConfig | null | undefined,
  req: Pick<GenerateImageRequest, 'n'>,
  usageTokens?: number | null,
): number | null {
  if (!pricing) return null;
  if (pricing.mode === 'per-image') {
    const count = Number.isFinite(req.n) && req.n > 0 ? Math.floor(req.n) : 1;
    return roundPoints(pricing.unitPoints * count);
  }
  if (!Number.isFinite(usageTokens ?? NaN) || (usageTokens ?? 0) < 0) return null;
  return roundPoints(((usageTokens as number) / 1000) * pricing.unitPoints);
}
