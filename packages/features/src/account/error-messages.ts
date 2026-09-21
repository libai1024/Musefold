import type { ApiErrorCode } from '@musefold/contracts';

/**
 * 账号域错误码 → 中文文案 + 建议动作(ui-parity 07-01 P2,承旧 AccountSignedInPanel.actionError)。
 * 码表对齐 contracts `apiErrorCodeSchema` 的 AUTH_* / ACCOUNT_* / OAuth 授权码;
 * 桌面桥另有 `ACCOUNT_SERVICE_UNAVAILABLE`(不在契约枚举,按旧 NETWORK 口径承接)。
 * 未知码回退原始 message,避免吞掉诊断线索。
 */

export interface AccountErrorCopy {
  /** 就地红字主句(I4)。 */
  message: string;
  /** 建议动作;与主句拼成一句展示。 */
  action: string;
}

/** 登录 / 注册 / 兑换会碰到的契约码 + 桌面桥网络码。 */
export const ACCOUNT_AUTH_ERROR_CODES = [
  'AUTH_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'AUTH_CREDENTIALS_INVALID',
  'AUTH_2FA_REQUIRED',
  'AUTH_SESSION_LIMIT',
  'AUTH_SESSION_ISSUANCE_LIMIT',
  'AUTH_SESSION_REVIEW_CHANGED',
  'AUTH_LOGIN_CHALLENGE_EXPIRED',
  'AUTH_OPERATION_CONFLICT',
  'AUTH_SESSION_MANAGEMENT_UNAVAILABLE',
  'AUTH_REGISTRATION_DISABLED',
  'OAUTH_INVALID_GRANT',
  'OAUTH_SCOPE_INSUFFICIENT',
  'ACCOUNT_QUOTA_INSUFFICIENT',
  'ACCOUNT_REDEEM_INVALID',
  'ACCOUNT_SERVICE_UNAVAILABLE',
  'ACCOUNT_IDENTITY_UNVERIFIED',
  'ACCOUNT_RECOVERY_CONFLICT',
  'ACCOUNT_RECOVERY_EXPIRED',
  'ACCOUNT_IDENTITY_SOURCE_CHANGED',
] as const;

export type AccountAuthErrorCode = (typeof ACCOUNT_AUTH_ERROR_CODES)[number];

const ACCOUNT_ERROR_COPY: Record<AccountAuthErrorCode, AccountErrorCopy> = {
  AUTH_REQUIRED: { message: '请先登录', action: '登录后再试' },
  AUTH_SESSION_EXPIRED: { message: '登录状态已失效', action: '请重新登录' },
  AUTH_CREDENTIALS_INVALID: { message: '用户名或密码不正确', action: '请检查后重试' },
  AUTH_2FA_REQUIRED: { message: '需要两步验证', action: '请填写验证码或备用码，并重新输入密码' },
  AUTH_SESSION_LIMIT: { message: '登录设备数量已达上限', action: '请在弹窗中选择要释放的设备' },
  AUTH_SESSION_ISSUANCE_LIMIT: {
    message: '登录次数已达安全上限',
    action: '请稍后再试；释放设备不会重置此限制',
  },
  AUTH_SESSION_REVIEW_CHANGED: { message: '设备状态已变化', action: '请刷新后重新选择并确认' },
  AUTH_LOGIN_CHALLENGE_EXPIRED: { message: '验证已过期', action: '请重新登录' },
  AUTH_OPERATION_CONFLICT: {
    message: '原登录请求正在核对',
    action: '请稍后核对原请求，不要追加释放设备',
  },
  AUTH_SESSION_MANAGEMENT_UNAVAILABLE: {
    message: '账号服务器尚未支持设备管理',
    action: '请在账号控制台管理登录设备',
  },
  AUTH_REGISTRATION_DISABLED: { message: '当前未开放注册', action: '请改用登录或联系管理员' },
  OAUTH_INVALID_GRANT: { message: '授权已失效', action: '请重新登录' },
  OAUTH_SCOPE_INSUFFICIENT: { message: '授权范围不足', action: '请重新授权后再试' },
  ACCOUNT_QUOTA_INSUFFICIENT: { message: '账户额度不足', action: '请兑换后再试' },
  ACCOUNT_REDEEM_INVALID: { message: '兑换码无效或已使用', action: '请检查后重试' },
  ACCOUNT_SERVICE_UNAVAILABLE: { message: '暂时无法连接账号服务器', action: '请稍后重试' },
  ACCOUNT_IDENTITY_UNVERIFIED: { message: '账号归属尚未验证', action: '请在账号页完成恢复' },
  ACCOUNT_RECOVERY_CONFLICT: {
    message: '恢复申请与当前账号不匹配或状态已变化',
    action: '请核对原设备账号并刷新恢复状态',
  },
  ACCOUNT_RECOVERY_EXPIRED: {
    message: '恢复申请已过期',
    action: '请在申请恢复的设备退出后重新登录',
  },
  ACCOUNT_IDENTITY_SOURCE_CHANGED: {
    message: '账号服务来源已变化',
    action: '请重新登录并核对账号归属',
  },
};

export function extractErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return undefined;
}

export function accountErrorCopy(error: unknown): AccountErrorCopy {
  const code = extractErrorCode(error);
  if (code && code in ACCOUNT_ERROR_COPY) {
    return ACCOUNT_ERROR_COPY[code as AccountAuthErrorCode];
  }
  const fallback = error instanceof Error ? error.message.trim() : '';
  return {
    message: fallback || '操作失败,请重试',
    action: '请稍后重试',
  };
}

/** 表单红字 / toast:已知码拼「文案。建议动作」;未知码只用原始 message。 */
export function accountErrorMessage(error: unknown): string {
  const code = extractErrorCode(error);
  if (code && code in ACCOUNT_ERROR_COPY) {
    const copy = ACCOUNT_ERROR_COPY[code as AccountAuthErrorCode];
    if (code === 'AUTH_SESSION_ISSUANCE_LIMIT' && error instanceof Error) {
      const retry = error.message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)?.[0];
      if (retry && Number.isFinite(Date.parse(retry)))
        return `${copy.message}。${copy.action}；最早可重试：${new Date(retry).toLocaleString()}`;
    }
    return `${copy.message}。${copy.action}`;
  }
  return accountErrorCopy(error).message;
}

/** 单测用:契约 AUTH_* / ACCOUNT_* 枚举里本表覆盖的码(OAuth 授权码一并收录)。 */
export function isMappedAccountErrorCode(
  code: ApiErrorCode | AccountAuthErrorCode,
): code is AccountAuthErrorCode {
  return code in ACCOUNT_ERROR_COPY;
}
