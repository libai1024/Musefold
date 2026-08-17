import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagnosticReport } from '@shared/diagnostics';
import { diagnosticText, reportError, useErrorStore } from '../errors';

describe('global error queue', () => {
  beforeEach(() => {
    useErrorStore.getState().clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T10:20:30.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('deduplicates the same error and tracks occurrences', () => {
    const first = createDiagnosticReport(new Error('same failure'), {
      process: 'renderer',
      source: 'unhandled-rejection',
    });
    const second = createDiagnosticReport(new Error('same failure'), {
      process: 'renderer',
      source: 'unhandled-rejection',
    });

    useErrorStore.getState().push(first);
    useErrorStore.getState().push(second);

    const items = useErrorStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].occurrences).toBe(2);
  });

  it('keeps different failures in order and exposes copy text', () => {
    reportError(new Error('first failure'), { source: 'window-error' });
    vi.advanceTimersByTime(6000);
    reportError(new Error('second failure'), { source: 'window-error' });

    const items = useErrorStore.getState().items;
    expect(items).toHaveLength(2);
    expect(diagnosticText(items[0])).toContain('first failure');
    expect(diagnosticText(items[1])).toContain('second failure');
  });
});
