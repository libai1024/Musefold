import { apiErrorCodeSchema } from '@musefold/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_AUTH_ERROR_CODES,
  accountErrorCopy,
  accountErrorMessage,
  extractErrorCode,
} from '../error-messages';

function coded(code: string, message = 'raw-upstream'): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

describe('accountErrorMessage', () => {
  it('displays only a valid retry time from issuance errors, not upstream text', () => {
    const retryAt = '2026-09-21T08:00:00.000Z';
    const message = accountErrorMessage(
      coded('AUTH_SESSION_ISSUANCE_LIMIT', `private-detail ${retryAt}`),
    );
    expect(message).toContain(new Date(retryAt).toLocaleString());
    expect(message).not.toContain('private-detail');
    expect(
      accountErrorMessage(coded('AUTH_SESSION_ISSUANCE_LIMIT', 'private-detail invalid')),
    ).not.toContain('private-detail');
  });
  it.each([
    ['AUTH_REQUIRED', '请先登录。登录后再试'],
    ['AUTH_SESSION_EXPIRED', '登录状态已失效。请重新登录'],
    ['AUTH_CREDENTIALS_INVALID', '用户名或密码不正确。请检查后重试'],
    ['AUTH_REGISTRATION_DISABLED', '当前未开放注册。请改用登录或联系管理员'],
    ['OAUTH_INVALID_GRANT', '授权已失效。请重新登录'],
    ['OAUTH_SCOPE_INSUFFICIENT', '授权范围不足。请重新授权后再试'],
    ['ACCOUNT_QUOTA_INSUFFICIENT', '账户额度不足。请兑换后再试'],
    ['ACCOUNT_REDEEM_INVALID', '兑换码无效或已使用。请检查后重试'],
    ['ACCOUNT_SERVICE_UNAVAILABLE', '暂时无法连接账号服务器。请稍后重试'],
  ] as const)('maps %s to Chinese copy + action', (code, expected) => {
    const copy = accountErrorCopy(coded(code, 'should-not-surface'));
    expect(copy.message.length).toBeGreaterThan(0);
    expect(copy.action.length).toBeGreaterThan(0);
    expect(accountErrorMessage(coded(code, 'should-not-surface'))).toBe(expected);
  });

  it('covers every AUTH_* / ACCOUNT_* contract code plus desktop network alias', () => {
    const contractAuthCodes = apiErrorCodeSchema.options.filter(
      (code) =>
        code.startsWith('AUTH_') || code.startsWith('ACCOUNT_') || code.startsWith('OAUTH_'),
    );
    for (const code of contractAuthCodes) {
      expect(ACCOUNT_AUTH_ERROR_CODES).toContain(code);
      expect(accountErrorMessage(coded(code))).not.toBe('should-not-surface');
    }
    expect(ACCOUNT_AUTH_ERROR_CODES).toContain('ACCOUNT_SERVICE_UNAVAILABLE');
  });

  it('unknown codes fall back to the original message', () => {
    expect(accountErrorMessage(coded('PROMPT_NOT_FOUND', '提示词不存在'))).toBe('提示词不存在');
    expect(accountErrorMessage(new Error('用户名或密码不正确'))).toBe('用户名或密码不正确');
    expect(accountErrorMessage('not-an-error')).toBe('操作失败,请重试');
  });

  it('extracts .code from gateway-shaped errors', () => {
    expect(extractErrorCode(coded('ACCOUNT_REDEEM_INVALID'))).toBe('ACCOUNT_REDEEM_INVALID');
    expect(extractErrorCode(new Error('no code'))).toBeUndefined();
  });
});
