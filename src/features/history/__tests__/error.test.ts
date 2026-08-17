import { describe, expect, it } from 'vitest';
import { historyErrorPresentation } from '../error';

describe('historyErrorPresentation', () => {
  it('allows retry for transient provider errors', () => {
    const p = historyErrorPresentation('RATE_LIMIT', '429');
    expect(p.displayTitle).toBe('请求过于频繁');
    expect(p.canRetry).toBe(true);
    expect(p.primaryAction).toEqual({ kind: 'retry', label: '重试' });
  });

  it('shows a recovery action instead of retry for auth failures', () => {
    const p = historyErrorPresentation('AUTH', '401');
    expect(p.displayTitle).toMatch(/Key|密钥/);
    expect(p.canRetry).toBe(false);
    expect(p.primaryAction?.kind).toBe('update_key');
  });

  it('keeps the original message for unknown codes', () => {
    const p = historyErrorPresentation('PROVIDER_CUSTOM', '上游返回了自定义错误');
    expect(p.displayTitle).toBe('上游返回了自定义错误');
    expect(p.canRetry).toBe(true);
  });

  it('accepts the legacy product-document aliases', () => {
    expect(historyErrorPresentation('AUTH_FAILED').canRetry).toBe(false);
    expect(historyErrorPresentation('SERVER_ERROR').canRetry).toBe(true);
    expect(historyErrorPresentation('CONTENT_POLICY').primaryAction?.kind).toBe('check_model');
  });
});
