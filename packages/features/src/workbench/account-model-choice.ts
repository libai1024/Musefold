import {
  ACCOUNT_QUOTA_PER_POINT,
  type AccountModelCatalog,
  type AccountSummary,
  type CloudModelPrice,
  cloudModelIdSchema,
  executionBindingSchema,
} from '@musefold/contracts';

export type AccountImageModel = AccountModelCatalog['models'][number];

export function modelUnavailableReason(model: AccountImageModel | undefined): string | null {
  if (!model) return '所选模型已不在当前账号目录中，请重新选择';
  if (model.pricing.kind === 'unavailable') {
    const messages: Record<Extract<CloudModelPrice, { kind: 'unavailable' }>['reason'], string> = {
      missing_price: '云端未提供价格，暂不可生成',
      group_not_enabled: '当前账号分组不可使用此模型',
      missing_group_ratio: '云端未提供账号分组倍率，暂不可生成',
      unsupported_billing: '暂不支持此模型的计费方式',
      invalid_price: '云端价格无效，暂不可生成',
    };
    return messages[model.pricing.reason];
  }
  if (!model.imageGeneration) return '当前不支持此模型的图像生成接口';
  return null;
}

function formatRate(quota: number): string {
  const points = quota / ACCOUNT_QUOTA_PER_POINT;
  // Do not round a positive (possibly very small) cloud rate down to "free".
  if (points > 0 && points < 0.000001) return points.toExponential(4);
  return new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 10 }).format(points);
}

export function modelPriceLabel(price: CloudModelPrice): string {
  if (price.kind === 'unavailable') return '价格不可用';
  if (price.kind === 'per_call') return `${formatRate(price.quotaPerCall)} 积分/计费次`;
  return `输入 ${formatRate(price.inputQuotaPerToken * 1_000_000)} / 输出 ${formatRate(price.outputQuotaPerToken * 1_000_000)} 积分/百万 token`;
}

/** Local UI preference only: never persist catalog prices, credentials or execution authority. */
export function modelPreferenceKey(catalog: AccountModelCatalog): string {
  const { apiIssuer, principalId, payer } = catalog.identity;
  return `musefold:account-image-model:${JSON.stringify([apiIssuer, principalId, payer.issuer, payer.ownerId])}`;
}

export function readModelPreference(key: string): string | null {
  try {
    const parsed = cloudModelIdSchema.safeParse(localStorage.getItem(key));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeModelPreference(key: string, model: string): boolean {
  try {
    localStorage.setItem(key, cloudModelIdSchema.parse(model));
    return true;
  } catch {
    return false;
  }
}

export function assertModelCatalogAccount(catalog: AccountModelCatalog, account: AccountSummary) {
  if (
    account.recovery ||
    account.identity?.status !== 'active' ||
    account.identity.apiIssuer !== catalog.identity.apiIssuer ||
    account.identity.principalId !== catalog.identity.principalId
  )
    throw new Error('模型目录与当前账号不一致，请重新核对账号');
}

/** This is only a client expectation. Server/main-process authorization remains mandatory. */
export function modelSubmission(catalog: AccountModelCatalog, model: string) {
  const reason = modelUnavailableReason(catalog.models.find((entry) => entry.model === model));
  if (reason) throw new Error(reason);
  return {
    model,
    expectedBinding: executionBindingSchema.parse({
      ...catalog.identity,
      providerId: 'cloud-default',
      model,
      capabilities: { image: true, text: false },
    }),
  };
}
