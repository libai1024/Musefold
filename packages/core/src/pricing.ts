// 积分换算与托管 Provider 价格解析/估算的纯逻辑（主进程侧存储与单测共用）。
// 本地中转站自定义单价已移除：价格条目只可能属于官方账号托管 Provider。
// 归入 core：运行时纯函数，但类型面是桌面 IPC 行模型，domain 不能依赖 desktop-contracts。

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

/** 托管 Provider 的存储形状（electron-store pricing.{providerId}，仅主进程使用）。 */
export interface ProviderPricingConfig {
  mode: 'per-image';
  /** 每张图片的价格（积分）。 */
  unitPoints: number;
}

function normalizePricingValue(mode: unknown, unitPoints: unknown): ProviderPricingConfig {
  if (mode !== 'per-image') {
    throw new Error('计费方式无效');
  }
  if (typeof unitPoints !== 'number' || !Number.isFinite(unitPoints)) {
    throw new Error('单价必须是有效积分数');
  }
  if (unitPoints < 0) {
    throw new Error('单价不能为负数');
  }
  return { mode, unitPoints: roundPoints(unitPoints) };
}

export function parseStoredProviderPricing(
  input: unknown,
  legacyCentsConverter: (value: number) => number = cnyCentsToPoints,
): ProviderPricingConfig | null {
  try {
    const raw = input as { mode?: unknown; unitPoints?: unknown; unitCents?: unknown } | null;
    if (raw?.unitPoints == null && typeof raw?.unitCents === 'number') {
      return normalizePricingValue(raw.mode, legacyCentsConverter(raw.unitCents));
    }
    return normalizePricingValue(raw?.mode, raw?.unitPoints);
  } catch {
    return null;
  }
}

export function estimateCostFromPricing(
  pricing: ProviderPricingConfig | null | undefined,
  req: { n?: number },
): number | null {
  if (!pricing) return null;
  const count = Number.isFinite(req.n) && (req.n ?? 0) > 0 ? Math.floor(req.n ?? 1) : 1;
  return roundPoints(pricing.unitPoints * count);
}
