import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDiagnosticReport,
  formatDiagnosticReport,
} from '../diagnostics';

describe('diagnostic reports', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T10:20:30.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('keeps useful context while redacting credentials', () => {
    const report = createDiagnosticReport(new Error('request failed'), {
      process: 'renderer',
      source: 'ipc',
      operation: 'provider.validate',
      context: {
        path: '/Users/test/Musefold/data.json',
        prompt: 'A detailed architecture diagram',
        apiKey: 'sk-test-secret-key',
        headers: { Authorization: 'Bearer very-secret-token' },
      },
    });

    const text = formatDiagnosticReport(report);
    expect(text).toContain('/Users/test/Musefold/data.json');
    expect(text).toContain('A detailed architecture diagram');
    expect(text).not.toContain('sk-test-secret-key');
    expect(text).not.toContain('very-secret-token');
    expect(text).toContain('[REDACTED]');
  });

  it('serializes non-Error throws and nested causes', () => {
    const cause = new Error('root cause');
    const error = new Error('outer error', { cause });
    const report = createDiagnosticReport(error, {
      process: 'main',
      source: 'main-process',
      appVersion: '0.3.0-dev',
      platform: 'darwin',
    });

    expect(report.error.cause?.message).toBe('root cause');
    expect(formatDiagnosticReport(report)).toContain('outer error');
    expect(formatDiagnosticReport(report)).toContain('root cause');
  });
});
