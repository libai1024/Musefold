/** @vitest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canMeasureVirtualRows,
  historyRowEstimate,
  historyThreadEstimate,
  promptRowEstimate,
  shouldVirtualizeList,
  useDocumentDensity,
  useRemeasureOnDensity,
  VIRTUAL_LIST_THRESHOLD,
} from '../use-virtual-rows';

afterEach(() => {
  delete document.documentElement.dataset.density;
});

describe('virtual list helpers', () => {
  it('keeps the 150-row threshold and density estimates', () => {
    expect(VIRTUAL_LIST_THRESHOLD).toBe(150);
    expect(shouldVirtualizeList(150)).toBe(false);
    expect(shouldVirtualizeList(151)).toBe(true);
    expect(promptRowEstimate('comfortable')).toBe(80);
    expect(promptRowEstimate('compact')).toBe(76);
    expect(historyRowEstimate('comfortable')).toBe(88);
    expect(historyRowEstimate('compact')).toBe(86);
    expect(historyThreadEstimate(3, 'comfortable')).toBe(264);
  });

  it('does not measure in jsdom (zero-rect would collapse the list)', () => {
    expect(canMeasureVirtualRows()).toBe(false);
  });
});

describe('useRemeasureOnDensity', () => {
  it('calls measure when html data-density changes', async () => {
    const measure = vi.fn();
    document.documentElement.dataset.density = 'comfortable';
    const view = renderHook(() => useRemeasureOnDensity({ measure }));
    expect(measure).not.toHaveBeenCalled();

    document.documentElement.dataset.density = 'compact';
    await waitFor(() => expect(measure).toHaveBeenCalledTimes(1));

    document.documentElement.dataset.density = 'comfortable';
    view.unmount();
  });
});

describe('useDocumentDensity', () => {
  it('reads compact from html data-density', () => {
    document.documentElement.dataset.density = 'compact';
    const view = renderHook(() => useDocumentDensity());
    expect(view.result.current).toBe('compact');
    document.documentElement.dataset.density = 'comfortable';
    view.unmount();
  });
});
