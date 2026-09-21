import {
  ACCOUNT_QUOTA_PER_USD,
  type AccountModelCatalog,
  type CloudModelPrice,
  type RelayModelPricing,
  type RelayPricing,
} from '@musefold/contracts';
import { supportsCloudImageGeneration } from './cloud-generation-policy';

/** No local tariff, default group multiplier or cross-account cache. */
export function projectAccountModelPrices(
  names: string[],
  pricing: RelayPricing,
  group: string,
): AccountModelCatalog['models'] {
  const prices = new Map(pricing.models.map((row) => [row.modelName, row]));
  return names.map((model) => {
    const row = prices.get(model);
    return {
      model,
      supportedEndpointTypes: row?.supportedEndpointTypes ?? [],
      imageGeneration: supportsCloudImageGeneration(model, row?.supportedEndpointTypes ?? []),
      pricing: quote(row, pricing, group),
    };
  });
}

function quote(
  row: RelayModelPricing | undefined,
  pricing: RelayPricing,
  group: string,
): CloudModelPrice {
  if (!row) return { kind: 'unavailable', reason: 'missing_price' };
  if (!row.enableGroups.includes(group) && !row.enableGroups.includes('all'))
    return { kind: 'unavailable', reason: 'group_not_enabled' };
  if (!Object.hasOwn(pricing.groupRatio, group))
    return { kind: 'unavailable', reason: 'missing_group_ratio' };
  const ratio = pricing.groupRatio[group];
  if (!valid(ratio)) return { kind: 'unavailable', reason: 'invalid_price' };
  if (row.billingMode && row.billingMode !== 'ratio')
    return { kind: 'unavailable', reason: 'unsupported_billing' };
  if (row.quotaType === 1) {
    if (!valid(row.modelPrice)) return { kind: 'unavailable', reason: 'missing_price' };
    const quota = row.modelPrice * ACCOUNT_QUOTA_PER_USD * ratio;
    if (!valid(quota)) return { kind: 'unavailable', reason: 'invalid_price' };
    return { kind: 'per_call', baseUsd: row.modelPrice, groupRatio: ratio, quotaPerCall: quota };
  }
  if (!valid(row.modelRatio) || !valid(row.completionRatio))
    return { kind: 'unavailable', reason: 'missing_price' };
  const input = row.modelRatio * ratio;
  const output = input * row.completionRatio;
  if (!valid(input) || !valid(output)) return { kind: 'unavailable', reason: 'invalid_price' };
  return {
    kind: 'usage',
    groupRatio: ratio,
    inputQuotaPerToken: input,
    outputQuotaPerToken: output,
  };
}

function valid(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}
