// shared/pricing.ts
// Provider 单价配置与成本估算的纯逻辑（主进程 IPC / Provider / 单测共用）。

import type {
  ProviderPricingConfig,
  ProviderPricingMode,
} from './types/models';
import type { GenerateImageRequest } from './types/providers';

export const PROVIDER_PRICING_MODES: ProviderPricingMode[] = ['per-image', 'per-1k-token'];

export function isProviderPricingMode(value: unknown): value is ProviderPricingMode {
  return value === 'per-image' || value === 'per-1k-token';
}

export function normalizeProviderPricing(input: unknown): ProviderPricingConfig {
  const raw = input as Partial<ProviderPricingConfig> | null | undefined;
  if (!raw || !isProviderPricingMode(raw.mode)) {
    throw new Error('计费方式无效');
  }
  const unitCents = raw.unitCents;
  if (typeof unitCents !== 'number' || !Number.isFinite(unitCents) || !Number.isInteger(unitCents)) {
    throw new Error('单价必须是整数分');
  }
  if (unitCents < 0) {
    throw new Error('单价不能为负数');
  }
  return { mode: raw.mode, unitCents };
}

export function parseStoredProviderPricing(input: unknown): ProviderPricingConfig | null {
  try {
    return normalizeProviderPricing(input);
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
    return pricing.unitCents * count;
  }
  if (!Number.isFinite(usageTokens ?? NaN) || (usageTokens ?? 0) < 0) return null;
  return Math.round(((usageTokens as number) / 1000) * pricing.unitCents);
}
