// 桌面 AccountStatus ↔ contracts AccountSession。设备令牌栈没有 CSRF / 账号 id。

import type { AccountSession } from '@musefold/contracts';
import type { AccountStatus } from '@musefold/desktop-contracts/account';

/** 桌面无 CSRF。占位串满足契约 min(32)，不可当安全令牌用。 */
export const DESKTOP_PLACEHOLDER_CSRF_TOKEN = 'desktop-local-session-no-csrf-token';

/**
 * 未登录返回 null，由 gateway 转成错误。
 * 有损：account.id 用 username 顶替；csrfToken 占位；displayName 恒 null；
 * quotaUnit 固定「点」；canGenerate 由 health===ok 推导；deviceTokenSuffix /
 * serverUrl / notices / estImagesRemaining 不在 AccountSession 上，丢弃。
 */
export function accountStatusToSession(status: AccountStatus): AccountSession | null {
  if (!status.loggedIn || !status.username) return null;
  const username = status.username.slice(0, 64);
  return {
    account: {
      id: username,
      username,
      displayName: null,
      quota: status.quota?.value ?? 0,
      quotaUnit: '点',
      canGenerate: status.health === 'ok',
    },
    csrfToken: DESKTOP_PLACEHOLDER_CSRF_TOKEN,
  };
}
