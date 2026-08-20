import { describe, expect, it } from 'vitest';
import { historyStatusMeta } from '../status';

describe('historyStatusMeta', () => {
  it('success is green, not retryable', () => {
    const m = historyStatusMeta('success');
    expect(m.label).toBe('成功');
    expect(m.colorClass).toBe('text-success');
    expect(m.canRetry).toBe(false);
    expect(m.showError).toBe(false);
  });

  it('failed is red and retryable', () => {
    const m = historyStatusMeta('failed');
    expect(m.label).toBe('失败');
    expect(m.colorClass).toBe('text-danger');
    expect(m.canRetry).toBe(true);
    expect(m.showError).toBe(true);
  });

  it('cancelled is neutral gray — never looks like failed', () => {
    const m = historyStatusMeta('cancelled');
    expect(m.label).toBe('已取消');
    expect(m.colorClass).toBe('text-tertiary');
    expect(m.canRetry).toBe(false);
    expect(m.showError).toBe(false);
    expect(m.colorClass).not.toBe('text-danger');
  });

  it('unknown status falls back without throwing', () => {
    const m = historyStatusMeta('weird');
    expect(m.status).toBe('failed');
  });
});
