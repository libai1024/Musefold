/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDiscardGuard } from '../use-discard-guard';

describe('useDiscardGuard', () => {
  it('closes immediately when clean, confirms when dirty', () => {
    const close = vi.fn();
    const clean = renderHook((dirty: boolean) => useDiscardGuard(dirty), { initialProps: false });
    act(() => clean.result.current.requestClose(close));
    expect(close).toHaveBeenCalledOnce();
    expect(clean.result.current.confirmOpen).toBe(false);

    const dirty = renderHook((value: boolean) => useDiscardGuard(value), { initialProps: true });
    act(() => dirty.result.current.requestClose(close));
    expect(close).toHaveBeenCalledOnce();
    expect(dirty.result.current.confirmOpen).toBe(true);

    act(() => dirty.result.current.confirmDiscard(close));
    expect(close).toHaveBeenCalledTimes(2);
    expect(dirty.result.current.confirmOpen).toBe(false);
  });
});
