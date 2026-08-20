// 账号积分展示 —— Web / 桌面共用的 quota → 积分换算与格式化。
// 计费常量留在 `@musefold/contracts/billing.js`（服务端口径）；本模块只消费它。

import { ACCOUNT_QUOTA_PER_POINT } from '@musefold/contracts/billing.js';

/** 服务器 quota 原值 → 用户侧「积分」数值（1 积分 = ¥0.1 = 50000 quota）。 */
export function quotaToPoints(quota: number): number {
  return quota / ACCOUNT_QUOTA_PER_POINT;
}

/** 积分展示：最多 2 位小数（一张图约 0.4 积分，四舍五入到整数会看不见变化）。 */
export function formatPoints(quota: number): string {
  return quotaToPoints(quota).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/** Web 侧已验证名称；与 `formatPoints` 同一实现。 */
export { formatPoints as formatAccountPoints };
