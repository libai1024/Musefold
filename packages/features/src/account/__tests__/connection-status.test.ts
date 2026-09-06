import { describe, expect, it } from 'vitest';
import { connectionStatusKind, connectionStatusLabel } from '../connection-status';

describe('connectionStatusKind', () => {
  it('prefers missing key over a passing test', () => {
    expect(connectionStatusKind(false, { ok: true, message: '连接正常', latencyMs: 10 })).toBe(
      'missing-key',
    );
    expect(connectionStatusLabel('missing-key')).toBe('未配置密钥');
  });

  it('marks a keyed connection tested-ok only after a passing session test', () => {
    expect(connectionStatusKind(true, undefined)).toBe('untested');
    expect(connectionStatusKind(true, { ok: false, message: 'HTTP 500', latencyMs: 3 })).toBe(
      'untested',
    );
    expect(connectionStatusKind(true, { ok: true, message: '连接正常', latencyMs: 12 })).toBe(
      'tested-ok',
    );
    expect(connectionStatusLabel('tested-ok')).toBe('最近测试通过');
  });
});
