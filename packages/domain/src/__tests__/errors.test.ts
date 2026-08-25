// packages/domain/src/__tests__/errors.test.ts
// TASK-GEN-03：错误码 → 友好文案 + 可执行动作

import { describe, expect, it } from 'vitest';
import {
  errorGuidance,
  friendlyError,
  formatValidationMessage,
  toErrorCode,
} from '../errors';

describe('toErrorCode', () => {
  it('maps known codes case-insensitively', () => {
    expect(toErrorCode('auth')).toBe('AUTH');
    expect(toErrorCode('no_balance')).toBe('NO_BALANCE');
  });
  it('falls back to UNKNOWN', () => {
    expect(toErrorCode('nope')).toBe('UNKNOWN');
    expect(toErrorCode('WRONG_GROUP')).toBe('UNKNOWN');
    expect(toErrorCode(null)).toBe('UNKNOWN');
  });
  it('accepts legacy provider/document aliases', () => {
    expect(toErrorCode('AUTH_FAILED')).toBe('AUTH');
    expect(toErrorCode('INSUFFICIENT_BALANCE')).toBe('NO_BALANCE');
    expect(toErrorCode('RATE_LIMITED')).toBe('RATE_LIMIT');
    expect(toErrorCode('SERVER_ERROR')).toBe('SERVER');
    expect(toErrorCode('NETWORK_ERROR')).toBe('NETWORK');
    expect(toErrorCode('CONTENT_POLICY')).toBe('BAD_REQUEST');
  });
});

describe('errorGuidance', () => {
  it('AUTH → 更新密钥', () => {
    const g = errorGuidance('AUTH');
    expect(g.title).toMatch(/Key|密钥/i);
    expect(g.actions.map((a) => a.kind)).toEqual(['update_key']);
  });

  it('NO_BALANCE → 去充值', () => {
    const g = errorGuidance('NO_BALANCE');
    expect(g.actions).toEqual([{ kind: 'open_url', label: '去充值' }]);
  });

  it('RATE_LIMIT / SERVER / NETWORK → 重试', () => {
    for (const code of ['RATE_LIMIT', 'SERVER', 'NETWORK', 'TIMEOUT'] as const) {
      const g = errorGuidance(code);
      expect(g.actions.some((a) => a.kind === 'retry'), code).toBe(true);
    }
  });

  it('BAD_REQUEST → 检查模型', () => {
    const g = errorGuidance('BAD_REQUEST');
    expect(g.actions.map((a) => a.kind)).toContain('check_model');
  });

  it('NO_KEY → 更新密钥', () => {
    expect(errorGuidance('NO_KEY').actions.map((a) => a.kind)).toEqual(['update_key']);
  });
});

describe('friendlyError', () => {
  it('returns stable copy for every known code', () => {
    for (const code of [
      'AUTH',
      'NO_BALANCE',
      'RATE_LIMIT',
      'SERVER',
      'TIMEOUT',
      'NETWORK',
      'BAD_REQUEST',
      'NO_PROVIDER',
      'NO_KEY',
      'CANCELLED',
      'UNKNOWN',
    ] as const) {
      const f = friendlyError(code);
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('formatValidationMessage', () => {
  it('passes through success message', () => {
    expect(formatValidationMessage({ ok: true, message: '连接成功，模型可用' })).toEqual({
      title: '连接成功，模型可用',
    });
  });

  it('uses guidance title on failure and keeps detail', () => {
    const r = formatValidationMessage({
      ok: false,
      code: 'AUTH',
      message: 'Incorrect API key provided: sk-xxx',
    });
    expect(r.title).toMatch(/Key|密钥/i);
    expect(r.detail).toContain('Incorrect API key');
    expect(r.code).toBe('AUTH');
  });
});
