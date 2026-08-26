// 桌面 AccountStatus → contracts AccountSummary。HTTP 会话与 CSRF 不进入 renderer 端口。

import type { AccountSummary } from '@musefold/contracts';
import type { AccountStatus } from '@musefold/desktop-contracts/account';

/**
 * 未登录返回 null，由 gateway 转成错误。
 * 有损：displayName 恒 null；quotaUnit 固定「点」；canGenerate 由 health===ok 推导；
 * deviceTokenSuffix / serverUrl / notices / estImagesRemaining 不在 AccountSummary 上，丢弃。
 */
export function accountStatusToSummary(status: AccountStatus): AccountSummary | null {
  if (!status.loggedIn || !status.userId || !status.username) return null;
  const username = status.username.slice(0, 64);
  return {
    id: status.userId,
    username,
    displayName: null,
    quota: status.quota?.value ?? 0,
    quotaUnit: '点',
    canGenerate: status.health === 'ok',
  };
}
